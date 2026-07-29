/**
 * Plan-time repair binding (WP-542/F-207) — the first consumer of the generic
 * gate-repair tier (`heal/gate-repair.ts`).
 *
 * The plan phase has five distinct ways to reject a decomposition, and until
 * WP-542 every one of them ended the launch: the planner's own LLM call failing,
 * an unserializable write-set topology, the WP-509 `min_nodes` floor, the
 * deterministic coverage/literal floors inside `buildPlanVerdict`, and the
 * plan meta-judge's own REVISE. Four of the five are *fixable by re-planning* —
 * ADR-005 D2 says so in the verdict kind's own name — but nothing consumed the
 * rejection as feedback, so the human hand-edited the goal spec and re-launched
 * (five times, on dogfood-120).
 *
 * This module turns each of those rejections into repair evidence. It is pure:
 * classification and brief-building only, no LLM call and no I/O, so the whole
 * decision is unit-testable. The evidence it harvests is exactly what the gate
 * already computed and then threw away — `verdict.uncoveredCriteria` and
 * `planLiteralGaps` — plus the rejected plan's outline, so the retry revises
 * rather than re-rolls.
 *
 * NOT repairable, and deliberately so: a same-family plan-judge is a config
 * error (invariant #2 — fail fast, no spend), and a substantive ESCALATE is the
 * verdict that means "a human must look at this". Repairing those would defeat
 * the gate rather than heal it.
 */
import { classifyPlanGateFailure } from "../chain/plan-gate-failure.js";
import { buildGateRepairBrief } from "../heal/gate-repair.js";
import type { Plan, PlanVerdict } from "../types.js";
import { planLiteralGaps } from "./literal-preservation.js";

/** The gate name every plan-phase repair brief is addressed from. */
export const PLAN_GATE_NAME = "plan meta-judge gate";

export type PlanPhaseFailureKind =
  | "planner-transport"
  | "write-set"
  | "min-nodes"
  | "gate-infra"
  | "gate-revise"
  | "gate-escalate"
  | "family-diversity";

export interface PlanPhaseFailure {
  kind: PlanPhaseFailureKind;
  /** Which half of the plan phase produced it (mirrors `PlanGateResult.phase`). */
  phase: "plan" | "gate";
  /** Whether the gate-repair tier may grant an attempt for this class. */
  repairable: boolean;
  /** The operator-facing message — unchanged from the pre-WP-542 behavior. */
  message: string;
  /** Independently checkable defects, verbatim, for the repair brief. */
  machineGaps: string[];
  /** What the next attempt must do differently. */
  instruction: string;
  verdict?: PlanVerdict;
}

/** The planner's own LLM call failed — no plan exists, so re-issue the pass. */
export function plannerTransportFailure(reason: string): PlanPhaseFailure {
  return {
    kind: "planner-transport",
    phase: "plan",
    repairable: true,
    message: reason,
    machineGaps: [],
    instruction:
      "The previous decomposition call did not return a usable reply. Emit the plan again.",
  };
}

/** The planner emitted a topology whose write sets cannot be serialized (WP-242). */
export function writeSetFailure(message: string): PlanPhaseFailure {
  return {
    kind: "write-set",
    phase: "plan",
    repairable: true,
    message,
    machineGaps: [`write-set topology rejected: ${message}`],
    instruction:
      "Give every node a `writeSet` of exact repo-relative POSIX paths, and make sure " +
      "nodes that write the same path are ordered by `dependsOn` rather than left concurrent.",
  };
}

/** The WP-509/F-88 decomposition floor: the goal was collapsed too coarsely. */
export function minNodesFailure(actual: number, required: number): PlanPhaseFailure {
  return {
    kind: "min-nodes",
    phase: "plan",
    repairable: true,
    message:
      `planner under-decomposed: ${actual} node(s) < min_nodes ${required} — ` +
      `the goal was collapsed too coarsely; re-run or lower min_nodes`,
    machineGaps: [`the plan has ${actual} node(s); at least ${required} are required`],
    instruction:
      `Emit at least ${required} nodes. Split each independently-shippable deliverable ` +
      "in the goal into its own node instead of collapsing them into one omnibus node.",
  };
}

