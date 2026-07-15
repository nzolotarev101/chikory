import type { NodeOutcome, Plan } from "../types.js";
import { summarizeNodeDesign } from "./design-summary.js";

/**
 * Renders sealed node outcomes in their deterministic plan order.
 */
export function renderChainDesignSummary(
  plan: Plan,
  nodeOutcomes: Readonly<Record<string, NodeOutcome>>,
): string {
  return plan.nodes
    .flatMap((node) => {
      const outcome = nodeOutcomes[node.id];
      return outcome === undefined ? [] : [summarizeNodeDesign(node.id, outcome, node.goal)];
    })
    .join("\n");
}
