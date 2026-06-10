const express = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

// GET /foods
// Optional query param: ?search=rice
// Returns all food_items ordered by name, or filtered by name if search is provided
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;

    let query = supabase
      .from('food_items')
      .select('*')
      .order('name', { ascending: true });

    if (search) {
      // ilike is case-insensitive pattern matching in PostgreSQL
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /foods/:id/serving-units
// Returns all serving units for a food item.
// Order: default first, then conventional, then unconventional, then alphabetical.
router.get('/:id/serving-units', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('food_serving_units')
      .select('id, unit_name, unit_type, grams, is_default')
      .eq('food_item_id', id)
      .order('is_default', { ascending: false })   // true first
      .order('unit_type', { ascending: true })      // 'conventional' before 'unconventional'
      .order('unit_name', { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
