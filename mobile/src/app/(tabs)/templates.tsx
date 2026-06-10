import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
import { QUANTITY_UNITS } from '@/lib/portion-units';
import { NutritionPreview } from '@/components/nutrition-preview';

// ── Types ─────────────────────────────────────────────────────────────────────

type FoodItem = {
  id: string;
  name: string;
  category?: string | null;
  serving_unit?: string | null;
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

type TemplateItem = {
  id: string;
  quantity: number;
  quantity_unit: string;
  food_items: { id: string; name: string };
};

type Template = {
  id: string;
  name: string;
  meal_type: string;
  created_at: string;
  meal_template_items: TemplateItem[];
};

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

// ── View modes ────────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'create' | 'food-picker';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TemplatesScreen() {
  // Template list state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Create template form state
  const [templateName, setTemplateName] = useState('');
  const [mealType, setMealType] = useState('breakfast');
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [quantityUnit, setQuantityUnit] = useState('plate');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // Serving units for the selected food
  const [servingUnits, setServingUnits] = useState<ServingUnit[]>([]);
  const [servingUnitsLoading, setServingUnitsLoading] = useState(false);
  const [selectedServingUnit, setSelectedServingUnit] = useState<ServingUnit | null>(null);

  // Food picker state
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [foodSearch, setFoodSearch] = useState('');
  const [foodsLoading, setFoodsLoading] = useState(false);
  const [foodsError, setFoodsError] = useState('');

  // Log-from-template state
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState('');
  const [logError, setLogError] = useState('');

  // Current view
  const [mode, setMode] = useState<ViewMode>('list');

  // Reload templates when tab gains focus
  useFocusEffect(
    useCallback(() => {
      fetchTemplates();
    }, [])
  );

  // ── Data fetching ───────────────────────────────────────────────────────────

  async function fetchTemplates() {
    setListError('');
    setListLoading(true);
    try {
      const res = await api.get('/templates');
      setTemplates(res.data.data ?? []);
    } catch {
      setListError('Could not load templates. Check your connection.');
    } finally {
      setListLoading(false);
    }
  }

  async function fetchFoods(query: string) {
    setFoodsError('');
    setFoodsLoading(true);
    try {
      const params = query.trim() ? { search: query.trim() } : {};
      const res = await api.get('/foods', { params });
      setFoods(res.data.data ?? []);
    } catch {
      setFoodsError('Could not load foods.');
    } finally {
      setFoodsLoading(false);
    }
  }

  // Fetches serving units, caches real DB units, appends synthetic g/ml units, auto-selects.
  // On failure, tries cached units; falls back to empty (g/ml chips still show).
  async function fetchServingUnits(foodId: string, food: FoodItem) {
    setServingUnitsLoading(true);
    try {
      const res = await api.get(`/foods/${foodId}/serving-units`);
      const rawUnits = res.data.data ?? [];
      await saveCachedServingUnits(foodId, rawUnits);
      const units = withGramUnits(rawUnits, food);
      setServingUnits(units);
      const defaultUnit = units.find((u) => u.is_default) ?? units[0] ?? null;
      setSelectedServingUnit(defaultUnit);
      if (defaultUnit) setQuantityUnit(defaultUnit.unit_name);
    } catch {
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

  // ── Actions ─────────────────────────────────────────────────────────────────

  function openFoodPicker() {
    setFoodSearch('');
    fetchFoods('');
    setMode('food-picker');
  }

  function selectFood(food: FoodItem) {
    saveCachedFood(food);
    setSelectedFood(food);
    fetchServingUnits(food.id, food);
    setMode('create');
  }

  function resetCreateForm() {
    setTemplateName('');
    setMealType('breakfast');
    setSelectedFood(null);
    setQuantity('1');
    setQuantityUnit('plate');
    setServingUnits([]);
    setSelectedServingUnit(null);
    setCreateError('');
    setCreateSuccess('');
  }

  async function handleCreateTemplate() {
    setCreateError('');
    setCreateSuccess('');

    if (!templateName.trim()) {
      setCreateError('Template name is required.');
      return;
    }
    if (!selectedFood) {
      setCreateError('Please select a food item.');
      return;
    }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setCreateError('Please enter a valid quantity.');
      return;
    }

    const itemPayload: Record<string, unknown> = {
      food_item_id: selectedFood.id,
      quantity: qty,
      quantity_unit: quantityUnit,
    };
    // Virtual g/ml units (id starts with '__') are not real DB rows — omit serving_unit_id
    if (selectedServingUnit && !selectedServingUnit.id.startsWith('__')) {
      itemPayload.serving_unit_id = selectedServingUnit.id;
    }

    setCreateLoading(true);
    try {
      await api.post('/templates', {
        name: templateName.trim(),
        meal_type: mealType,
        items: [itemPayload],
      });
      resetCreateForm();
      setCreateSuccess('Template created successfully.');
      await fetchTemplates();
      setMode('list');
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to create template.';
      setCreateError(message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleLogTemplate(templateId: string) {
    setLogError('');
    setLogSuccess('');
    setLoggingId(templateId);
    try {
      await api.post(`/templates/${templateId}/log`);
      setLogSuccess(templateId);
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to log from template.';
      setLogError(message);
    } finally {
      setLoggingId(null);
    }
  }

  // ── Food picker view ────────────────────────────────────────────────────────

  if (mode === 'food-picker') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Select a Food</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search food..."
            placeholderTextColor="#999"
            value={foodSearch}
            onChangeText={(text) => {
              setFoodSearch(text);
              fetchFoods(text);
            }}
            autoCapitalize="none"
          />
        </View>

        {foodsLoading && <ActivityIndicator style={{ marginTop: 20 }} color="#2563EB" />}
        {foodsError ? <Text style={[styles.error, { margin: 20 }]}>{foodsError}</Text> : null}

        <ScrollView contentContainerStyle={styles.foodList}>
          {!foodsLoading && foods.length === 0 && !foodsError && (
            <Text style={styles.emptyText}>No foods found.</Text>
          )}
          {foods.map((food) => (
            <Pressable
              key={food.id}
              style={({ pressed }) => [styles.foodRow, pressed && styles.pressed]}
              onPress={() => selectFood(food)}>
              <Text style={styles.foodName}>{food.name}</Text>
              <Text style={styles.foodCalories}>{food.calories} kcal</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          style={({ pressed }) => [styles.ghostButton, { margin: 20 }, pressed && styles.pressed]}
          onPress={() => setMode('create')}>
          <Text style={styles.ghostButtonText}>← Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Create template view ────────────────────────────────────────────────────

  if (mode === 'create') {
    const conventionalUnits = servingUnits.filter((u) => u.unit_type === 'conventional');
    const unconventionalUnits = servingUnits.filter((u) => u.unit_type === 'unconventional');
    const gramsPerUnit = selectedServingUnit?.grams ?? null;

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.heading}>New Template</Text>

          <Text style={styles.label}>Template Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. My Breakfast"
            placeholderTextColor="#999"
            value={templateName}
            onChangeText={setTemplateName}
          />

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

          <Text style={styles.label}>Food Item</Text>
          <Pressable
            style={({ pressed }) => [styles.foodPickerButton, pressed && styles.pressed]}
            onPress={openFoodPicker}>
            <Text style={selectedFood ? styles.foodPickerSelected : styles.foodPickerPlaceholder}>
              {selectedFood ? selectedFood.name : 'Tap to select a food...'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="e.g. 1"
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
            food={selectedFood}
            quantity={parseFloat(quantity) || 0}
            unit={quantityUnit}
            gramsPerUnit={gramsPerUnit}
          />

          {createError ? <Text style={styles.error}>{createError}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={handleCreateTemplate}
            disabled={createLoading}>
            {createLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save Template</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
            onPress={() => {
              resetCreateForm();
              setMode('list');
            }}>
            <Text style={styles.ghostButtonText}>← Cancel</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Template list view ──────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Templates</Text>
          <Pressable
            style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
            onPress={() => {
              resetCreateForm();
              setMode('create');
            }}>
            <Text style={styles.createButtonText}>+ New</Text>
          </Pressable>
        </View>

        {createSuccess ? (
          <Text style={styles.successText}>{createSuccess}</Text>
        ) : null}

        {logError ? <Text style={styles.error}>{logError}</Text> : null}

        {listLoading && <ActivityIndicator color="#2563EB" style={{ marginTop: 24 }} />}
        {listError ? <Text style={styles.error}>{listError}</Text> : null}

        {!listLoading && templates.length === 0 && !listError && (
          <Text style={styles.emptyText}>
            No templates yet. Tap + New to create your first one.
          </Text>
        )}

        {templates.map((template) => {
          const justLogged = logSuccess === template.id;
          return (
            <View key={template.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.templateName}>{template.name}</Text>
                <Text style={styles.templateType}>{template.meal_type}</Text>
              </View>

              {template.meal_template_items.map((item) => (
                <Text key={item.id} style={styles.templateItem}>
                  • {item.food_items?.name ?? 'Unknown'} — {item.quantity} {item.quantity_unit}
                </Text>
              ))}

              {justLogged ? (
                <Text style={styles.successText}>Meal logged from this template.</Text>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}
                  onPress={() => handleLogTemplate(template.id)}
                  disabled={loggingId === template.id}>
                  {loggingId === template.id ? (
                    <ActivityIndicator color="#2563EB" size="small" />
                  ) : (
                    <Text style={styles.logButtonText}>Log This Meal</Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
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
    paddingTop: 24,
    paddingBottom: 40,
    gap: 10,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  heading: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  createButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#F5F5F7',
    borderRadius: 10,
    padding: 14,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  templateName: {
    fontSize: 15,
    fontWeight: '600',
  },
  templateType: {
    fontSize: 12,
    color: '#888',
    textTransform: 'capitalize',
  },
  templateItem: {
    fontSize: 13,
    color: '#444',
  },
  logButton: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  logButtonText: {
    color: '#2563EB',
    fontWeight: '600',
    fontSize: 13,
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
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#000',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#000',
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
  foodPickerButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
  },
  foodPickerPlaceholder: {
    color: '#999',
    fontSize: 15,
  },
  foodPickerSelected: {
    color: '#000',
    fontSize: 15,
    fontWeight: '500',
  },
  foodList: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 2,
  },
  foodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  foodName: {
    fontSize: 15,
    flex: 1,
    color: '#111',
  },
  foodCalories: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
    marginLeft: 8,
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
  successText: {
    color: '#16a34a',
    fontSize: 13,
    textAlign: 'center',
  },
  emptyText: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 32,
  },
  pressed: {
    opacity: 0.7,
  },
});