/** A same-family plan-judge — a config error, never repaired (invariant #2). */
export function familyDiversityFailure(message: string): PlanPhaseFailure {
  return {
    kind: "family-diversity",
    phase: "gate",
    repairable: false,
    message,
    machineGaps: [],
    instruction: "",
  };
}

function describeUncovered(id: string): string {
  return (
    `goal acceptance criterion \`${id}\` is covered by no node — some node's own ` +
    `\`acceptanceCriteria\` must contain an entry whose id is exactly \`${id}\``
  );
}

function describeLiteralGap(literal: string): string {
  return (
    `mandated goal literal \`${literal}\` appears in no node goal — copy it verbatim ` +
    `into the goal of the node that owns it`
  );
}

/**
 * Classify a non-PROCEED plan meta-judge verdict, harvesting the deterministic
 * floors' own findings as repair evidence. `classifyPlanGateFailure` stays the
 * authority on infra-vs-substantive so the WP-233 distinction is not forked.
 */
export function gateFailure(verdict: PlanVerdict, plan: Plan): PlanPhaseFailure {
  const cls = classifyPlanGateFailure(verdict);
  const machineGaps = [
    ...verdict.uncoveredCriteria.map(describeUncovered),
    ...planLiteralGaps(plan).map(describeLiteralGap),
  ];

  // An unreachable meta-judge says nothing about the plan — re-ask, don't revise.
  if (cls?.kind === "infra") {
    return {
      kind: "gate-infra",
      phase: "gate",
      repairable: true,
      message: verdict.rationale,
      machineGaps: [],
      instruction: "The gate could not be reached. Emit the plan again.",
      verdict,
    };
  }

  // REVISE is the fixable verdict — ADR-005 D2: "REVISE → re-plan".
  if (verdict.kind === "REVISE") {
    return {
      kind: "gate-revise",
      phase: "gate",
      repairable: true,
      message: verdict.rationale,
      machineGaps,
      instruction:
        "Fix every machine-checked defect above and address the gate's rationale. Keep the " +
        "parts of your plan it did not object to — node ids, dependency order, and write sets " +
        "that were accepted should survive unchanged.",
      verdict,
    };
  }

  // A substantive ESCALATE is the verdict that means "a human must decide".
  return {
    kind: "gate-escalate",
    phase: "gate",
    repairable: false,
    message: verdict.rationale,
    machineGaps,
    instruction: "",
    verdict,
  };
}

export interface PlanRepairBriefInput {
  failure: PlanPhaseFailure;
  attempt: number;
  maxAttempts: number;
  /** The rejected plan, when one was produced (absent on a transport failure). */
  priorPlan?: Plan;
}

/** `id: goal` outline of the rejected plan — the brief's subject line. */
export function planOutline(plan: Plan): string[] {
  return plan.nodes.map((node) => {
    const deps = node.dependsOn.length > 0 ? ` (after ${node.dependsOn.join(", ")})` : "";
    return `${node.id}${deps}: ${node.goal}`;
  });
}

/** The plan-phase repair brief, rendered through the shared tier. */
export function buildPlanRepairBrief(input: PlanRepairBriefInput): string {
  const { failure } = input;
  return buildGateRepairBrief({
    gate: PLAN_GATE_NAME,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    machineGaps: failure.machineGaps,
    ...(failure.verdict !== undefined ? { rationale: failure.verdict.rationale } : {}),
    instruction: failure.instruction,
    ...(input.priorPlan !== undefined ? { priorOutline: planOutline(input.priorPlan) } : {}),
  });
}

/**
 * One-line operator summary of what this attempt is repairing. Prefers the
 * machine-checked defects — they are the actionable half; the gate's prose is
 * the fallback when there are none (a transport fault, say).
 */
export function describeRepairTarget(failure: {
  machineGaps: string[];
  message: string;
}): string {
  if (failure.machineGaps.length > 0) {
    return failure.machineGaps.join("; ");
  }
  return failure.message.replace(/\s+/g, " ").trim();
}
