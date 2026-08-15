/**
 * Pure run-completion review decisions — the cumulative-diff design pass at
 * the SUCCESS seal moment. Deterministic unit tests, `remediation.test.ts`
 * sibling: the decision needs no Temporal and no LLM.
 */
import { describe, expect, it } from "vitest";

import {
  buildCompletionReviewBrief,
  decideCompletionReview,
  MAX_COMPLETION_REVIEWS,
  mergeDesignFindings,
  type RubricResult,
} from "../../src/workflow/completion-review.js";
import type { JudgeForm } from "../../src/types.js";

const BASE = "commit-base";
const LATER = "commit-later";

describe("decideCompletionReview — 2x2x3 input matrix", () => {
  // Dimension 1: { first-verdict seal (sealingDiffBase === baseCommit), later seal (sealingDiffBase !== baseCommit) }
  // Dimension 2: { rubric clean, rubric failing }
  // Dimension 3: { attempts 0, 1, MAX_COMPLETION_REVIEWS (2) }

  // ─── First-verdict seals (sealingDiffBase === baseCommit) ─────────────────
  it("first-verdict seal + clean rubric + attempts 0 => skip (trap A: zero extra passes for clean 1-step run)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("first-verdict seal");
  });

  it("first-verdict seal + clean rubric + attempts 1 => skip", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("first-verdict seal");
  });

  it("first-verdict seal + clean rubric + attempts 2 (exhausted) => skip", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  it("first-verdict seal + failing rubric + attempts 0 => review (the F-180 fix)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("first-verdict seal + failing rubric + attempts 1 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("first-verdict seal + failing rubric + attempts 2 (exhausted) => skip (bound wins over rubric failure)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  // ─── Later seals (sealingDiffBase !== baseCommit) ─────────────────────────
  it("later seal + clean rubric + attempts 0 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + clean rubric + attempts 1 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + clean rubric + attempts 2 (exhausted) => skip", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  it("later seal + failing rubric + attempts 0 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + failing rubric + attempts 1 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + failing rubric + attempts 2 (exhausted) => skip (bound wins over rubric failure)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  // ─── Rubric input spellings (F-194: exactly two, both wired) ──────────────
  it("derives the rubric outcome from a raw rubricResults array when no boolean is given", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        rubricResults: [{ pass: false }],
      }).action,
    ).toBe("review");

    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        rubricResults: [{ pass: true }],
      }).action,
    ).toBe("skip");
  });

  it("the explicit boolean wins over the array when both are supplied", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        sealingVerdictHasRubricFailures: false,
        rubricResults: [{ pass: false }],
      }).action,
    ).toBe("skip");
  });

  it("treats an absent rubric outcome as clean — the pre-F-180 default", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
      }).action,
    ).toBe("skip");
  });

  // ─── Escalation concerns (WP-619) ──────────────────────────────────────────
  it("first-verdict seal + clean rubric + hasEscalationConcerns => review", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        sealingVerdictHasRubricFailures: false,
        hasEscalationConcerns: true,
      }).action,
    ).toBe("review");
  });

  it("first-verdict seal + clean rubric + hasEscalationConcerns + exhausted => skip", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
        sealingVerdictHasRubricFailures: false,
        hasEscalationConcerns: true,
      }).action,
    ).toBe("skip");
  });
});

describe("mergeDesignFindings (trap C: the sealing objection must survive a clean review)", () => {
  const fail = (id: string): RubricResult => ({
    id,
    pass: false,
    justification: `${id} is unsound`,
  });
  const pass = (id: string): RubricResult => ({ id, pass: true, justification: "fine" });

  it("keeps the sealing objection when the completion review comes back clean", () => {
    const merged = mergeDesignFindings([fail("design_serves_overall_goal")], [pass("cumulative")]);
    expect(merged.map((r) => r.id)).toEqual(["design_serves_overall_goal"]);
  });

  it("unions both sides, sealing objections first", () => {
    const merged = mergeDesignFindings([fail("sealing")], [pass("ok"), fail("review")]);
    expect(merged.map((r) => r.id)).toEqual(["sealing", "review"]);
  });

  it("dedupes by rubric id — one finding, not two", () => {
    const merged = mergeDesignFindings([fail("same")], [fail("same")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.justification).toBe("same is unsound");
  });

  it("returns empty when nothing failed on either side", () => {
    expect(mergeDesignFindings([pass("a")], [pass("b")])).toEqual([]);
  });

  it("carries the merged findings into the brief verbatim", () => {
    const merged = mergeDesignFindings([fail("design_serves_overall_goal")], []);
    const brief = buildCompletionReviewBrief({
      criterionResults: [],
      rubricResults: merged,
      concerns: [],
    } as unknown as JudgeForm);
    expect(brief).toContain("design_serves_overall_goal is unsound");
  });
});

describe("buildCompletionReviewBrief", () => {
  it("folds the failing rubric items into a bounded design-fix brief", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [
        { id: "no_architecture_violations", pass: true, justification: "clean" },
        {
          id: "cumulative_design_coherent",
          pass: false,
          justification: "step 2 duplicated the parser helper from step 1",
        },
      ],
      concerns: [],
    };

    const brief = buildCompletionReviewBrief(form);

    expect(brief).toContain("DESIGN REVIEW BRIEF");
    expect(brief).toContain("cumulative_design_coherent: step 2 duplicated the parser helper");
    expect(brief).not.toContain("no_architecture_violations");
    expect(brief).toContain("do NOT change behavior");
    expect(brief.length).toBeLessThanOrEqual(2000);
  });

  it("builds a REPAIR BRIEF directing a behavior fix when pre_existing_suite_still_green fails", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [
        {
          id: "pre_existing_suite_still_green",
          pass: false,
          justification: "regression suite command `pnpm test` exited 1:\nFAIL test/foo.test.ts > unique_marker_123",
        },
      ],
      concerns: [],
    };

    const brief = buildCompletionReviewBrief(form);

    expect(brief).toContain("REPAIR BRIEF");
    expect(brief).toContain("pre_existing_suite_still_green");
    expect(brief).toContain("unique_marker_123");
    expect(brief).not.toContain("do NOT change behavior, only design");
    expect(brief.length).toBeLessThanOrEqual(2000);
  });

  it("clamps an oversized brief", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [
        { id: "cumulative_design_coherent", pass: false, justification: "x".repeat(5000) },
      ],
      concerns: [],
    };

    expect(buildCompletionReviewBrief(form).length).toBeLessThanOrEqual(2000);
  });
});
