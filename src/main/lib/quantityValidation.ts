// Utility functions for quantity validation and formatting (Main Process)
export const formatToThreeDecimalPlaces = (value: number | string): number => {
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 0;
    value = parsed;
  }

  // Round to 3 decimal places
  return Math.round(value * 1000) / 1000;
};

export const validateAndFormatQuantity = (value: number | string): number => {
  return formatToThreeDecimalPlaces(value);
};
