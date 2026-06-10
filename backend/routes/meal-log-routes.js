const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');
const { updateTrackingStreak, updateGoalStreak } = require('../lib/streak-helpers');
const { calculateNutrition } = require('../utils/nutrition-calculator');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// Builds meal_log_items rows for an array of request items.
// foodMap: { [food_item_id]: food_row }
// servingUnitMap: { [serving_unit_id]: { id, grams } }
function buildItemRows(items, foodMap, servingUnitMap) {
  return items.map((item) => {
    const food = foodMap[item.food_item_id];
    const qty = Number(item.quantity);
    const servingUnit = item.serving_unit_id ? servingUnitMap[item.serving_unit_id] : null;
    const gramsPerUnit = servingUnit ? Number(servingUnit.grams) : null;
    const nutrition = calculateNutrition(food, qty, gramsPerUnit);
    return {
      food_item_id: item.food_item_id,
      quantity: qty,
      quantity_unit: item.quantity_unit,
      serving_unit_id: item.serving_unit_id || null,
      grams_per_unit: nutrition.grams_per_unit,
      total_grams: nutrition.total_grams,
      calories: nutrition.calories,
      carbs_g: nutrition.carbs_g,
      protein_g: nutrition.protein_g,
      fat_g: nutrition.fat_g,
      fiber_g: nutrition.fiber_g,
    };
  });
}

// Fetches food_serving_units rows for the given ids and returns a map keyed by id.
async function fetchServingUnitMap(servingUnitIds) {
  if (!servingUnitIds || servingUnitIds.length === 0) return {};
  const { data } = await supabase
    .from('food_serving_units')
    .select('id, grams')
    .in('id', servingUnitIds);
  const map = {};
  for (const su of (data || [])) {
    map[su.id] = su;
  }
  return map;
}

