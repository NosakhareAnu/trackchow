// Shared portion units used across Log Meal, Edit Meal, and Templates.
// Update this single list to keep all screens in sync.
export const QUANTITY_UNITS = [
  'plate',
  'scoop',
  'serving spoon',
  'takeaway pack',
  'foam takeaway',
  'bowl',
  'wrap',
  'piece',
  'bottle',
  'cup',
  'slice',
  'pack',
] as const;

export type QuantityUnit = (typeof QUANTITY_UNITS)[number];
