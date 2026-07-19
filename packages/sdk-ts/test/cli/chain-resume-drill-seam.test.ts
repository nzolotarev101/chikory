import { describe, expect, it } from "vitest";

import { replanBudgetFromEnv } from "../../src/cli/chain.js";

describe("replanBudgetFromEnv (WP-532 chain resume-drill heal-budget seam)", () => {
  it("returns 0 so a seeded-failure chain seals FAILED (heal-by-default OFF)", () => {
    expect(replanBudgetFromEnv("0")).toBe(0);
  });

  it("passes through an explicit positive budget", () => {
    expect(replanBudgetFromEnv("2")).toBe(2);
  });

  it("no-ops when unset or empty (→ startChain's heal-by-default default of 1)", () => {
    expect(replanBudgetFromEnv(undefined)).toBeUndefined();
    expect(replanBudgetFromEnv("")).toBeUndefined();
  });

  it("no-ops for a non-integer or negative value", () => {
    expect(replanBudgetFromEnv("abc")).toBeUndefined();
    expect(replanBudgetFromEnv("1.5")).toBeUndefined();
    expect(replanBudgetFromEnv("-1")).toBeUndefined();
  });
});
