import { describe, expect, it } from "vitest";

import {
  evaluateSpecStalenessPrecheck,
  extractTargetWpId,
  type SpecStalenessPrecheckResult,
} from "../../src/cli/spec-staleness-precheck.js";

describe("extractTargetWpId", () => {
  it("extracts the first WP id from a raw task spec", () => {
    const specText = `
name: dogfood-068-wp258-spec-staleness-precheck
goal: |
  Implement WP-258 without touching WP-256.
`;

    expect(extractTargetWpId(specText)).toBe("WP-258");
  });

  it("returns null when the raw task spec has no WP id", () => {
    expect(extractTargetWpId("goal: Implement the requested pure module")).toBeNull();
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
