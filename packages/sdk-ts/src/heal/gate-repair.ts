/**
 * The gate-repair tier (WP-542, ADR-009 D1/D2) — the heal tier for artifacts
 * that a gate rejects BEFORE any durable execution exists.
 *
 * ADR-009 D1 is binding: *every* non-infra failure class gets at least one
 * bounded, journaled, automated heal attempt before a terminal seal. The run
 * loop has `workflow/remediation.ts` and the chain loop has `chain/replan.ts`,
 * but the gates that sit ABOVE both — the ones that judge a plan before a single
 * node runs — had no tier at all: a rejected artifact was discarded and the
 * launch exited, leaving the human to hand-edit the input and re-launch (F-207).
 *
 * This module is that tier, and it is deliberately artifact-agnostic: strings
 * in, strings out, no `Plan` and no `PlanVerdict` in the signatures. A gate
 * binds to it by classifying its own failure as repairable-or-not and rendering
 * its own machine-derived gaps (`planner/plan-repair.ts` is the first such
 * binding). Both functions are pure — same shape as `decideRemediation` /
 * `buildRemediationBrief` — so the whole decision is unit-testable with no LLM
 * call, and the brief is composed deterministically from evidence the gate has
 * already produced (no paraphrase drift, no second opinion to pay for).
 */

/** Repair attempts are counted and capped (CG-1 / invariant #4 — no infinite loops). */
export const MAX_GATE_REPAIR_ATTEMPTS = 3;

/**
 * Fraction of the artifact's own budget the repair loop may spend before it
 * stops. Repair happens before any node runs, so an unbounded loop would burn
 * the work's budget on planning it.
 */
export const GATE_REPAIR_COST_SHARE = 0.1;

/** A brief must ride inside the next prompt without rotting it (CM-3 discipline). */
export const GATE_REPAIR_BRIEF_MAX_CHARS = 2000;

export interface GateRepairState {
  /** Repair attempts already granted for this artifact. */
  attemptsUsed: number;
  /** Cumulative USD the gated stages have spent so far (all attempts). */
  costUsdSpent: number;
  /**
   * Whether the failure class can be repaired at all. A config error or a
   * substantive human escalation is NOT repairable — those must still fail
   * fast, exactly as they do today (invariant #2 stays fail-fast).
   */
  repairable: boolean;
}

export interface GateRepairBounds {
  maxAttempts: number;
  /** Absolute USD ceiling on the whole repair loop; `0` disables the cost stop. */
  costCapUsd: number;
}

export type GateRepairDecision =
  | { action: "repair"; attempt: number }
  | { action: "stop"; reason: string };

/**
 * Grant a bounded repair attempt, or stop with the reason the loop ended. The
 * caller renders the stop reason to the operator — a repair loop that gives up
 * silently is the same dead end it replaced.
 */
export function decideGateRepair(
  state: GateRepairState,
  bounds: GateRepairBounds,
): GateRepairDecision {
  if (!state.repairable) {
    return { action: "stop", reason: "failure class is not repairable" };
  }
  if (bounds.maxAttempts <= 0) {
    return { action: "stop", reason: "repair is disabled (0 attempts)" };
  }
  if (state.attemptsUsed >= bounds.maxAttempts) {
    return {
      action: "stop",
      reason: `repair budget exhausted after ${bounds.maxAttempts} attempt(s)`,
    };
  }
  if (bounds.costCapUsd > 0 && state.costUsdSpent >= bounds.costCapUsd) {
    return {
      action: "stop",
      reason:
        `repair cost cap reached: $${state.costUsdSpent.toFixed(4)} spent of ` +
        `$${bounds.costCapUsd.toFixed(4)} allowed`,
    };
  }
  return { action: "repair", attempt: state.attemptsUsed + 1 };
}

/** The absolute repair ceiling for an artifact with its own budget. */
export function gateRepairCostCap(
  budgetUsd: number,
  share: number = GATE_REPAIR_COST_SHARE,
): number {
  return budgetUsd > 0 ? budgetUsd * share : 0;
}

export interface GateRepairBriefInput {
  /** Human name of the gate that rejected the artifact ("plan meta-judge gate"). */
  gate: string;
  attempt: number;
  maxAttempts: number;
  /**
   * Machine-derived, independently checkable defects (missing ids, dropped
   * literals, a node-count shortfall). Listed FIRST and verbatim: these are the
   * ones a paraphrasing retry silently loses, and they are why the previous
   * attempt was rejected regardless of how good its prose looked.
   */
  machineGaps: string[];
  /** The gate's own prose rationale, if it produced one. */
  rationale?: string;
  /** What the next attempt must do differently, in the gate's own terms. */
  instruction: string;
  /** The rejected artifact's outline, so the retry revises rather than re-rolls. */
  priorOutline?: string[];
}

function clampBrief(text: string): string {
  return text.length <= GATE_REPAIR_BRIEF_MAX_CHARS
    ? text
    : `${text.slice(0, GATE_REPAIR_BRIEF_MAX_CHARS - 1)}…`;
}

/**
 * The repair brief: the rejection evidence composed deterministically so the
 * retry works against the exact diagnosis that failed it (the
 * `buildRemediationBrief` / `buildReplanBrief` shape at gate scope). Given the
 * same inputs it returns byte-identical output.
 */
export function buildGateRepairBrief(input: GateRepairBriefInput): string {
  const lines = [
    `REPAIR BRIEF — the ${input.gate} rejected your previous attempt.`,
    `This is repair attempt ${input.attempt} of ${input.maxAttempts}; the launch fails if it is not fixed.`,
  ];

  if (input.machineGaps.length > 0) {
    lines.push(
      "",
      "## Machine-checked defects — every one of these is verified automatically:",
      ...input.machineGaps.map((gap) => `- ${gap}`),
    );
  }

  const rationale = (input.rationale ?? "").replace(/\s+/g, " ").trim();
  if (rationale.length > 0) {
    lines.push("", `## Gate rationale`, rationale);
  }

  if (input.priorOutline !== undefined && input.priorOutline.length > 0) {
    lines.push(
      "",
      "## Your rejected attempt (revise this — do not start over):",
      ...input.priorOutline.map((item) => `- ${item}`),
    );
  }

  lines.push("", `## What the next attempt must do`, input.instruction);

  return clampBrief(lines.join("\n"));
}
