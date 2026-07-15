/**
 * Pure chain heal-by-default plan surgery (WP-521, ADR-009 D5) — the
 * chain-scope sibling of the per-run remediation brief (`workflow/remediation.ts`).
 *
 * When a node seals FAILED and `decideReplan` (`replan.ts`) grants a REPLAN
 * under budget, this module deterministically re-plans the remaining work by
 * RETRYING the failed node with its own failure evidence folded into the goal
 * — no LLM re-decomposition, so the recovery is replay-safe and unit-testable.
 * The sealed-SUCCESS predecessor nodes are untouched (never re-run, never
 * re-judged); only the failed node is replaced by a fresh retry node and any
 * not-yet-sealed downstream node is rewired onto it.
 */
import type { Plan, PlanNode } from "../types.js";

/** A retry brief rides inside the node goal without rotting it (CM-3 discipline). */
export const MAX_REPLAN_BRIEF_CHARS = 2000;

function clampBrief(text: string): string {
  return text.length <= MAX_REPLAN_BRIEF_CHARS
    ? text
    : `${text.slice(0, MAX_REPLAN_BRIEF_CHARS - 1)}…`;
}

/**
 * The replan brief: the failed node's evidence composed deterministically so
 * the retry works against the exact diagnosis that failed it (no paraphrase
 * drift, no extra LLM call — the `buildRemediationBrief` shape at chain scope).
 */
export function buildReplanBrief(failedNodeId: string, failureReason: string): string {
  const reason = failureReason.replace(/\s+/g, " ").trim() || "unknown";
  return clampBrief(
    [
      `REPLAN BRIEF — node ${failedNodeId} failed; one bounded retry is granted with its failure evidence.`,
      `previous failure: ${reason}`,
      "the retry must satisfy every acceptance criterion the failed attempt left unmet, " +
        "without regressing the sealed predecessor nodes.",
    ].join("\n"),
  );
}

/**
 * Build the revised plan that retries the failed node with its evidence. The
 * failed node is replaced IN PLACE by a fresh node `${failedNodeId}-r${replanIndex}`
 * carrying the brief; every other node keeps its id and outcome, with any
 * `dependsOn` on the failed node rewired onto the retry id. Deterministic:
 * given the same inputs it returns byte-identical output.
 */
export function buildRetryPlan(
  plan: Plan,
  failedNodeId: string,
  failureReason: string,
  replanIndex: number,
): Plan {
  const failed = plan.nodes.find((node) => node.id === failedNodeId);
  if (failed === undefined) {
    throw new Error(`buildRetryPlan: failed node ${failedNodeId} is not in the plan`);
  }
  const retryId = `${failedNodeId}-r${replanIndex}`;
  const brief = buildReplanBrief(failedNodeId, failureReason);
  const retryNode: PlanNode = { ...failed, id: retryId, goal: `${failed.goal}\n\n${brief}` };
  const rewire = (dependsOn: string[]): string[] =>
    dependsOn.map((dep) => (dep === failedNodeId ? retryId : dep));
  const nodes = plan.nodes.map((node) =>
    node.id === failedNodeId ? retryNode : { ...node, dependsOn: rewire(node.dependsOn) },
  );
  return { ...plan, id: `${plan.id}-r${replanIndex}`, nodes };
}
