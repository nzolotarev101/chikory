/**
 * Deterministic verdict computation (WP-131) — CONTRACTS.md §4 rules 1–5.
 *
 * The reward-hacking guard (JD-7, ADR-002): the LLM only fills the binary
 * `JudgeForm`; the verdict is computed HERE, by code, from the booleans plus
 * the per-criterion verdict history. The model never chooses the verdict.
 */
import type { JudgeForm } from "../types.js";
import { STANDING_RUBRIC, type RubricItem } from "./rubric.js";

/** Same criterion failed by this many consecutive verdicts → HALT (rule 3). */
export const HALT_CONSECUTIVE_FAILS = 3;
/** pass→fail→pass patterns on one criterion before ESCALATE (rule 5). */
export const FLIP_FLOPS_TO_ESCALATE = 2;

export interface VerdictDecision {
  kind: "PROCEED" | "ROLLBACK" | "HALT" | "ESCALATE" | "BRANCH";
  rationale: string;
  escalateReason?: string;
}

function flipFlops(history: boolean[]): number {
  let count = 0;
  for (let i = 0; i + 2 < history.length; i++) {
    if (history[i] && !history[i + 1] && history[i + 2]) count++;
  }
  return count;
}

function trailingFails(history: boolean[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0 && !history[i]; i--) count++;
  return count;
}

function describe(items: Array<{ id: string; justification: string }>): string {
  return items.map((i) => `${i.id}: ${i.justification}`).join("; ");
}

/**
 * `criteriaHistory` holds per-criterion pass booleans from PREVIOUS verdicts
 * (oldest first); the current form's results are appended internally before
 * the consecutive-failure and flip-flop rules are evaluated.
 */
export function computeVerdict(
  form: JudgeForm,
  criteriaHistory: Record<string, boolean[]>,
  rubric: RubricItem[] = STANDING_RUBRIC,
  workChunkInProgress = false,
): VerdictDecision {
  const destructiveIds = new Set(rubric.filter((r) => r.destructive).map((r) => r.id));
  const rubricFails = form.rubricResults.filter((r) => !r.pass);
  const criteriaFails = form.criterionResults.filter((r) => !r.pass);

  // Rule 1 — destructive rubric failure → ROLLBACK.
  const destructiveFails = rubricFails.filter((r) => destructiveIds.has(r.id));
  if (destructiveFails.length > 0) {
    return {
      kind: "ROLLBACK",
      rationale: `destructive rubric failure → ROLLBACK — ${describe(destructiveFails)}`,
    };
  }

  const branchConcern = form.concerns.find((concern) => /\bbranch\b/i.test(concern));
  if (branchConcern !== undefined) {
    return {
      kind: "BRANCH",
      rationale: `judge recommends BRANCH for alternative exploration — ${branchConcern}`,
    };
  }

  // Rules 3/5 need the full per-criterion sequence including this verdict.
  // WP-263(b): an INFRA-failed result (check killed at its cap — the check
  // infrastructure died, not the code) is inconclusive and does not extend
  // the sequence: three hung checks must not read as a stuck criterion.
  const sequences = form.criterionResults.map((r) => ({
    id: r.id,
    history:
      r.infraFailed === true
        ? [...(criteriaHistory[r.id] ?? [])]
        : [...(criteriaHistory[r.id] ?? []), r.pass],
  }));

  // Rule 3 — same criterion failed by ≥3 consecutive verdicts → HALT.
  // Suppressed while a bounded-work-unit run is still consuming EARLIER chunks
  // (F-112): a terminal acceptance criterion that a LATER chunk is designed to
  // satisfy fails the earlier chunks BY DESIGN, which is not goal drift. The
  // guard resumes on the final chunk + post-chunk completion re-verification,
  // where a criterion stuck failing is real budget-waste. This is the
  // deterministic-gate analog of the WP-271 chunk-scoped LLM adjudication.
  const stuck = workChunkInProgress
    ? []
    : sequences.filter((s) => trailingFails(s.history) >= HALT_CONSECUTIVE_FAILS);
  if (stuck.length > 0) {
    return {
      kind: "HALT",
      rationale:
        `criterion ${stuck.map((s) => s.id).join(", ")} failed ` +
        `${HALT_CONSECUTIVE_FAILS}+ consecutive verdicts → HALT (goal drift / budget-waste guard)`,
    };
  }

  // Rule 5 — criterion flip-flop (pass→fail→pass) twice → ESCALATE (judge-drift guard).
  // Also suppressed while chunking (F-112 / WP-273): the guard catches judge
  // drift on a STABLE diff, but under bounded-work-unit chunking the diff
  // changes each step, so a criterion oscillating as later chunks touch shared
  // code is expected STATE change, not judge drift. Resumes on the final chunk.
  const flippers = workChunkInProgress
    ? []
    : sequences.filter((s) => flipFlops(s.history) >= FLIP_FLOPS_TO_ESCALATE);
  if (flippers.length > 0) {
    const reason =
      `criterion ${flippers.map((s) => s.id).join(", ")} flip-flopped ` +
      `${FLIP_FLOPS_TO_ESCALATE}+ times across verdicts — judge drift or unstable criterion (JD-7)`;
    return { kind: "ESCALATE", rationale: reason, escalateReason: reason };
  }

  // Rule 4 — concerns with no rubric basis → ESCALATE (ambiguity belongs to humans).
  if (form.concerns.length > 0 && rubricFails.length === 0) {
    const reason = `judge raised concerns outside the rubric: ${form.concerns.join(" | ")}`;
    return { kind: "ESCALATE", rationale: reason, escalateReason: reason };
  }

  // Rule 2 / default — PROCEED. All-criteria-pass → the runner seals run-level
  // SUCCESS; otherwise the work is mid-flight and healthy (no regressions),
  // which is exactly what PROCEED gates on (judge.md verdict table).
  if (criteriaFails.length === 0 && rubricFails.length === 0 && form.criterionResults.length > 0) {
    return {
      kind: "PROCEED",
      rationale: `all ${form.criterionResults.length} acceptance criteria pass; no rubric failures`,
    };
  }
  const failNote =
    criteriaFails.length > 0
      ? `unmet criteria: ${criteriaFails.map((c) => c.id).join(", ")}`
      : "no criteria evaluated";
  const rubricNote =
    rubricFails.length > 0 ? `; non-destructive rubric failures: ${describe(rubricFails)}` : "";
  return {
    kind: "PROCEED",
    rationale: `work in progress, no regressions — ${failNote}${rubricNote}`,
  };
}
