import type { Plan } from "../types.js";

export function hasDependencyCycle(plan: Plan): boolean {
  const ids = new Set(plan.nodes.map((n) => n.id));
  const indegree = new Map<string, number>();
  for (const node of plan.nodes) {
    indegree.set(node.id, node.dependsOn.filter((d) => ids.has(d)).length);
  }
  const ready = plan.nodes
    .filter((n) => indegree.get(n.id) === 0)
    .map((n) => n.id);
  let processed = 0;
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    processed += 1;
    for (const node of plan.nodes) {
      if (node.dependsOn.includes(id)) {
        const next = (indegree.get(node.id) ?? 0) - 1;
        indegree.set(node.id, next);
        if (next === 0) ready.push(node.id);
      }
    }
  }
  return processed < plan.nodes.length;
}
