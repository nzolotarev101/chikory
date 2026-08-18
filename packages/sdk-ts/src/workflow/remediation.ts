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
import { blockingConcerns } from "../judge/verdict.js";
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

export function clampBrief(text: string, maxChars: number = REMEDIATION_BRIEF_MAX_CHARS): string {
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars - 1)}…`;
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
 * Every-pass criterion and concern feedback (WP-519 slice (a), WP-599, ADR-009 D3):
 * the failing-criterion justifications and blocking out-of-rubric concerns that
 * ride into the next step on EVERY judge pass — not only at completion milestones —
 * so the executor never retries blind against evidence the judge already holds.
 * Returns undefined when no criterion failed and no blocking concern was raised (nothing to feed back).
 */
export function buildCriterionFeedback(form: JudgeForm): string | undefined {
  const fails = form.criterionResults.filter((r) => !r.pass);
  const blocking = blockingConcerns(form);
  if (fails.length === 0 && blocking.length === 0) return undefined;

  const sections: string[] = [];
  if (fails.length > 0) {
    const lines = fails.map((fail) => `- ${fail.id}: ${fail.justification}`);
    sections.push(
      `unmet acceptance criteria (judge evidence — address these directly):\n${lines.join("\n")}`,
    );
  }
  if (blocking.length > 0) {
    const lines = blocking.map((concern) => `- ${concern}`);
    sections.push(
      `judge concerns (out-of-rubric — address these directly):\n${lines.join("\n")}`,
    );
  }
  return clampSections(sections);
}

/**
 * F-384 (dogfood-153 review): clamping the CONCATENATION truncates from the
 * tail, so the section that happens to be last disappears whole. That is not a
 * corner case here — a judge's failing-criterion justification quotes the
 * check it ran, and the three measured on run-8113a98d were 6532 / 3757 / 2851
 * bytes against this 2000-char budget. Joined-then-clamped, the concerns
 * section was therefore dropped in EVERY combined case, which is exactly the
 * "alongside the failing-criterion evidence" WP-599 exists to deliver, and the
 * executor's only copy — the seal's copy arrives too late to act on.
 *
 * Each present section instead gets a fair share of the budget: shortest
 * first, so a section under its share releases the remainder to the others and
 * a short concern list is never truncated to pay for a verbose criterion.
 */
function clampSections(sections: string[], maxChars: number = REMEDIATION_BRIEF_MAX_CHARS): string {
  const separator = "\n\n";
  const joined = sections.join(separator);
  if (joined.length <= maxChars) return joined;

  const clamped: string[] = new Array(sections.length);
  let remaining = maxChars - separator.length * (sections.length - 1);
  let unallocated = sections.length;
  const shortestFirst = sections
    .map((_, index) => index)
    .sort((a, b) => sections[a].length - sections[b].length);
  for (const index of shortestFirst) {
    clamped[index] = clampSectionKeepingTail(
      sections[index],
      Math.floor(remaining / unallocated),
    );
    remaining -= clamped[index].length;
    unallocated -= 1;
  }
  return clamped.join(separator);
}

/**
 * F-388 (dogfood-154 review): WP-635 made a failing check's justification carry
 * the check's OUTPUT and deliberately preserved its TAIL — the assertion and the
 * author's `AC-n FAIL: …` sentence, the only text written for the next attempt
 * (src/judge/harness.ts:137). This clamp then threw exactly that away, because
 * `clampBrief` keeps the HEAD: measured over the real `applyCheckOverrides`, any
 * check output from 1,890 bytes up reached the executor as build-banner noise
 * with neither the assertion nor the author's sentence in it. That is the common
 * case, not a corner: a fully GREEN `pnpm --filter @chikory/sdk exec vitest run`
 * over this suite prints 17,403 bytes. Two clamps disagreeing about which end is
 * the signal make the feature inert.
 *
 * Every section here is `<header line>\n<body>`: the header names WHAT failed,
 * and the body's signal is at its END. So keep both — the header verbatim, the
 * body tail-clamped behind the same head-truncation marker the harness and the
 * judge prompt already use (src/judge/prompt.ts:87), so the executor can always
 * tell that what it received is partial.
 */
function clampSectionKeepingTail(section: string, maxChars: number): string {
  if (section.length <= maxChars) return section;
  const headerEnd = section.indexOf("\n");
  if (headerEnd < 0) return clampBrief(section, maxChars);
  const header = section.slice(0, headerEnd);
  const marker = "\n… [head truncated]\n";
  const bodyBudget = maxChars - header.length - marker.length;
  if (bodyBudget <= 0) return clampBrief(section, maxChars);
  return `${header}${marker}${section.slice(-bodyBudget)}`;
}

/**
 * F-212 / F-385: compose the verdict rationale with the failing acceptance
 * criteria and blocking concerns. A mechanical violation must never mask the
 * substantive one, and the feedback from a milestone pass must not displace
 * the verdict rationale that names the failing rubric rows.
 */
export function withCriterionFeedback(rationale: string, form: JudgeForm): string {
  const criteria = buildCriterionFeedback(form);
  return criteria === undefined ? rationale : `${rationale}\n\n${criteria}`;
}

