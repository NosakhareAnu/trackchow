import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import api from '@/lib/api';
import { colors, radius, spacing } from '@/lib/theme';
import { setFlash } from '@/lib/flash-message';
import {
  getCachedServingUnits,
  saveCachedFood,
  saveCachedServingUnits,
  searchCachedFoods,
} from '@/lib/food-cache';
import { savePendingLog, PendingItem } from '@/lib/offline-sync';
import { QUANTITY_UNITS } from '@/lib/portion-units';
import { getRecentFoods, saveRecentFood, type RecentFood } from '@/lib/recent-foods';
import { NutritionPreview } from '@/components/nutrition-preview';

// ── Types ─────────────────────────────────────────────────────────────────────

type FoodItem = {
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
};

type ServingUnit = {
  id: string;
  unit_name: string;
  unit_type: 'conventional' | 'unconventional';
  grams: number;
  is_default: boolean;
};

// ── Serving unit helpers ──────────────────────────────────────────────────────

// Synthetic units appended client-side so users can always log exact weight.
// id starts with '__' so the submit handler knows not to send serving_unit_id.
const GRAM_UNIT: ServingUnit = { id: '__g__', unit_name: 'g', unit_type: 'conventional', grams: 1, is_default: false };
const ML_UNIT: ServingUnit = { id: '__ml__', unit_name: 'ml', unit_type: 'conventional', grams: 1, is_default: false };

const LIQUID_CATEGORIES = ['drink', 'liquid', 'beverage', 'soup'];
const LIQUID_UNIT_NAMES = ['cup', 'bottle', 'glass', 'ml'];

// Ensures 'g' is always in the list. Adds 'ml' for drink-like foods or when
// the backend already returns liquid units (cup, bottle, glass). No duplicates.
function withGramUnits(units: ServingUnit[], food?: FoodItem | null): ServingUnit[] {
  const result = [...units];
  const names = result.map((u) => u.unit_name.toLowerCase());

  if (!names.includes('g')) result.push(GRAM_UNIT);

  const category = food?.category?.toLowerCase() ?? '';
  const isLiquid = LIQUID_CATEGORIES.some((c) => category.includes(c));
  const hasLiquidUnit = LIQUID_UNIT_NAMES.some((n) => names.includes(n));

  if ((isLiquid || hasLiquidUnit) && !names.includes('ml')) result.push(ML_UNIT);

  return result;
}

// Controls which step the AI food search flow is in.
// 'none'    — not shown
// 'confirm' — confirmation card shown before making the API call
// 'loading' — POST /ai/food-search in progress
// 'error'   — call failed or AI was not confident
type AiStep = 'none' | 'confirm' | 'loading' | 'error';

// ── Constants ─────────────────────────────────────────────────────────────────

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

// ── Date helpers (local-time only, no toISOString) ────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return localDateStr(new Date());
}

function addOneDayStr(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return localDateStr(new Date(year, month - 1, day + 1));
}

