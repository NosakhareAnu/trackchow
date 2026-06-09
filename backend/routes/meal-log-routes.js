const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// POST /meal-logs
// Creates a meal log with one or more food items
router.post('/', async (req, res) => {
  try {
    const { meal_type, items, notes } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!meal_type) {
      return res.status(400).json({ success: false, message: 'meal_type is required' });
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

    // Fetch all referenced food items in one query
    const foodIds = items.map((item) => item.food_item_id);
    const { data: foodItems, error: foodError } = await supabase
      .from('food_items')
      .select('id, name, calories, carbs_g, protein_g, fat_g, fiber_g')
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

    // Build item rows with per-item nutrition calculated from food_items values x quantity
    const logItemsToInsert = items.map((item) => {
      const food = foodMap[item.food_item_id];
      const qty = item.quantity;

      return {
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

    // Create the meal log row — nutrition totals live in meal_log_items, not here
    const { data: mealLog, error: logError } = await supabase
      .from('meal_logs')
      .insert({
        user_id: userId,
        meal_type,
        notes: notes || null,
      })
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

    return res.status(201).json({
      success: true,
      data: { ...mealLog, items: insertedItems },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /meal-logs/today
// Returns the current user's meal logs for today, with items and food names
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

    // Verify ownership before deleting
    const { data: existing, error: findError } = await supabase
      .from('meal_logs')
      .select('id')
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

    // Verify ownership
    const { data: existing, error: findError } = await supabase
      .from('meal_logs')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ success: false, message: 'Meal log not found' });
    }

    // Fetch current nutrition values for the submitted food items
    const foodIds = items.map((item) => item.food_item_id);
    const { data: foodItems, error: foodError } = await supabase
      .from('food_items')
      .select('id, calories, carbs_g, protein_g, fat_g, fiber_g')
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

    const newItems = items.map((item) => {
      const food = foodMap[item.food_item_id];
      const qty = item.quantity;
      return {
        meal_log_id: id,
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
      .insert(newItems)
      .select('*');

    if (itemsError) {
      return res.status(500).json({ success: false, message: itemsError.message });
    }

    return res.json({ success: true, data: { ...updatedLog, items: insertedItems } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
