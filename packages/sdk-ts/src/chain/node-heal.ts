/**
 * F-214 (WP-544) — the heal tier between a failed node run and rewriting the
 * node (ADR-009 D1 tiering: the cheapest heal that PRESERVES work runs first).
 *
 * A run seals `resumable: true` precisely to say "re-enter me, I kept my
 * checkpoint and I know why I failed" — that is the whole of WP-520, and
 * `chikory resume` has honored it since. The chain never did. `readNodeResult`
 * dropped the flag on the floor and `replanRemaining` was the only response to
 * a FAILED node, so a chain answered "this run can continue" by deleting the
 * run: on dogfood-120, `N-2` sealed resumable with a remediation brief and 962
 * insertions of real work at `f7dee78`, and the only heal the chain could offer
 * was a fresh empty workspace under a rewritten goal.
 *
 * Pure — the `decideRemediation` / `decideReplan` / `decideGateRepair` sibling.
 */

/** Chain-level child resumes ONE node may consume (CG-1: bounded, never a loop). */
export const MAX_CHILD_RESUMES_PER_NODE = 1;

export interface NodeHealState {
  /** The child run's sealed terminal status. */
  childStatus: "SUCCESS" | "FAILED";
  /** Did the child seal `resumable: true` (WP-520)? */
  childResumable: boolean;
  /** Chain-level resumes already granted to this node. */
  resumesUsed: number;
}

export type NodeHealDecision =
  | { action: "resume_child"; attempt: number; reason: string }
  /** Fall through to `decideReplan` — the existing rewrite-the-node tier. */
  | { action: "replan_node"; reason: string };

/**
 * Grant a bounded child resume while the run says it can continue; otherwise
 * hand the failure to the replan tier. A SUCCESS never reaches either.
 */
export function decideNodeHeal(
  state: NodeHealState,
  maxResumes: number = MAX_CHILD_RESUMES_PER_NODE,
): NodeHealDecision {
  if (state.childStatus !== "FAILED") {
    return { action: "replan_node", reason: "node did not fail" };
  }
  if (!state.childResumable) {
    return { action: "replan_node", reason: "child sealed a dead FAILED — nothing to re-enter" };
  }
  if (state.resumesUsed >= maxResumes) {
    return {
      action: "replan_node",
      reason: `child resume budget spent (${state.resumesUsed}/${maxResumes})`,
    };
  }
  return {
    action: "resume_child",
    attempt: state.resumesUsed + 1,
    reason:
      `re-entering the resumable child run (attempt ${state.resumesUsed + 1}/${maxResumes}) ` +
      `— its checkpoint and failure evidence are preserved`,
  };
}
