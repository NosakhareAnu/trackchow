import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUser } from './auth-storage';

const BASE_PENDING_KEY = '@trackchow/pending_meal_logs';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PendingItem = {
  food_item_id: string;
  quantity: number;
  quantity_unit: string;
  // Optional — populated when a real DB serving unit was selected at log time.
  // Sent to POST /sync/meal-logs so the backend can use the per-100g calculation.
  serving_unit_id?: string;
  // Local display name only — not used by the backend (it destructures only food_item_id etc).
  food_name?: string;
};

export type PendingMealLog = {
  client_temp_id: string;
  meal_type: string;
  log_date: string;   // "YYYY-MM-DD"
  log_time: string;   // "HH:MM:SS"
  notes: string;
  items: PendingItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTempId(): string {
  // Simple unique id — timestamp + short random suffix
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Builds a user-scoped storage key so different accounts never share pending logs.
// Pending logs must be isolated: syncing account A's meals under account B would
// send them to the wrong user's diary on the server.
async function getPendingKey(): Promise<string> {
  const user = await getUser();
  return user?.id ? `${BASE_PENDING_KEY}:${user.id}` : BASE_PENDING_KEY;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getPendingLogs(): Promise<PendingMealLog[]> {
  const key = await getPendingKey();
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  return JSON.parse(raw) as PendingMealLog[];
}

export async function getPendingCount(): Promise<number> {
  const logs = await getPendingLogs();
  return logs.length;
}

// Saves a meal log locally when the network is unavailable.
// log_date defaults to today if not provided. log_time is always now.
export async function savePendingLog(
  meal_type: string,
  items: PendingItem[],
  notes = '',
  log_date?: string
): Promise<void> {
  const key = await getPendingKey();
  const raw = await AsyncStorage.getItem(key);
  const existing: PendingMealLog[] = raw ? JSON.parse(raw) : [];
  const newLog: PendingMealLog = {
    client_temp_id: generateTempId(),
    meal_type,
    log_date: log_date || todayDateStr(),
    log_time: currentTimeStr(),
    notes,
    items,
  };
  await AsyncStorage.setItem(key, JSON.stringify([...existing, newLog]));
}

// Removes logs from the pending list after they have been accepted by the server.
export async function removeSyncedLogs(syncedTempIds: string[]): Promise<void> {
  const key = await getPendingKey();
  const raw = await AsyncStorage.getItem(key);
  const existing: PendingMealLog[] = raw ? JSON.parse(raw) : [];
  const remaining = existing.filter(
    (log) => !syncedTempIds.includes(log.client_temp_id)
  );
  await AsyncStorage.setItem(key, JSON.stringify(remaining));
}

// Deletes a single pending log by its client_temp_id (before it is synced).
export async function deletePendingLog(client_temp_id: string): Promise<void> {
  const key = await getPendingKey();
  const raw = await AsyncStorage.getItem(key);
  const existing: PendingMealLog[] = raw ? JSON.parse(raw) : [];
  const remaining = existing.filter((log) => log.client_temp_id !== client_temp_id);
  await AsyncStorage.setItem(key, JSON.stringify(remaining));
}

// Updates meal_type, notes, and/or items for a pending log before it is synced.
export async function updatePendingLog(
  client_temp_id: string,
  updates: Partial<Pick<PendingMealLog, 'meal_type' | 'notes' | 'items'>>
): Promise<void> {
  const key = await getPendingKey();
  const raw = await AsyncStorage.getItem(key);
  const existing: PendingMealLog[] = raw ? JSON.parse(raw) : [];
  const updated = existing.map((log) =>
    log.client_temp_id === client_temp_id ? { ...log, ...updates } : log
  );
  await AsyncStorage.setItem(key, JSON.stringify(updated));
}
