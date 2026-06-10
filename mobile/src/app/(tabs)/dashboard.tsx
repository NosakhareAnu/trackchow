import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import api from '@/lib/api';
import { clearAuth, getUser, StoredUser } from '@/lib/auth-storage';
import { consumeFlash, FlashType } from '@/lib/flash-message';
import {
  deletePendingLog,
  getPendingCount,
  getPendingLogs,
  PendingMealLog,
  removeSyncedLogs,
} from '@/lib/offline-sync';

// Shape of GET /summary/daily response data
type DailySummary = {
  date: string;
  calories: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  fiber_g: number;
};

// Shape of GET /summary/weekly response data (array of daily totals)
type WeeklyDay = {
  date: string;
  calories: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  fiber_g: number;
};

// Shape of a single food item inside a meal log item
type FoodItem = {
  id: string;
  name: string;
};

// Shape of a single item inside a meal log
type MealLogItem = {
  id: string;
  quantity: number;
  quantity_unit: string;
  calories: number;
  food_items: FoodItem;
};

// Shape of GET /meal-logs/today response data
type MealLog = {
  id: string;
  meal_type: string;
  notes: string | null;
  created_at: string;
  meal_log_items: MealLogItem[];
};

// ── Date helpers ──────────────────────────────────────────────────────────────

// Return today's date as a local YYYY-MM-DD string (no UTC conversion).
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Add (or subtract) days from a YYYY-MM-DD string using local date arithmetic only.
// Never calls toISOString() — that would shift the date in non-UTC timezones.
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day + days); // local time constructor
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function formatDateLabel(dateStr: string): string {
  const today = todayStr();
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day); // local time — safe to use for display
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Meal grouping ─────────────────────────────────────────────────────────────

// Canonical order for displaying meal type groups
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

