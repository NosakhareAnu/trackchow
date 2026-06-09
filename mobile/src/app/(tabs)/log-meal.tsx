import { useRouter } from 'expo-router';
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
import { savePendingLog } from '@/lib/offline-sync';

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

export default function LogMealScreen() {
  const router = useRouter();

  // Food search state
  const [searchQuery, setSearchQuery] = useState('');
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Selected food and log options
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [mealType, setMealType] = useState('lunch');
  const [quantity, setQuantity] = useState('1');
  const [quantityUnit, setQuantityUnit] = useState('plate');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);

  // Debounce timer ref so we don't fire a request on every keystroke
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load all foods on mount
  useEffect(() => {
    fetchFoods('');
  }, []);

  // Re-fetch whenever search query changes, with a short debounce
  useEffect(() => {
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

  async function handleSubmit() {
    if (!selectedFood) return;

    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setSubmitError('Please enter a valid quantity.');
      return;
    }

    setSubmitError('');
    setSubmitting(true);

    const items = [{ food_item_id: selectedFood.id, quantity: qty, quantity_unit: quantityUnit }];

    try {
      await api.post('/meal-logs', { meal_type: mealType, items });
      setSuccess(true);
    } catch (err: any) {
      // No response means the device is offline or the server is unreachable.
      // Save the log locally so it can be synced later.
      if (!err.response) {
        await savePendingLog(mealType, items);
        setSavedOffline(true);
        setSuccess(true);
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
    setQuantity('1');
    setQuantityUnit('plate');
    setMealType('lunch');
    setSearchQuery('');
    setSubmitError('');
    setSuccess(false);
    setSavedOffline(false);
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.successIcon}>{savedOffline ? '📦' : '✓'}</Text>
        <Text style={styles.successTitle}>
          {savedOffline ? 'Saved Offline' : 'Meal Logged!'}
        </Text>
        <Text style={styles.successSub}>
          {savedOffline
            ? `${selectedFood?.name} was saved locally. Sync when you're back online.`
            : `${selectedFood?.name} has been added to your ${mealType}.`}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => router.replace('/(tabs)/dashboard')}>
          <Text style={styles.primaryButtonText}>Go to Dashboard</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
          onPress={handleReset}>
          <Text style={styles.ghostButtonText}>Log Another Meal</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Meal options panel (after selecting a food) ─────────────────────────────
  if (selectedFood) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.heading}>Log Meal</Text>

          {/* Selected food summary */}
          <View style={styles.selectedCard}>
            <Text style={styles.selectedName}>{selectedFood.name}</Text>
            <Text style={styles.selectedMacros}>
              {selectedFood.calories} kcal · C {selectedFood.carbs_g}g · P {selectedFood.protein_g}g · F {selectedFood.fat_g}g
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
            placeholderTextColor="#999"
          />

          {/* Quantity unit picker */}
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
            onPress={() => setSelectedFood(null)}>
            <Text style={styles.ghostButtonText}>← Back to Search</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Food search panel ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchHeader}>
        <Text style={styles.heading}>Log Meal</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search food (e.g. jollof rice)"
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {searchLoading && (
        <ActivityIndicator style={{ marginTop: 24 }} color="#2563EB" />
      )}
      {searchError ? <Text style={[styles.error, { margin: 20 }]}>{searchError}</Text> : null}

      {!searchLoading && foods.length === 0 && !searchError && (
        <Text style={styles.emptyText}>No foods found.</Text>
      )}

      <FlatList
        data={foods}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.foodCard, pressed && styles.pressed]}
            onPress={() => setSelectedFood(item)}>
            <View style={styles.foodCardLeft}>
              <Text style={styles.foodName}>{item.name}</Text>
              {item.serving_unit ? (
                <Text style={styles.foodUnit}>per {item.serving_unit}</Text>
              ) : null}
            </View>
            <Text style={styles.foodCalories}>{item.calories} kcal</Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: '#fff',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 10,
  },
  searchHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  heading: {
    fontSize: 22,
    fontWeight: 'bold',
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
  selectedCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  selectedName: {
    fontSize: 17,
    fontWeight: '600',
  },
  selectedMacros: {
    fontSize: 13,
    color: '#555',
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
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#000',
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
  successIcon: {
    fontSize: 48,
    color: '#16a34a',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  successSub: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 8,
  },
  pressed: {
    opacity: 0.7,
  },
});
