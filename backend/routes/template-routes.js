const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');
const { calculateNutrition } = require('../utils/nutrition-calculator');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// POST /templates
// Creates a meal template with one or more food items.
// Optional item field serving_unit_id: if provided, grams_per_unit and total_grams are snapshotted.
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

    // Fetch serving unit gram data for any items that include a serving_unit_id
    const servingUnitIds = [...new Set(items.map((i) => i.serving_unit_id).filter(Boolean))];
    let servingUnitMap = {};
    if (servingUnitIds.length > 0) {
      const { data } = await supabase
        .from('food_serving_units')
        .select('id, grams')
        .in('id', servingUnitIds);
      for (const su of (data || [])) {
        servingUnitMap[su.id] = su;
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

    // Build template item rows — snapshot serving unit gram data if available
    const templateItems = items.map((item) => {
      const qty = Number(item.quantity);
      const servingUnit = item.serving_unit_id ? servingUnitMap[item.serving_unit_id] : null;
      const gramsPerUnit = servingUnit ? Number(servingUnit.grams) : null;
      const totalGrams = gramsPerUnit != null ? qty * gramsPerUnit : null;

      return {
        template_id: template.id,
        food_item_id: item.food_item_id,
        quantity: qty,
        quantity_unit: item.quantity_unit,
        serving_unit_id: item.serving_unit_id || null,
        grams_per_unit: gramsPerUnit,
        total_grams: totalGrams,
      };
    });

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
// Logs a meal from a template.
// Recalculates nutrition using current per-100g food data + snapshotted grams_per_unit from the template.
// Falls back to legacy serving-based calculation if per-100g data is absent.
router.post('/:id/log', async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;

    // Fetch the template and verify it belongs to the current user
    // Include serving_unit_id and grams_per_unit so we can use the snapshotted gram data
    const { data: template, error: templateError } = await supabase
      .from('meal_templates')
      .select(`
        id,
        name,
        meal_type,
        meal_template_items (
          quantity,
          quantity_unit,
          food_item_id,
          serving_unit_id,
          grams_per_unit
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

    // Fetch current food data — include per-100g fields for preferred calculation
    const foodIds = templateItems.map((item) => item.food_item_id);
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

    // Build meal_log_items using current per-100g food data + snapshotted grams_per_unit from the template
    const logItemsToInsert = templateItems.map((item) => {
      const food = foodMap[item.food_item_id] || {};
      const qty = Number(item.quantity);
      // Use the gram value snapshotted at template creation time
      const gramsPerUnit = item.grams_per_unit != null ? Number(item.grams_per_unit) : null;
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
