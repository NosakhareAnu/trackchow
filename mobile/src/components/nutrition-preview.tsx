import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/lib/theme';

// Nutrition values from food_items.
// Legacy fields (calories, carbs_g, etc.) are always present.
// Per-100g fields are optional — present only for foods with updated data.
export type NutritionValues = {
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

type Props = {
  food: NutritionValues | null;
  quantity: number;
  unit: string;
  // Grams for the selected serving unit (from food_serving_units.grams).
  // When provided alongside per-100g food data, enables accurate gram-based calculation.
  gramsPerUnit?: number | null;
};

// Live preview card.
// Preferred path: uses per-100g × gramsPerUnit when both are available.
//   total_grams = quantity × gramsPerUnit
//   nutrient    = (total_grams / 100) × nutrient_per_100g
// Fallback path: multiplies legacy per-serving values × quantity.
export function NutritionPreview({ food, quantity, unit, gramsPerUnit }: Props) {
  if (!food || !quantity || quantity <= 0 || !isFinite(quantity)) return null;

  const canUsePerHundredG =
    food.calories_per_100g != null &&
    food.calories_per_100g > 0 &&
    gramsPerUnit != null &&
    gramsPerUnit > 0;

  let cals: number;
  let carbs: number;
  let protein: number;
  let fat: number;
  let fiber: number;
  let totalGrams: number | null = null;

  if (canUsePerHundredG) {
    totalGrams = Math.round(quantity * gramsPerUnit!);
    const factor = totalGrams / 100;
    cals = Math.round(factor * food.calories_per_100g!);
    carbs = parseFloat((factor * (food.carbs_per_100g || 0)).toFixed(1));
    protein = parseFloat((factor * (food.protein_per_100g || 0)).toFixed(1));
    fat = parseFloat((factor * (food.fat_per_100g || 0)).toFixed(1));
    fiber = parseFloat((factor * (food.fiber_per_100g || 0)).toFixed(1));
  } else {
    cals = Math.round(food.calories * quantity);
    carbs = parseFloat((food.carbs_g * quantity).toFixed(1));
    protein = parseFloat((food.protein_g * quantity).toFixed(1));
    fat = parseFloat((food.fat_g * quantity).toFixed(1));
    fiber = parseFloat((food.fiber_g * quantity).toFixed(1));
  }

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Nutrition Preview</Text>
        <Text style={styles.subtitle}>
          {quantity} {unit}{totalGrams != null ? ` = ${totalGrams}g` : ''}
        </Text>
      </View>
      <View style={styles.row}>
        <MacroBox label="Calories" value={cals} unit="kcal" accent />
        <MacroBox label="Carbs" value={carbs} unit="g" />
        <MacroBox label="Protein" value={protein} unit="g" />
        <MacroBox label="Fat" value={fat} unit="g" />
        <MacroBox label="Fiber" value={fiber} unit="g" />
      </View>
    </View>
  );
}

function MacroBox({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.macroBox}>
      <Text style={[styles.macroValue, accent && styles.accentValue]}>{value}</Text>
      <Text style={styles.macroUnit}>{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macroBox: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  macroValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  accentValue: {
    color: colors.accentSoft,
    fontSize: 16,
  },
  macroUnit: {
    fontSize: 10,
    color: colors.textMuted,
  },
  macroLabel: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
