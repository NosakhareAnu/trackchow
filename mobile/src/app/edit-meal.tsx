import { useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Search } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
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
import { getCachedServingUnits, saveCachedFood, saveCachedServingUnits } from '@/lib/food-cache';
import { updatePendingLog, type PendingItem } from '@/lib/offline-sync';
import { QUANTITY_UNITS } from '@/lib/portion-units';
import { getRecentFoods, type RecentFood } from '@/lib/recent-foods';
import { colors, radius, spacing } from '@/lib/theme';
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

type EditItem = {
  food_item_id: string;
  food_name: string;
  quantity: number;
  quantity_unit: string;
};

type ParsedData = {
  meal_type: string;
  notes: string;
  items: EditItem[];
};

type AiStep = 'none' | 'confirm' | 'result';

// ── Serving unit helpers ──────────────────────────────────────────────────────

const GRAM_UNIT: ServingUnit = { id: '__g__', unit_name: 'g', unit_type: 'conventional', grams: 1, is_default: false };
const ML_UNIT: ServingUnit = { id: '__ml__', unit_name: 'ml', unit_type: 'conventional', grams: 1, is_default: false };

const LIQUID_CATEGORIES = ['drink', 'liquid', 'beverage', 'soup'];
const LIQUID_UNIT_NAMES = ['cup', 'bottle', 'glass', 'ml'];

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

