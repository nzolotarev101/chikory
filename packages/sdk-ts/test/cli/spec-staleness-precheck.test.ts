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

describe("cmdRun staleness gate — refuse by default", () => {
  // run-0a285f5b lesson: the warn-only wire let a closed spec re-run for
  // $3.02. The gate now refuses at zero LLM cost unless a NON-EMPTY
  // CHIKORY_ALLOW_STALE_SPEC overrides (WP-261/267 launcher-guard family).
  const STALE_PLAN = `
| WP | Title | Status |
| --- | --- | --- |
| WP-258 | Wire spec staleness gate | 🟢 |
`;
  const SPEC_YAML = `
name: stale-wire-test
goal: Re-run WP-258 follow-up work
repos:
  - url: file:///tmp/nowhere
    writable: true
acceptance_criteria:
  - id: AC-1
    description: n/a
budget_usd: 1
executor:
  adapter: claude-code
  family: anthropic
judge:
  family: gemini
`;

  it("exits 1 before any worker is hosted, naming the override", async () => {
    process.env["ANTHROPIC_API_KEY"] ??= "test-key";
    process.env["GEMINI_API_KEY"] ??= "test-key";
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { cmdRun } = await import("../../src/cli/commands.js");

    const dir = mkdtempSync(join(tmpdir(), "chikory-stale-"));
    try {
      const specPath = join(dir, "spec.yaml");
      writeFileSync(specPath, SPEC_YAML);
      const errLines: string[] = [];
      const code = await cmdRun(
        { file: specPath, watch: false, json: false, dataDir: dir },
        {
          readPlanText: async () => STALE_PLAN,
          env: {},
          err: (line) => errLines.push(line),
          out: () => {},
        },
      );
      expect(code).toBe(1);
      const stderr = errLines.join("\n");
      expect(stderr).toContain("stale spec: target WP-258 already done");
      expect(stderr).toContain("CHIKORY_ALLOW_STALE_SPEC=1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
