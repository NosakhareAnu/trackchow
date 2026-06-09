const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

// All routes in this file require a valid Bearer token
router.use(authMiddleware);

// GET /summary/daily
// Returns today's total nutrition for the current user
router.get('/daily', async (req, res) => {
  try {
    const userId = req.user.id;

    // Build today's date range in ISO format (UTC)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // e.g. "2026-06-08"
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    // Fetch today's meal_log_items via meal_logs so we can filter by user and date.
    // Nutrition totals live in meal_log_items, not meal_logs.
    const { data: logs, error } = await supabase
      .from('meal_logs')
      .select('meal_log_items ( calories, carbs_g, protein_g, fat_g, fiber_g )')
      .eq('user_id', userId)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Flatten all items from all meal logs, then sum their nutrition values
    const allItems = logs.flatMap((log) => log.meal_log_items || []);
    const totals = allItems.reduce(
      (acc, item) => {
        acc.calories += item.calories || 0;
        acc.carbs_g += item.carbs_g || 0;
        acc.protein_g += item.protein_g || 0;
        acc.fat_g += item.fat_g || 0;
        acc.fiber_g += item.fiber_g || 0;
        return acc;
      },
      { calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0 }
    );

    return res.json({
      success: true,
      data: {
        date: dateStr,
        ...totals,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /summary/weekly
// Returns per-day nutrition totals for the last 7 days including today.
// Days with no logs are included as zero values.
router.get('/weekly', async (req, res) => {
  try {
    const userId = req.user.id;

    // Build the 7-day window: from 6 days ago (start of day) to end of today
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const sixDaysAgo = new Date(today);
    sixDaysAgo.setDate(today.getDate() - 6);
    const sixDaysAgoStr = sixDaysAgo.toISOString().split('T')[0];

    const windowStart = `${sixDaysAgoStr}T00:00:00.000Z`;
    const windowEnd = `${todayStr}T23:59:59.999Z`;

    // Fetch all meal logs in the window with their items' nutrition values.
    // created_at on meal_logs is used for date grouping; nutrition lives in meal_log_items.
    const { data: logs, error } = await supabase
      .from('meal_logs')
      .select('created_at, meal_log_items ( calories, carbs_g, protein_g, fat_g, fiber_g )')
      .eq('user_id', userId)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Build a map keyed by date string so we can group logs per day
    const dayMap = {};

    // Pre-fill all 7 days with zero values so days without logs still appear
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dayMap[dateStr] = { date: dateStr, calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0 };
    }

    // Accumulate each meal log's items into the correct day bucket
    for (const log of logs) {
      const dateStr = log.created_at.split('T')[0];
      if (!dayMap[dateStr]) continue; // guard against unexpected dates

      for (const item of log.meal_log_items || []) {
        dayMap[dateStr].calories += item.calories || 0;
        dayMap[dateStr].carbs_g += item.carbs_g || 0;
        dayMap[dateStr].protein_g += item.protein_g || 0;
        dayMap[dateStr].fat_g += item.fat_g || 0;
        dayMap[dateStr].fiber_g += item.fiber_g || 0;
      }
    }

    // Return as an array ordered oldest to newest
    const result = Object.values(dayMap);

    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
