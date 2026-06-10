import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUser } from './auth-storage';

const BASE_KEY = '@trackchow_recent_foods';
const MAX_RECENT = 5;

// Mirrors the full nutrition shape stored on food_items.
// Per-100g fields are optional — present only for foods logged after the portion architecture update.
// Existing cached entries without these fields still work (legacy preview fallback).
export type RecentFood = {
  id: string;
  name: string;
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
};

// Builds a user-scoped storage key so different accounts never share recent foods.
async function getKey(): Promise<string> {
  const user = await getUser();
  return user?.id ? `${BASE_KEY}:${user.id}` : BASE_KEY;
}

// Prepends a food to the recent list, deduplicating by id, keeping MAX_RECENT.
// Silently ignores errors — recent foods are non-critical.
export async function saveRecentFood(food: RecentFood): Promise<void> {
  try {
    const key = await getKey();
    const raw = await AsyncStorage.getItem(key);
    const existing: RecentFood[] = raw ? (JSON.parse(raw) as RecentFood[]) : [];
    const updated = [food, ...existing.filter((f) => f.id !== food.id)].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Non-critical — do not throw
  }
}

export async function getRecentFoods(): Promise<RecentFood[]> {
  try {
    const key = await getKey();
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as RecentFood[];
  } catch {
    return [];
  }
}
