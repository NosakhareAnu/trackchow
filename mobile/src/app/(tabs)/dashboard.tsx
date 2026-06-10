import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Activity, Flame, Gauge } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import api from '@/lib/api';
import { getUser, StoredUser } from '@/lib/auth-storage';
import { consumeFlash, FlashType } from '@/lib/flash-message';
import {
  deletePendingLog,
  getPendingLogs,
  PendingMealLog,
  removeSyncedLogs,
} from '@/lib/offline-sync';
import { colors, radius, spacing } from '@/lib/theme';

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
      // Diary is dark-themed — use light status bar icons while it is focused,
      // and restore dark icons on blur so the still-light Profile screen stays readable.
      setStatusBarStyle('light');

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
        setStatusBarStyle('dark');
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

  // Subtle affordance: tapping the date label jumps back to Today.
  function goToToday() {
    setFutureMsg('');
    setSelectedDate(todayStr());
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

  // Format a date string like "2026-06-08" to a short label like "Jun 8"
  function formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading diary...</Text>
      </SafeAreaView>
    );
  }

  const isToday = selectedDate === todayStr();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        }>

        {/* Header */}
        <Text style={styles.title}>Diary</Text>
        {user && <Text style={styles.welcome}>Hello, {user.full_name}</Text>}

        {/* Date navigation */}
        <View style={styles.dateNav}>
          <Pressable onPress={goToPrevDay} style={({ pressed }) => [styles.dateArrow, pressed && styles.pressedDim]}>
            <Text style={styles.dateArrowText}>‹</Text>
          </Pressable>
          <Pressable onPress={goToToday} style={styles.dateLabelWrap} disabled={isToday}>
            <Text style={styles.dateLabel}>{formatDateLabel(selectedDate)}</Text>
            {!isToday && <Text style={styles.dateLabelHint}>Tap to return to today</Text>}
          </Pressable>
          <Pressable onPress={goToNextDay} style={({ pressed }) => [styles.dateArrow, pressed && styles.pressedDim]}>
            <Text style={styles.dateArrowText}>›</Text>
          </Pressable>
        </View>
        {futureMsg ? <Text style={styles.futureMsg}>{futureMsg}</Text> : null}

        {/* Streak — compact, themed chips */}
        <View style={styles.streakRow}>
          <View style={styles.streakChip}>
            <Flame color={colors.support} size={16} />
            <Text style={styles.streakChipValue}>{trackingStreak ?? 0}</Text>
            <Text style={styles.streakChipLabel}>Tracking streak</Text>
          </View>
          <View style={styles.streakChip}>
            <Flame color={colors.support} size={16} />
            <Text style={styles.streakChipValue}>{goalStreak ?? 0}</Text>
            <Text style={styles.streakChipLabel}>Goal streak</Text>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Flash banner — auto-hides after 4 s; shown after log-meal redirect */}
        {flashMsg ? (
          <View style={[styles.flashBanner, flashType === 'offline' ? styles.flashBannerOffline : styles.flashBannerOnline]}>
            <Text style={[styles.flashText, flashType === 'offline' ? styles.flashTextOffline : styles.flashTextOnline]}>
              {flashMsg}
            </Text>
          </View>
        ) : null}

        {/* Nutrition — swipeable summary panels */}
        <View style={styles.summaryHeader}>
          <Text style={styles.sectionTitle}>Nutrition</Text>
          <Text style={styles.swipeHint}>swipe ›</Text>
        </View>
        <NutritionSummary daily={daily} calorieGoal={calorieGoal} />

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
              style={({ pressed }) => [styles.syncBannerButton, pressed && styles.pressedDim]}
              onPress={handleSync}
              disabled={syncing}>
              {syncing
                ? <ActivityIndicator size="small" color="#1A1300" />
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
            style={({ pressed }) => [styles.logMealLink, pressed && styles.pressedDim]}
            onPress={() => router.push({ pathname: '/(tabs)/log-meal', params: { date: selectedDate } })}>
            <Text style={styles.logMealLinkText}>+ Log Meal</Text>
          </Pressable>
        </View>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        {todayLogs.length === 0 ? (
          <Text style={styles.emptyText}>No meals logged for this day.</Text>
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
                      style={({ pressed }) => [styles.editButton, pressed && styles.pressedDim]}
                      onPress={() => handleEditOnlineLog(log)}>
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedDim]}
                      onPress={() => handleDeleteOnlineLog(log.id)}
                      disabled={deletingId === log.id}>
                      {deletingId === log.id
                        ? <ActivityIndicator size="small" color={colors.danger} />
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
            {weekly.map((day, i) => (
              <View key={day.date} style={[styles.weekRow, i === weekly.length - 1 && styles.weekRowLast]}>
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
                style={({ pressed }) => [styles.editButton, pressed && styles.pressedDim]}
                onPress={() => handleEditOfflineLog(log)}>
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedDim]}
                onPress={() => handleDeleteOfflineLog(log.client_temp_id)}
                disabled={deletingTempId === log.client_temp_id}>
                {deletingTempId === log.client_temp_id
                  ? <ActivityIndicator size="small" color={colors.danger} />
                  : <Text style={styles.deleteButtonText}>Delete</Text>}
              </Pressable>
            </View>
          </View>
        ))}

        {pendingCount > 0 && (
          <Pressable
            style={({ pressed }) => [styles.syncButton, pressed && styles.pressedDim]}
            onPress={handleSync}
            disabled={syncing}>
            {syncing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.syncButtonText}>Sync Pending Meals ({pendingCount})</Text>
            )}
          </Pressable>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Nutrition summary (swipeable panels) ────────────────────────────────────────

