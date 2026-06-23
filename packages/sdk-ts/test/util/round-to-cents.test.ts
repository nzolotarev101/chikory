import { describe, expect, it } from "vitest";

import { roundToCents } from "../../src/util/round-to-cents.js";

describe("roundToCents", () => {
  it("rounds to two decimal places", () => {
    expect(roundToCents(12.345)).toBe(12.35);
    expect(roundToCents(12.344)).toBe(12.34);
    expect(roundToCents(12)).toBe(12);
  });

  it("handles common floating point representation imprecision", () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(2.675)).toBe(2.68);
  });
});
