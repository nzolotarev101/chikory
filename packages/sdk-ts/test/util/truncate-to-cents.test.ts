import { describe, expect, it } from "vitest";

import { truncateToCents } from "../../src/util/truncate-to-cents.js";

describe("truncateToCents", () => {
  it("truncates to two decimal places", () => {
    expect(truncateToCents(9.999)).toBe(9.99);
    expect(truncateToCents(1.239)).toBe(1.23);
    expect(truncateToCents(12.349)).toBe(12.34);
    expect(truncateToCents(5)).toBe(5);
  });

  it("truncates negative values toward zero", () => {
    expect(truncateToCents(-12.345)).toBe(-12.34);
    expect(truncateToCents(-12.349)).toBe(-12.34);
  });

  it("preserves values that already fit cents precision", () => {
    expect(truncateToCents(1.23)).toBe(1.23);
    expect(truncateToCents(0.01)).toBe(0.01);
  });
});
