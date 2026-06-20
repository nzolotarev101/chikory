import { describe, expect, it } from "vitest";

import { formatUsd } from "../../src/chain/cost.js";

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [1, "$1.00"],
    [1.5, "$1.50"],
    [12.345, "$12.35"],
  ])("formats %s as %s", (amount, expected) => {
    expect(formatUsd(amount)).toBe(expected);
  });
});
