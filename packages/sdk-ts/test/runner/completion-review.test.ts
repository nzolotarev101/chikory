/**
 * Pure run-completion review decisions — the cumulative-diff design pass at
 * the SUCCESS seal moment. Deterministic unit tests, `remediation.test.ts`
 * sibling: the decision needs no Temporal and no LLM.
 */
import { describe, expect, it } from "vitest";

import {
  areMateriallySameObjections,
  buildCompletionReviewBrief,
  type CompletionReviewState,
  decideCompletionReview,
  hasRepeatedObjection,
  MAX_COMPLETION_REVIEWS,
  MAX_PROGRESS_GRANTS,
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

  // ─── Standing findings ────────────────────────────────────────────────────
  it("first-verdict seal + clean rubric + hasStandingFindings => review", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        sealingVerdictHasRubricFailures: false,
        hasStandingFindings: true,
      }).action,
    ).toBe("review");
  });

  it("first-verdict seal + clean rubric + hasStandingFindings + exhausted => skip", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
        sealingVerdictHasRubricFailures: false,
        hasStandingFindings: true,
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

describe("areMateriallySameObjections", () => {
  it("returns true for identical id and justification", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "dup helper" },
        { id: "cumulative_design_coherent", justification: "dup helper" },
      ),
    ).toBe(true);
  });

  it("returns false for same id but different justification (dogfood-159)", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "dup helper in utils" },
        { id: "cumulative_design_coherent", justification: "unhandled error in db" },
      ),
    ).toBe(false);
  });

  it("returns false for different id with same justification", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "flawed abstraction" },
        { id: "design_serves_overall_goal", justification: "flawed abstraction" },
      ),
    ).toBe(false);
  });

  it("normalizes leading and trailing whitespace", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "  dup helper\n" },
        { id: "cumulative_design_coherent", justification: "dup helper" },
      ),
    ).toBe(true);
  });
});

describe("hasRepeatedObjection", () => {
  it("returns true when any current finding matches an attempted finding", () => {
    const current = [
      { id: "cumulative_design_coherent", justification: "dup helper" },
      { id: "design_serves_overall_goal", justification: "missing validation" },
    ];
    const attempted = [
      { id: "cumulative_design_coherent", justification: "dup helper" },
    ];
    expect(hasRepeatedObjection(current, attempted)).toBe(true);
  });

  it("returns false when all current findings are new", () => {
    const current = [
      { id: "cumulative_design_coherent", justification: "new objection B" },
    ];
    const attempted = [
      { id: "cumulative_design_coherent", justification: "old objection A" },
    ];
    expect(hasRepeatedObjection(current, attempted)).toBe(false);
  });

  it("returns false when attempted list is empty", () => {
    const current = [
      { id: "cumulative_design_coherent", justification: "objection" },
    ];
    expect(hasRepeatedObjection(current, [])).toBe(false);
  });
});

describe("decideCompletionReview — dynamic attempts for new findings & headroom (WP-640)", () => {
  const fail = (id: string, justification: string): RubricResult => ({
    id,
    pass: false,
    justification,
  });

  it("grants repair attempt for a NEW objection on the same rubric id (dogfood-159)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new objection 2")],
      attemptedFindings: [fail("cumulative_design_coherent", "old objection 1")],
      // A non-empty attempted history means a grant was issued; the state is
      // only coherent with the grant counted (F-413 — the bound is read on
      // every call, so the exemption has to be earned, not assumed).
      progressGrantsUsed: 1,
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("review");
  });

  it("skips and stops when the objection is materially the SAME as previously attempted", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "same objection 1")],
      attemptedFindings: [fail("cumulative_design_coherent", "same objection 1")],
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });

  it("skips when one finding is resolved but another previously attempted finding persists", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [
        fail("cumulative_design_coherent", "unresolved finding A"),
        fail("design_serves_overall_goal", "brand new finding C"),
      ],
      attemptedFindings: [
        fail("cumulative_design_coherent", "unresolved finding A"),
        fail("design_serves_overall_goal", "resolved finding B"),
      ],
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });

  it("skips when finding is new but step headroom is exhausted (stepIndex >= maxSteps)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new finding")],
      attemptedFindings: [fail("cumulative_design_coherent", "old finding")],
      hasStepHeadroom: false,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("step headroom exhausted");
    }
  });

  it("skips when finding is new but budget headroom is exhausted", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new finding")],
      attemptedFindings: [fail("cumulative_design_coherent", "old finding")],
      hasStepHeadroom: true,
      hasBudgetHeadroom: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("budget headroom exhausted");
    }
  });

  it("skips when remainingSteps is 0 even if hasStepHeadroom is not explicitly false", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new finding")],
      attemptedFindings: [fail("cumulative_design_coherent", "old finding")],
      remainingSteps: 0,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("step headroom exhausted");
    }
  });

  it("prevents oscillation when an earlier finding re-appears after an intervening finding", () => {
    // Attempted history holds both A and B. Current finding re-introduces A.
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 3,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "finding A")],
      attemptedFindings: [
        fail("cumulative_design_coherent", "finding A"),
        fail("design_serves_overall_goal", "finding B"),
      ],
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });
});


