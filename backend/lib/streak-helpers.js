// Returns the date string for the day before a given YYYY-MM-DD string (UTC-safe)
function prevDateStr(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day - 1));
  return d.toISOString().split('T')[0];
}

// Increments the tracking streak if the user has not already been credited for logDate.
// Called after a meal log is successfully created.
async function updateTrackingStreak(supabase, userId, logDate) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('tracking_streak, last_tracked_date')
    .eq('id', userId)
    .single();

  if (!profile) return;
  if (profile.last_tracked_date === logDate) return; // already credited this date

  const newStreak =
    profile.last_tracked_date === prevDateStr(logDate)
      ? (profile.tracking_streak || 0) + 1 // consecutive day
      : 1; // gap — restart

  await supabase
    .from('profiles')
    .update({ tracking_streak: newStreak, last_tracked_date: logDate })
    .eq('id', userId);
}

// Recalculates goal streak after any meal change on logDate.
// Goal is met when total calories for that date >= daily_calorie_goal.
// Also handles the reversal case: if goal was previously met for logDate but now falls short.
async function updateGoalStreak(supabase, userId, logDate) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('daily_calorie_goal, goal_streak, last_goal_hit_date')
    .eq('id', userId)
    .single();

  // Skip if no profile or no calorie goal set
  if (!profile || !profile.daily_calorie_goal) return;

  // Sum all calories logged on logDate
  const startOfDay = `${logDate}T00:00:00.000Z`;
  const endOfDay = `${logDate}T23:59:59.999Z`;

  const { data: logs } = await supabase
    .from('meal_logs')
    .select('meal_log_items(calories)')
    .eq('user_id', userId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  const totalCalories = (logs || []).reduce((sum, log) => {
    return sum + (log.meal_log_items || []).reduce((s, item) => s + (item.calories || 0), 0);
  }, 0);

  const goalMet = totalCalories >= profile.daily_calorie_goal;

  if (goalMet) {
    if (profile.last_goal_hit_date === logDate) return; // already credited

    const newStreak =
      profile.last_goal_hit_date === prevDateStr(logDate)
        ? (profile.goal_streak || 0) + 1
        : 1;

    await supabase
      .from('profiles')
      .update({ goal_streak: newStreak, last_goal_hit_date: logDate })
      .eq('id', userId);
  } else if (profile.last_goal_hit_date === logDate) {
    // Previously counted this date but now below goal (e.g. meal deleted or edited down)
    await supabase
      .from('profiles')
      .update({
        goal_streak: Math.max(0, (profile.goal_streak || 1) - 1),
        last_goal_hit_date: null,
      })
      .eq('id', userId);
  }
}

module.exports = { updateTrackingStreak, updateGoalStreak };
