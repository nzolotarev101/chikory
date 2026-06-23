import { describe, expect, it } from "vitest";

import { truncateDecimals } from "../../src/util/truncate-decimals.js";

describe("truncateDecimals", () => {
  it("truncates positive values to the requested decimal places", () => {
    expect(truncateDecimals(1.239, 2)).toBe(1.23);
    expect(truncateDecimals(12.3456, 3)).toBe(12.345);
  });

  it("truncates negative values toward zero", () => {
    expect(truncateDecimals(-1.239, 2)).toBe(-1.23);
    expect(truncateDecimals(-12.3456, 3)).toBe(-12.345);
  });

  it("truncates to an integer when digits is zero", () => {
    expect(truncateDecimals(2.5, 0)).toBe(2);
    expect(truncateDecimals(-2.5, 0)).toBe(-2);
  });

  it("preserves values that are already at the requested precision", () => {
    expect(truncateDecimals(7, 3)).toBe(7);
    expect(truncateDecimals(3.14, 2)).toBe(3.14);
  });

  it("throws a RangeError when digits is not a non-negative integer", () => {
    expect(() => truncateDecimals(1, -1)).toThrow(RangeError);
    expect(() => truncateDecimals(1, 1.5)).toThrow(RangeError);
  });
});
