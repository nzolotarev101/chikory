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
} from "../../src/workflow/completion-review.js";
import type { JudgeForm } from "../../src/types.js";

const BASE = "commit-base";
const LATER = "commit-later";

describe("decideCompletionReview", () => {
  it("reviews at the first seal moment when earlier verdicts advanced the diff base", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
    });
    expect(decision).toEqual({ action: "review" });
  });

  it("skips a first-verdict seal — the sealing pass already judged the cumulative diff", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("first-verdict seal");
  });

  it("grants the post-fix re-review, then exhausts", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: LATER,
        baseCommit: BASE,
        reviewAttemptsUsed: 1,
      }).action,
    ).toBe("review");
    const exhausted = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
    });
    expect(exhausted.action).toBe("skip");
    if (exhausted.action === "skip") expect(exhausted.reason).toContain("exhausted");
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
