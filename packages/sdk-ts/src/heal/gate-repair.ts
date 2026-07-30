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

/**
 * A brief must ride inside the next prompt without rotting it (CM-3 discipline).
 *
 * F-223: this was 2000, applied as a clamp of the WHOLE rendered string with the
 * instruction rendered last — so on any realistic plan the instruction was the
 * first thing cut. dogfood-121's gate oscillated for three attempts and $0.62
 * because of it: six node goals totalling 3,688 chars made the brief ~5,300, and
 * the planner never read "Keep the parts of your plan it did not object to". The
 * brief rides in a PLANNER prompt, not a compacted step context, so 4000 is still
 * bounded; the budgeting below is what actually makes the cap safe.
 */
export const GATE_REPAIR_BRIEF_MAX_CHARS = 4000;

/** Share of the elastic budget the rejected outline may take before the rationale. */
const OUTLINE_BUDGET_SHARE = 0.5;

/** Enough of an outline entry to carry its node id and a readable fragment. */
const MIN_OUTLINE_ITEM_CHARS = 120;

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
  /**
   * F-226: the machine-checked defect sets of the attempts already made, oldest
   * first, and the set this attempt was just rejected for. Supplied together or
   * not at all — a gate that reports no machine gaps keeps the old behavior.
   */
  gapHistory?: readonly (readonly string[])[];
  machineGaps?: readonly string[];
}

/** What the machine-checked defect sets say about the loop's direction (F-226). */
export type GapProgress = "shrinking" | "stalled" | "oscillating";

/**
 * F-226 — tell a converging repair loop from a churning one.
 *
 * dogfood-121's gate spent three attempts and $0.62 on backticked words: attempt
 * 2 was rejected for `devbox run`, attempt 3 fixed it and lost `benchmarks/`,
 * attempt 4 fixed that and lost `devbox run` AGAIN. A defect that comes BACK
 * after being satisfied is proof the retries are rewriting parts of the artifact
 * the gate never objected to — more attempts buy more of the same. `stalled`
 * still repairs: a defect set that has not shrunk yet may be one attempt away.
 */
export function classifyGapProgress(
  history: readonly (readonly string[])[],
  current: readonly string[],
): GapProgress {
  return returnedGaps(history, current).length > 0
    ? "oscillating"
    : isStalled(history, current)
      ? "stalled"
      : "shrinking";
}

/** Defects that were satisfied by the previous attempt and have come back. */
export function returnedGaps(
  history: readonly (readonly string[])[],
  current: readonly string[],
): string[] {
  const previous = history.at(-1);
  if (previous === undefined) return [];

  const satisfied = new Set(history.flat());
  for (const gap of previous) satisfied.delete(gap);
  return current.filter((gap) => satisfied.has(gap));
}

