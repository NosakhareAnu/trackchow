const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');
const { estimateFoodNutrition } = require('../utils/ai-food-estimator');

const router = express.Router();

const DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '5', 10);

// Returns how many successful AI food searches the user has made today (UTC).
// Failed requests do not count — only actual successful lookups consume quota.
async function countTodaySuccessful(userId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const { count, error } = await supabase
    .from('ai_food_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'success')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());

  if (error) return 0; // fail open — do not block users if the count query fails
  return count ?? 0;
}

// Rounds a nutrition value to 2 decimal places.
function rnd(val) {
  return Math.round(Number(val) * 100) / 100;
}

// POST /ai/food-search
// Protected. Estimates nutrition for a food not found in the database.
router.post('/food-search', authMiddleware, async (req, res) => {
  try {
    // --- Validate input ---
    const { query: rawQuery } = req.body;

    if (!rawQuery || typeof rawQuery !== 'string') {
      return res.status(400).json({ success: false, message: 'query is required' });
    }

    const query = rawQuery.trim();

    if (query.length < 2) {
      return res.status(400).json({ success: false, message: 'query must be at least 2 characters' });
    }
    if (query.length > 80) {
      return res.status(400).json({ success: false, message: 'query must be 80 characters or fewer' });
    }
    // Reject symbol-only or number-only strings — must have at least one letter.
    if (!/[a-zA-Z]/.test(query)) {
      return res.status(400).json({ success: false, message: 'query must contain at least one letter' });
    }

    // --- Rate limit check ---
    const todayCount = await countTodaySuccessful(req.user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.json({
        success: false,
        limitReached: true,
        message: 'Daily AI search limit reached',
      });
    }

    // --- Check existing food_items first (skip AI if found) ---
    const { data: existingFoods } = await supabase
      .from('food_items')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(1);

    if (existingFoods && existingFoods.length > 0) {
      const food = existingFoods[0];

      const { data: servingUnits } = await supabase
        .from('food_serving_units')
        .select('id, unit_name, unit_type, grams, is_default')
        .eq('food_item_id', food.id)
        .order('is_default', { ascending: false })
        .order('unit_name', { ascending: true });

      return res.json({
        success: true,
        source: 'database',
        food,
        serving_units: servingUnits || [],
      });
    }

    // --- Call AI ---
    let aiResult;
    try {
      aiResult = await estimateFoodNutrition(query);
    } catch (aiErr) {
      console.error('[AI] estimateFoodNutrition error:', aiErr.message);
      await supabase.from('ai_food_requests').insert({
        user_id: req.user.id,
        query,
        status: 'failed',
        error_message: 'AI call failed',
      });
      return res.json({
        success: false,
        message: 'AI could not process this request. Please try again.',
      });
    }

    if (!aiResult) {
      // AI returned confident:false
      await supabase.from('ai_food_requests').insert({
        user_id: req.user.id,
        query,
        status: 'failed',
        error_message: 'AI not confident',
      });
      return res.json({
        success: false,
        message: 'AI could not confidently estimate nutrition for this food.',
      });
    }

    // --- Build legacy per-serving values from the default serving unit ---
    // legacy fields (calories, carbs_g, etc.) represent one default serving
    const defaultUnit =
      aiResult.suggested_serving_units?.find((u) => u.is_default) ||
      aiResult.suggested_serving_units?.[0];
    const defaultGrams = defaultUnit ? Number(defaultUnit.grams) : 100;
    const factor = defaultGrams / 100;

    const foodRow = {
      name: aiResult.name,
      category: aiResult.category,
      serving_unit: defaultUnit?.unit_name || 'g',
      serving_size_default: 1,
      calories: rnd(factor * Number(aiResult.calories_per_100g || 0)),
      carbs_g: rnd(factor * Number(aiResult.carbs_per_100g || 0)),
      protein_g: rnd(factor * Number(aiResult.protein_per_100g || 0)),
      fat_g: rnd(factor * Number(aiResult.fat_per_100g || 0)),
      fiber_g: rnd(factor * Number(aiResult.fiber_per_100g || 0)),
      calories_per_100g: aiResult.calories_per_100g,
      carbs_per_100g: aiResult.carbs_per_100g,
      protein_per_100g: aiResult.protein_per_100g,
      fat_per_100g: aiResult.fat_per_100g,
      fiber_per_100g: aiResult.fiber_per_100g,
      is_local: false,
      is_ai_estimated: true,
      created_by: req.user.id,
    };

    // --- Insert food item ---
    const { data: insertedFood, error: foodInsertError } = await supabase
      .from('food_items')
      .insert(foodRow)
      .select()
      .single();

    if (foodInsertError) {
      console.error('[AI] food insert error:', foodInsertError.message);
      await supabase.from('ai_food_requests').insert({
        user_id: req.user.id,
        query,
        status: 'failed',
        error_message: 'Failed to save food item',
      });
      return res.json({
        success: false,
        message: 'Failed to save estimated food. Please try again.',
      });
    }

    // --- Insert serving units ---
    let insertedUnits = [];
    if (Array.isArray(aiResult.suggested_serving_units) && aiResult.suggested_serving_units.length > 0) {
      const unitRows = aiResult.suggested_serving_units.map((u) => ({
        food_item_id: insertedFood.id,
        unit_name: String(u.unit_name),
        unit_type: u.unit_type === 'unconventional' ? 'unconventional' : 'conventional',
        grams: Number(u.grams),
        is_default: Boolean(u.is_default),
      }));

      const { data: units, error: unitsError } = await supabase
        .from('food_serving_units')
        .insert(unitRows)
        .select('id, unit_name, unit_type, grams, is_default');

      if (!unitsError) insertedUnits = units || [];
      // Serving unit insert failure is non-fatal — food was saved; don't roll back
    }

    // --- Log successful request (counts toward daily quota) ---
    await supabase.from('ai_food_requests').insert({
      user_id: req.user.id,
      query,
      status: 'success',
      result_food_item_id: insertedFood.id,
    });

    return res.json({
      success: true,
      source: 'ai',
      food: insertedFood,
      serving_units: insertedUnits,
    });
  } catch (err) {
    console.error('[AI] Unexpected error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