function groupLogsByMealType(logs: MealLog[]): Array<{ mealType: string; logs: MealLog[] }> {
  const map = new Map<string, MealLog[]>();
  for (const log of logs) {
    const key = log.meal_type.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      const ai = MEAL_ORDER.indexOf(a);
      const bi = MEAL_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([mealType, logs]) => ({ mealType, logs }));
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Nutrition insights ─────────────────────────────────────────────────────────

type InsightLevel = 'empty' | 'info' | 'warning' | 'success';

type Insight = {
  text: string;
  level: InsightLevel;
};

// Pure rule-based function — no AI, no external calls.
// Returns one or more insights based on the day's macro totals and calorie goal.
function generateInsights(
  daily: DailySummary | null,
  calorieGoal: number | null,
  hasLogs: boolean
): Insight[] {
  if (!hasLogs || !daily || daily.calories === 0) {
    return [{ text: 'Log a meal to see nutrition insights.', level: 'empty' }];
  }

  const { calories, carbs_g, protein_g, fat_g } = daily;
  const insights: Insight[] = [];

  // Calorie insights — only when a goal is set
  if (calorieGoal && calorieGoal > 0) {
    if (calories > calorieGoal) {
      insights.push({
        text: `You have passed your calorie goal for this day. (${Math.round(calories)} / ${calorieGoal} kcal)`,
        level: 'warning',
      });
    } else if (calories < calorieGoal * 0.5) {
      insights.push({
        text: `You are far below your calorie goal for this day. (${Math.round(calories)} / ${calorieGoal} kcal)`,
        level: 'info',
      });
    }
  }

  // Carb-heavy: meaningful carbs logged and protein is less than a third of carbs
  if (carbs_g > 20 && protein_g < carbs_g / 3) {
    insights.push({
      text: 'Your meals are carb-heavy today. Consider adding protein like eggs, beans, fish, or chicken.',
      level: 'info',
    });
  }

  // High fat: more than 40% of total calories from fat (fat = 9 kcal/g)
  if (calories > 0 && fat_g * 9 > calories * 0.4) {
    insights.push({
      text: 'Fat intake is relatively high today. Check oily foods or fried snacks.',
      level: 'warning',
    });
  }

  // Fallback — no concerns detected
  if (insights.length === 0) {
    insights.push({
      text: 'Your nutrition looks balanced for the meals logged today.',
      level: 'success',
    });
  }

  return insights;
}

export default function DashboardScreen() {
  const router = useRouter();

  const [user, setUser] = useState<StoredUser | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [weekly, setWeekly] = useState<WeeklyDay[]>([]);
  const [todayLogs, setTodayLogs] = useState<MealLog[]>([]);
  const [calorieGoal, setCalorieGoal] = useState<number | null>(null);
  const [trackingStreak, setTrackingStreak] = useState<number | null>(null);
  const [goalStreak, setGoalStreak] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Selected date for the diary view
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [futureMsg, setFutureMsg] = useState('');
  // Ref so useFocusEffect always reads the latest date without re-registering
  const selectedDateRef = useRef(selectedDate);

  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLogs, setPendingLogs] = useState<PendingMealLog[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Delete loading state — holds the id/tempId currently being deleted
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingTempId, setDeletingTempId] = useState<string | null>(null);

  const [actionError, setActionError] = useState('');

  // Flash banner — shown briefly after log-meal redirects here with a success message.
  const [flashMsg, setFlashMsg] = useState('');
  const [flashType, setFlashType] = useState<FlashType>('online');

  // Load user from storage once on mount
  useEffect(() => {
    getUser().then(setUser);
  }, []);

  // Keep ref in sync so useFocusEffect always has the latest date
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // Refetch whenever this tab comes into focus (uses ref so always reads latest date).
  // Also consumes any pending flash message from log-meal (one-shot, module-level store).
  useFocusEffect(
    useCallback(() => {
      const flash = consumeFlash();
      const dateToShow = flash?.date ?? selectedDateRef.current;

      // If the just-logged meal was for a different date, switch the diary to that date.
      if (flash?.date && flash.date !== selectedDateRef.current) {
        setSelectedDate(flash.date);
        selectedDateRef.current = flash.date;
      }

      fetchDashboardData(dateToShow);
      refreshPending();

      // Show the flash banner and auto-hide it after 4 seconds.
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (flash) {
        setFlashMsg(flash.msg);
        setFlashType(flash.type);
        timer = setTimeout(() => setFlashMsg(''), 4000);
      }

      return () => {
        if (timer) clearTimeout(timer);
      };
    }, [])
  );

  // Refetch when the selected date changes while the screen is already focused.
  // Skip the initial mount — useFocusEffect handles that.
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    fetchDashboardData(selectedDate);
  }, [selectedDate]);

  async function refreshPending() {
    const logs = await getPendingLogs();
    setPendingLogs(logs);
    setPendingCount(logs.length);
  }

  async function fetchDashboardData(date: string) {
    setError('');
    try {
      // Fetch daily summary + logs for the selected date; weekly always shows last 7 days.
      // Profile is fetched alongside to get daily_calorie_goal for the goal display.
      const [dailyRes, weeklyRes, logsRes, profileRes] = await Promise.all([
        api.get('/summary/daily', { params: { date } }),
        api.get('/summary/weekly'),
        api.get('/meal-logs', { params: { date } }),
        api.get('/profile').catch(() => null), // non-fatal — goal display degrades gracefully
      ]);

      setDaily(dailyRes.data.data);
      setWeekly(weeklyRes.data.data);
      setTodayLogs(logsRes.data.data);
      const profileData = profileRes?.data?.data ?? null;
      setCalorieGoal(profileData?.daily_calorie_goal ?? null);
      setTrackingStreak(profileData?.tracking_streak ?? null);
      setGoalStreak(profileData?.goal_streak ?? null);
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to load diary data.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchDashboardData(selectedDate);
  }

  // ── Date navigation ───────────────────────────────────────────────────────

  function goToPrevDay() {
    setFutureMsg('');
    setSelectedDate(prev => addDays(prev, -1));
  }

  function goToNextDay() {
    const tomorrow = addDays(todayStr(), 1);
    if (selectedDate >= tomorrow) {
      setFutureMsg("We can't see the future.");
      return;
    }
    setFutureMsg('');
    setSelectedDate(prev => addDays(prev, 1));
  }

  // ── Edit / delete handlers ────────────────────────────────────────────────

  function handleEditOnlineLog(log: MealLog) {
    const data = JSON.stringify({
      meal_type: log.meal_type,
      notes: log.notes ?? '',
      items: log.meal_log_items.map((item) => ({
        food_item_id: item.food_items.id,
        food_name: item.food_items.name,
        quantity: item.quantity,
        quantity_unit: item.quantity_unit,
      })),
    });
    router.push({ pathname: '/edit-meal', params: { logId: log.id, data } });
  }

  function handleEditOfflineLog(log: PendingMealLog) {
    const data = JSON.stringify({
      meal_type: log.meal_type,
      notes: log.notes ?? '',
      items: log.items.map((item) => ({
        food_item_id: item.food_item_id,
        food_name: item.food_name ?? '',
        quantity: item.quantity,
        quantity_unit: item.quantity_unit,
      })),
    });
    router.push({ pathname: '/edit-meal', params: { tempId: log.client_temp_id, data } });
  }

  async function handleDeleteOnlineLog(logId: string) {
    setActionError('');
    setDeletingId(logId);
    try {
      await api.delete(`/meal-logs/${logId}`);
      await fetchDashboardData(selectedDate);
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to delete meal.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteOfflineLog(tempId: string) {
    setActionError('');
    setDeletingTempId(tempId);
    try {
      await deletePendingLog(tempId);
      await refreshPending();
    } catch {
      setActionError('Failed to delete offline meal.');
    } finally {
      setDeletingTempId(null);
    }
  }

  // ── Sync handler ──────────────────────────────────────────────────────────

  async function handleSync() {
    setSyncMessage('');
    setSyncing(true);
    try {
      const pending = await getPendingLogs();
      // [Sync debug] — never logs the auth token, only safe shape info.
      console.log('[Sync] pendingCount:', pending.length, '| baseURL:', api.defaults.baseURL);
      console.log(
        '[Sync] payload shape:',
        JSON.stringify(
          pending.map((l) => ({
            client_temp_id: l.client_temp_id,
            meal_type: l.meal_type,
            log_date: l.log_date,
            items: l.items.map((i) => ({
              food_item_id: i.food_item_id,
              quantity: i.quantity,
              quantity_unit: i.quantity_unit,
              has_serving_unit_id: i.serving_unit_id != null,
            })),
          }))
        )
      );

      if (pending.length === 0) {
        // Stale React state can show pendingCount > 0 while storage is already empty.
        // refreshPending() corrects the count so the banner disappears.
        await refreshPending();
        setSyncMessage('Nothing to sync.');
        return;
      }

      console.log('[Sync] POST /sync/meal-logs with', pending.length, 'log(s)');
      // Sync does far more DB work per log than a normal request (dedup check,
      // food + serving-unit lookups, two inserts, streak recompute), so give it
      // a longer timeout than the 10s global default to avoid false failures.
      const res = await api.post('/sync/meal-logs', { meal_logs: pending }, { timeout: 30000 });

      const { created, skipped } = res.data.data as {
        created: { client_temp_id: string }[];
        skipped: { client_temp_id: string | null; reason: string }[];
      };
      console.log('[Sync] response status:', res.status, '| created:', created.length, '| skipped:', skipped.length);
      if (skipped.length > 0) console.warn('[Sync] skipped reasons:', skipped);

      // Remove the logs the server created, PLUS any skipped as "Already synced"
      // (those are genuinely in the DB, so keeping them pending would wedge them
      // forever). Real DB errors keep their other reasons and stay pending for retry.
      const createdIds = created.map((l) => l.client_temp_id);
      const alreadySyncedIds = skipped
        .filter((s) => s.reason === 'Already synced' && s.client_temp_id)
        .map((s) => s.client_temp_id as string);
      const realFailures = skipped.filter((s) => s.reason !== 'Already synced');
      await removeSyncedLogs([...createdIds, ...alreadySyncedIds]);

      if (created.length === 0 && alreadySyncedIds.length === 0 && realFailures.length > 0) {
        // Nothing synced and nothing was a clean duplicate — surface the reason.
        const reason = realFailures[0]?.reason ? ` (${realFailures[0].reason})` : '';
        setSyncMessage(`Could not sync ${realFailures.length} meal${realFailures.length !== 1 ? 's' : ''}${reason}.`);
      } else {
        const clearedDup = alreadySyncedIds.length > 0 ? `, ${alreadySyncedIds.length} already synced` : '';
        const failedPart = realFailures.length > 0 ? `, skipped ${realFailures.length}` : '';
        setSyncMessage(
          `Synced ${created.length} meal${created.length !== 1 ? 's' : ''}${clearedDup}${failedPart}.`
        );
      }

      // Refresh pending count + diary numbers now that logs are on the server
      await refreshPending();
      await fetchDashboardData(selectedDate);
      console.log('[Sync] remaining pending after sync:', (await getPendingLogs()).length);
    } catch (err: any) {
      // Full safe error detail — never clears pending logs on failure.
      console.error(
        '[Sync] handleSync failed | code:', err?.code,
        '| message:', err?.message,
        '| status:', err?.response?.status,
        '| data:', err?.response?.data
      );
      // Refresh count even on failure — stale pendingCount can keep the banner stuck.
      await refreshPending();
      if (err?.code === 'ECONNABORTED') {
        setSyncMessage('Sync timed out. The server took too long — try again.');
      } else if (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK') {
        setSyncMessage(
          'Cannot reach the server. Make sure the backend is running and check the BASE_URL in mobile/src/lib/api.ts.'
        );
      } else {
        const serverMsg = err?.response?.data?.message;
        setSyncMessage(serverMsg ? `Sync failed: ${serverMsg}` : 'Sync failed. Check your connection and try again.');
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleLogout() {
    await clearAuth();
    router.replace('/(auth)/login');
  }

  // Format a date string like "2026-06-08" to a short label like "Jun 8"
  function formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }>

        {/* Header */}
        <Text style={styles.title}>Diary</Text>
        {user && <Text style={styles.welcome}>Hello, {user.full_name}</Text>}

        {/* Date navigation */}
        <View style={styles.dateNav}>
          <Pressable onPress={goToPrevDay} style={styles.dateArrow}>
            <Text style={styles.dateArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.dateLabel}>{formatDateLabel(selectedDate)}</Text>
          <Pressable onPress={goToNextDay} style={styles.dateArrow}>
            <Text style={styles.dateArrowText}>›</Text>
          </Pressable>
        </View>
        {futureMsg ? <Text style={styles.futureMsg}>{futureMsg}</Text> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Flash banner — auto-hides after 4 s; shown after log-meal redirect */}
        {flashMsg ? (
          <View style={[styles.flashBanner, flashType === 'offline' ? styles.flashBannerOffline : styles.flashBannerOnline]}>
            <Text style={[styles.flashText, flashType === 'offline' ? styles.flashTextOffline : styles.flashTextOnline]}>
              {flashMsg}
            </Text>
          </View>
        ) : null}

        {/* Streak summary */}
        <View style={styles.streakCard}>
          <View style={styles.streakItem}>
            <Text style={styles.streakValue}>{trackingStreak ?? 0}</Text>
            <Text style={styles.streakLabel}>Tracking{'\n'}Streak</Text>
          </View>
          <View style={styles.streakCardDivider} />
          <View style={styles.streakItem}>
            <Text style={styles.streakValue}>{goalStreak ?? 0}</Text>
            <Text style={styles.streakLabel}>Goal{'\n'}Streak</Text>
          </View>
        </View>

        {/* Daily Summary */}
        <Text style={styles.sectionTitle}>Nutrition</Text>
        {daily ? (
          <View style={styles.card}>
            <View style={styles.macroRow}>
              <MacroBox label="Calories" value={Math.round(daily.calories)} unit="kcal" />
              <MacroBox label="Carbs" value={Math.round(daily.carbs_g)} unit="g" />
              <MacroBox label="Protein" value={Math.round(daily.protein_g)} unit="g" />
              <MacroBox label="Fat" value={Math.round(daily.fat_g)} unit="g" />
            </View>
            {calorieGoal != null ? (
              <Text style={styles.goalText}>
                {Math.round(daily.calories)} kcal / {calorieGoal} kcal
              </Text>
            ) : (
              <Text style={styles.goalHint}>Set a daily calorie goal in Profile</Text>
            )}
          </View>
        ) : (
          <Text style={styles.emptyText}>No nutrition data for today.</Text>
        )}

        {/* Nutrition Insight — rule-based, updates with the selected date's data */}
        <NutritionInsightCard
          daily={daily}
          calorieGoal={calorieGoal}
          hasLogs={todayLogs.length > 0}
        />

        {/* Pending sync banner — visible when offline meals are waiting */}
        {pendingCount > 0 && (
          <View style={styles.syncBanner}>
            <View style={styles.syncBannerLeft}>
              <Text style={styles.syncBannerTitle}>
                {pendingCount} pending meal{pendingCount !== 1 ? 's' : ''} saved offline
              </Text>
              <Text style={styles.syncBannerSub}>Sync now to save them to your account.</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.syncBannerButton, pressed && { opacity: 0.7 }]}
              onPress={handleSync}
              disabled={syncing}>
              {syncing
                ? <ActivityIndicator size="small" color="#92400E" />
                : <Text style={styles.syncBannerButtonText}>Sync Now</Text>}
            </Pressable>
          </View>
        )}
        {/* Sync result message — rendered here so it is always visible near the top,
            whether or not the banner is showing (it hides when pendingCount → 0). */}
        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}

        {/* Meals — grouped by meal type for selected date */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>Meals</Text>
          <Pressable
            style={({ pressed }) => [styles.logMealLink, pressed && { opacity: 0.7 }]}
            onPress={() => router.push({ pathname: '/(tabs)/log-meal', params: { date: selectedDate } })}>
            <Text style={styles.logMealLinkText}>+ Log Meal</Text>
          </Pressable>
        </View>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        {todayLogs.length === 0 ? (
          <Text style={styles.emptyText}>No meals logged today.</Text>
        ) : (
          groupLogsByMealType(todayLogs).map(({ mealType, logs: group }) => (
            <View key={mealType}>
              <Text style={styles.mealGroupHeader}>{capitalize(mealType)}</Text>
              {group.map((log) => (
                <View key={log.id} style={styles.card}>
                  {log.meal_log_items.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemRowLeft}>
                        <Text style={styles.itemName}>
                          {item.food_items?.name ?? 'Unknown food'}
                        </Text>
                        <Text style={styles.itemDetail}>
                          {item.quantity} {item.quantity_unit}
                        </Text>
                      </View>
                      <Text style={styles.itemCalories}>
                        {Math.round(item.calories)} kcal
                      </Text>
                    </View>
                  ))}
                  {log.notes ? <Text style={styles.notes}>{log.notes}</Text> : null}
                  <View style={styles.cardActions}>
                    <Pressable
                      style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.7 }]}
                      onPress={() => handleEditOnlineLog(log)}>
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}
                      onPress={() => handleDeleteOnlineLog(log.id)}
                      disabled={deletingId === log.id}>
                      {deletingId === log.id
                        ? <ActivityIndicator size="small" color="#c0392b" />
                        : <Text style={styles.deleteButtonText}>Delete</Text>}
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ))
        )}

        {/* Weekly Summary */}
        <Text style={styles.sectionTitle}>Last 7 Days</Text>
        {weekly.length === 0 ? (
          <Text style={styles.emptyText}>No weekly data available.</Text>
        ) : (
          <View style={styles.card}>
            {weekly.map((day) => (
              <View key={day.date} style={styles.weekRow}>
                <Text style={styles.weekDate}>{formatDate(day.date)}</Text>
                <Text style={styles.weekCalories}>{Math.round(day.calories)} kcal</Text>
                <Text style={styles.weekMacros}>
                  C {Math.round(day.carbs_g)}g · P {Math.round(day.protein_g)}g · F {Math.round(day.fat_g)}g
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Offline Meals */}
        <Text style={styles.sectionTitle}>
          Offline Meals{' '}
          <Text style={pendingCount > 0 ? styles.pendingBadge : styles.pendingBadgeZero}>
            ({pendingCount} pending)
          </Text>
        </Text>

        {pendingLogs.map((log) => (
          <View key={log.client_temp_id} style={[styles.card, styles.pendingCard]}>
            <Text style={styles.mealType}>
              {log.meal_type}{' '}
              <Text style={styles.offlineBadge}>• offline</Text>
            </Text>
            {/* Show individual food names when available (new logs); fall back to item
                count for old pending logs that were saved before food_name was added. */}
            {log.items.some((item) => item.food_name) ? (
              <>
                {log.items.map((item, i) => (
                  <Text key={i} style={styles.mealItem}>
                    {item.food_name
                      ? `${item.food_name} — ${item.quantity} ${item.quantity_unit}`
                      : `${item.quantity} ${item.quantity_unit}`}
                  </Text>
                ))}
                <Text style={styles.notes}>{log.log_date} {log.log_time}</Text>
              </>
            ) : (
              <Text style={styles.mealItem}>
                {log.items.length} food item{log.items.length !== 1 ? 's' : ''} · {log.log_date} {log.log_time}
              </Text>
            )}
            {log.notes ? <Text style={styles.notes}>{log.notes}</Text> : null}
            <View style={styles.cardActions}>
              <Pressable
                style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.7 }]}
                onPress={() => handleEditOfflineLog(log)}>
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}
                onPress={() => handleDeleteOfflineLog(log.client_temp_id)}
                disabled={deletingTempId === log.client_temp_id}>
                {deletingTempId === log.client_temp_id
                  ? <ActivityIndicator size="small" color="#c0392b" />
                  : <Text style={styles.deleteButtonText}>Delete</Text>}
              </Pressable>
            </View>
          </View>
        ))}

        {pendingCount > 0 && (
          <Pressable
            style={({ pressed }) => [styles.syncButton, pressed && styles.buttonPressed]}
            onPress={handleSync}
            disabled={syncing}>
            {syncing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.syncButtonText}>Sync Pending Meals ({pendingCount})</Text>
            )}
          </Pressable>
        )}

        {/* Logout */}
        <Pressable
          style={({ pressed }) => [styles.logoutButton, pressed && styles.buttonPressed]}
          onPress={handleLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

// Small reusable macro display box
function MacroBox({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.macroBox}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroUnit}>{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

// Returns a style object for the insight text based on its severity level.
function insightTextStyle(level: InsightLevel) {
  switch (level) {
    case 'warning': return styles.insightWarning;
    case 'info':    return styles.insightInfo;
    case 'success': return styles.insightSuccess;
    default:        return styles.insightEmpty;
  }
}

// Returns a prefix character for each insight level.
function insightPrefix(level: InsightLevel): string {
  switch (level) {
    case 'warning': return '⚠ ';
    case 'info':    return '💡 ';
    case 'success': return '✓ ';
    default:        return '';
  }
}

// Renders the "Nutrition Insight" card below the macro summary.
// Uses rule-based logic only — no AI, no external calls.
function NutritionInsightCard({
  daily,
  calorieGoal,
  hasLogs,
}: {
  daily: DailySummary | null;
  calorieGoal: number | null;
  hasLogs: boolean;
}) {
  const insights = generateInsights(daily, calorieGoal, hasLogs);
  return (
    <View style={styles.insightCard}>
      <Text style={styles.insightTitle}>Nutrition Insight</Text>
      {insights.map((insight, i) => (
        <Text key={i} style={[styles.insightText, insightTextStyle(insight.level)]}>
          {insightPrefix(insight.level)}{insight.text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
  },
  loadingText: {
    color: '#555',
    fontSize: 14,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  welcome: {
    fontSize: 15,
    color: '#555',
    marginBottom: 8,
  },
  error: {
    color: '#c0392b',
    fontSize: 14,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
  },
  card: {
    backgroundColor: '#F5F5F7',
    borderRadius: 10,
    padding: 14,
    gap: 6,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macroBox: {
    alignItems: 'center',
    flex: 1,
  },
  macroValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2563EB',
  },
  macroUnit: {
    fontSize: 11,
    color: '#888',
  },
  macroLabel: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 6,
  },
  sectionTitleInRow: {
    marginTop: 0,
    marginBottom: 0,
  },
  logMealLink: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  logMealLinkText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  dateArrow: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#F5F5F7',
  },
  dateArrowText: {
    fontSize: 22,
    color: '#2563EB',
    fontWeight: '600',
    lineHeight: 28,
  },
  dateLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
  },
  futureMsg: {
    fontSize: 12,
    color: '#d97706',
    textAlign: 'center',
    marginBottom: 2,
  },
  mealGroupHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemRowLeft: {
    flex: 1,
    gap: 1,
  },
  itemName: {
    fontSize: 14,
    color: '#111',
  },
  itemDetail: {
    fontSize: 12,
    color: '#888',
  },
  itemCalories: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
    flexShrink: 0,
  },
  mealType: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  mealItem: {
    fontSize: 13,
    color: '#333',
  },
  notes: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 4,
  },
  weekRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    gap: 2,
  },
  weekDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  weekCalories: {
    fontSize: 13,
    color: '#2563EB',
  },
  weekMacros: {
    fontSize: 12,
    color: '#888',
  },
  pendingBadge: {
    color: '#d97706',
    fontWeight: '600',
  },
  pendingBadgeZero: {
    color: '#aaa',
    fontWeight: 'normal',
  },
  syncButton: {
    backgroundColor: '#16a34a',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  syncMessage: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
  },
  logoutButton: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#c0392b',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  logoutText: {
    color: '#c0392b',
    fontSize: 16,
    fontWeight: '600',
  },
  pendingCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#d97706',
  },
  offlineBadge: {
    color: '#d97706',
    fontWeight: 'normal',
    fontSize: 11,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  editButton: {
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  editButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#c0392b',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minWidth: 60,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#c0392b',
    fontSize: 12,
    fontWeight: '600',
  },
  actionError: {
    color: '#c0392b',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 4,
  },
  goalText: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    marginTop: 6,
  },
  goalHint: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    marginTop: 6,
    fontStyle: 'italic',
  },
  insightCard: {
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    padding: 14,
    gap: 6,
    marginTop: 4,
  },
  insightTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  insightText: {
    fontSize: 13,
    lineHeight: 20,
  },
  insightWarning: {
    color: '#92400E',
  },
  insightInfo: {
    color: '#1e40af',
  },
  insightSuccess: {
    color: '#166534',
  },
  insightEmpty: {
    color: '#888',
  },
  streakCard: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F7',
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
  },
  streakItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 2,
  },
  streakCardDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 8,
  },
  streakValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2563EB',
  },
  streakLabel: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    lineHeight: 15,
  },
  flashBanner: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
  },
  flashBannerOnline: {
    backgroundColor: '#DCFCE7',
  },
  flashBannerOffline: {
    backgroundColor: '#FEF3C7',
  },
  flashText: {
    fontSize: 13,
    fontWeight: '600',
  },
  flashTextOnline: {
    color: '#166534',
  },
  flashTextOffline: {
    color: '#92400E',
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF3C7',
    borderLeftWidth: 3,
    borderLeftColor: '#d97706',
    borderRadius: 8,
    padding: 12,
    gap: 10,
    marginTop: 8,
  },
  syncBannerLeft: {
    flex: 1,
    gap: 2,
  },
  syncBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  syncBannerSub: {
    fontSize: 12,
    color: '#78350F',
  },
  syncBannerButton: {
    backgroundColor: '#d97706',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 76,
    alignItems: 'center',
  },
  syncBannerButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
