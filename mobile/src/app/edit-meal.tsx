import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { updatePendingLog } from '@/lib/offline-sync';
import { QUANTITY_UNITS } from '@/lib/portion-units';
import { getRecentFoods, type RecentFood } from '@/lib/recent-foods';
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

    const itemPayload: Record<string, unknown> = {
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
          <TextInput
            style={styles.searchInput}
            placeholder="Search food (e.g. jollof rice)"
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            autoFocus
          />
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
                {recentFoods.map((food, i) => (
                  <View key={food.id}>
                    <Pressable
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
                    {i < recentFoods.length - 1 && <View style={styles.separator} />}
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.emptyText}>Start typing to search for a food item.</Text>
            )}
          </ScrollView>
        ) : searchLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color="#2563EB" />
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
            ItemSeparatorComponent={() => <View style={styles.separator} />}
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
          placeholderTextColor="#999"
        />

        {/* Serving unit picker — dynamic from API, grouped by type */}
        <Text style={styles.label}>Unit</Text>
        {servingUnitsLoading ? (
          <ActivityIndicator color="#2563EB" size="small" style={{ alignSelf: 'flex-start' }} />
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
          placeholderTextColor="#999"
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
    backgroundColor: '#fff',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backButton: {
    width: 60,
  },
  backButtonText: {
    color: '#2563EB',
    fontSize: 15,
  },
  heading: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 10,
  },
  offlineBannerText: {
    color: '#92400E',
    fontSize: 13,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 4,
  },
  unitGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
    marginBottom: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  chipText: {
    fontSize: 13,
    color: '#333',
  },
  chipTextSelected: {
    color: '#fff',
  },
  selectedCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  selectedName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e3a5f',
  },
  changeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  changeButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#000',
  },
  notesInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  ghostButtonText: {
    color: '#555',
    fontSize: 15,
  },
  error: {
    color: '#c0392b',
    fontSize: 13,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  // Food picker styles
  pickerHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#000',
  },
  searchHint: {
    fontSize: 12,
    color: '#aaa',
    marginTop: -4,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  foodCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  foodCardLeft: {
    flex: 1,
    gap: 2,
  },
  foodName: {
    fontSize: 15,
    color: '#111',
  },
  foodUnit: {
    fontSize: 12,
    color: '#888',
  },
  foodCalories: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
    marginLeft: 8,
  },
  separator: {
    height: 1,
    backgroundColor: '#F0F0F0',
  },
  emptyText: {
    textAlign: 'center',
    color: '#aaa',
    marginTop: 40,
    fontSize: 14,
  },
  noResultsText: {
    textAlign: 'center',
    color: '#555',
    fontSize: 14,
    marginBottom: 16,
  },
  aiButton: {
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginHorizontal: 40,
  },
  aiButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  aiCard: {
    backgroundColor: '#F5F3FF',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  aiCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#5B21B6',
  },
  aiCardBody: {
    fontSize: 14,
    color: '#4C1D95',
    lineHeight: 20,
  },
  aiCardRow: {
    flexDirection: 'row',
    gap: 10,
  },
  aiCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  aiCancelText: {
    color: '#333',
    fontWeight: '600',
    fontSize: 14,
  },
  aiConfirmButton: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  aiConfirmText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
