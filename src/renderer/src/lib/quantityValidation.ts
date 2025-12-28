/**
 * Utility functions for quantity validation and formatting
 * Ensures all quantities are formatted to 3 decimal places to prevent floating point precision issues
 */

/**
 * Formats a number to exactly 3 decimal places
 * @param value - The number to format
 * @returns The formatted number with exactly 3 decimal places
 */
export function formatToThreeDecimalPlaces(value: number): number {
  if (typeof value !== "number" || isNaN(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

/**
 * Validates and formats quantity input from user
 * @param input - The string input from the user
 * @returns The validated and formatted number, or null if invalid
 */
export function validateQuantityInput(input: string): number | null {
  if (!input || input.trim() === "") {
    return null;
  }

  const numericValue = parseFloat(input.trim());

  if (isNaN(numericValue) || !isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  // Format to 3 decimal places
  return formatToThreeDecimalPlaces(numericValue);
}
