import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

export default function DashboardScreen() {
  const router = useRouter();

  const [user, setUser] = useState<StoredUser | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [weekly, setWeekly] = useState<WeeklyDay[]>([]);
  const [todayLogs, setTodayLogs] = useState<MealLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLogs, setPendingLogs] = useState<PendingMealLog[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Delete loading state — holds the id/tempId currently being deleted
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingTempId, setDeletingTempId] = useState<string | null>(null);

  const [actionError, setActionError] = useState('');

  // Load user from storage once on mount
  useEffect(() => {
    getUser().then(setUser);
  }, []);

  // Refetch dashboard data and pending logs every time this tab comes into focus.
  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
      refreshPending();
    }, [])
  );

  async function refreshPending() {
    const logs = await getPendingLogs();
    setPendingLogs(logs);
    setPendingCount(logs.length);
  }

  async function fetchDashboardData() {
    setError('');
    try {
      // Fetch all three endpoints in parallel
      const [dailyRes, weeklyRes, logsRes] = await Promise.all([
        api.get('/summary/daily'),
        api.get('/summary/weekly'),
        api.get('/meal-logs/today'),
      ]);

      setDaily(dailyRes.data.data);
      setWeekly(weeklyRes.data.data);
      setTodayLogs(logsRes.data.data);
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to load dashboard data.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchDashboardData();
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
        food_name: '',
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
      await fetchDashboardData();
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
      if (pending.length === 0) {
        setSyncMessage('Nothing to sync.');
        return;
      }
      const res = await api.post('/sync/meal-logs', { meal_logs: pending });
      const { created, skipped } = res.data.data;

      // Remove successfully created logs from local storage
      const syncedIds = (created as { client_temp_id: string }[]).map((l) => l.client_temp_id);
      await removeSyncedLogs(syncedIds);

      const newCount = await getPendingCount();
      setPendingCount(newCount);
      setSyncMessage(
        `Synced ${created.length} meal${created.length !== 1 ? 's' : ''}` +
        (skipped.length > 0 ? `, skipped ${skipped.length}` : '') + '.'
      );
      // Refresh dashboard numbers now that new logs are on the server
      await fetchDashboardData();
      await refreshPending();
    } catch {
      setSyncMessage('Sync failed. Check your connection and try again.');
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
        <Text style={styles.title}>TrackChow</Text>
        {user && <Text style={styles.welcome}>Hello, {user.full_name}</Text>}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Daily Summary */}
        <Text style={styles.sectionTitle}>Today's Nutrition</Text>
        {daily ? (
          <View style={styles.card}>
            <View style={styles.macroRow}>
              <MacroBox label="Calories" value={Math.round(daily.calories)} unit="kcal" />
              <MacroBox label="Carbs" value={Math.round(daily.carbs_g)} unit="g" />
              <MacroBox label="Protein" value={Math.round(daily.protein_g)} unit="g" />
              <MacroBox label="Fat" value={Math.round(daily.fat_g)} unit="g" />
            </View>
          </View>
        ) : (
          <Text style={styles.emptyText}>No nutrition data for today.</Text>
        )}

        {/* Today's Meals */}
        <Text style={styles.sectionTitle}>Today's Meals</Text>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        {todayLogs.length === 0 ? (
          <Text style={styles.emptyText}>No meals logged today.</Text>
        ) : (
          todayLogs.map((log) => (
            <View key={log.id} style={styles.card}>
              <Text style={styles.mealType}>{log.meal_type}</Text>
              {log.meal_log_items.map((item) => (
                <Text key={item.id} style={styles.mealItem}>
                  • {item.food_items?.name ?? 'Unknown food'} — {item.quantity} {item.quantity_unit}
                </Text>
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
        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}

        {pendingLogs.map((log) => (
          <View key={log.client_temp_id} style={[styles.card, styles.pendingCard]}>
            <Text style={styles.mealType}>
              {log.meal_type}{' '}
              <Text style={styles.offlineBadge}>• offline</Text>
            </Text>
            <Text style={styles.mealItem}>
              {log.items.length} food item{log.items.length !== 1 ? 's' : ''} · {log.log_date} {log.log_time}
            </Text>
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
});
