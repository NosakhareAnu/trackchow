const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// POST /templates
// Creates a meal template with one or more food items
router.post('/', async (req, res) => {
  try {
    const { name, meal_type, items } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
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

    // Create the template row
    const { data: template, error: templateError } = await supabase
      .from('meal_templates')
      .insert({ user_id: userId, name, meal_type })
      .select('*')
      .single();

    if (templateError) {
      return res.status(500).json({ success: false, message: templateError.message });
    }

    // Build template item rows and insert them
    const templateItems = items.map((item) => ({
      template_id: template.id,
      food_item_id: item.food_item_id,
      quantity: item.quantity,
      quantity_unit: item.quantity_unit,
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('meal_template_items')
      .insert(templateItems)
      .select('*');

    if (itemsError) {
      return res.status(500).json({ success: false, message: itemsError.message });
    }

    return res.status(201).json({
      success: true,
      data: { ...template, items: insertedItems },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /templates
// Returns all templates belonging to the current user, with items and food names
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: templates, error } = await supabase
      .from('meal_templates')
      .select(`
        id,
        name,
        meal_type,
        created_at,
        meal_template_items (
          id,
          quantity,
          quantity_unit,
          food_items ( id, name )
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, data: templates });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /templates/:id/log
// Logs a meal from a template — fetches live food nutrition and creates a real meal log
router.post('/:id/log', async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;

    // Fetch the template and verify it belongs to the current user
    const { data: template, error: templateError } = await supabase
      .from('meal_templates')
      .select(`
        id,
        name,
        meal_type,
        meal_template_items (
          quantity,
          quantity_unit,
          food_item_id
        )
      `)
      .eq('id', templateId)
      .eq('user_id', userId)
      .single();

    if (templateError || !template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const templateItems = template.meal_template_items;

    if (!templateItems || templateItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Template has no items' });
    }

    // Fetch current nutrition values for each food item in the template
    const foodIds = templateItems.map((item) => item.food_item_id);
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

    // Create the meal log row — source marks this as logged from a template
    const { data: mealLog, error: logError } = await supabase
      .from('meal_logs')
      .insert({
        user_id: userId,
        meal_type: template.meal_type,
        notes: `Logged from template: ${template.name}`,
        source: 'template',
      })
      .select('*')
      .single();

    if (logError) {
      return res.status(500).json({ success: false, message: logError.message });
    }

    // Build meal_log_items rows using live food nutrition x quantity
    const logItemsToInsert = templateItems.map((item) => {
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

module.exports = router;
