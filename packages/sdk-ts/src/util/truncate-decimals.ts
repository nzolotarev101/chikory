/**
 * Truncates a finite number toward zero to a fixed count of decimal places.
 *
 * @throws {RangeError} If `digits` is not a non-negative integer.
 */
export function truncateDecimals(value: number, digits: number): number {
  if (!Number.isInteger(digits) || digits < 0) {
    throw new RangeError("digits must be a non-negative integer");
  }

  const factor = 10 ** digits;

  return Math.trunc(value * factor) / factor;
}