function formatLogDateLabel(dateStr: string): string {
  const today = todayStr();
  if (dateStr === today) return 'Today';
  if (dateStr === addOneDayStr(today)) return 'Tomorrow';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LogMealScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();

  const [logDate, setLogDate] = useState(params.date || todayStr());

  // Food search state
  const [searchQuery, setSearchQuery] = useState('');
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Recent foods loaded from AsyncStorage — shown when search is empty
  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([]);

  // AI search step and error text
  const [aiStep, setAiStep] = useState<AiStep>('none');
  const [aiError, setAiError] = useState('');

  // Selected food and log options
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [mealType, setMealType] = useState('lunch');
  const [quantity, setQuantity] = useState('1');
  const [quantityUnit, setQuantityUnit] = useState('plate');

  // Serving units for the selected food
  const [servingUnits, setServingUnits] = useState<ServingUnit[]>([]);
  const [servingUnitsLoading, setServingUnitsLoading] = useState(false);
  const [selectedServingUnit, setSelectedServingUnit] = useState<ServingUnit | null>(null);

  // True when food search results are coming from the local cache (offline fallback).
  const [offlineFoodSearch, setOfflineFoodSearch] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set to true after a successful log so useFocusEffect resets the form on return.
  const justLoggedRef = useRef(false);

  // Reload logDate and recent foods on every tab focus.
  // Also resets the form when returning after a successful log (justLoggedRef).
  useFocusEffect(
    useCallback(() => {
      // Dark-themed screen — light status-bar icons while focused; restore on blur.
      setStatusBarStyle('light');
      setLogDate(params.date || todayStr());
      getRecentFoods().then(setRecentFoods);
      if (justLoggedRef.current) {
        justLoggedRef.current = false;
        setSelectedFood(null);
        setServingUnits([]);
        setSelectedServingUnit(null);
        setServingUnitsLoading(false);
        setQuantity('1');
        setQuantityUnit('plate');
        setMealType('lunch');
        setSearchQuery('');
        setFoods([]);
        setOfflineFoodSearch(false);
        setSubmitError('');
        setAiStep('none');
        setAiError('');
      }
      return () => setStatusBarStyle('dark');
    }, [params.date])
  );

  // Debounced food search — only fires when the query is ≥ 2 characters.
  // Clears results and resets the AI step on every keystroke so stale state
  // from a previous "no results" search doesn't linger.
  useEffect(() => {
    setAiStep('none');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setFoods([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetchFoods(trimmed);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  async function fetchFoods(query: string) {
    setSearchError('');
    setOfflineFoodSearch(false);
    setSearchLoading(true);
    try {
      const res = await api.get('/foods', { params: { search: query } });
      setFoods(res.data.data ?? []);
    } catch (err: any) {
      if (!err.response) {
        // Network/offline error — fall back to local food cache.
        const cached = await searchCachedFoods(query);
        setFoods(cached);
        setOfflineFoodSearch(true);
        if (cached.length === 0) {
          setSearchError('');  // no error text — UI handles this with offlineFoodSearch flag
        }
      } else {
        setSearchError('Could not load foods. Check your connection.');
      }
    } finally {
      setSearchLoading(false);
    }
  }

  // Fetches serving units for a food item, caches the real DB units, adds synthetic
  // g/ml units, and auto-selects the default. On failure, tries the local cache.
  async function fetchServingUnits(foodId: string, food: FoodItem) {
    setServingUnitsLoading(true);
    try {
      const res = await api.get(`/foods/${foodId}/serving-units`);
      const rawUnits = res.data.data ?? [];
      // Cache real DB units (virtual __g__/__ml__ are excluded inside saveCachedServingUnits)
      await saveCachedServingUnits(foodId, rawUnits);
      const units = withGramUnits(rawUnits, food);
      setServingUnits(units);
      const defaultUnit = units.find((u) => u.is_default) ?? units[0] ?? null;
      setSelectedServingUnit(defaultUnit);
      if (defaultUnit) setQuantityUnit(defaultUnit.unit_name);
    } catch {
      // Offline — try cached serving units, then fall back to empty (g/ml chips still show)
      const cached = await getCachedServingUnits(foodId);
      const units = withGramUnits(cached, food);
      setServingUnits(units);
      const defaultUnit = units.find((u) => u.is_default) ?? units[0] ?? null;
      setSelectedServingUnit(defaultUnit);
      if (defaultUnit) setQuantityUnit(defaultUnit.unit_name);
    } finally {
      setServingUnitsLoading(false);
    }
  }

  // Selects a food and loads its serving units (with g/ml always appended).
  // Pass preloadedUnits (from AI response) to skip the extra fetch.
  function handleSelectFood(food: FoodItem, preloadedUnits?: ServingUnit[]) {
    // Cache so the food is available offline next time.
    saveCachedFood(food);
    setSelectedFood(food);
    if (preloadedUnits !== undefined) {
      const enriched = withGramUnits(preloadedUnits, food);
      setServingUnits(enriched);
      const defaultUnit = enriched.find((u) => u.is_default) ?? enriched[0] ?? null;
      setSelectedServingUnit(defaultUnit);
      if (defaultUnit) setQuantityUnit(defaultUnit.unit_name);
      // Cache the AI-returned serving units so they are available offline next time.
      // saveCachedServingUnits filters out virtual __g__/__ml__ units automatically.
      saveCachedServingUnits(food.id, preloadedUnits);
    } else {
      fetchServingUnits(food.id, food);
    }
  }

  // Called when the user confirms the AI search card.
  // Calls POST /ai/food-search, then selects the returned food on success.
  async function handleAiSearch() {
    const query = searchQuery.trim();
    setAiStep('loading');
    setAiError('');
    try {
      const res = await api.post('/ai/food-search', { query });
      const { success, food, serving_units, limitReached, message } = res.data;
      if (!success) {
        setAiError(
          limitReached
            ? 'Daily AI search limit reached. Try again tomorrow.'
            : message || 'Could not estimate this food. Try a simpler name.'
        );
        setAiStep('error');
        return;
      }
      // Use the food and serving units returned by the backend directly —
      // avoids an extra GET /foods/:id/serving-units round trip.
      handleSelectFood(food, serving_units ?? []);
    } catch (err: any) {
      if (!err.response) {
        setAiError('AI search requires internet connection.');
      } else {
        setAiError('Could not estimate this food. Try a simpler name.');
      }
      setAiStep('error');
    }
  }

  async function handleSubmit() {
    if (!selectedFood) return;

    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setSubmitError('Please enter a valid quantity.');
      return;
    }

    setSubmitError('');
    setSubmitting(true);

    // PendingItem type covers both the online POST payload and the offline savePendingLog call.
    // food_name is local-display only; the backend ignores it (destructures only food_item_id etc).
    const itemPayload: PendingItem = {
      food_item_id: selectedFood.id,
      quantity: qty,
      quantity_unit: quantityUnit,
      food_name: selectedFood.name,
    };
    // Virtual g/ml units (id starts with '__') are not real DB rows — omit serving_unit_id
    if (selectedServingUnit && !selectedServingUnit.id.startsWith('__')) {
      itemPayload.serving_unit_id = selectedServingUnit.id;
    }
    const items = [itemPayload];

    try {
      await api.post('/meal-logs', { meal_type: mealType, items, log_date: logDate });
      await saveRecentFood(selectedFood);
      justLoggedRef.current = true;
      setFlash(`${selectedFood.name} was added to ${mealType}.`, 'online', logDate);
      router.replace('/(tabs)/dashboard');
    } catch (err: any) {
      if (!err.response) {
        await savePendingLog(mealType, items, '', logDate);
        await saveRecentFood(selectedFood);
        justLoggedRef.current = true;
        setFlash(`${selectedFood.name} was saved offline. Sync when you are back online.`, 'offline', logDate);
        router.replace('/(tabs)/dashboard');
      } else {
        const message = err?.response?.data?.message ?? 'Failed to log meal. Please try again.';
        setSubmitError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedFood(null);
    setServingUnits([]);
    setSelectedServingUnit(null);
    setServingUnitsLoading(false);
    setQuantity('1');
    setQuantityUnit('plate');
    setMealType('lunch');
    setSearchQuery('');
    setFoods([]);
    setOfflineFoodSearch(false);
    setSubmitError('');
    setAiStep('none');
    setAiError('');
  }

  // ── Meal options panel (after selecting a food) ─────────────────────────────
  if (selectedFood) {
    const conventionalUnits = servingUnits.filter((u) => u.unit_type === 'conventional');
    const unconventionalUnits = servingUnits.filter((u) => u.unit_type === 'unconventional');
    const gramsPerUnit = selectedServingUnit?.grams ?? null;

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.heading}>Log Meal</Text>
          <Text style={styles.dateBadge}>Logging for: {formatLogDateLabel(logDate)}</Text>

          {/* Selected food */}
          <View style={styles.selectedCard}>
            <Text style={styles.selectedName}>{selectedFood.name}</Text>
            <Text style={styles.selectedMacros}>
              Per serving: {selectedFood.calories} kcal · C {selectedFood.carbs_g}g · P {selectedFood.protein_g}g · F {selectedFood.fat_g}g · Fiber {selectedFood.fiber_g}g
            </Text>
          </View>

          {/* Meal type picker */}
          <Text style={styles.label}>Meal Type</Text>
          <View style={styles.chipRow}>
            {MEAL_TYPES.map((type) => (
              <Pressable
                key={type}
                style={[styles.chip, mealType === type && styles.chipSelected]}
                onPress={() => setMealType(type)}>
                <Text style={[styles.chipText, mealType === type && styles.chipTextSelected]}>
                  {type}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Quantity input */}
          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="e.g. 2"
            placeholderTextColor={colors.placeholder}
          />

          {/* Serving unit picker — dynamic from API, grouped by type */}
          <Text style={styles.label}>Unit</Text>
          {servingUnitsLoading ? (
            <ActivityIndicator color={colors.accent} size="small" style={{ alignSelf: 'flex-start' }} />
          ) : servingUnits.length > 0 ? (
            <>
              {conventionalUnits.length > 0 && (
                <>
                  <Text style={styles.unitGroupLabel}>Conventional</Text>
                  <View style={styles.chipRow}>
                    {conventionalUnits.map((u) => (
                      <Pressable
                        key={u.id}
                        style={[styles.chip, selectedServingUnit?.id === u.id && styles.chipSelected]}
                        onPress={() => {
                          setSelectedServingUnit(u);
                          setQuantityUnit(u.unit_name);
                        }}>
                        <Text style={[styles.chipText, selectedServingUnit?.id === u.id && styles.chipTextSelected]}>
                          {u.unit_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              {unconventionalUnits.length > 0 && (
                <>
                  <Text style={styles.unitGroupLabel}>Unconventional</Text>
                  <View style={styles.chipRow}>
                    {unconventionalUnits.map((u) => (
                      <Pressable
                        key={u.id}
                        style={[styles.chip, selectedServingUnit?.id === u.id && styles.chipSelected]}
                        onPress={() => {
                          setSelectedServingUnit(u);
                          setQuantityUnit(u.unit_name);
                        }}>
                        <Text style={[styles.chipText, selectedServingUnit?.id === u.id && styles.chipTextSelected]}>
                          {u.unit_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </>
          ) : (
            // Fallback — food has no serving units defined in the database yet
            <View style={styles.chipRow}>
              {QUANTITY_UNITS.map((unit) => (
                <Pressable
                  key={unit}
                  style={[styles.chip, quantityUnit === unit && styles.chipSelected]}
                  onPress={() => setQuantityUnit(unit)}>
                  <Text style={[styles.chipText, quantityUnit === unit && styles.chipTextSelected]}>
                    {unit}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Live nutrition preview — updates as quantity, unit, and gramsPerUnit change */}
          <NutritionPreview
            food={selectedFood}
            quantity={parseFloat(quantity) || 0}
            unit={quantityUnit}
            gramsPerUnit={gramsPerUnit}
          />

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={handleSubmit}
            disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Confirm Meal</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
            onPress={() => {
              setSelectedFood(null);
              setServingUnits([]);
              setSelectedServingUnit(null);
            }}>
            <Text style={styles.ghostButtonText}>← Back to Search</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Food search panel ───────────────────────────────────────────────────────

  const isShortQuery = searchQuery.trim().length < 2;

  return (
    <SafeAreaView style={styles.container}>
      {/* Fixed search header */}
      <View style={styles.searchHeader}>
        <Text style={styles.heading}>Log Meal</Text>
        <Text style={styles.dateBadge}>Logging for: {formatLogDateLabel(logDate)}</Text>
        <View style={styles.searchBox}>
          <Search color={colors.textMuted} size={18} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search food (e.g. jollof rice)"
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
        {isShortQuery && searchQuery.length === 0
          ? null
          : isShortQuery
            ? <Text style={styles.searchHint}>Type at least 2 characters to search</Text>
            : null}
      </View>

      {/* Content area — conditionally rendered based on search state */}

      {isShortQuery ? (
        // Empty or very short query — show recent foods
        <ScrollView contentContainerStyle={styles.list}>
          {recentFoods.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Recent</Text>
              {recentFoods.map((food) => (
                <Pressable
                  key={food.id}
                  style={({ pressed }) => [styles.foodCard, pressed && styles.pressed]}
                  onPress={() => handleSelectFood(food)}>
                  <View style={styles.foodCardLeft}>
                    <Text style={styles.foodName}>{food.name}</Text>
                    {food.serving_unit ? (
                      <Text style={styles.foodUnit}>per {food.serving_unit}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.foodCalories}>{food.calories} kcal</Text>
                </Pressable>
              ))}
            </>
          ) : (
            <Text style={styles.emptyText}>Start typing to search for a food item.</Text>
          )}
        </ScrollView>
      ) : searchLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />
      ) : searchError ? (
        <Text style={[styles.error, { margin: 20 }]}>{searchError}</Text>
      ) : foods.length > 0 ? (
        // Search results — online or offline cached
        <FlatList
          data={foods}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            offlineFoodSearch ? (
              <Text style={styles.offlineBanner}>Showing saved offline foods</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.foodCard, pressed && styles.pressed]}
              onPress={() => handleSelectFood(item)}>
              <View style={styles.foodCardLeft}>
                <Text style={styles.foodName}>{item.name}</Text>
                {item.serving_unit ? (
                  <Text style={styles.foodUnit}>per {item.serving_unit}</Text>
                ) : null}
              </View>
              <Text style={styles.foodCalories}>{item.calories} kcal</Text>
            </Pressable>
          )}
        />
      ) : aiStep === 'confirm' ? (
        // Confirmation card — shown before making the AI call
        <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
          <View style={styles.aiCard}>
            <Text style={styles.aiCardTitle}>Search with AI</Text>
            <Text style={styles.aiCardBody}>
              AI will estimate nutrition for "{searchQuery.trim()}". Results may not be exact.
            </Text>
            <View style={styles.aiCardRow}>
              <Pressable
                style={({ pressed }) => [styles.aiCancelButton, pressed && styles.pressed]}
                onPress={() => setAiStep('none')}>
                <Text style={styles.aiCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.aiConfirmButton, pressed && styles.pressed]}
                onPress={handleAiSearch}>
                <Text style={styles.aiConfirmText}>Search with AI</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      ) : aiStep === 'loading' ? (
        // Loading state while AI estimates nutrition
        <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
          <View style={styles.aiCard}>
            <ActivityIndicator color={colors.accent} style={{ marginBottom: 8 }} />
            <Text style={[styles.aiCardBody, { textAlign: 'center' }]}>
              Estimating nutrition...
            </Text>
          </View>
        </ScrollView>
      ) : aiStep === 'error' ? (
        // Error state — AI failed, limit reached, or low-confidence result
        <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
          <View style={styles.aiCard}>
            <Text style={[styles.error, { textAlign: 'left', marginBottom: 8 }]}>{aiError}</Text>
            <Pressable
              style={({ pressed }) => [styles.aiCancelButton, pressed && styles.pressed]}
              onPress={() => setAiStep('none')}>
              <Text style={styles.aiCancelText}>← Back to search</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : offlineFoodSearch ? (
        // Offline, no cached matches — do not offer AI (requires internet)
        <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
          <Text style={styles.noResultsText}>
            No saved offline food found. Connect to the internet to search more foods.
          </Text>
        </ScrollView>
      ) : (
        // Online, no results — prompt the user to try AI
        <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
          <Text style={styles.noResultsText}>
            No food found for "{searchQuery.trim()}".
          </Text>
          <Pressable
            style={({ pressed }) => [styles.aiButton, pressed && styles.pressed]}
            onPress={() => setAiStep('confirm')}>
            <Text style={styles.aiButtonText}>Search with AI</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    gap: spacing.md,
  },
  searchHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  dateBadge: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 2,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.textPrimary,
  },
  searchHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: -4,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  foodCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  foodCardLeft: {
    flex: 1,
    gap: 2,
  },
  foodName: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  foodUnit: {
    fontSize: 12,
    color: colors.textMuted,
  },
  foodCalories: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accentSoft,
    marginLeft: spacing.sm,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
    fontSize: 14,
  },
  noResultsText: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: spacing.lg,
  },
  offlineBanner: {
    fontSize: 12,
    color: colors.warning,
    backgroundColor: colors.warningFill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  aiButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginHorizontal: 40,
  },
  aiButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  aiCard: {
    backgroundColor: colors.accentFill,
    borderWidth: 1,
    borderColor: 'rgba(139,128,249,0.4)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  aiCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accentSoft,
  },
  aiCardBody: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  aiCardRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  aiCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.elevated,
  },
  aiCancelText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  aiConfirmButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  aiConfirmText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  selectedCard: {
    backgroundColor: colors.accentFill,
    borderWidth: 1,
    borderColor: 'rgba(139,128,249,0.35)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  selectedName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  selectedMacros: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  unitGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.elevated,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
  },
  ghostButtonText: {
    color: colors.textMuted,
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
