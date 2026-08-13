import { describe, expect, it } from "vitest";
import {
  COMPLETION_REVIEW_RUBRIC,
  computeVerdict,
  DETERMINISTIC_RUBRIC_IDS,
  parseTaskSpec,
  RUBRIC_PRE_EXISTING_SUITE_GREEN,
  RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM,
  scanDiffForLayeringViolations,
  STANDING_RUBRIC,
} from "../../src/index.js";
import { applyCheckOverrides } from "../../src/judge/index.js";
import type { JudgeForm } from "../../src/types.js";

describe("AC-1: Deterministic rubric classification & non-destructive oracle", () => {
  it("DETERMINISTIC_RUBRIC_IDS is on the public surface and classifies standing and completion-review items correctly", () => {
    expect(DETERMINISTIC_RUBRIC_IDS).toBeDefined();
    expect(DETERMINISTIC_RUBRIC_IDS.has("no_architecture_violations")).toBe(true);
    expect(DETERMINISTIC_RUBRIC_IDS.has("no_secrets_introduced")).toBe(true);
    expect(DETERMINISTIC_RUBRIC_IDS.has(RUBRIC_PRE_EXISTING_SUITE_GREEN)).toBe(true);

    // Standing items not in DETERMINISTIC_RUBRIC_IDS
    expect(DETERMINISTIC_RUBRIC_IDS.has("tests_pass")).toBe(false);
    expect(DETERMINISTIC_RUBRIC_IDS.has("no_unrelated_deletions")).toBe(false);
    expect(DETERMINISTIC_RUBRIC_IDS.has("scope_matches_instruction")).toBe(false);
    expect(DETERMINISTIC_RUBRIC_IDS.has("design_serves_overall_goal")).toBe(false);

    // Completion-review items not in DETERMINISTIC_RUBRIC_IDS
    expect(DETERMINISTIC_RUBRIC_IDS.has("cumulative_design_coherent")).toBe(false);

    // Verify all 6 standing items classification
    const standingMap = STANDING_RUBRIC.map((item) => ({
      id: item.id,
      deterministic: DETERMINISTIC_RUBRIC_IDS.has(item.id),
    }));
    expect(standingMap).toEqual([
      { id: "tests_pass", deterministic: false },
      { id: "no_unrelated_deletions", deterministic: false },
      { id: "no_secrets_introduced", deterministic: true },
      { id: "no_architecture_violations", deterministic: true },
      { id: "scope_matches_instruction", deterministic: false },
      { id: "design_serves_overall_goal", deterministic: false },
    ]);

    // Verify base completion-review items classification
    const completionMap = COMPLETION_REVIEW_RUBRIC.map((item) => ({
      id: item.id,
      deterministic: DETERMINISTIC_RUBRIC_IDS.has(item.id),
    }));
    expect(completionMap).toEqual([
      { id: "no_architecture_violations", deterministic: true },
      { id: "design_serves_overall_goal", deterministic: false },
      { id: "cumulative_design_coherent", deterministic: false },
    ]);

    // Verify RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM properties
    expect(RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM.id).toBe("pre_existing_suite_still_green");
    expect(RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM.destructive).toBe(false);
  });

  it("applyCheckOverrides returns an error when pre_existing_suite_still_green is in rubric without evidence (trap C)", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [{ id: RUBRIC_PRE_EXISTING_SUITE_GREEN, pass: true, justification: "model claim" }],
      concerns: [],
    };
    const overridden = applyCheckOverrides(
      form,
      [],
      [RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM],
      [],
      [],
      [],
      undefined, // no evidence
    );
    expect("error" in overridden).toBe(true);
    if ("error" in overridden) {
      expect(overridden.error).toContain("pre_existing_suite_still_green");
    }
  });

  it("applyCheckOverrides settles pre_existing_suite_still_green RED with output excerpt, GREEN, and cap-killed", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [{ id: RUBRIC_PRE_EXISTING_SUITE_GREEN, pass: true, justification: "model claim" }],
      concerns: [],
    };

    // RED with output
    const redResult = applyCheckOverrides(
      form,
      [],
      [RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM],
      [],
      [],
      [],
      {
        criterionId: "pre_existing_suite_still_green",
        command: "pnpm test",
        exitCode: 1,
        output: "FAIL src/foo.test.ts > broken feature\n1 test failed",
        durationMs: 100,
        infraFailed: false,
      },
    );
    expect("form" in redResult).toBe(true);
    if ("form" in redResult) {
      const item = redResult.form.rubricResults[0]!;
      expect(item.pass).toBe(false);
      expect(item.justification).toContain("exited 1");
      expect(item.justification).toContain("FAIL src/foo.test.ts > broken feature");
    }

    // GREEN
    const greenResult = applyCheckOverrides(
      form,
      [],
      [RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM],
      [],
      [],
      [],
      {
        criterionId: "pre_existing_suite_still_green",
        command: "pnpm test",
        exitCode: 0,
        output: "all passed",
        durationMs: 100,
        infraFailed: false,
      },
    );
    expect("form" in greenResult).toBe(true);
    if ("form" in greenResult) {
      expect(greenResult.form.rubricResults[0]!.pass).toBe(true);
    }

    // Cap-killed
    const killedResult = applyCheckOverrides(
      form,
      [],
      [RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM],
      [],
      [],
      [],
      {
        criterionId: "pre_existing_suite_still_green",
        command: "pnpm test",
        exitCode: -1,
        output: "",
        durationMs: 120000,
        infraFailed: true,
      },
    );
    expect("form" in killedResult).toBe(true);
    if ("form" in killedResult) {
      const item = killedResult.form.rubricResults[0]!;
      expect(item.pass).toBe(false);
      expect(item.infraFailed).toBe(true);
      expect(item.justification).toContain("killed at the per-check cap");
    }
  });

  it("pre_existing_suite_still_green is destructive: false and computeVerdict returns a NON-ROLLBACK verdict naming it", () => {
    expect(RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM.destructive).toBe(false);

    const formWithSuiteFail: JudgeForm = {
      criterionResults: [{ id: "AC-1", pass: true, justification: "done" }],
      rubricResults: [
        ...STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
        { id: RUBRIC_PRE_EXISTING_SUITE_GREEN, pass: false, justification: "regression suite exited 1" },
      ],
      concerns: [],
    };

    const verdict = computeVerdict(formWithSuiteFail, {}, [...STANDING_RUBRIC, RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM]);
    expect(verdict.kind).not.toBe("ROLLBACK");
    expect(verdict.kind).toBe("PROCEED");
    expect(verdict.rationale).toContain("pre_existing_suite_still_green");
  });

  it("no_architecture_violations is destructive: false and computeVerdict returns a NON-ROLLBACK verdict naming it", () => {
    const archItem = STANDING_RUBRIC.find((r) => r.id === "no_architecture_violations");
    expect(archItem).toBeDefined();
    expect(archItem!.destructive).toBe(false);

    const formWithArchFail: JudgeForm = {
      criterionResults: [{ id: "AC-1", pass: true, justification: "done" }],
      rubricResults: STANDING_RUBRIC.map((r) => ({
        id: r.id,
        pass: r.id !== "no_architecture_violations",
        justification: r.id === "no_architecture_violations" ? "layer violation" : "ok",
      })),
      concerns: [],
    };

    const verdict = computeVerdict(formWithArchFail, {});
    expect(verdict.kind).not.toBe("ROLLBACK");
    expect(verdict.kind).toBe("PROCEED");
    expect(verdict.rationale).toContain("no_architecture_violations");
  });

  it("spec-authored judge.rubric_extra item is non-destructive AND outside the deterministic set", () => {
    const yaml = `
name: extra-rubric-test
goal: test extra rubric
repos:
  - url: https://example.com/repo.git
    writable: true
acceptance_criteria:
  - id: AC-1
    description: criterion 1
budget_usd: 5
executor:
  adapter: codex
  family: openai
judge:
  family: anthropic
  rubric_extra:
    - id: custom_extra_rule
      description: custom check
`;
    const spec = parseTaskSpec(yaml, {
      env: { OPENAI_API_KEY: "test-key", ANTHROPIC_API_KEY: "test-key" },
    });
    expect(spec.judge.rubricExtra).toBeDefined();
    expect(spec.judge.rubricExtra).toHaveLength(1);
    const extraItem = spec.judge.rubricExtra![0];
    expect(extraItem.id).toBe("custom_extra_rule");
    expect(extraItem.destructive).toBe(false);
    expect(DETERMINISTIC_RUBRIC_IDS.has(extraItem.id)).toBe(false);
  });

  it("scanDiffForLayeringViolations reports core→judge for a real violating diff and nothing for a clean diff", () => {
    const violatingDiff = `
diff --git a/src/types.ts b/src/types.ts
index 123456..789012 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -1,3 +1,4 @@
+// comment
+import type { Harness } from "./judge/harness.js";
 export interface Test {};
`;
    const cleanDiff = `
diff --git a/src/types.ts b/src/types.ts
index 123456..789012 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -1,3 +1,4 @@
 export interface Test {};
`;

    const violations = scanDiffForLayeringViolations(violatingDiff);
    expect(violations).toEqual(["core→judge"]);

    const cleanViolations = scanDiffForLayeringViolations(cleanDiff);
    expect(cleanViolations).toEqual([]);
  });

  it("applyCheckOverrides scan wins over model opinion both ways for machine-settled items", () => {
    const formWithModelLies: JudgeForm = {
      criterionResults: [{ id: "AC-1", pass: true, justification: "done" }],
      rubricResults: STANDING_RUBRIC.map((r) => ({
        id: r.id,
        // Model claims no_architecture_violations is true, but scan found core→judge
        // Model claims no_secrets_introduced is false, but scan found no secrets
        pass: r.id === "no_architecture_violations" ? true : r.id === "no_secrets_introduced" ? false : true,
        justification: "model opinion",
      })),
      concerns: [],
    };

    const overridden = applyCheckOverrides(
      formWithModelLies,
      [{ id: "AC-1", description: "ac1" }],
      STANDING_RUBRIC,
      [],
      ["core→judge"], // architecture scan found violation
      [], // secret scan found NO violation
    );

    if ("error" in overridden) throw new Error(overridden.error);

    const archResult = overridden.form.rubricResults.find((r) => r.id === "no_architecture_violations");
    expect(archResult?.pass).toBe(false);
    expect(archResult?.justification).toContain("core→judge");

    const secretResult = overridden.form.rubricResults.find((r) => r.id === "no_secrets_introduced");
    expect(secretResult?.pass).toBe(true);
    expect(secretResult?.justification).toContain("no secrets introduced");
  });

  it("pin constants: COMPLETION_BRIEF_MAX_CHARS is 2000 and DEFAULT_CHECK_TIMEOUT_MS is 120000", async () => {
    const { DEFAULT_CHECK_TIMEOUT_MS } = await import("../../src/judge/index.js");
    const { buildCompletionReviewBrief } = await import("../../src/workflow/completion-review.js");
    expect(DEFAULT_CHECK_TIMEOUT_MS).toBe(120000);
    // Pin 2000 char cap via boundary test
    const longBriefForm: JudgeForm = {
      criterionResults: [],
      rubricResults: [{ id: "cumulative_design_coherent", pass: false, justification: "x".repeat(3000) }],
      concerns: [],
    };
    expect(buildCompletionReviewBrief(longBriefForm).length).toBe(2000);
  });

  it("drives repair brief at 0, 1, 2, and 3 co-occurring design findings against a 4 KB suite output", async () => {
    const { buildCompletionReviewBrief } = await import("../../src/workflow/completion-review.js");
    const suiteOutputHeader = "START OF 4KB OUTPUT\n" + "x".repeat(3000) + "\n";
    const suiteOutputTail = "FAIL test/a.test.ts > TEST_FAIL_MARKER_TAIL\n1 test failed, 49 passed.";
    const full4KbOutput = suiteOutputHeader + suiteOutputTail;

    const possibleDesignFails = [
      { id: "cumulative_design_coherent", pass: false, justification: "design finding 1: duplicated logic" },
      { id: "design_serves_overall_goal", pass: false, justification: "design finding 2: abstraction mismatch" },
      { id: "no_architecture_violations", pass: false, justification: "design finding 3: import cycle" },
    ];

    for (let count = 0; count <= 3; count++) {
      const designFails = possibleDesignFails.slice(0, count);
      const form: JudgeForm = {
        criterionResults: [],
        rubricResults: [
          ...designFails,
          {
            id: RUBRIC_PRE_EXISTING_SUITE_GREEN,
            pass: false,
            justification: `regression suite command \`pnpm test\` exited 1:\n${full4KbOutput}`,
          },
        ],
        concerns: [],
      };

      const brief = buildCompletionReviewBrief(form);

      // Must stay within 2000 char cap
      expect(brief.length).toBeLessThanOrEqual(2000);

      // Must name failing item
      expect(brief).toContain(RUBRIC_PRE_EXISTING_SUITE_GREEN);

      // Must carry TAIL of output where test names live
      expect(brief).toContain("TEST_FAIL_MARKER_TAIL");

      // Must list EVERY co-occurring design finding
      for (const df of designFails) {
        expect(brief).toContain(df.id);
        expect(brief).toContain(df.justification);
      }

      // Must keep closing instruction at end
      expect(brief).toContain("a fix must resolve these findings while keeping every acceptance criterion passing.");
      expect(brief.trimEnd().endsWith("a fix must resolve these findings while keeping every acceptance criterion passing.")).toBe(true);

      // Must omit design-only instruction
      expect(brief).not.toContain("do NOT change behavior, only design");
    }
  });

  // F-326 (dogfood-137 review). The test above sweeps the COUNT dimension at a fixed
  // ~40-char justification; the defect lived in the LENGTH dimension. When the fixed
  // part of the brief lands within 4 chars of the cap the excerpt budget goes to zero,
  // and `String.prototype.slice(-0)` is `slice(0)` — the WHOLE string. Measured on the
  // delivery as landed: a 2000-char brief became 46,095 chars.
  it("holds the 2000-char cap at EVERY design-justification length, not just short ones", async () => {
    const { buildCompletionReviewBrief } = await import("../../src/workflow/completion-review.js");
    const tail = "FAIL test/a.test.ts > TEST_FAIL_MARKER_TAIL\n Test Files  2 failed (177)";
    const output = `${"noise line ".repeat(4000)}${tail}`;
    expect(output.length).toBeGreaterThan(40_000);

    let sawZeroBudget = false;
    for (let justificationLen = 1200; justificationLen <= 2200; justificationLen++) {
      const form: JudgeForm = {
        criterionResults: [],
        rubricResults: [
          { id: "design_serves_overall_goal", pass: false, justification: "d".repeat(justificationLen) },
          {
            id: RUBRIC_PRE_EXISTING_SUITE_GREEN,
            pass: false,
            justification: `regression suite command \`pnpm test\` exited 1:\n${output}`,
          },
        ],
        concerns: [],
      };
      const brief = buildCompletionReviewBrief(form);
      expect(
        brief.length,
        `brief overflowed its cap at justification length ${justificationLen}`,
      ).toBeLessThanOrEqual(2000);
      // The other failing finding is never squeezed out to make room (trap E).
      expect(brief).toContain("design_serves_overall_goal");
      if (!brief.includes("TEST_FAIL_MARKER_TAIL")) sawZeroBudget = true;
    }
    // The zero-budget window must actually be reached, or the sweep proves nothing.
    expect(sawZeroBudget).toBe(true);
  });

  it("asserts infra/red distinction on settled row and seal decision", () => {
    // Settled row: infraFailed: true carries through check override
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [{ id: RUBRIC_PRE_EXISTING_SUITE_GREEN, pass: true, justification: "model claim" }],
      concerns: [],
    };

    const infraRow = applyCheckOverrides(
      form,
      [],
      [RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM],
      [],
      [],
      [],
      {
        criterionId: "pre_existing_suite_still_green",
        command: "pnpm test",
        exitCode: -1,
        output: "",
        durationMs: 120000,
        infraFailed: true,
      },
    );
    expect("form" in infraRow).toBe(true);
    if ("form" in infraRow) {
      expect(infraRow.form.rubricResults[0]!.infraFailed).toBe(true);
      expect(infraRow.form.rubricResults[0]!.pass).toBe(false);
      expect(infraRow.form.rubricResults[0]!.justification).toContain("DID NOT COMPLETE");
    }

    const codeRedRow = applyCheckOverrides(
      form,
      [],
      [RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM],
      [],
      [],
      [],
      {
        criterionId: "pre_existing_suite_still_green",
        command: "pnpm test",
        exitCode: 1,
        output: "FAIL test",
        durationMs: 500,
        infraFailed: false,
      },
    );
    expect("form" in codeRedRow).toBe(true);
    if ("form" in codeRedRow) {
      expect(codeRedRow.form.rubricResults[0]!.infraFailed).toBeUndefined();
      expect(codeRedRow.form.rubricResults[0]!.pass).toBe(false);
      expect(codeRedRow.form.rubricResults[0]!.justification).toContain("exited 1");
    }
  });
});
