const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');
const { updateTrackingStreak, updateGoalStreak } = require('../lib/streak-helpers');
const { calculateNutrition } = require('../utils/nutrition-calculator');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// POST /sync/meal-logs
// Accepts an array of offline meal logs and inserts ones not already synced.
// client_temp_id is used to detect duplicates — if it already exists for this user, the log is skipped.
// Optional item field serving_unit_id: if provided, nutrition is recalculated via per-100g + gram mapping.
router.post('/meal-logs', async (req, res) => {
  try {
    const userId = req.user.id;
    const { meal_logs } = req.body;

    // [Sync debug] how many logs arrived and a safe shape preview (no token, no PII)
    console.log(
      `[Sync] received ${Array.isArray(meal_logs) ? meal_logs.length : 'non-array'} log(s) for user ${userId}`
    );

    if (!meal_logs || !Array.isArray(meal_logs) || meal_logs.length === 0) {
      return res.status(400).json({ success: false, message: 'meal_logs must be a non-empty array' });
    }

    const created = [];
    const skipped = [];

    for (const log of meal_logs) {
      const { client_temp_id, meal_type, log_date, log_time, notes, items } = log;

      // Validate required fields on each log entry
      if (!client_temp_id || !meal_type || !log_date || !items || !Array.isArray(items) || items.length === 0) {
        console.error(`[Sync] skip ${client_temp_id || '(no id)'}: missing required fields`);
        skipped.push({ client_temp_id: client_temp_id || null, reason: 'Missing required fields' });
        continue;
      }

      // Check if this client_temp_id has already been synced for this user.
      // We also pull related meal_log_items so we can tell a *complete* sync
      // apart from an *orphan* parent left behind by an earlier failed sync.
      const { data: existing } = await supabase
        .from('meal_logs')
        .select('id, meal_log_items(id)')
        .eq('user_id', userId)
        .eq('client_temp_id', client_temp_id)
        .single();

      if (existing) {
        const itemCount = Array.isArray(existing.meal_log_items) ? existing.meal_log_items.length : 0;
        if (itemCount > 0) {
          // Genuine duplicate — the meal is fully in the database already.
          console.log(`[Sync] skip ${client_temp_id}: already synced`);
          skipped.push({ client_temp_id, reason: 'Already synced' });
          continue;
        }
        // Orphan/incomplete parent from a previous failed sync (parent row but
        // no items). Delete it and fall through to re-create the meal normally.
        await supabase.from('meal_logs').delete().eq('id', existing.id);
        console.log('[Sync] removed orphan parent and retried');
      }

      // Collect all food ids from this log's items
      const foodIds = items.map((item) => item.food_item_id);

      // Fetch food data — include per-100g fields for preferred calculation
      const { data: foodItems, error: foodError } = await supabase
        .from('food_items')
        .select('id, calories, carbs_g, protein_g, fat_g, fiber_g, calories_per_100g, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g')
        .in('id', foodIds);

      if (foodError) {
        console.error(`[Sync] skip ${client_temp_id}: food lookup failed -`, foodError.message);
        skipped.push({ client_temp_id, reason: foodError.message });
        continue;
      }

      // Index food items by id for nutrition lookup
      const foodMap = {};
      for (const food of foodItems) {
        foodMap[food.id] = food;
      }

      // Fetch serving unit gram data for any items that include a serving_unit_id
      const servingUnitIds = [...new Set(items.map((i) => i.serving_unit_id).filter(Boolean))];
      let servingUnitMap = {};
      if (servingUnitIds.length > 0) {
        const { data: servingUnits } = await supabase
          .from('food_serving_units')
          .select('id, grams')
          .in('id', servingUnitIds);
        for (const su of (servingUnits || [])) {
          servingUnitMap[su.id] = su;
        }
      }

      // Build the created_at timestamp from the offline log's date and time
      const loggedAt = log_time
        ? `${log_date}T${log_time}.000Z`
        : `${log_date}T00:00:00.000Z`;

      // Create the meal_logs row, tagging it as an offline sync
      const { data: mealLog, error: logError } = await supabase
        .from('meal_logs')
        .insert({
          user_id: userId,
          meal_type,
          notes: notes || null,
          source: 'offline_sync',
          client_temp_id,
          created_at: loggedAt,
        })
        .select('*')
        .single();

      if (logError) {
        console.error(`[Sync] skip ${client_temp_id}: meal_logs insert failed -`, logError.message);
        skipped.push({ client_temp_id, reason: logError.message });
        continue;
      }

      // Build meal_log_items rows — uses per-100g calculation when data is available, falls back to legacy
      const logItemsToInsert = items.map((item) => {
        const food = foodMap[item.food_item_id] || {};
        const qty = Number(item.quantity);
        const servingUnit = item.serving_unit_id ? servingUnitMap[item.serving_unit_id] : null;
        const gramsPerUnit = servingUnit ? Number(servingUnit.grams) : null;
        const nutrition = calculateNutrition(food, qty, gramsPerUnit);

        return {
          meal_log_id: mealLog.id,
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

      const { data: insertedItems, error: itemsError } = await supabase
        .from('meal_log_items')
        .insert(logItemsToInsert)
        .select('*');

      if (itemsError) {
        // The parent meal_logs row was already inserted above. If we leave it,
        // the client_temp_id dedup check will mark this log "Already synced" on
        // every future retry, so it can NEVER sync even after the cause is fixed.
        // Roll the orphan parent back so a retry is possible.
        await supabase.from('meal_logs').delete().eq('id', mealLog.id);
        console.error(`[Sync] skip ${client_temp_id}: items insert failed (parent rolled back) -`, itemsError.message);
        skipped.push({ client_temp_id, reason: itemsError.message });
        continue;
      }

      // Update streaks for this synced log's date
      await Promise.all([
        updateTrackingStreak(supabase, userId, log_date).catch(() => {}),
        updateGoalStreak(supabase, userId, log_date).catch(() => {}),
      ]);

      created.push({ ...mealLog, items: insertedItems });
    }

    console.log(`[Sync] done: created ${created.length}, skipped ${skipped.length}`);

    return res.status(201).json({
      success: true,
      data: { created, skipped },
    });
  } catch (err) {
    // Log the real error server-side so a 500 is never a silent dead-end.
    console.error('[Sync] unhandled error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