function isStalled(
  history: readonly (readonly string[])[],
  current: readonly string[],
): boolean {
  const previous = history.at(-1);
  if (previous === undefined) return false;
  const previousSet = new Set(previous);
  return current.length === previous.length && current.every((gap) => previousSet.has(gap));
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
  const returned = returnedGaps(state.gapHistory ?? [], state.machineGaps ?? []);
  if (returned.length > 0) {
    return {
      action: "stop",
      reason:
        `repair is oscillating: ${returned.length} machine-checked defect(s) returned after ` +
        `being satisfied — ${returned.join("; ")}`,
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
  /**
   * Standing requirements the next attempt must keep whether or not they are
   * currently broken (F-226). Rendered separately from the defects so a retry
   * that fixes one cannot silently drop another it had already satisfied.
   */
  contract?: string[];
  /** The gate's own prose rationale, if it produced one. */
  rationale?: string;
  /** What the next attempt must do differently, in the gate's own terms. */
  instruction: string;
  /** The rejected artifact's outline, so the retry revises rather than re-rolls. */
  priorOutline?: string[];
}

function clampText(text: string, max: number): string {
  if (max <= 0) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Rendered size of one section, including the newline that joins it onward. */
function blockLength(lines: readonly string[]): number {
  return lines.length === 0 ? 0 : lines.join("\n").length + 1;
}

/**
 * The machine-checked defects, list-truncated rather than string-truncated: a
 * defect the retry can act on is worth more than the tail of one it cannot read.
 */
function renderGaps(gaps: readonly string[], budget: number): string[] {
  return renderList(
    gaps,
    "## Machine-checked defects — every one of these is verified automatically:",
    (n) => `- … and ${n} more machine-checked defect(s)`,
    budget,
  );
}

function renderContract(contract: readonly string[], budget: number): string[] {
  return renderList(
    contract,
    "## The contract the next attempt must keep, defect or not:",
    (n) => `- … and ${n} more standing requirement(s)`,
    budget,
  );
}

function renderList(
  items: readonly string[],
  heading: string,
  overflow: (remaining: number) => string,
  budget: number,
): string[] {
  if (items.length === 0) return [];
  const lines = ["", heading];
  const spend = budget - overflow(items.length).length - 1;
  let used = blockLength(lines);
  let shown = 0;

  for (const item of items) {
    const line = `- ${item}`;
    if (shown > 0 && used + line.length + 1 > spend) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (shown < items.length) lines.push(overflow(items.length - shown));
  return lines;
}

/**
 * The rejected outline, shrunk per ENTRY so every node id survives. Losing the
 * ids is what makes a retry re-roll the whole decomposition instead of revising
 * the two nodes the gate objected to (F-223/F-226).
 */
function renderOutline(items: readonly string[], budget: number): string[] {
  if (items.length === 0) return [];
  const lines = ["", "## Your rejected attempt (revise this — do not start over):"];
  const overflow = (n: number): string => `- … and ${n} more node(s)`;
  const spend = budget - overflow(items.length).length - 1;
  const perItem = Math.max(
    MIN_OUTLINE_ITEM_CHARS,
    Math.floor((spend - blockLength(lines)) / items.length) - 3,
  );
  let used = blockLength(lines);
  let shown = 0;

  for (const item of items) {
    const line = `- ${clampText(item, perItem)}`;
    if (shown > 0 && used + line.length + 1 > spend) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (shown < items.length) lines.push(overflow(items.length - shown));
  return lines;
}

function renderRationale(rationale: string, budget: number): string[] {
  const text = rationale.replace(/\s+/g, " ").trim();
  if (text.length === 0) return [];
  const lines = ["", "## Gate rationale"];
  const clamped = clampText(text, budget - blockLength(lines));
  return clamped.length === 0 ? [] : [...lines, clamped];
}

/**
 * The repair brief: the rejection evidence composed deterministically so the
 * retry works against the exact diagnosis that failed it (the
 * `buildRemediationBrief` / `buildReplanBrief` shape at gate scope). Given the
 * same inputs it returns byte-identical output.
 *
 * F-223 — the budget, not a tail clamp, is what bounds it. The header, the
 * machine-checked defects and the instruction are MANDATORY and are reserved
 * first; whatever remains is spent on the rejected outline and then the gate's
 * prose rationale. A brief that cannot fit its own mandatory half drops the
 * elastic sections entirely rather than truncating the instruction away.
 */
export function buildGateRepairBrief(input: GateRepairBriefInput): string {
  const header = [
    `REPAIR BRIEF — the ${input.gate} rejected your previous attempt.`,
    `This is repair attempt ${input.attempt} of ${input.maxAttempts}; the launch fails if it is not fixed.`,
  ];
  const instruction = ["", "## What the next attempt must do", input.instruction];

  const mandatory = blockLength(header) + blockLength(instruction);
  const gaps = renderGaps(
    input.machineGaps,
    Math.max(0, GATE_REPAIR_BRIEF_MAX_CHARS - mandatory),
  );
  const contract = renderContract(
    input.contract ?? [],
    Math.max(0, GATE_REPAIR_BRIEF_MAX_CHARS - mandatory - blockLength(gaps)),
  );
  const elastic = Math.max(
    0,
    GATE_REPAIR_BRIEF_MAX_CHARS - mandatory - blockLength(gaps) - blockLength(contract),
  );
  const outline = renderOutline(
    input.priorOutline ?? [],
    Math.floor(elastic * OUTLINE_BUDGET_SHARE),
  );
  const rationale = renderRationale(input.rationale ?? "", elastic - blockLength(outline));

  const brief = [...header, ...gaps, ...contract, ...rationale, ...outline, ...instruction].join(
    "\n",
  );
  if (brief.length <= GATE_REPAIR_BRIEF_MAX_CHARS) return brief;
  return [...header, ...gaps, ...instruction].join("\n");
}
