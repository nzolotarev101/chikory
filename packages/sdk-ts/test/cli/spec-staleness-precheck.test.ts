import { describe, expect, it } from "vitest";

import {
  evaluateSpecStalenessPrecheck,
  extractTargetWpId,
  type SpecStalenessPrecheckResult,
} from "../../src/cli/spec-staleness-precheck.js";

describe("extractTargetWpId", () => {
  it("extracts the first WP id from the goal text", () => {
    const goalText = "Implement WP-258 without touching WP-256.";

    expect(extractTargetWpId(goalText)).toBe("WP-258");
  });

  it("WP-260: reads the goal's target, so a preamble that name-drops other WPs first is irrelevant", () => {
    // The caller now passes spec.goal (not raw YAML), so preamble WP mentions
    // like a ladder rung or prior run cannot hijack the target.
    const goalText =
      "Give the operator `chikory inject` — WP-212 / requirement OB-2. (rung 1 of WP-265.)";

    expect(extractTargetWpId(goalText)).toBe("WP-212");
  });

  it("returns null when the goal has no WP id", () => {
    expect(extractTargetWpId("Implement the requested pure module")).toBeNull();
  });
});

describe("evaluateSpecStalenessPrecheck", () => {
  it("🟢→stale/warning", () => {
    const specText = `
name: dogfood-068-wp258-spec-staleness-precheck
goal: Implement WP-258.
`;
    const planText = `
| WP | Title | Status |
| --- | --- | --- |
| WP-258 | Wire spec staleness gate | 🟢 |
`;

    const result: SpecStalenessPrecheckResult = evaluateSpecStalenessPrecheck(specText, planText);

    expect(result.targetWpId).toBe("WP-258");
    expect(result.warning).toBe(
      "[chikory] WARNING: stale spec: target WP-258 already done (🟢) — spec is stale",
    );
    expect(result.warning).toContain("stale");
  });

  it("🟡→fresh/null", () => {
    const specText = `
name: dogfood-068-wp258-spec-staleness-precheck
goal: Implement WP-258.
`;
    const planText = `
| WP | Title | Status |
| --- | --- | --- |
| WP-258 | Wire spec staleness gate | 🟡 |
`;

    const result = evaluateSpecStalenessPrecheck(specText, planText);

    expect(result.targetWpId).toBe("WP-258");
    expect(result.warning).toBeNull();
  });

  it("no-id→null", () => {
    const specText = `
name: pure-module-without-target
goal: Implement the requested pure module.
`;
    const planText = `
| WP | Title | Status |
| --- | --- | --- |
| WP-258 | Wire spec staleness gate | 🟢 |
`;

    const result = evaluateSpecStalenessPrecheck(specText, planText);

    expect(result.targetWpId).toBeNull();
    expect(result.warning).toBeNull();
  });
});