// Horizontal, paged summary — TWO panels.
//   Panel 1 (Calories): eaten / goal / progress / remaining-or-over.
//   Panel 2 (Macros):   protein / carbs / fat — grams EATEN only. The app stores
//                       no macro goals, so these must never show "/ goal".
function NutritionSummary({
  daily,
  calorieGoal,
}: {
  daily: DailySummary | null;
  calorieGoal: number | null;
}) {
  const { width } = useWindowDimensions();
  const pageWidth = width; // full-bleed paging within the padded scroll view
  const [index, setIndex] = useState(0);

  const cals = Math.round(daily?.calories ?? 0);
  const protein = Math.round(daily?.protein_g ?? 0);
  const carbs = Math.round(daily?.carbs_g ?? 0);
  const fat = Math.round(daily?.fat_g ?? 0);

  const hasGoal = calorieGoal != null && calorieGoal > 0;
  const remaining = hasGoal ? calorieGoal! - cals : 0;
  const over = remaining < 0;
  const pct = hasGoal ? Math.max(0, Math.min(1, cals / calorieGoal!)) : 0;

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (i !== index) setIndex(i);
  }

  const PANELS = 2;

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.pager}>
        {/* Panel 1 — Calories */}
        <View style={[styles.panel, { width: pageWidth }]}>
          <View style={styles.panelCard}>
            <View style={styles.panelLabelRow}>
              <Gauge color={colors.textMuted} size={14} />
              <Text style={styles.panelLabel}>CALORIES</Text>
            </View>
            <View style={styles.panelAccentLine} />
            <View style={styles.bigRow}>
              <Text style={styles.bigNumber}>{cals}</Text>
              <Text style={styles.bigUnit}>kcal</Text>
            </View>
            {hasGoal ? (
              <>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.trackFill,
                      { width: `${pct * 100}%` },
                      over && styles.trackFillOver,
                    ]}
                  />
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaMuted}>{cals} of {calorieGoal} kcal</Text>
                  <Text style={over ? styles.metaOver : styles.metaMuted}>
                    {over ? `${Math.abs(remaining)} over` : `${remaining} left`}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.panelHint}>Set a daily calorie goal in Profile</Text>
            )}
          </View>
        </View>

        {/* Panel 2 — Macros (eaten only) */}
        <View style={[styles.panel, { width: pageWidth }]}>
          <View style={styles.panelCard}>
            <View style={styles.panelLabelRow}>
              <Activity color={colors.textMuted} size={14} />
              <Text style={styles.panelLabel}>MACROS</Text>
            </View>
            <View style={styles.panelAccentLine} />
            <View style={styles.macroTriple}>
              <MacroColumn label="Protein" value={protein} />
              <View style={styles.macroColDivider} />
              <MacroColumn label="Carbs" value={carbs} />
              <View style={styles.macroColDivider} />
              <MacroColumn label="Fat" value={fat} />
            </View>
            <Text style={styles.panelHint}>grams eaten today</Text>
          </View>
        </View>
      </ScrollView>

      {/* Page dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: PANELS }).map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

// One macro column inside the combined Macros panel — grams eaten only.
function MacroColumn({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.macroCol}>
      <Text style={styles.macroColValue}>
        {value}<Text style={styles.macroColUnit}>g</Text>
      </Text>
      <Text style={styles.macroColLabel}>{label}</Text>
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

// Returns a coloured dot prefix for each insight level (mature, non-playful).
function insightDotStyle(level: InsightLevel) {
  switch (level) {
    case 'warning': return styles.dotWarning;
    case 'info':    return styles.dotInfo;
    case 'success': return styles.dotSuccess;
    default:        return styles.dotEmpty;
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
        <View key={i} style={styles.insightRow}>
          <View style={[styles.insightDot, insightDotStyle(insight.level)]} />
          <Text style={[styles.insightText, insightTextStyle(insight.level)]}>
            {insight.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bg,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    gap: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  welcome: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  pressedDim: {
    opacity: 0.6,
  },

  // Section titles
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: 0.2,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  swipeHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.xs,
  },

  // Generic card
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },

  // ── Date navigation ──
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  dateArrow: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateArrowText: {
    fontSize: 22,
    color: colors.accentSoft,
    fontWeight: '600',
    lineHeight: 26,
  },
  dateLabelWrap: {
    flex: 1,
    alignItems: 'center',
  },
  dateLabel: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateLabelHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  futureMsg: {
    fontSize: 12,
    color: colors.warning,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },

  // ── Streak chips ──
  streakRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  streakChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  streakChipValue: {
    color: colors.support,
    fontSize: 18,
    fontWeight: '700',
  },
  streakChipLabel: {
    color: colors.textMuted,
    fontSize: 12,
    flexShrink: 1,
  },

  // ── Nutrition summary panels ──
  pager: {
    marginHorizontal: -spacing.lg, // full-bleed inside the padded scroll view
    marginTop: spacing.xs,
  },
  panel: {
    paddingHorizontal: spacing.lg, // re-inset the card to line up with other content
  },
  panelCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    minHeight: 148,
    justifyContent: 'flex-start',
  },
  panelLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  panelLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  panelAccentLine: {
    width: 22,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  bigRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  bigNumber: {
    color: colors.textPrimary,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bigUnit: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
  panelHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.md,
  },
  // Combined macros panel — three columns
  macroTriple: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  macroCol: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  macroColDivider: {
    width: 1,
    height: 34,
    backgroundColor: colors.border,
  },
  macroColValue: {
    color: colors.accentSoft,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  macroColUnit: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  macroColLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  trackFill: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  trackFillOver: {
    backgroundColor: colors.warning,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  metaMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  metaOver: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.accent,
  },

  // ── Meals section ──
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionTitleInRow: {
    marginTop: 0,
    marginBottom: 0,
  },
  logMealLink: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  logMealLinkText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  mealGroupHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  itemRowLeft: {
    flex: 1,
    gap: 1,
  },
  itemName: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  itemDetail: {
    fontSize: 12,
    color: colors.textMuted,
  },
  itemCalories: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentSoft,
    flexShrink: 0,
  },
  mealType: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  mealItem: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  notes: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },

  // ── Weekly ──
  weekRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  weekRowLast: {
    borderBottomWidth: 0,
  },
  weekDate: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  weekCalories: {
    fontSize: 13,
    color: colors.accentSoft,
  },
  weekMacros: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // ── Offline / pending ──
  pendingBadge: {
    color: colors.warning,
    fontWeight: '600',
  },
  pendingBadgeZero: {
    color: colors.textMuted,
    fontWeight: 'normal',
  },
  pendingCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  offlineBadge: {
    color: colors.warning,
    fontWeight: 'normal',
    fontSize: 11,
  },

  // ── Card actions ──
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  editButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  editButtonText: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 64,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  actionError: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },

  // ── Sync ──
  syncButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  syncMessage: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.warningFill,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  syncBannerLeft: {
    flex: 1,
    gap: 2,
  },
  syncBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.warning,
  },
  syncBannerSub: {
    fontSize: 12,
    color: colors.textMuted,
  },
  syncBannerButton: {
    backgroundColor: colors.warning,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 76,
    alignItems: 'center',
  },
  syncBannerButtonText: {
    color: '#1A1300',
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Flash banner ──
  flashBanner: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    borderWidth: 1,
  },
  flashBannerOnline: {
    backgroundColor: colors.successFill,
    borderColor: 'rgba(88,194,125,0.4)',
  },
  flashBannerOffline: {
    backgroundColor: colors.warningFill,
    borderColor: 'rgba(244,184,96,0.4)',
  },
  flashText: {
    fontSize: 13,
    fontWeight: '600',
  },
  flashTextOnline: {
    color: colors.success,
  },
  flashTextOffline: {
    color: colors.warning,
  },

  // ── Insight card ──
  insightCard: {
    backgroundColor: colors.elevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  insightTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    marginTop: 6,
  },
  insightText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
  insightWarning: { color: colors.warning },
  insightInfo: { color: colors.accentSoft },
  insightSuccess: { color: colors.success },
  insightEmpty: { color: colors.textMuted },
  dotWarning: { backgroundColor: colors.warning },
  dotInfo: { backgroundColor: colors.accentSoft },
  dotSuccess: { backgroundColor: colors.success },
  dotEmpty: { backgroundColor: colors.textMuted },
});
