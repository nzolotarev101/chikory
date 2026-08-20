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
import { RUBRIC_PRE_EXISTING_SUITE_GREEN } from "../judge/rubric.js";
import type { JudgeForm } from "../types.js";

/** Initial review + one re-review after the bounded design-fix retry. */
export const MAX_COMPLETION_REVIEWS = 2;

/**
 * Ceiling on how many EXTRA review passes a run may earn by showing progress
 * (F-412, dogfood-160 review). `areMateriallySameObjections` is sound but
 * INCOMPLETE — it recognises a repeat only when the judge restates the objection
 * verbatim, and a real LLM judge does not. Measured on two real completion-review
 * pairs at this review (normalised content-word Jaccard, stopwords dropped):
 *
 *   run-de555224 review #1 vs #2 — the SAME complaint, reworded  → 0.109
 *   run-ec5c4bb8 review #1 vs #2 — two DIFFERENT complaints      → 0.077
 *
 * The two populations overlap, so no prose threshold separates them and the
 * comparator cannot be made complete cheaply (→ WP-643). Until it is, the
 * progress exemption must fail CLOSED: a judge that rewords the same objection
 * every pass earns at most this many extra attempts, never the run's whole
 * headroom.
 */
export const MAX_PROGRESS_GRANTS = 2;

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
  rubricResults?: ReadonlyArray<{ pass: boolean; id?: string; justification?: string }>;
  /**
   * Whether the spec has a declared `regression_suite` command.
   * When true on a first-verdict seal, the completion review MUST run to execute
   * the command, since the command never runs on per-step passes.
   */
  hasRegressionSuite?: boolean;
  /**
   * Whether the run has out-of-rubric escalation concerns that must be adjudicated (WP-619).
   * When true on a first-verdict seal, the completion review MUST run to adjudicate
   * the concerns, even if no regression suite was declared.
   */
  hasEscalationConcerns?: boolean;
  /**
   * Whether the run has standing findings from earlier passes or the sealing pass.
   */
  hasStandingFindings?: boolean;
  /**
   * The failing rubric items / objections from the current completion review (or sealing pass).
   */
  currentFindings?: ReadonlyArray<RubricResult>;
  /**
   * Objections that have already been given a repair attempt in this run.
   */
  attemptedFindings?: ReadonlyArray<RubricResult | { id: string; justification: string }>;
  /**
   * The objections given to the immediate last repair attempt.
   */
  lastAttemptedFindings?: ReadonlyArray<RubricResult | { id: string; justification: string }>;
  /**
   * Whether the run still has step headroom (stepIndex < maxSteps).
   */
  hasStepHeadroom?: boolean;
  /**
   * Whether the run has budget headroom (!budgetBreached).
   */
  hasBudgetHeadroom?: boolean;
  /**
   * Remaining steps before reaching maxSteps.
   */
  remainingSteps?: number;
  /**
   * Repair grants already earned by a NEW (non-repeated) objection. Each one
   * buys exactly one extra review pass, up to `MAX_PROGRESS_GRANTS`.
   */
  progressGrantsUsed?: number;
}

export type CompletionReviewDecision =
  | { action: "review" }
  | { action: "skip"; reason: string };

/** One filled rubric row of a judge form. */
export type RubricResult = JudgeForm["rubricResults"][number];

/**
 * Decides whether two objections are materially the same: same rubric id and
 * the same justification text once trimmed.
 *
 * SOUND BUT INCOMPLETE (F-412). A `true` here is always a genuine repeat; a
 * `false` is NOT evidence of progress, because a judge that restates the same
 * complaint in different words reads as new. See `MAX_PROGRESS_GRANTS` for the
 * measurement and for the bound that contains the incompleteness.
 */
export function areMateriallySameObjections(
  a: RubricResult | { id: string; justification: string },
  b: RubricResult | { id: string; justification: string },
): boolean {
  if (a.id !== b.id) return false;
  return a.justification.trim() === b.justification.trim();
}

/**
 * Returns true if any finding in `current` matches an objection that was already attempted.
 */
