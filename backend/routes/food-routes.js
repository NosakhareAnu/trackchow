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

module.exports = router;
