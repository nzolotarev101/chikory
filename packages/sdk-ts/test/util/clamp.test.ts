import { describe, expect, it } from "vitest";

import { clamp } from "../../src/util/clamp.js";

describe("clamp", () => {
  it("returns values inside the range unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("returns min for values below the floor", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it("returns max for values above the ceiling", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("includes both bounds", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("returns the single bound when min equals max", () => {
    expect(clamp(7, 7, 7)).toBe(7);
  });

  it("throws a RangeError when min is greater than max", () => {
    expect(() => clamp(1, 5, 2)).toThrow(RangeError);
  });
});