export function hasRepeatedObjection(
  current: ReadonlyArray<RubricResult | { id: string; justification: string }>,
  attempted: ReadonlyArray<RubricResult | { id: string; justification: string }>,
): boolean {
  return current.some((curr) =>
    attempted.some((att) => areMateriallySameObjections(curr, att)),
  );
}

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
  if (state.hasStepHeadroom === false || (typeof state.remainingSteps === "number" && state.remainingSteps <= 0)) {
    return { action: "skip", reason: "step headroom exhausted" };
  }
  if (state.hasBudgetHeadroom === false) {
    return { action: "skip", reason: "budget headroom exhausted" };
  }

  const currentFails: ReadonlyArray<RubricResult> = state.currentFindings ??
    (Array.isArray(state.rubricResults)
      ? (state.rubricResults.filter(
          (r): r is RubricResult =>
            !r.pass &&
            typeof (r as { id?: unknown }).id === "string" &&
            typeof (r as { justification?: unknown }).justification === "string",
        ) as ReadonlyArray<RubricResult>)
      : []);

  // F-414: the two histories are UNIONED, not selected between. `??` made
  // `lastAttemptedFindings` unreachable, because every agent-loop call site
  // passes an always-defined `attemptedFindings` array.
  const attempted: ReadonlyArray<RubricResult | { id: string; justification: string }> = [
    ...(state.attemptedFindings ?? []),
    ...(state.lastAttemptedFindings ?? []),
  ];

  if (
    currentFails.length > 0 &&
    attempted.length > 0 &&
    hasRepeatedObjection(currentFails, attempted)
  ) {
    return {
      action: "skip",
      reason: "completion review: repeated objection on a converged step",
    };
  }

  // F-413: the bound is UNCONDITIONAL. Gating it on an empty `attempted` list
  // meant the agent loop — which always passes a non-empty list once one repair
  // has been granted — never consulted it again, so the cap was live only until
  // the first grant. Progress raises the ceiling by one pass per grant and no
  // more, and `MAX_PROGRESS_GRANTS` caps the raise itself.
  const progressGrants = Math.min(
    Math.max(state.progressGrantsUsed ?? 0, 0),
    MAX_PROGRESS_GRANTS,
  );
  if (state.reviewAttemptsUsed >= MAX_COMPLETION_REVIEWS + progressGrants) {
    return { action: "skip", reason: "completion reviews exhausted" };
  }

  const isFirstVerdictSeal = state.sealingDiffBase === state.baseCommit;
  const failingRubric = extractHasRubricFailures(state);

  if (
    isFirstVerdictSeal &&
    !failingRubric &&
    !state.hasRegressionSuite &&
    !state.hasEscalationConcerns &&
    !state.hasStandingFindings
  ) {
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
 * The design-fix or suite-repair brief: the completion review's failing rubric items, fed to
 * the executor as the next step's instruction — composed deterministically
 * from the form the judge already filled (the `buildRemediationBrief`
 * discipline: no extra LLM call, no paraphrase drift).
 */
export function buildCompletionReviewBrief(form: JudgeForm): string {
  const rubricFails = form.rubricResults.filter((r) => !r.pass);
  const hasSuiteFail = rubricFails.some((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN);

  if (!hasSuiteFail) {
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

  const headerLines = [
    "REPAIR BRIEF — every acceptance criterion passes; a completion review",
    "of the run's CUMULATIVE changes found regression test failures. One bounded repair",
    "attempt is granted; fix the broken behavior and restore the test suite to green.",
    "failing items (judge evidence):",
  ];
  const closingLine =
    "a fix must resolve these findings while keeping every acceptance criterion passing.";

  const otherFails = rubricFails.filter((r) => r.id !== RUBRIC_PRE_EXISTING_SUITE_GREEN);
  const otherFailLines = otherFails.map((fail) => `- ${fail.id}: ${fail.justification}`);

  const suiteFail = rubricFails.find((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN)!;
  let statusPrefix = suiteFail.justification;
  let outputLog = "";
  const colonIdx = suiteFail.justification.indexOf(":\n");
  if (colonIdx !== -1) {
    statusPrefix = suiteFail.justification.slice(0, colonIdx);
    outputLog = suiteFail.justification.slice(colonIdx + 2);
  }

  const suiteHeaderLine = `- pre_existing_suite_still_green: ${statusPrefix}`;

  const fixedLinesWithoutLog = [
    ...headerLines,
    ...otherFailLines,
    suiteHeaderLine,
    closingLine,
  ];
  const fixedLengthWithoutLog = fixedLinesWithoutLog.join("\n").length;

  // The brief with the suite's own output omitted entirely — the floor this
  // function falls back to whenever there is no room to carry an excerpt.
  const withoutLog = (): string => {
    const text = fixedLinesWithoutLog.join("\n");
    return text.length <= COMPLETION_BRIEF_MAX_CHARS
      ? text
      : `${text.slice(0, COMPLETION_BRIEF_MAX_CHARS - 1)}…`;
  };

  if (!outputLog || fixedLengthWithoutLog >= COMPLETION_BRIEF_MAX_CHARS) return withoutLog();

  const availableForLog = COMPLETION_BRIEF_MAX_CHARS - fixedLengthWithoutLog - 2;
  let logExcerpt = outputLog;
  if (outputLog.length > availableForLog) {
    // F-326: `String.prototype.slice(-0)` is `slice(0)` — the WHOLE string, not the
    // empty one. When the fixed part leaves no room for even the `…\n` marker the
    // excerpt must be DROPPED; emitting it in full blew the 2000-char brief to
    // 46,095 chars on the dogfood-137 delivery.
    const sliceLen = availableForLog - 2;
    if (sliceLen <= 0) return withoutLog();
    logExcerpt = `…\n${outputLog.slice(-sliceLen)}`;
  }

  const finalLines = [
    ...headerLines,
    ...otherFailLines,
    `${suiteHeaderLine}:\n${logExcerpt}`,
    closingLine,
  ];

  return finalLines.join("\n");
}
