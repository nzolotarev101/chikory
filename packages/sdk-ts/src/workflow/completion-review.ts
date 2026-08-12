/**
 * Pure run-completion review decisions — the holistic architecture pass over
 * the CUMULATIVE diff at the moment a run would seal SUCCESS. Kept outside the
 * Temporal workflow body so the decision is deterministic and unit-testable
 * (the `decideRemediation`/`decideWorkChunk` sibling).
 *
 * Cost bound: at most `MAX_COMPLETION_REVIEWS` extra judge passes per run
 * (initial review + the re-review after the one bounded design-fix retry),
 * and zero passes when the sealing verdict already covered the cumulative
 * diff (a first-verdict seal).
 */
import type { JudgeForm } from "../types.js";

/** Initial review + one re-review after the bounded design-fix retry. */
export const MAX_COMPLETION_REVIEWS = 2;

/** A brief must ride inside step context without rotting it (CM-3 discipline). */
const COMPLETION_BRIEF_MAX_CHARS = 2000;

export interface CompletionReviewState {
  /** Diff base of the judge pass that just confirmed all criteria. */
  sealingDiffBase: string;
  /** The run's base commit (prepareRun). */
  baseCommit: string;
  /** Completion reviews already run since the last terminal seal. */
  reviewAttemptsUsed: number;
  /**
   * Whether the sealing verdict's design rubric had any failing items.
   * When true on a first-verdict seal, the run must take the bounded design-fix
   * review path instead of skipping (the F-180 fix).
   */
  sealingVerdictHasRubricFailures?: boolean;
  /**
   * The sealing verdict's rubric results, when the caller holds the array
   * rather than a precomputed boolean. Equivalent to
   * `sealingVerdictHasRubricFailures: rubricResults.some((r) => !r.pass)`,
   * which wins when both are given.
   */
  rubricResults?: ReadonlyArray<{ pass: boolean }>;
  /**
   * Whether the spec has a declared `regression_suite` command.
   * When true on a first-verdict seal, the completion review MUST run to execute
   * the command, since the command never runs on per-step passes.
   */
  hasRegressionSuite?: boolean;
}

export type CompletionReviewDecision =
  | { action: "review" }
  | { action: "skip"; reason: string };

/** One filled rubric row of a judge form. */
export type RubricResult = JudgeForm["rubricResults"][number];

function extractHasRubricFailures(state: CompletionReviewState): boolean {
  if (typeof state.sealingVerdictHasRubricFailures === "boolean") {
    return state.sealingVerdictHasRubricFailures;
  }
  if (Array.isArray(state.rubricResults)) {
    return state.rubricResults.some((r) => !r.pass);
  }
  return false;
}

export function decideCompletionReview(
  state: CompletionReviewState,
): CompletionReviewDecision {
  if (state.reviewAttemptsUsed >= MAX_COMPLETION_REVIEWS) {
    return { action: "skip", reason: "completion reviews exhausted" };
  }
  const isFirstVerdictSeal = state.sealingDiffBase === state.baseCommit;
  const failingRubric = extractHasRubricFailures(state);

  if (isFirstVerdictSeal && !failingRubric && !state.hasRegressionSuite) {
    return {
      action: "skip",
      reason: "sealing verdict already judged the cumulative diff (first-verdict seal)",
    };
  }
  return { action: "review" };
}

/**
 * Union the design objections the SEALING verdict raised with the ones the
 * completion review raised, deduped by rubric id, sealing-verdict-first.
 *
 * Without this the F-180 fix is only half wired: a first-verdict seal with a
 * failing rubric would fire the review, and then — if that second, independent
 * review came back clean — drop the original objection and seal, having paid an
 * extra judge pass to change nothing (the goal's trap C). Every objection
 * raised at seal time reaches the executor's brief.
 */
export function mergeDesignFindings(
  sealingRubric: ReadonlyArray<RubricResult>,
  reviewRubric: ReadonlyArray<RubricResult>,
): RubricResult[] {
  const merged: RubricResult[] = [];
  const seen = new Set<string>();
  for (const result of [...sealingRubric, ...reviewRubric]) {
    if (result.pass || seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
  }
  return merged;
}

/**
 * The design-fix brief: the completion review's failing rubric items, fed to
 * the executor as the next step's instruction — composed deterministically
 * from the form the judge already filled (the `buildRemediationBrief`
 * discipline: no extra LLM call, no paraphrase drift).
 */
export function buildCompletionReviewBrief(form: JudgeForm): string {
  const rubricFails = form.rubricResults.filter((r) => !r.pass);
  const lines: string[] = [
    "DESIGN REVIEW BRIEF — every acceptance criterion passes; a completion review",
    "of the run's CUMULATIVE changes found design findings. One bounded fix",
    "attempt is granted; do NOT change behavior, only design.",
  ];
  if (rubricFails.length > 0) {
    lines.push("design findings (judge evidence):");
    for (const fail of rubricFails) lines.push(`- ${fail.id}: ${fail.justification}`);
  }
  lines.push(
    "a fix must resolve these findings while keeping every acceptance criterion passing.",
  );
  const text = lines.join("\n");
  return text.length <= COMPLETION_BRIEF_MAX_CHARS
    ? text
    : `${text.slice(0, COMPLETION_BRIEF_MAX_CHARS - 1)}…`;
}
