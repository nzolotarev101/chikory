import { describe, expect, it } from "vitest";

import { formatCostShare } from "../../src/chain/cost-report.js";

describe("formatCostShare", () => {
  it.each([
    [0.01, 1.5, "$0.01 (0.7%)"],
    [1, 4, "$1.00 (25.0%)"],
    [2.5, 2.5, "$2.50 (100.0%)"],
  ])("formats %s of %s", (part, total, expected) => {
    expect(formatCostShare(part, total)).toBe(expected);
  });
});
