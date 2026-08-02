/**
 * Step-level agent rotation (WP-568) — the activity-side glue between the pure
 * selection core and the runner.
 *
 * The rotation unit is the STEP BOUNDARY, not a retry inside one activity. That
 * is deliberate: the durable step boundary is already the runner's retry unit,
 * already journaled, already idempotent. Recording a wall in the cross-run
 * ledger and letting the NEXT attempt select a peer reuses all of that, where a
 * nested in-activity re-run would need its own crash-safety story and would hide
 * the swap from the journal.
 *
 * Sequence on a wall:
 *   1. the member that hit the wall is cooled in the ledger (cross-run, so every
 *      later step AND every later chain node skips it);
 *   2. the step is handed back as a retriable, `infraFailed` failure — no strike,
 *      because a wall says nothing about the code (the F-210 rule);
 *   3. the next attempt calls `resolveStepAgents`, which now selects the peer.
 *
 * Step 2 only happens when a peer actually exists. With no peer there is nothing
 * to rotate to and the caller keeps its existing park-until-reset behavior —
 * parking is still correct, it is just no longer the FIRST answer.
 */
import { applyAgentPair, currentMember, specMatchesPair } from "../agents/apply.js";
import type { AgentClassRegistry, MemberCooldown } from "../agents/classes.js";
import {
  classifyAgentFailure,
  decideMemberRotation,
  type AgentFailureKind,
} from "../agents/health.js";
import { classMembers } from "../agents/classes.js";
import type { AgentPair, AgentPairSelection } from "../agents/select.js";
import { EndpointLedger } from "../journal/endpoint-ledger.js";
import type { StepRecord, TaskSpec } from "../types.js";
import { selectRunAgentPair, type RunAgentClasses } from "./agent-pair.js";
import { endpointLedgerPath } from "./paths.js";

export interface StepAgentsDeps {
  readonly dataDir: string;
  readonly registry?: AgentClassRegistry;
}

export interface ResolvedStepAgents extends Partial<RunAgentClasses> {
  /** The spec this step should actually run on — rewritten when a peer was selected. */
  readonly spec: TaskSpec;
  readonly pair?: AgentPair;
  /** Set when the selected pair differs from the spec's own — journal it. */
  readonly rotation?: AgentRotation;
  /** Set when no legal pair exists; the caller falls back to parking. */
  readonly parked?: Extract<AgentPairSelection, { action: "park-until-reset" }>;
  /**
   * Set when class resolution itself failed (a registry that does not name the
   * spec's class). The step still runs on the declared agents rather than
   * crashing, but the reason is journaled — a silently un-rotatable long chain
   * is exactly the failure this feature exists to prevent.
   */
  readonly resolutionError?: string;
}

export interface AgentRotation {
  readonly fromExecutor?: string;
  readonly toExecutor: string;
  readonly fromJudge?: string;
  readonly toJudge: string;
  readonly executorAdapter: string;
  readonly executorModel: string;
  readonly judgeModel: string;
}

function describeRotation(
  classes: RunAgentClasses,
  spec: TaskSpec,
  pair: AgentPair,
): AgentRotation {
  return {
    ...(currentMember(classes.executorClass, spec, "executor") === undefined
      ? {}
      : { fromExecutor: currentMember(classes.executorClass, spec, "executor")!.id }),
    toExecutor: pair.executor.id,
    ...(currentMember(classes.judgeClass, spec, "judge") === undefined
      ? {}
      : { fromJudge: currentMember(classes.judgeClass, spec, "judge")!.id }),
    toJudge: pair.judge.id,
    executorAdapter: pair.executor.adapter,
    executorModel: pair.executor.model,
    judgeModel: pair.judge.model,
  };
}

/**
 * Which agents this step runs on, given every wall recorded so far. Never
 * throws: a registry that cannot resolve the spec's class degrades to the
 * declared agents with the reason attached.
 */
export function resolveStepAgents(
  deps: StepAgentsDeps,
  spec: TaskSpec,
  nowMs: number,
): ResolvedStepAgents {
  let cooldowns: readonly MemberCooldown[] = [];
  const ledger = new EndpointLedger(endpointLedgerPath(deps.dataDir));
  try {
    cooldowns = ledger.activeCooldowns(nowMs);
  } finally {
    ledger.close();
  }

  let resolved;
  try {
    resolved = selectRunAgentPair({
      spec,
      cooldowns,
      nowMs,
      ...(deps.registry === undefined ? {} : { registry: deps.registry }),
    });
  } catch (err) {
    // A spec that declared no classes has nothing to rotate to, so a singleton
    // that will not build (a test adapter, an adapter this build does not know)
    // is not a problem worth journaling — it is just the pre-WP-566 world.
    // A spec that DID name a class and cannot resolve it is a real regression
    // and must be visible, because it silently removes the run's ability to heal.
    if (spec.agentClasses === undefined) return { spec };
    return { spec, resolutionError: err instanceof Error ? err.message : String(err) };
  }

  const { selection, ...classes } = resolved;
  if (!classes.declared) {
    // No classes declared: the spec's own agents are the only option. Never park
    // on selection here — there is no peer to wait for, and the legacy
    // park-until-reset path already handles a wall on a single agent.
    return { spec, ...classes };
  }
  if (selection.action !== "selected") {
    return { spec, ...classes, parked: selection };
  }

  const pair = selection.pair;
  if (specMatchesPair(spec, pair)) return { spec, ...classes, pair };

  return {
    spec: applyAgentPair(spec, pair),
    ...classes,
    pair,
    rotation: describeRotation(classes, spec, pair),
  };
}

