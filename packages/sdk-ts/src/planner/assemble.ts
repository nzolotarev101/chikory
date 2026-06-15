import type { Plan, PlanInput, PlanNode } from "../types.js";

/** Non-deterministic plan fields injected by the WP-219 S2 ADR-005 D1 wrapper. */
export interface BuildPlanOptions {
  id: string;
  createdAt: string;
}

function collectNodeIds(nodes: PlanNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      throw new Error(`duplicate plan node id: ${node.id}`);
    }
    ids.add(node.id);
  }
  return ids;
}

/** Pure WP-219 S2 ADR-005 D1 assembly of a validated planner reply into a Plan. */
export function buildPlan(
  reply: { nodes: PlanNode[] },
  input: PlanInput,
  opts: BuildPlanOptions,
): Plan {
  if (reply.nodes.length === 0) {
    throw new Error("planner returned no nodes");
  }

  const nodeIds = collectNodeIds(reply.nodes);
  for (const node of reply.nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!nodeIds.has(dependencyId)) {
        throw new Error(`plan node ${node.id} depends on unknown node ${dependencyId}`);
      }
    }
  }

  return {
    id: opts.id,
    goal: input.goal,
    nodes: reply.nodes,
    createdAt: opts.createdAt,
  };
}
