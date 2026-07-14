/**
 * Pure chain-completion review decision (WP-311) — the chain-scope sibling of
 * the per-run `decideCompletionReview` (`src/workflow/completion-review.ts`).
 * At the moment a chain would seal SUCCESS, the executor runs ONE aggregate
 * design-judge pass over the whole chain's cumulative cross-node diff +
 * `plan.goal` + every `NodeOutcome`. This decides whether that pass runs at all.
 *
 * Kept outside the Temporal workflow body so the decision is deterministic and
 * unit-testable (the `decideReplan`/`deriveChainStatus` sibling). Bounded to a
 * single aggregate pass; there is NO chain-level design-fix re-heal (a finished
 * chain is never re-judged or re-parked — the F-107 discipline at chain scope),
 * so findings are recorded and the chain seals SUCCESS-with-findings.
 */

/** A one-node chain has no cross-node design to review. */
export const MIN_CHAIN_NODES_FOR_REVIEW = 2;

export interface ChainCompletionReviewState {
  /** Total nodes in the (possibly replanned) plan. */
  nodeCount: number;
  /** Nodes that sealed SUCCESS. */
  succeededCount: number;
  /** A `chain_completion_review` entry already exists (a resumed re-seal). */
  alreadyReviewed: boolean;
}

export type ChainCompletionReviewDecision =
  | { action: "review" }
  | { action: "skip"; reason: string };

export function decideChainCompletionReview(
  state: ChainCompletionReviewState,
): ChainCompletionReviewDecision {
  if (state.alreadyReviewed) {
    return { action: "skip", reason: "chain completion already reviewed" };
  }
  if (state.nodeCount < MIN_CHAIN_NODES_FOR_REVIEW) {
    return {
      action: "skip",
      reason: `single-node chain — no cross-node design to review (nodes ${state.nodeCount})`,
    };
  }
  if (state.succeededCount < state.nodeCount) {
    return {
      action: "skip",
      reason: `chain not all-SUCCESS (${state.succeededCount}/${state.nodeCount}) — no completion review`,
    };
  }
  return { action: "review" };
}
