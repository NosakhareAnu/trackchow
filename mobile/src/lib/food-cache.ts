import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUser } from './auth-storage';

const BASE_FOOD_CACHE_KEY = '@trackchow/food_cache';
const BASE_SERVING_UNITS_CACHE_KEY = '@trackchow/serving_units_cache';
const MAX_CACHED = 100;

// Matches the full FoodItem shape used across screens, plus a cached_at timestamp.
export type CachedFood = {
  id: string;
  name: string;
  category?: string | null;
  serving_unit: string | null;
  calories: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  fiber_g: number;
  calories_per_100g?: number | null;
  carbs_per_100g?: number | null;
  protein_per_100g?: number | null;
  fat_per_100g?: number | null;
  fiber_per_100g?: number | null;
  cached_at: string; // ISO timestamp — used for LRU eviction
};

export type CachedServingUnit = {
  id: string;
  unit_name: string;
  unit_type: 'conventional' | 'unconventional';
  grams: number;
  is_default: boolean;
};

// ── Key builders ────────────────────────────────────────────────────────────────
// Each account gets its own cache so AI-estimated foods and selections from
// one user never appear in another user's offline search or serving unit list.

async function getFoodCacheKey(): Promise<string> {
  const user = await getUser();
  return user?.id ? `${BASE_FOOD_CACHE_KEY}:${user.id}` : BASE_FOOD_CACHE_KEY;
}

async function getServingUnitsCacheKey(): Promise<string> {
  const user = await getUser();
  return user?.id ? `${BASE_SERVING_UNITS_CACHE_KEY}:${user.id}` : BASE_SERVING_UNITS_CACHE_KEY;
}

// ── Food cache ─────────────────────────────────────────────────────────────────

// Upserts a single food. If the id already exists the entry is refreshed and
// moved to the front (most-recently-used). Trims to MAX_CACHED.
export async function saveCachedFood(food: Omit<CachedFood, 'cached_at'>): Promise<void> {
  try {
    const key = await getFoodCacheKey();
    const raw = await AsyncStorage.getItem(key);
    const existing: CachedFood[] = raw ? (JSON.parse(raw) as CachedFood[]) : [];
    const entry: CachedFood = { ...food, cached_at: new Date().toISOString() };
    const updated = [entry, ...existing.filter((f) => f.id !== food.id)].slice(0, MAX_CACHED);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Non-critical — never throw
  }
}

// Upserts multiple foods in one pass. Each food is moved to the front; the
// combined list is trimmed to MAX_CACHED.
export async function saveCachedFoods(foods: Omit<CachedFood, 'cached_at'>[]): Promise<void> {
  try {
    if (foods.length === 0) return;
    const key = await getFoodCacheKey();
    const raw = await AsyncStorage.getItem(key);
    const existing: CachedFood[] = raw ? (JSON.parse(raw) as CachedFood[]) : [];
    const newIds = new Set(foods.map((f) => f.id));
    const kept = existing.filter((f) => !newIds.has(f.id));
    const now = new Date().toISOString();
    const entries: CachedFood[] = foods.map((f) => ({ ...f, cached_at: now }));
    const updated = [...entries, ...kept].slice(0, MAX_CACHED);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Non-critical
  }
}

export async function getCachedFoods(): Promise<CachedFood[]> {
  try {
    const key = await getFoodCacheKey();
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as CachedFood[];
  } catch {
    return [];
  }
}

// Case-insensitive substring search over cached food names.
export async function searchCachedFoods(query: string): Promise<CachedFood[]> {
  const all = await getCachedFoods();
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((f) => f.name.toLowerCase().includes(q));
}

// ── Serving unit cache ─────────────────────────────────────────────────────────

// Persists serving units for a food. Stores only real DB units — virtual g/ml
// units (id starting with '__') are client-side constructs, not cached.
export async function saveCachedServingUnits(
  foodId: string,
  units: CachedServingUnit[]
): Promise<void> {
  try {
    const real = units.filter((u) => !u.id.startsWith('__'));
    const key = await getServingUnitsCacheKey();
    const raw = await AsyncStorage.getItem(key);
    const map: Record<string, CachedServingUnit[]> = raw ? JSON.parse(raw) : {};
    map[foodId] = real;
    await AsyncStorage.setItem(key, JSON.stringify(map));
  } catch {
    // Non-critical
  }
}

// Returns cached serving units for a food, or [] if none are stored.
export async function getCachedServingUnits(foodId: string): Promise<CachedServingUnit[]> {
  try {
    const key = await getServingUnitsCacheKey();
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const map: Record<string, CachedServingUnit[]> = JSON.parse(raw);
    return map[foodId] ?? [];
  } catch {
    return [];
  }
}
