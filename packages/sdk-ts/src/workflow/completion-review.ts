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