export interface RecordWallInput {
  readonly deps: StepAgentsDeps;
  readonly spec: TaskSpec;
  readonly classes: RunAgentClasses;
  readonly kind: AgentFailureKind;
  readonly nowMs: number;
  readonly limitRetryAtMs?: number;
  /** Consecutive non-infra failures already seen on this member. */
  readonly consecutiveFailures: number;
  readonly rotationsUsed: number;
}

export interface RecordWallResult {
  readonly cooled?: MemberCooldown;
  /** A peer is available for the next attempt — the caller must NOT park. */
  readonly peerAvailable: boolean;
  /** The member the next attempt will select. Present iff `peerAvailable`. */
  readonly nextExecutorId?: string;
  readonly nextJudgeId?: string;
  readonly stayReason?: string;
}

/**
 * Cool the member this step ran on, then report whether a peer can take over.
 *
 * The peer check runs AFTER the cooldown is written, so it answers the question
 * that actually matters — "is there somewhere to go now that this member is out"
 * — rather than the stale one.
 */
export function recordWallAndCheckPeer(input: RecordWallInput): RecordWallResult {
  const member = currentMember(input.classes.executorClass, input.spec, "executor");
  if (member === undefined) return { peerAvailable: false };

  const decision = decideMemberRotation({
    kind: input.kind,
    memberId: member.id,
    consecutiveFailures: input.consecutiveFailures,
    rotationsUsed: input.rotationsUsed,
    classSize: classMembers(input.classes.executorClass).length,
    nowMs: input.nowMs,
    ...(input.limitRetryAtMs === undefined ? {} : { limitRetryAtMs: input.limitRetryAtMs }),
  });

  if (decision.action !== "rotate") {
    return { peerAvailable: false, stayReason: decision.reason };
  }

  const ledger = new EndpointLedger(endpointLedgerPath(input.deps.dataDir));
  let next;
  try {
    ledger.recordMemberCooldown(decision.cooldown);
    next = selectRunAgentPair({
      spec: input.spec,
      cooldowns: ledger.activeCooldowns(input.nowMs),
      nowMs: input.nowMs,
      ...(input.deps.registry === undefined ? {} : { registry: input.deps.registry }),
    });
  } finally {
    ledger.close();
  }

  if (next.selection.action !== "selected" || next.selection.pair.executor.id === member.id) {
    return { cooled: decision.cooldown, peerAvailable: false };
  }
  return {
    cooled: decision.cooldown,
    peerAvailable: true,
    nextExecutorId: next.selection.pair.executor.id,
    nextJudgeId: next.selection.pair.judge.id,
  };
}

/**
 * WP-574 — the agent attributes for this step's OTel span. `chikory.run.step`
 * carried no provider/model at all, so once a run can rotate mid-flight the
 * trace could not say which agent produced a given diff.
 */
export function stepAgentAttrs(
  spec: TaskSpec,
  agents: ResolvedStepAgents,
): { adapter: string; model?: string; memberId?: string } {
  const member = agents.pair?.executor ?? currentMember(agents.executorClass, spec, "executor");
  return {
    adapter: spec.executor.adapter,
    model: spec.routing.stages.code.model,
    ...(member === undefined ? {} : { memberId: member.id }),
  };
}

/** Classify a failed step's raw stderr. Undefined when there is nothing to classify. */
export function stepFailureKind(record: StepRecord): AgentFailureKind | undefined {
  if (record.status !== "FAILED") return undefined;
  const signal = record.limitSignal;
  if (signal === undefined || signal.kind !== "cli-stderr") return undefined;
  return classifyAgentFailure({ stderr: signal.stderr, exitCode: signal.exitCode });
}

/**
 * Re-shape a walled step as a no-strike retriable failure. The work is not
 * judged as wrong — the agent never got to do it — so `infraFailed` keeps this
 * out of the rule-3 stuck-criterion sequence, exactly as a cap-kill is (F-210).
 */
export function rotationHandoffRecord(
  record: StepRecord,
  cooled: MemberCooldown,
  toMemberId: string,
): StepRecord {
  return {
    ...record,
    infraFailed: true,
    failure: {
      reason:
        `agent '${cooled.memberId}' is unavailable (${cooled.reason}) until ` +
        `${new Date(cooled.cooldownUntilMs).toISOString()}; rotating to '${toMemberId}' ` +
        `for the next attempt. Original: ${record.failure?.reason ?? "no reason recorded"}`,
      retriable: true,
    },
  };
}
