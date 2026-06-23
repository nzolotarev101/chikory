import { describe, expect, it } from "vitest";

import { roundTo } from "../../src/util/round-to.js";

describe("roundTo", () => {
  it("rounds to the nearest integer when decimalPlaces is zero", () => {
    expect(roundTo(4.4, 0)).toBe(4);
    expect(roundTo(4.5, 0)).toBe(5);
  });

  it("rounds to the requested number of decimal places", () => {
    expect(roundTo(12.345, 2)).toBe(12.35);
    expect(roundTo(12.344, 2)).toBe(12.34);
    expect(roundTo(0.123456, 4)).toBe(0.1235);
  });

  it("handles common floating point representation imprecision", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.675, 2)).toBe(2.68);
  });

  it("preserves values that are already at the requested precision", () => {
    expect(roundTo(7, 3)).toBe(7);
    expect(roundTo(3.14, 2)).toBe(3.14);
  });

  it("throws a RangeError when decimalPlaces is not a non-negative integer", () => {
    expect(() => roundTo(1.23, -1)).toThrow(RangeError);
    expect(() => roundTo(1.23, 1.5)).toThrow(RangeError);
  });
});