// ── Constants ─────────────────────────────────────────────────────────────────

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EditMealScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ logId?: string; tempId?: string; data: string }>();

  const isOffline = !!params.tempId;

  const parsed: ParsedData = JSON.parse(params.data ?? '{"meal_type":"lunch","notes":"","items":[]}');

  const [view, setView] = useState<'edit' | 'food-picker'>('edit');

  // Edit form state — initialised from parsed params
  const [mealType, setMealType] = useState(parsed.meal_type);
  const [notes, setNotes] = useState(parsed.notes);
  const [item, setItem] = useState<EditItem>(
    parsed.items[0] ?? { food_item_id: '', food_name: '', quantity: 1, quantity_unit: 'plate' }
  );
  const [quantity, setQuantity] = useState(String(parsed.items[0]?.quantity ?? '1'));
  const [quantityUnit, setQuantityUnit] = useState(parsed.items[0]?.quantity_unit ?? 'plate');

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Full FoodItem for the selected food — used for the nutrition preview.
  // On mount, we try to find the initial food in recent foods (lightweight, no API call).
  // Updates whenever the user picks from the food picker.
  const [selectedFoodData, setSelectedFoodData] = useState<FoodItem | null>(null);

  // Serving units for the selected food
  const [servingUnits, setServingUnits] = useState<ServingUnit[]>([]);
  const [servingUnitsLoading, setServingUnitsLoading] = useState(false);
  const [selectedServingUnit, setSelectedServingUnit] = useState<ServingUnit | null>(null);

  // Food picker state
  const [searchQuery, setSearchQuery] = useState('');
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([]);
  const [aiStep, setAiStep] = useState<AiStep>('none');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dark-themed screen — light status-bar icons while mounted; restore on unmount
  // (the Diary it returns to re-applies light on focus).
  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []);

  // On mount: load recent foods and fetch serving units for the current food item.
  // If the current food is in recent foods, its nutrition data is available for the preview.
  useEffect(() => {
    getRecentFoods().then((recents) => {
      setRecentFoods(recents);
      if (item.food_item_id) {
        const match = recents.find((f) => f.id === item.food_item_id);
        if (match) setSelectedFoodData(match as FoodItem);
      }
    });
    if (item.food_item_id) {
      fetchServingUnits(item.food_item_id, item.quantity_unit);
    }
  }, []);

  // Debounced search in food picker — only fires when query is ≥ 2 characters.
  // Resets AI step on every query change so stale state doesn't persist.
  useEffect(() => {
    if (view !== 'food-picker') return;
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
  }, [searchQuery, view]);

  async function fetchFoods(query: string) {
    setSearchError('');
    setSearchLoading(true);
    try {
      const res = await api.get('/foods', { params: { search: query } });
      setFoods(res.data.data ?? []);
    } catch {
      setSearchError('Could not load foods. Check your connection.');
    } finally {
      setSearchLoading(false);
    }
  }

  // Fetches serving units, caches real DB units, appends synthetic g/ml units, and auto-selects.
  // currentUnitName: re-selects the unit matching the existing quantity_unit (works for 'g'/'ml' too).
  // food: used for ml detection by category; pass null at mount when food data is not yet loaded.
  async function fetchServingUnits(foodId: string, currentUnitName?: string, food?: FoodItem | null) {
    setServingUnitsLoading(true);
    try {
      const res = await api.get(`/foods/${foodId}/serving-units`);
      const rawUnits = res.data.data ?? [];
      await saveCachedServingUnits(foodId, rawUnits);
      const units = withGramUnits(rawUnits, food);
      setServingUnits(units);
      const matched = currentUnitName ? units.find((u) => u.unit_name === currentUnitName) : null;
      const defaultUnit = matched ?? units.find((u) => u.is_default) ?? units[0] ?? null;
      setSelectedServingUnit(defaultUnit);
      if (defaultUnit) setQuantityUnit(defaultUnit.unit_name);
    } catch {
      // Offline — try cached serving units
      const cached = await getCachedServingUnits(foodId);
      const units = withGramUnits(cached, food);
      setServingUnits(units);
      const matched = currentUnitName ? units.find((u) => u.unit_name === currentUnitName) : null;
      const defaultUnit = matched ?? units.find((u) => u.is_default) ?? units[0] ?? null;
      setSelectedServingUnit(defaultUnit);
      if (defaultUnit) setQuantityUnit(defaultUnit.unit_name);
    } finally {
      setServingUnitsLoading(false);
    }
  }

  function handleSelectFood(food: FoodItem) {
    saveCachedFood(food);
    setSelectedFoodData(food);
    setItem({
      food_item_id: food.id,
      food_name: food.name,
      quantity: parseFloat(quantity) || 1,
      quantity_unit: quantityUnit,
    });
    // Fetch serving units for the new food — no currentUnit match, use default
    fetchServingUnits(food.id, undefined, food);
    setAiStep('none');
    setSearchQuery('');
    setFoods([]);
    setView('edit');
  }

  async function handleSave() {
    if (!item.food_item_id) {
      setSaveError('Please select a food item.');
      return;
    }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setSaveError('Please enter a valid quantity.');
      return;
    }

    setSaveError('');
    setSaving(true);

    // PendingItem covers both the online PUT payload and the offline updatePendingLog call.
    const itemPayload: PendingItem = {
      food_item_id: item.food_item_id,
      quantity: qty,
      quantity_unit: quantityUnit,
    };
    // Virtual g/ml units (id starts with '__') are not real DB rows — omit serving_unit_id
    if (selectedServingUnit && !selectedServingUnit.id.startsWith('__')) {
      itemPayload.serving_unit_id = selectedServingUnit.id;
    }

    try {
      if (isOffline) {
        await updatePendingLog(params.tempId!, {
          meal_type: mealType,
          notes,
          items: [itemPayload],
        });
      } else {
        await api.put(`/meal-logs/${params.logId}`, {
          meal_type: mealType,
          notes,
          items: [itemPayload],
        });
      }
      router.back();
    } catch (err: any) {
      setSaveError(err?.response?.data?.message ?? 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Food picker view ────────────────────────────────────────────────────────

  if (view === 'food-picker') {
    const isShortQuery = searchQuery.trim().length < 2;

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.pickerHeader}>
          <Pressable
            onPress={() => {
              setAiStep('none');
              setSearchQuery('');
              setFoods([]);
              setView('edit');
            }}
            style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </Pressable>
          <Text style={styles.heading}>Change Food</Text>
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
              autoFocus
            />
          </View>
          {searchQuery.length > 0 && isShortQuery ? (
            <Text style={styles.searchHint}>Type at least 2 characters to search</Text>
          ) : null}
        </View>

        {isShortQuery ? (
          // Show recent foods when query is empty or < 2 chars
          <ScrollView contentContainerStyle={styles.list}>
            {recentFoods.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Recent</Text>
                {recentFoods.map((food) => (
                  <Pressable
                    key={food.id}
                    style={({ pressed }) => [styles.foodCard, pressed && styles.pressed]}
                    onPress={() => handleSelectFood(food as FoodItem)}>
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
          <FlatList
            data={foods}
            keyExtractor={(f) => f.id}
            contentContainerStyle={styles.list}
            renderItem={({ item: food }) => (
              <Pressable
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
            )}
          />
        ) : aiStep === 'confirm' ? (
          <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
            <View style={styles.aiCard}>
              <Text style={styles.aiCardTitle}>Search with AI</Text>
              <Text style={styles.aiCardBody}>
                AI food search will estimate nutrition for "{searchQuery.trim()}".
              </Text>
              <View style={styles.aiCardRow}>
                <Pressable
                  style={({ pressed }) => [styles.aiCancelButton, pressed && styles.pressed]}
                  onPress={() => setAiStep('none')}>
                  <Text style={styles.aiCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.aiConfirmButton, pressed && styles.pressed]}
                  onPress={() => setAiStep('result')}>
                  <Text style={styles.aiConfirmText}>Continue</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        ) : aiStep === 'result' ? (
          <ScrollView contentContainerStyle={[styles.list, { paddingTop: 16 }]}>
            <View style={styles.aiCard}>
              <Text style={styles.aiCardBody}>AI search not connected yet.</Text>
              <Pressable
                style={({ pressed }) => [styles.aiCancelButton, pressed && styles.pressed]}
                onPress={() => setAiStep('none')}>
                <Text style={styles.aiCancelText}>← Back to search</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          // No results
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

  // ── Edit form view ──────────────────────────────────────────────────────────

  const conventionalUnits = servingUnits.filter((u) => u.unit_type === 'conventional');
  const unconventionalUnits = servingUnits.filter((u) => u.unit_type === 'unconventional');
  const gramsPerUnit = selectedServingUnit?.grams ?? null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Cancel</Text>
          </Pressable>
          <Text style={styles.heading}>Edit Meal</Text>
          <View style={{ width: 60 }} />
        </View>

        {isOffline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>Offline meal — changes saved locally</Text>
          </View>
        )}

        {/* Meal type */}
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

        {/* Selected food */}
        <Text style={styles.label}>Food Item</Text>
        <View style={styles.selectedCard}>
          <Text style={styles.selectedName}>
            {item.food_name || 'No food selected'}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.changeButton, pressed && styles.pressed]}
            onPress={() => {
              setSearchQuery('');
              setFoods([]);
              setAiStep('none');
              setView('food-picker');
            }}>
            <Text style={styles.changeButtonText}>Change Food</Text>
          </Pressable>
        </View>

        {/* Quantity */}
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

        {/* Live nutrition preview */}
        <NutritionPreview
          food={selectedFoodData}
          quantity={parseFloat(quantity) || 0}
          unit={quantityUnit}
          gramsPerUnit={gramsPerUnit}
        />

        {/* Notes */}
        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="e.g. had it for lunch at work"
          placeholderTextColor={colors.placeholder}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

        {/* Save button */}
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={handleSave}
          disabled={saving}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryButtonText}>Save Changes</Text>}
        </Pressable>

        {/* Cancel button */}
        <Pressable
          style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
          onPress={() => router.back()}>
          <Text style={styles.ghostButtonText}>Cancel</Text>
        </Pressable>
      </ScrollView>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backButton: {
    width: 60,
  },
  backButtonText: {
    color: colors.accentSoft,
    fontSize: 15,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  offlineBanner: {
    backgroundColor: colors.warningFill,
    borderWidth: 1,
    borderColor: 'rgba(244,184,96,0.4)',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  offlineBannerText: {
    color: colors.warning,
    fontSize: 13,
    textAlign: 'center',
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
  selectedCard: {
    backgroundColor: colors.accentFill,
    borderWidth: 1,
    borderColor: 'rgba(139,128,249,0.35)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  selectedName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  changeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  changeButtonText: {
    color: colors.accentSoft,
    fontSize: 13,
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
  notesInput: {
    minHeight: 70,
    textAlignVertical: 'top',
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
  // Food picker styles
  pickerHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
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
});
