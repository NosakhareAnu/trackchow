const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

router.use(authMiddleware);

// ── Streak helpers ────────────────────────────────────────────────────────────

// UTC-safe: shift a YYYY-MM-DD string by N days
function addDaysUTC(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().split('T')[0];
}

// Compute tracking and goal streaks from actual meal_logs data.
// This is always accurate — it does not rely on stored streak columns.
async function computeStreaks(userId, dailyCalorieGoal) {
  const { data: logs } = await supabase
    .from('meal_logs')
    .select('created_at, meal_log_items(calories)')
    .eq('user_id', userId);

  // Build date -> total calories map
  const calsByDate = {};
  for (const log of (logs || [])) {
    const date = log.created_at.split('T')[0]; // UTC date from noon-UTC created_at
    const logCals = (log.meal_log_items || []).reduce((s, item) => s + (item.calories || 0), 0);
    calsByDate[date] = (calsByDate[date] || 0) + logCals;
  }

  const today = new Date().toISOString().split('T')[0];

  // Tracking streak: consecutive days from today where at least one meal was logged
  let trackingStreak = 0;
  for (let i = 0; i < 365; i++) {
    const date = addDaysUTC(today, -i);
    if (calsByDate[date] !== undefined) {
      trackingStreak++;
    } else {
      break;
    }
  }

  // Goal streak: consecutive days from today where total calories >= daily_calorie_goal
  let goalStreak = 0;
  if (dailyCalorieGoal && dailyCalorieGoal > 0) {
    for (let i = 0; i < 365; i++) {
      const date = addDaysUTC(today, -i);
      if ((calsByDate[date] || 0) >= dailyCalorieGoal) {
        goalStreak++;
      } else {
        break;
      }
    }
  }

  return { tracking_streak: trackingStreak, goal_streak: goalStreak };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /profile
// Returns the current user's profile with streaks computed from meal data.
// Streak columns in the profiles table are not read here — computation is always fresh.
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, age, weight_kg, height_cm, daily_calorie_goal, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const streaks = await computeStreaks(userId, data.daily_calorie_goal);

    return res.json({ success: true, data: { ...data, ...streaks } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /profile
// Updates editable profile fields. Email is not editable.
// Streaks are returned as computed values — no streak columns are written here.
router.put('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { full_name, age, weight_kg, height_cm, daily_calorie_goal } = req.body;

    // Validate each field when present
    if (full_name !== undefined) {
      if (typeof full_name !== 'string' || full_name.trim() === '') {
        return res.status(400).json({ success: false, message: 'full_name must be a non-empty string' });
      }
    }
    if (age !== undefined) {
      if (typeof age !== 'number' || !Number.isInteger(age) || age < 1 || age > 120) {
        return res.status(400).json({ success: false, message: 'age must be a whole number between 1 and 120' });
      }
    }
    if (weight_kg !== undefined) {
      if (typeof weight_kg !== 'number' || weight_kg <= 0) {
        return res.status(400).json({ success: false, message: 'weight_kg must be a positive number' });
      }
    }
    if (height_cm !== undefined) {
      if (typeof height_cm !== 'number' || height_cm <= 0) {
        return res.status(400).json({ success: false, message: 'height_cm must be a positive number' });
      }
    }
    if (daily_calorie_goal !== undefined) {
      if (typeof daily_calorie_goal !== 'number' || !Number.isInteger(daily_calorie_goal) || daily_calorie_goal < 0) {
        return res.status(400).json({ success: false, message: 'daily_calorie_goal must be a non-negative whole number' });
      }
    }

    // Build update object — profile fields only, no streak columns
    const profileUpdates = {};
    if (full_name !== undefined) profileUpdates.full_name = full_name.trim();
    if (age !== undefined) profileUpdates.age = age;
    if (weight_kg !== undefined) profileUpdates.weight_kg = weight_kg;
    if (height_cm !== undefined) profileUpdates.height_cm = height_cm;
    if (daily_calorie_goal !== undefined) profileUpdates.daily_calorie_goal = daily_calorie_goal;

    if (Object.keys(profileUpdates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided to update' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', userId)
      .select('id, full_name, email, age, weight_kg, height_cm, daily_calorie_goal, created_at, updated_at')
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Compute streaks with the newly saved goal so the response is immediately accurate
    const streaks = await computeStreaks(userId, data.daily_calorie_goal);

    return res.json({ success: true, data: { ...data, ...streaks } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
