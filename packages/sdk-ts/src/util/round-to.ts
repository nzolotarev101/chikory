/**
 * Rounds a finite number to a fixed count of decimal places.
 *
 * @throws {RangeError} If `decimalPlaces` is not a non-negative integer.
 */
export function roundTo(value: number, decimalPlaces: number): number {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    throw new RangeError("decimalPlaces must be a non-negative integer");
  }

  const factor = 10 ** decimalPlaces;

  return Math.round((value + Number.EPSILON) * factor) / factor;
}
