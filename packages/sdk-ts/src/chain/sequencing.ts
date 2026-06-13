import type { Plan, PlanNode } from "../types.js";

export function readyNodes(plan: Plan, completed: string[]): PlanNode[] {
  const done = new Set(completed);
  return plan.nodes.filter(
    (node) => !done.has(node.id) && node.dependsOn.every((dep) => done.has(dep)),
  );
}
