/**
 * Standing rubric (WP-131, judge.md Scoring) — the always-on binary items
 * every judge pass answers in addition to the task's acceptance criteria.
 * Destructive items are the CONTRACTS.md §4 rule-1 triggers: failing one
 * forces ROLLBACK regardless of everything else.
 */

export interface RubricItem {
  id: string;
  description: string;
  /** CONTRACTS.md §4 rule 1: a `pass=false` on a destructive item → ROLLBACK. */
  destructive: boolean;
}

/** Rubric id whose answer is overridden by judge-executed checks (JD-4). */
export const RUBRIC_TESTS_PASS = "tests_pass";

/** Rubric id for the big-picture design-quality judgment. */
export const RUBRIC_DESIGN_SERVES_OVERALL_GOAL = "design_serves_overall_goal";

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
];
