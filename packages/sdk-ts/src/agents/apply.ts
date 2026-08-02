/**
 * Applying a selected agent pair to a spec (WP-568/WP-569) — pure.
 *
 * One function owns the rewrite so the executor and the judge can never drift
 * apart. Rewriting only `spec.executor` would leave `routing.stages.code`
 * pointing at the walled model and the judge stage pinned to a member the
 * scheduler just rotated away from — a rotation that changes the agent but not
 * its routing is cosmetic.
 */
import type { RoutingPolicy, TaskSpec } from "../types.js";
import type { AgentClass, AgentMember } from "./classes.js";
import { classMembers } from "./classes.js";
import type { AgentPair } from "./select.js";

/** Does this spec currently run on this exact pair? Used to skip no-op rotations. */
export function specMatchesPair(spec: TaskSpec, pair: AgentPair): boolean {
  return (
    spec.executor.adapter === pair.executor.adapter &&
    spec.routing.stages.code.model === pair.executor.model &&
    spec.judge.family === pair.judge.transport &&
    (spec.judge.model ?? spec.routing.stages.judge.model) === pair.judge.model
  );
}

/**
 * Rewrite a spec to run on `pair`. Every stage the pair owns moves together:
 * the executor's adapter/family/model, and the judge member's transport+model
 * across the three router-served stages (plan, review, judge).
 *
 * `routing.failover` is deliberately dropped: the agent class IS the failover
 * list now, and a stale per-stage failover entry could route a rotated judge
 * straight back into the vendor it just left.
 */
export function applyAgentPair(spec: TaskSpec, pair: AgentPair): TaskSpec {
  const judgeChoice = { provider: pair.judge.transport, model: pair.judge.model };
  const routing: RoutingPolicy = {
    stages: {
      plan: judgeChoice,
      code: { provider: pair.executor.family, model: pair.executor.model },
      review: judgeChoice,
      judge: judgeChoice,
    },
  };

  return {
    ...spec,
    executor: { adapter: pair.executor.adapter, family: pair.executor.family },
    judge: { ...spec.judge, family: pair.judge.transport, model: pair.judge.model },
    routing,
  };
}

/**
 * The member a spec is currently running on, if it is one of the class's.
 * Matching is on adapter+model rather than id because the spec carries the
 * SELECTION, not the id — ids live only in the registry.
 */
export function currentMember(
  agentClass: AgentClass | undefined,
  spec: TaskSpec,
  role: "executor" | "judge",
): AgentMember | undefined {
  if (agentClass === undefined) return undefined;
  return classMembers(agentClass).find((member) => {
    if (member.role !== role) return false;
    if (member.role === "executor") {
      return (
        member.adapter === spec.executor.adapter &&
        member.model === spec.routing.stages.code.model
      );
    }
    return (
      member.transport === spec.judge.family &&
      member.model === (spec.judge.model ?? spec.routing.stages.judge.model)
    );
  });
}
