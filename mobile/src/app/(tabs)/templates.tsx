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

// ── Types ─────────────────────────────────────────────────────────────────────

type FoodItem = {
  id: string;
  name: string;
  calories: number;
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

// ── Constants ─────────────────────────────────────────────────────────────────

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

const QUANTITY_UNITS = [
  'plate',
  'scoop',
  'serving spoon',
  'takeaway pack',
  'wrap',
  'piece',
  'bottle',
  'cup',
  'bowl',
  'portion',
];

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

  // ── Actions ─────────────────────────────────────────────────────────────────

  function openFoodPicker() {
    setFoodSearch('');
    fetchFoods('');
    setMode('food-picker');
  }

  function selectFood(food: FoodItem) {
    setSelectedFood(food);
    setMode('create');
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

    setCreateLoading(true);
    try {
      await api.post('/templates', {
        name: templateName.trim(),
        meal_type: mealType,
        items: [
          {
            food_item_id: selectedFood.id,
            quantity: qty,
            quantity_unit: quantityUnit,
          },
        ],
      });
      // Reset form and return to list
      setTemplateName('');
      setMealType('breakfast');
      setSelectedFood(null);
      setQuantity('1');
      setQuantityUnit('plate');
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

          <Text style={styles.label}>Unit</Text>
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
              setCreateError('');
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
              setCreateError('');
              setCreateSuccess('');
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
