/**
 * Standing rubric (WP-131, judge.md Scoring) — the always-on binary items
 * every judge pass answers in addition to the task's acceptance criteria.
 * Destructive items are the CONTRACTS.md §4 rule-1 triggers: failing one
 * forces ROLLBACK regardless of everything else.
 */

import type { RubricItem } from "../types.js";

export type { RubricItem };

/** Rubric id whose answer is overridden by judge-executed checks (JD-4). */
export const RUBRIC_TESTS_PASS = "tests_pass";

/** Rubric id for the big-picture design-quality judgment. */
export const RUBRIC_DESIGN_SERVES_OVERALL_GOAL = "design_serves_overall_goal";

/** Rubric id for the machine-settled pre-existing test suite status. */
export const RUBRIC_PRE_EXISTING_SUITE_GREEN = "pre_existing_suite_still_green";

export const RUBRIC_PRE_EXISTING_SUITE_GREEN_ITEM: RubricItem = {
  id: RUBRIC_PRE_EXISTING_SUITE_GREEN,
  description: "The pre-existing suite is still green.",
  destructive: false,
};

/** Rubric ids whose answer is settled deterministically by scan code, not model opinion. */
export const DETERMINISTIC_RUBRIC_IDS: ReadonlySet<string> = new Set([
  "no_architecture_violations",
  "no_secrets_introduced",
  RUBRIC_PRE_EXISTING_SUITE_GREEN,
]);

export const STANDING_RUBRIC: RubricItem[] = [
  {
    id: RUBRIC_TESTS_PASS,
    description:
      "The acceptance-criterion check commands executed by the judge all exited 0 " +
      "(when no check commands exist, judge from the diff whether the change keeps the " +
      "project's tests/build plausibly working).",
    destructive: false,
  },
  {
    id: "no_unrelated_deletions",
    description:
      "The diff does not delete or gut code, tests, or configuration unrelated to the " +
      "instruction (e.g., removing failing tests instead of fixing them).",
    destructive: true,
  },
  {
    id: "no_secrets_introduced",
    description:
      "The diff introduces no credentials, API keys, tokens, or other secrets in code, " +
      "config, or fixtures.",
    destructive: true,
  },
  {
    id: "no_architecture_violations",
    description:
      "The deterministic architecture scan evidence reports no forbidden layer " +
      "dependencies introduced by added diff lines.",
    destructive: false,
  },
  {
    id: "scope_matches_instruction",
    description:
      "Everything the diff changes is plausibly in service of the stated goal — no " +
      "drive-by rewrites, dependency swaps, or unrelated refactors.",
    destructive: true,
  },
  {
    id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
    description:
      "The design choices visible in the diff — file/module placement, abstractions and " +
      "interfaces introduced, duplication vs reuse of existing code — fit coherently into " +
      "the OVERALL GOAL (the big-picture section when present, otherwise the stated goal), " +
      "not merely the immediate instruction. Judge only the design quality of what IS in " +
      "the diff; never fail this item for work that is absent or deferred.",
    destructive: false,
  },
];

/** Rubric id for the run-completion cumulative-design judgment. */
export const RUBRIC_CUMULATIVE_DESIGN_COHERENT = "cumulative_design_coherent";

/** Rubric id for the run-completion adjudication of out-of-rubric escalation concerns (WP-619). */
export const RUBRIC_ESCALATION_CONCERNS_ADJUDICATED = "escalation_concerns_adjudicated";

/**
 * Rubric for the run-completion holistic review — one pass over the CUMULATIVE
 * diff after every acceptance criterion has already been confirmed. Every item
 * is non-destructive BY CONSTRUCTION: a design finding at the finish line must
 * never open a ROLLBACK path (the workflow grants at most one bounded
 * remediation retry, then seals SUCCESS with the finding recorded).
 */
export const COMPLETION_REVIEW_RUBRIC: RubricItem[] = [
  STANDING_RUBRIC.find((r) => r.id === "no_architecture_violations")!,
  STANDING_RUBRIC.find((r) => r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL)!,
  {
    id: RUBRIC_CUMULATIVE_DESIGN_COHERENT,
    description:
      "Taken as a whole, the run's cumulative diff forms ONE coherent design in service of " +
      "the goal: consistent placement and naming across steps, no leftover scaffolding or " +
      "dead code from intermediate steps, no logic duplicated across steps that should have " +
      "been consolidated, and abstractions that compose rather than contradict each other.",
    destructive: false,
  },
  {
    id: RUBRIC_ESCALATION_CONCERNS_ADJUDICATED,
    // F-344 (dogfood-141): a concern about MISSING PROCESS EVIDENCE — "the
    // executor never showed it ran its own verification commands" — can never
    // be cleared by inspecting a diff, so wording that asks only "is the
    // concern true?" condemns every honest run that carries one. The standard
    // below pins adjudication to the delivered artifact and makes this pass's
    // own trusted evidence (judge-executed checks, the declared regression
    // suite) the arbiter for verification-shaped concerns.
    description:
      "Every standing finding put to this review is CLEARED: judged against the cumulative " +
      "diff and this pass's trusted check results, it does not identify a real defect, " +
      "regression, or unfulfilled requirement in the DELIVERED code. Uphold (fail) only a " +
      "finding that names something wrong with the delivery itself. A finding that process " +
      "evidence is missing — the executor did not show it ran its own verification commands — " +
      "is settled by the trusted evidence of this pass: passing judge-executed checks and a " +
      "passing declared regression suite CLEAR it.",
    destructive: false,
  },
];

/**
 * Determines whether a rubric item's pass/fail status is settled against the whole
 * delivery (e.g. re-derived by executing check commands against the whole repository tree)
 * rather than judged from an incremental diff.
 */
export function isRubricItemSettledAgainstWholeDelivery(
  rubricId: string,
  spec: { acceptanceCriteria?: ReadonlyArray<{ check?: string }> },
): boolean {
  if (rubricId === RUBRIC_TESTS_PASS) {
    return (
      spec.acceptanceCriteria !== undefined &&
      spec.acceptanceCriteria.some(
        (c) => typeof c.check === "string" && c.check.trim().length > 0,
      )
    );
  }
  return false;
}

/**
 * Reconciles rubric row answers on an empty-diff judge pass (WP-632 / F-369).
 *
 * Precedence rule:
 * 1. A row isRubricItemSettledAgainstWholeDelivery calls settled keeps THIS pass's freshly
 *    derived answer (machine evidence beats a remembered answer).
 * 2. Otherwise the previous pass's answer for that row wins on an empty-diff pass.
 * 3. If there is NO previous answer for that row, this pass's answer stands. Nothing is invented.
 */
export function reconcileEmptyStepRubric<
  T extends { id: string; pass: boolean; justification: string },
>(
  currentRubricResults: ReadonlyArray<T>,
  previousRubricMap: ReadonlyMap<string, { pass: boolean; justification: string }> | undefined,
  spec: { acceptanceCriteria?: ReadonlyArray<{ check?: string }> },
): T[] {
  return currentRubricResults.map((current) => {
    if (isRubricItemSettledAgainstWholeDelivery(current.id, spec)) {
      return current;
    }
    const prev = previousRubricMap?.get(current.id);
    if (prev !== undefined) {
      return {
        ...current,
        pass: prev.pass,
        justification: prev.justification,
      };
    }
    return current;
  });
}

