const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// POST /sync/meal-logs
// Accepts an array of offline meal logs and inserts ones not already synced.
// client_temp_id is used to detect duplicates — if it already exists for this user, the log is skipped.
router.post('/meal-logs', async (req, res) => {
  try {
    const userId = req.user.id;
    const { meal_logs } = req.body;

    if (!meal_logs || !Array.isArray(meal_logs) || meal_logs.length === 0) {
      return res.status(400).json({ success: false, message: 'meal_logs must be a non-empty array' });
    }

    const created = [];
    const skipped = [];

    for (const log of meal_logs) {
      const { client_temp_id, meal_type, log_date, log_time, notes, items } = log;

      // Validate required fields on each log entry
      if (!client_temp_id || !meal_type || !log_date || !items || !Array.isArray(items) || items.length === 0) {
        skipped.push({ client_temp_id: client_temp_id || null, reason: 'Missing required fields' });
        continue;
      }

      // Check if this client_temp_id has already been synced for this user
      const { data: existing } = await supabase
        .from('meal_logs')
        .select('id')
        .eq('user_id', userId)
        .eq('client_temp_id', client_temp_id)
        .single();

      if (existing) {
        skipped.push({ client_temp_id, reason: 'Already synced' });
        continue;
      }

      // Collect all food ids from this log's items
      const foodIds = items.map((item) => item.food_item_id);

      const { data: foodItems, error: foodError } = await supabase
        .from('food_items')
        .select('id, calories, carbs_g, protein_g, fat_g, fiber_g')
        .in('id', foodIds);

      if (foodError) {
        skipped.push({ client_temp_id, reason: foodError.message });
        continue;
      }

      // Index food items by id for nutrition lookup
      const foodMap = {};
      for (const food of foodItems) {
        foodMap[food.id] = food;
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
        skipped.push({ client_temp_id, reason: logError.message });
        continue;
      }

      // Build meal_log_items rows — calculate nutrition from food_items x quantity
      const logItemsToInsert = items.map((item) => {
        const food = foodMap[item.food_item_id] || {};
        const qty = item.quantity;

        return {
          meal_log_id: mealLog.id,
          food_item_id: item.food_item_id,
          quantity: qty,
          quantity_unit: item.quantity_unit,
          calories: (food.calories || 0) * qty,
          carbs_g: (food.carbs_g || 0) * qty,
          protein_g: (food.protein_g || 0) * qty,
          fat_g: (food.fat_g || 0) * qty,
          fiber_g: (food.fiber_g || 0) * qty,
        };
      });

      const { data: insertedItems, error: itemsError } = await supabase
        .from('meal_log_items')
        .insert(logItemsToInsert)
        .select('*');

      if (itemsError) {
        skipped.push({ client_temp_id, reason: itemsError.message });
        continue;
      }

      created.push({ ...mealLog, items: insertedItems });
    }

    return res.status(201).json({
      success: true,
      data: { created, skipped },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
