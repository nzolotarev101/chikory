/**
 * Pure remediation decisions (WP-519, ADR-009 D3) — the self-heal tier
 * between the judge's ROLLBACK correction and the human ESCALATE.
 *
 * When verdict rule 3 (criterion stuck 3+ consecutive verdicts) would HALT,
 * the run gets ONE bounded remediation attempt: the judge's diagnosis is
 * folded into a remediation brief instead of being discarded, the workspace
 * rolls back to the last-good checkpoint, and the executor retries against
 * the brief. Still stuck → seal a *resumable* FAILED (WP-520), never a dead
 * end. Kept outside the Temporal workflow body so the decision is
 * deterministic and unit-testable (the `decideSoakDelay`/`decideWorkChunk`
 * sibling).
 */
import type { JudgeForm } from "../types.js";

/** Heal attempts are counted and capped (ADR-009 D1 / CG-1: bounded, never a loop). */
export const MAX_REMEDIATION_ATTEMPTS = 1;

/** A brief must ride inside step context without rotting it (CM-3 discipline). */
export const REMEDIATION_BRIEF_MAX_CHARS = 2000;

export interface RemediationState {
  /** Remediation attempts already granted since the last terminal seal. */
  attemptsUsed: number;
}

export type RemediationDecision =
  | { action: "remediate"; attempt: number }
  | { action: "seal_resumable_failed" };

/**
 * HALT interception: grant a bounded remediation attempt while the budget
 * lasts; exhausted → the caller seals resumable FAILED (WP-520).
 */
export function decideRemediation(
  state: RemediationState,
  maxAttempts: number = MAX_REMEDIATION_ATTEMPTS,
): RemediationDecision {
  if (state.attemptsUsed < maxAttempts) {
    return { action: "remediate", attempt: state.attemptsUsed + 1 };
  }
  return { action: "seal_resumable_failed" };
}

function clampBrief(text: string): string {
  return text.length <= REMEDIATION_BRIEF_MAX_CHARS
    ? text
    : `${text.slice(0, REMEDIATION_BRIEF_MAX_CHARS - 1)}…`;
}

/**
 * The remediation brief (ADR-009 D3): the failing criteria, the judge's
 * evidence, and what a fix must change — composed deterministically from the
 * form the judge already filled, so the diagnosis that triggered the HALT is
 * the exact feedback the remediation attempt works against (no extra LLM
 * call, no paraphrase drift).
 */
export function buildRemediationBrief(form: JudgeForm, rationale: string): string {
  const criterionFails = form.criterionResults.filter((r) => !r.pass);
  const rubricFails = form.rubricResults.filter((r) => !r.pass);
  const lines: string[] = [
    "REMEDIATION BRIEF — the judge halted this run; one bounded remediation attempt is granted.",
    `trigger: ${rationale}`,
  ];
  if (criterionFails.length > 0) {
    lines.push("failing acceptance criteria (judge evidence):");
    for (const fail of criterionFails) lines.push(`- ${fail.id}: ${fail.justification}`);
  }
  if (rubricFails.length > 0) {
    lines.push("rubric failures:");
    for (const fail of rubricFails) lines.push(`- ${fail.id}: ${fail.justification}`);
  }
  if (form.concerns.length > 0) {
    lines.push("judge concerns:");
    for (const concern of form.concerns) lines.push(`- ${concern}`);
  }
  lines.push(
    "a fix must make each failing criterion's check pass without regressing the passing ones.",
  );
  return clampBrief(lines.join("\n"));
}

/**
 * Every-pass criterion feedback (WP-519 slice (a), ADR-009 D3): the
 * failing-criterion rationale that rides into the next step on EVERY judge
 * pass — not only at completion milestones — so the executor never retries
 * blind against evidence the judge already holds. Returns undefined when no
 * criterion failed (nothing to feed back).
 */
export function buildCriterionFeedback(form: JudgeForm): string | undefined {
  const fails = form.criterionResults.filter((r) => !r.pass);
  if (fails.length === 0) return undefined;
  const lines = fails.map((fail) => `- ${fail.id}: ${fail.justification}`);
  return clampBrief(
    `unmet acceptance criteria (judge evidence — address these directly):\n${lines.join("\n")}`,
  );
}
