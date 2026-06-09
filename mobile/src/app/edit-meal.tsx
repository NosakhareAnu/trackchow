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
import { updatePendingLog } from '@/lib/offline-sync';

// ── Types ─────────────────────────────────────────────────────────────────────

type FoodItem = {
  id: string;
  name: string;
  serving_unit: string | null;
  calories: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EditMealScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ logId?: string; tempId?: string; data: string }>();

  const isOffline = !!params.tempId;

  // Parse the data passed from dashboard
  const parsed: ParsedData = JSON.parse(params.data ?? '{"meal_type":"lunch","notes":"","items":[]}');

  const [view, setView] = useState<'edit' | 'food-picker'>('edit');

  // Edit form state — initialised from parsed params
  const [mealType, setMealType] = useState(parsed.meal_type);
  const [notes, setNotes] = useState(parsed.notes);
  const [item, setItem] = useState<EditItem>(parsed.items[0] ?? { food_item_id: '', food_name: '', quantity: 1, quantity_unit: 'plate' });
  const [quantity, setQuantity] = useState(String(parsed.items[0]?.quantity ?? '1'));
  const [quantityUnit, setQuantityUnit] = useState(parsed.items[0]?.quantity_unit ?? 'plate');

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Food picker state
  const [searchQuery, setSearchQuery] = useState('');
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load all foods when picker opens
  useEffect(() => {
    if (view === 'food-picker') {
      fetchFoods('');
    }
  }, [view]);

  // Debounced search in food picker
  useEffect(() => {
    if (view !== 'food-picker') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchFoods(searchQuery.trim());
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  async function fetchFoods(query: string) {
    setSearchError('');
    setSearchLoading(true);
    try {
      const params = query ? { search: query } : {};
      const res = await api.get('/foods', { params });
      setFoods(res.data.data ?? []);
    } catch {
      setSearchError('Could not load foods. Check your connection.');
    } finally {
      setSearchLoading(false);
    }
  }

  function handleSelectFood(food: FoodItem) {
    setItem({
      food_item_id: food.id,
      food_name: food.name,
      quantity: parseFloat(quantity) || 1,
      quantity_unit: quantityUnit,
    });
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

    try {
      if (isOffline) {
        // Update the pending log in AsyncStorage
        await updatePendingLog(params.tempId!, {
          meal_type: mealType,
          notes,
          items: [{ food_item_id: item.food_item_id, quantity: qty, quantity_unit: quantityUnit }],
        });
      } else {
        // Call PUT /meal-logs/:id
        await api.put(`/meal-logs/${params.logId}`, {
          meal_type: mealType,
          notes,
          items: [{ food_item_id: item.food_item_id, quantity: qty, quantity_unit: quantityUnit }],
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
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.pickerHeader}>
          <Pressable onPress={() => setView('edit')} style={styles.backButton}>
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
        </View>

        {searchLoading && <ActivityIndicator style={{ marginTop: 24 }} color="#2563EB" />}
        {searchError ? <Text style={[styles.error, { margin: 20 }]}>{searchError}</Text> : null}
        {!searchLoading && foods.length === 0 && !searchError && (
          <Text style={styles.emptyText}>No foods found.</Text>
        )}

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
      </SafeAreaView>
    );
  }

  // ── Edit form view ──────────────────────────────────────────────────────────

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
            onPress={() => { setSearchQuery(''); setView('food-picker'); }}>
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

        {/* Quantity unit */}
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
  // Food picker
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
  list: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
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
});