describe("decideCompletionReview — the bound survives a repair history (F-412/F-413)", () => {
  const fail = (id: string, justification: string): RubricResult => ({
    id,
    pass: false,
    justification,
  });

  // The two objections THIS defect was found on: run-de555224's completion
  // review #1 (journal idx 12) and #2 (idx 24), verbatim. Same rubric id, the
  // same complaint — that an always-defined `attemptedFindings` array bypasses
  // the cap — in different words. `areMateriallySameObjections` cannot see it.
  const REWORDED_1 = fail(
    "design_serves_overall_goal",
    "The integration passes `attemptedFindings` as an always-defined array, while the original cap is enforced only when `attempted === undefined`. Consequently the normal agent-loop path bypasses `MAX_COMPLETION_REVIEWS` even when the array is empty, explaining the reported third review hit and regressing the established bounded-review behavior.",
  );
  const REWORDED_2 = fail(
    "design_serves_overall_goal",
    "The diff makes cap enforcement conditional on attempted findings being absent or empty, while nonempty history bypasses the fixed review-attempt cap. It also treats an empty history at the cap as exhausted. These choices do not coherently preserve the existing bounded sealing contract and can prematurely stop stalled repairs or permit extra reviews.",
  );

  const withHeadroom = (extra: Partial<CompletionReviewState>): CompletionReviewState => ({
    sealingDiffBase: LATER,
    baseCommit: BASE,
    reviewAttemptsUsed: 0,
    sealingVerdictHasRubricFailures: true,
    hasStepHeadroom: true,
    hasBudgetHeadroom: true,
    ...extra,
  });

  it("F-412: a REWORDED repeat cannot buy more than MAX_PROGRESS_GRANTS extra passes", () => {
    // The comparator reads these two as different, so every pass looks like
    // progress. The ceiling is what stops the run — not the comparator.
    const atCeiling = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: MAX_COMPLETION_REVIEWS + MAX_PROGRESS_GRANTS,
        currentFindings: [REWORDED_2],
        attemptedFindings: [REWORDED_1],
        progressGrantsUsed: 99, // a judge that reworded on every single pass
      }),
    );
    expect(atCeiling.action).toBe("skip");
    expect(atCeiling.action === "skip" && atCeiling.reason).toBe("completion reviews exhausted");
  });

  it("F-413: the cap is consulted even once a repair history exists", () => {
    // The shape of the agent loop's FIRST call site: no currentFindings (the
    // review has not run yet), a non-empty attempted history from an earlier
    // grant. Before the fix this returned `review` at any attempt count.
    const decision = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: 99,
        hasRegressionSuite: true,
        hasEscalationConcerns: true,
        hasStandingFindings: true,
        attemptedFindings: [REWORDED_1],
        progressGrantsUsed: 1,
      }),
    );
    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" && decision.reason).toBe("completion reviews exhausted");
  });

  it("one NEW finding still buys exactly one extra pass past the base cap", () => {
    expect(
      decideCompletionReview(
        withHeadroom({
          reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
          currentFindings: [fail("cumulative_design_coherent", "a genuinely new objection")],
          attemptedFindings: [fail("design_serves_overall_goal", "the first objection")],
          progressGrantsUsed: 1,
        }),
      ).action,
    ).toBe("review");
    expect(
      decideCompletionReview(
        withHeadroom({
          reviewAttemptsUsed: MAX_COMPLETION_REVIEWS + 1,
          currentFindings: [fail("cumulative_design_coherent", "a genuinely new objection")],
          attemptedFindings: [fail("design_serves_overall_goal", "the first objection")],
          progressGrantsUsed: 1,
        }),
      ).action,
    ).toBe("skip");
  });

  it("F-414: lastAttemptedFindings is read even when attemptedFindings is an empty array", () => {
    const decision = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: 1,
        currentFindings: [REWORDED_1],
        attemptedFindings: [],
        lastAttemptedFindings: [REWORDED_1],
        progressGrantsUsed: 1,
      }),
    );
    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" && decision.reason).toBe(
      "completion review: repeated objection on a converged step",
    );
  });
});
