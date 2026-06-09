import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_KEY = '@trackchow/pending_meal_logs';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PendingItem = {
  food_item_id: string;
  quantity: number;
  quantity_unit: string;
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
  return new Date().toISOString().split('T')[0];
}

function currentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getPendingLogs(): Promise<PendingMealLog[]> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as PendingMealLog[];
}

export async function getPendingCount(): Promise<number> {
  const logs = await getPendingLogs();
  return logs.length;
}

// Saves a meal log locally when the network is unavailable.
// client_temp_id, log_date, and log_time are generated automatically.
export async function savePendingLog(
  meal_type: string,
  items: PendingItem[],
  notes = ''
): Promise<void> {
  const existing = await getPendingLogs();
  const newLog: PendingMealLog = {
    client_temp_id: generateTempId(),
    meal_type,
    log_date: todayDateStr(),
    log_time: currentTimeStr(),
    notes,
    items,
  };
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify([...existing, newLog]));
}

// Removes logs from the pending list after they have been accepted by the server.
export async function removeSyncedLogs(syncedTempIds: string[]): Promise<void> {
  const existing = await getPendingLogs();
  const remaining = existing.filter(
    (log) => !syncedTempIds.includes(log.client_temp_id)
  );
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
}

// Deletes a single pending log by its client_temp_id (before it is synced).
export async function deletePendingLog(client_temp_id: string): Promise<void> {
  const existing = await getPendingLogs();
  const remaining = existing.filter((log) => log.client_temp_id !== client_temp_id);
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
}

// Updates meal_type, notes, and/or items for a pending log before it is synced.
export async function updatePendingLog(
  client_temp_id: string,
  updates: Partial<Pick<PendingMealLog, 'meal_type' | 'notes' | 'items'>>
): Promise<void> {
  const existing = await getPendingLogs();
  const updated = existing.map((log) =>
    log.client_temp_id === client_temp_id ? { ...log, ...updates } : log
  );
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(updated));
}