// POST /meal-logs
// Creates a meal log with one or more food items.
// Optional item field serving_unit_id: if provided, nutrition is calculated via per-100g + gram mapping.
// Optional body field log_date (YYYY-MM-DD) sets which date the meal belongs to.
// If omitted the meal is stamped with the current server time (today).
router.post('/', async (req, res) => {
  try {
    const { meal_type, items, notes, log_date } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!meal_type) {
      return res.status(400).json({ success: false, message: 'meal_type is required' });
    }

    // Validate log_date format when provided
    if (log_date && !/^\d{4}-\d{2}-\d{2}$/.test(log_date)) {
      return res.status(400).json({ success: false, message: 'Invalid log_date format. Use YYYY-MM-DD' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items must be a non-empty array' });
    }

    // Validate each item has required fields
    for (const item of items) {
      if (!item.food_item_id || !item.quantity || !item.quantity_unit) {
        return res.status(400).json({
          success: false,
          message: 'Each item requires food_item_id, quantity, and quantity_unit',
        });
      }
    }

    // Fetch all referenced food items in one query — include per-100g fields for preferred calculation
    const foodIds = items.map((item) => item.food_item_id);
    const { data: foodItems, error: foodError } = await supabase
      .from('food_items')
      .select('id, name, calories, carbs_g, protein_g, fat_g, fiber_g, calories_per_100g, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g')
      .in('id', foodIds);

    if (foodError) {
      return res.status(500).json({ success: false, message: foodError.message });
    }

    // Index food items by id for quick lookup
    const foodMap = {};
    for (const food of foodItems) {
      foodMap[food.id] = food;
    }

    // Check every requested food id was found
    for (const item of items) {
      if (!foodMap[item.food_item_id]) {
        return res.status(404).json({
          success: false,
          message: `food_item_id ${item.food_item_id} not found`,
        });
      }
    }

    // Fetch serving unit gram data for any items that include a serving_unit_id
    const servingUnitIds = [...new Set(items.map((i) => i.serving_unit_id).filter(Boolean))];
    const servingUnitMap = await fetchServingUnitMap(servingUnitIds);

    // Build item rows — uses per-100g calculation when data is available, falls back to legacy
    const logItemsToInsert = buildItemRows(items, foodMap, servingUnitMap);

    // Build the meal_logs insert payload.
    // When log_date is provided, pin created_at to noon UTC on that date so the
    // meal falls inside the correct day window for all date-range queries.
    const mealLogInsert = {
      user_id: userId,
      meal_type,
      notes: notes || null,
    };
    if (log_date) {
      mealLogInsert.created_at = `${log_date}T12:00:00.000Z`;
    }

    // Create the meal log row — nutrition totals live in meal_log_items, not here
    const { data: mealLog, error: logError } = await supabase
      .from('meal_logs')
      .insert(mealLogInsert)
      .select('*')
      .single();

    if (logError) {
      return res.status(500).json({ success: false, message: logError.message });
    }

    // Attach meal_log_id to each item row, then insert
    const itemsWithLogId = logItemsToInsert.map((item) => ({
      ...item,
      meal_log_id: mealLog.id,
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('meal_log_items')
      .insert(itemsWithLogId)
      .select('*');

    if (itemsError) {
      return res.status(500).json({ success: false, message: itemsError.message });
    }

    // Update streaks — errors here must not affect the response
    const logDateStr = mealLog.created_at.split('T')[0];
    await Promise.all([
      updateTrackingStreak(supabase, userId, logDateStr).catch(() => {}),
      updateGoalStreak(supabase, userId, logDateStr).catch(() => {}),
    ]);

    return res.status(201).json({
      success: true,
      data: { ...mealLog, items: insertedItems },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /meal-logs?date=YYYY-MM-DD (optional, defaults to today)
// Returns the current user's meal logs for a given date, with items and food names
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    const { data: logs, error } = await supabase
      .from('meal_logs')
      .select(`
        id,
        meal_type,
        notes,
        created_at,
        meal_log_items (
          id,
          quantity,
          quantity_unit,
          calories,
          carbs_g,
          protein_g,
          fat_g,
          fiber_g,
          food_items ( id, name )
        )
      `)
      .eq('user_id', userId)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /meal-logs/today
// Kept for backwards compatibility — same as GET /meal-logs?date=<today>
router.get('/today', async (req, res) => {
  try {
    const userId = req.user.id;

    // Build today's date range in ISO format (UTC)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

    const { data: logs, error } = await supabase
      .from('meal_logs')
      .select(`
        id,
        meal_type,
        notes,
        created_at,
        meal_log_items (
          id,
          quantity,
          quantity_unit,
          calories,
          carbs_g,
          protein_g,
          fat_g,
          fiber_g,
          food_items ( id, name )
        )
      `)
      .eq('user_id', userId)
      .gte('created_at', startOfDay)
      .lt('created_at', endOfDay)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /meal-logs/:id
// Deletes a meal log and its items — user can only delete their own logs
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Verify ownership before deleting — also grab created_at for streak recalc
    const { data: existing, error: findError } = await supabase
      .from('meal_logs')
      .select('id, created_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ success: false, message: 'Meal log not found' });
    }

    // Delete child items explicitly in case the table has no cascade rule
    await supabase.from('meal_log_items').delete().eq('meal_log_id', id);

    const { error: deleteError } = await supabase
      .from('meal_logs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return res.status(500).json({ success: false, message: deleteError.message });
    }

    // Recalculate goal streak for the deleted log's date
    const logDateStr = existing.created_at.split('T')[0];
    await updateGoalStreak(supabase, userId, logDateStr).catch(() => {});

    return res.json({ success: true, message: 'Meal log deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /meal-logs/:id
// Updates meal_type, notes, and replaces all items — user can only update their own logs
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { meal_type, notes, items } = req.body;

    if (!meal_type) {
      return res.status(400).json({ success: false, message: 'meal_type is required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items must be a non-empty array' });
    }

    // Verify ownership — also grab created_at for streak recalc
    const { data: existing, error: findError } = await supabase
      .from('meal_logs')
      .select('id, created_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ success: false, message: 'Meal log not found' });
    }

    // Fetch current food data — include per-100g fields for preferred calculation
    const foodIds = items.map((item) => item.food_item_id);
    const { data: foodItems, error: foodError } = await supabase
      .from('food_items')
      .select('id, calories, carbs_g, protein_g, fat_g, fiber_g, calories_per_100g, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g')
      .in('id', foodIds);

    if (foodError) {
      return res.status(500).json({ success: false, message: foodError.message });
    }

    const foodMap = {};
    for (const food of foodItems) {
      foodMap[food.id] = food;
    }

    for (const item of items) {
      if (!foodMap[item.food_item_id]) {
        return res.status(404).json({
          success: false,
          message: `food_item_id ${item.food_item_id} not found`,
        });
      }
    }

    // Fetch serving unit gram data for any items that include a serving_unit_id
    const servingUnitIds = [...new Set(items.map((i) => i.serving_unit_id).filter(Boolean))];
    const servingUnitMap = await fetchServingUnitMap(servingUnitIds);

    // Update the meal_logs row
    const { data: updatedLog, error: updateError } = await supabase
      .from('meal_logs')
      .update({ meal_type, notes: notes || null })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      return res.status(500).json({ success: false, message: updateError.message });
    }

    // Replace all items: delete existing, then insert the new set
    await supabase.from('meal_log_items').delete().eq('meal_log_id', id);

    const newItems = buildItemRows(items, foodMap, servingUnitMap).map((item) => ({
      ...item,
      meal_log_id: id,
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('meal_log_items')
      .insert(newItems)
      .select('*');

    if (itemsError) {
      return res.status(500).json({ success: false, message: itemsError.message });
    }

    // Recalculate goal streak for this log's date (items changed, total calories may have changed)
    const logDateStr = existing.created_at.split('T')[0];
    await updateGoalStreak(supabase, userId, logDateStr).catch(() => {});

    return res.json({ success: true, data: { ...updatedLog, items: insertedItems } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
