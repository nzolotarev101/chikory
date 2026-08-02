/**
 * Runtime agent-pair resolution (WP-568) — the one place that turns a spec plus
 * live cooldowns into "which agents does this step actually run on".
 *
 * Activity-side by construction: it reads the cross-run endpoint ledger, so it
 * must never be called from a workflow. The workflow sees the outcome only as a
 * memoized activity result, exactly like every other quota state (WP-310).
 *
 * A spec with no `agentClasses` resolves to singleton classes built from its own
 * declared executor/judge, so the selection path is identical for legacy specs —
 * they simply have nowhere to rotate to, which is the pre-WP-566 behavior.
 */
import {
  classMembers,
  inferBackendFromModel,
  type AgentBackend,
  type AgentClass,
  type AgentClassRegistry,
  type JudgeAgentMember,
  type MemberCooldown,
} from "../agents/classes.js";
import {
  loadAgentClassRegistry,
  resolveAgentClass,
  singletonExecutorClass,
  singletonJudgeClass,
} from "../agents/registry.js";
import { selectAgentPair, type AgentPairSelection } from "../agents/select.js";
import type { LLMProvider, ModelChoice, TaskSpec } from "../types.js";

export interface RunAgentClasses {
  readonly executorClass: AgentClass;
  readonly judgeClass: AgentClass;
  /** True when the spec named real classes — i.e. rotation is possible at all. */
  readonly declared: boolean;
}

/**
 * The classes this spec may rotate within. Falls back to singletons so callers
 * never branch on "does this spec use classes".
 */
export function runAgentClasses(
  spec: TaskSpec,
  registry: AgentClassRegistry = loadAgentClassRegistry(),
): RunAgentClasses {
  const executorClassId = spec.agentClasses?.executor;
  const judgeClassId = spec.agentClasses?.judge;

  const executorClass =
    executorClassId !== undefined
      ? resolveAgentClass(registry, executorClassId, "executor")
      : singletonExecutorClass({
          adapter: spec.executor.adapter,
          family: spec.executor.family,
          model: spec.routing.stages.code.model,
        });

  const judgeModel = spec.judge.model ?? spec.routing.stages.judge.model;
  const judgeClass =
    judgeClassId !== undefined
      ? resolveAgentClass(registry, judgeClassId, "judge")
      : singletonJudgeClass({
          transport: spec.judge.family,
          // A legacy inline judge declares only its TRANSPORT. `openai-compat`
          // is not a vendor, so read the real one off the model name — the same
          // thing the judge proxy does when it picks which CLI to spawn.
          backend: inferBackendFromModel(judgeModel),
          model: judgeModel,
        });

  return {
    executorClass,
    judgeClass,
    declared: executorClassId !== undefined || judgeClassId !== undefined,
  };
}

/**
 * The judge stage's in-router failover list, drawn from the judge class (WP-569).
 *
 * Two filters, both load-bearing:
 *   * SAME TRANSPORT only. `createRouter` eagerly builds one provider adapter per
 *     routed choice and throws on a missing key, so admitting a native-transport
 *     member here would demand an API key for a keyless run. Same-transport
 *     members are free: the proxy picks the backing CLI from the model name.
 *   * DIFFERENT VENDOR from the executor. A failover choice that shares the
 *     executor's backend would quietly re-break invariant #2 the moment the
 *     router used it — the one place a diversity check never runs.
 */
export function judgeFailoverChoices(
  judgeClass: AgentClass,
  currentModel: string,
  transport: LLMProvider,
  executorBackend: AgentBackend,
): ModelChoice[] {
  return classMembers(judgeClass)
    .filter(
      (member): member is JudgeAgentMember =>
        member.role === "judge" &&
        member.transport === transport &&
        member.model !== currentModel &&
        member.backend !== executorBackend,
    )
    .map((member) => ({ provider: member.transport, model: member.model }));
}

export interface SelectRunAgentPairInput {
  readonly spec: TaskSpec;
  readonly cooldowns: readonly MemberCooldown[];
  readonly nowMs: number;
  readonly registry?: AgentClassRegistry;
}

export interface RunAgentPairSelection extends RunAgentClasses {
  readonly selection: AgentPairSelection;
}

export function selectRunAgentPair(input: SelectRunAgentPairInput): RunAgentPairSelection {
  const classes = runAgentClasses(input.spec, input.registry);
  const selection = selectAgentPair({
    executorClass: classes.executorClass,
    judgeClass: classes.judgeClass,
    cooldowns: input.cooldowns,
    nowMs: input.nowMs,
    ...(input.spec.judge.allowSameFamily === undefined
      ? {}
      : { allowSameFamily: input.spec.judge.allowSameFamily }),
  });
  return { ...classes, selection };
}
