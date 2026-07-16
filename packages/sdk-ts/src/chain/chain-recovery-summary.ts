import type { NodeOutcome, Plan } from "../types.js";
import { summarizeNodeRecovery } from "./recovery-summary.js";
import type { ChainEntry, NodeReplannedPayload } from "./store.js";

const NO_FAILURE_RECORDED = "none recorded";

interface RecoveryFacts {
  attempts: number;
  lastFailureReason: string;
}

function recoveryFactsByNode(
  plan: Plan,
  entries: readonly ChainEntry[],
): ReadonlyMap<string, RecoveryFacts> {
  const orderedEntries = [...entries].sort((left, right) => left.idx - right.idx);
  const initialPlanEntry = orderedEntries.find((entry) => entry.kind === "plan");
  let activePlan = (initialPlanEntry?.payload as Plan | undefined) ?? plan;
  let rootByNode = new Map(activePlan.nodes.map((node) => [node.id, node.id]));
  const factsByRoot = new Map<string, RecoveryFacts>();

  for (const entry of orderedEntries) {
    if (entry.kind !== "node_replanned") continue;

    const payload = entry.payload as NodeReplannedPayload;
    const failedIndex = activePlan.nodes.findIndex((node) => node.id === payload.failedNodeId);
    const root = rootByNode.get(payload.failedNodeId) ?? payload.failedNodeId;
    const previous = factsByRoot.get(root);
    factsByRoot.set(root, {
      attempts: (previous?.attempts ?? 1) + 1,
      lastFailureReason: payload.reason,
    });

    const revisedRoots = new Map<string, string>();
    for (const node of payload.revisedPlan.nodes) {
      const existingRoot = rootByNode.get(node.id);
      if (existingRoot !== undefined) revisedRoots.set(node.id, existingRoot);
    }

    const replacement = failedIndex < 0 ? undefined : payload.revisedPlan.nodes[failedIndex];
    if (replacement !== undefined) revisedRoots.set(replacement.id, root);

    activePlan = payload.revisedPlan;
    rootByNode = revisedRoots;
  }

  return new Map(
    plan.nodes.map((node) => {
      const root = rootByNode.get(node.id) ?? node.id;
      return [
        node.id,
        factsByRoot.get(root) ?? {
          attempts: 1,
          lastFailureReason: NO_FAILURE_RECORDED,
        },
      ];
    }),
  );
}

/**
 * Renders sealed node recovery facts in deterministic plan order. Replans are
 * folded into the replacement node at the same plan position, preserving the
 * incarnation count and latest failure reason across replaced node ids.
 */
export function renderChainRecoverySummary(
  plan: Plan,
  nodeOutcomes: Readonly<Record<string, NodeOutcome>>,
  entries: readonly ChainEntry[],
): string {
  const recoveryFacts = recoveryFactsByNode(plan, entries);

  return plan.nodes
    .flatMap((node) => {
      const outcome = nodeOutcomes[node.id];
      const facts = recoveryFacts.get(node.id);
      return outcome === undefined || facts === undefined
        ? []
        : [
            summarizeNodeRecovery(
              node.id,
              outcome,
              facts.attempts,
              facts.lastFailureReason,
            ),
          ];
    })
    .join("\n");
}
