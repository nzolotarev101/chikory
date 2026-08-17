/**
 * Tests for standingConcerns accumulation and concern severity floor in workflow execution (WP-548).
 *
 * Verifies:
 * 1. Minor concerns are filtered at the floor and NEVER accumulate into standingConcerns.
 * 2. Blocking concerns pass the floor and accumulate into standingConcerns.
 * 3. Unannotated legacy concerns pass the floor (fail-safe default) and accumulate into standingConcerns.
 * 4. Ragged severity arrays treat unmapped indices as blocking and accumulate them.
 * 5. accumulateStandingConcerns mutates the array in-place and returns it.
 * 6. JudgeFormSchema parses valid forms with/without concernSeverities and rejects unknown keys.
 */
import { describe, expect, it } from "vitest";

import { JudgeFormSchema } from "../../src/schemas.js";
import type { JudgeForm } from "../../src/types.js";
import { accumulateStandingConcerns } from "../../src/workflow/standing-concerns.js";

function makeForm(overrides: Partial<JudgeForm>): JudgeForm {
  return {
    criterionResults: [{ id: "AC-1", pass: true, justification: "pass" }],
    rubricResults: [{ id: "tests_pass", pass: true, justification: "pass" }],
    concerns: [],
    ...overrides,
  };
}

describe("standingConcerns accumulation (WP-548 / F-219)", () => {
  it("minor concerns do NOT accumulate into standingConcerns", () => {
    const f1 = makeForm({
      concerns: ["stray text in report (minor formatting nit)"],
      concernSeverities: ["minor"],
    });
    const f2 = makeForm({
      concerns: ["variable naming typo in comment"],
      concernSeverities: ["minor"],
    });

    const standing: string[] = [];
    accumulateStandingConcerns(standing, f1);
    accumulateStandingConcerns(standing, f2);
    expect(standing).toEqual([]);
  });

  it("blocking concerns DO accumulate into standingConcerns", () => {
    const blockingConcern = "critical missing assertion in test suite";
    const f = makeForm({
      concerns: [blockingConcern],
      concernSeverities: ["blocking"],
    });

    const standing: string[] = [];
    accumulateStandingConcerns(standing, f);
    expect(standing).toEqual([blockingConcern]);
  });

  it("mixed passes: only blocking concerns survive into standingConcerns", () => {
    const f1 = makeForm({
      concerns: ["cosmetic typo", "real defect: unhandled error"],
      concernSeverities: ["minor", "blocking"],
    });
    const f2 = makeForm({
      concerns: ["another minor nit"],
      concernSeverities: ["minor"],
    });
    const f3 = makeForm({
      concerns: ["second real defect: resource leak"],
      concernSeverities: ["blocking"],
    });

    const standing: string[] = [];
    accumulateStandingConcerns(standing, f1);
    accumulateStandingConcerns(standing, f2);
    accumulateStandingConcerns(standing, f3);
    expect(standing).toEqual([
      "real defect: unhandled error",
      "second real defect: resource leak",
    ]);
  });

  it("unannotated legacy concerns default to blocking and accumulate (fail-safe)", () => {
    const legacyConcern = "legacy concern with no severity metadata";
    const f = makeForm({
      concerns: [legacyConcern],
    });

    const standing: string[] = [];
    accumulateStandingConcerns(standing, f);
    expect(standing).toEqual([legacyConcern]);
  });

  it("ragged severity array accumulates unmapped concerns as blocking", () => {
    const f = makeForm({
      concerns: ["minor concern", "unmapped concern 1", "unmapped concern 2"],
      concernSeverities: ["minor"],
    });

    const standing: string[] = [];
    accumulateStandingConcerns(standing, f);
    expect(standing).toEqual(["unmapped concern 1", "unmapped concern 2"]);
  });

  it("deduplicates identical blocking concerns across passes", () => {
    const defect = "recurring defect across passes";
    const f1 = makeForm({ concerns: [defect], concernSeverities: ["blocking"] });
    const f2 = makeForm({ concerns: [defect], concernSeverities: ["blocking"] });

    const standing: string[] = [];
    accumulateStandingConcerns(standing, f1);
    accumulateStandingConcerns(standing, f2);
    expect(standing).toEqual([defect]);
  });

  it("returns the mutated standingConcerns array reference for chaining", () => {
    const standing: string[] = [];
    const f = makeForm({ concerns: ["defect"], concernSeverities: ["blocking"] });
    const result = accumulateStandingConcerns(standing, f);
    expect(result).toBe(standing);
    expect(result).toEqual(["defect"]);
  });
});

describe("JudgeFormSchema runtime mirror (WP-548)", () => {
  it("accepts valid concernSeverities with minor and blocking", () => {
    const parsed = JudgeFormSchema.safeParse({
      criterionResults: [{ id: "AC-1", pass: true, justification: "pass" }],
      rubricResults: [{ id: "tests_pass", pass: true, justification: "pass" }],
      concerns: ["cosmetic", "defect"],
      concernSeverities: ["minor", "blocking"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts forms without concernSeverities (optional field)", () => {
    const parsed = JudgeFormSchema.safeParse({
      criterionResults: [{ id: "AC-1", pass: true, justification: "pass" }],
      rubricResults: [{ id: "tests_pass", pass: true, justification: "pass" }],
      concerns: ["legacy concern"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid severity values", () => {
    const parsed = JudgeFormSchema.safeParse({
      criterionResults: [{ id: "AC-1", pass: true, justification: "pass" }],
      rubricResults: [{ id: "tests_pass", pass: true, justification: "pass" }],
      concerns: ["concern"],
      concernSeverities: ["critical"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unexpected extra keys (strict schema)", () => {
    const parsed = JudgeFormSchema.safeParse({
      criterionResults: [{ id: "AC-1", pass: true, justification: "pass" }],
      rubricResults: [{ id: "tests_pass", pass: true, justification: "pass" }],
      concerns: ["concern"],
      concernSeverities: ["minor"],
      unknownExtraKey: true,
    });
    expect(parsed.success).toBe(false);
  });
});
