/**
 * Calculates nutrition values for a single meal item.
 *
 * Preferred path — per-100g + gram mapping:
 *   total_grams = quantity × gramsPerUnit
 *   nutrient    = (total_grams / 100) × nutrient_per_100g
 *
 * Fallback path — legacy serving-based (when per-100g values or gramsPerUnit are absent):
 *   nutrient = food.nutrient × quantity
 *
 * @param {object} food         - Row from food_items (must include legacy and/or per-100g fields)
 * @param {number} quantity     - How many units the user selected
 * @param {number|null} gramsPerUnit - Grams for the selected unit (from food_serving_units), or null
 * @returns {{ grams_per_unit, total_grams, calories, carbs_g, protein_g, fat_g, fiber_g }}
 */
function calculateNutrition(food, quantity, gramsPerUnit) {
  const qty = Number(quantity) || 0;
  const grams = gramsPerUnit != null ? Number(gramsPerUnit) : null;

  const canUsePerHundredG =
    food.calories_per_100g != null &&
    Number(food.calories_per_100g) > 0 &&
    grams != null &&
    grams > 0;

  if (canUsePerHundredG) {
    const totalGrams = qty * grams;
    return {
      grams_per_unit: grams,
      total_grams: round(totalGrams),
      calories: round((totalGrams / 100) * Number(food.calories_per_100g)),
      carbs_g: round((totalGrams / 100) * Number(food.carbs_per_100g || 0)),
      protein_g: round((totalGrams / 100) * Number(food.protein_per_100g || 0)),
      fat_g: round((totalGrams / 100) * Number(food.fat_per_100g || 0)),
      fiber_g: round((totalGrams / 100) * Number(food.fiber_per_100g || 0)),
    };
  }

  // Fallback: old serving-based calculation — keeps existing logged meals correct
  return {
    grams_per_unit: null,
    total_grams: null,
    calories: (Number(food.calories) || 0) * qty,
    carbs_g: (Number(food.carbs_g) || 0) * qty,
    protein_g: (Number(food.protein_g) || 0) * qty,
    fat_g: (Number(food.fat_g) || 0) * qty,
    fiber_g: (Number(food.fiber_g) || 0) * qty,
  };
}

function round(val) {
  return Math.round(val * 100) / 100;
}

module.exports = { calculateNutrition };
