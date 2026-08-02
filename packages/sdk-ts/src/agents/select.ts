/**
 * Agent pair selection (WP-566) — pure.
 *
 * Selects a COMPATIBLE PAIR, never two independent members. That is the whole
 * point: when the executor rotates into the judge's vendor, the judge must
 * rotate in lockstep or invariant #2 (judge family ≠ executor family) silently
 * breaks and the judge starts grading its own family's work.
 *
 * Preference order is the declared order — each class's primary first, then its
 * adjacent group as written. A declared default is always tried before a peer.
 *
 * Parking is the last resort, not the first response: the caller parks only when
 * NO legal pair exists, and then until the EARLIEST cooldown expiry across both
 * classes, rather than until the one endpoint that happened to report a wall.
 */
import {
  classMembers,
  isExecutorMember,
  isJudgeMember,
  type AgentClass,
  type AgentRole,
  type ExecutorAgentMember,
  type JudgeAgentMember,
  type MemberCooldown,
} from "./classes.js";

export type MemberBlockReason = "cooldown" | "same-backend-as-executor" | "wrong-role";

export interface BlockedMember {
  readonly memberId: string;
  readonly role: AgentRole;
  readonly reason: MemberBlockReason;
  readonly cooldownUntilMs?: number;
}

export interface AgentPair {
  readonly executor: ExecutorAgentMember;
  readonly judge: JudgeAgentMember;
}

export type AgentPairSelection =
  | {
      readonly action: "selected";
      readonly pair: AgentPair;
      readonly blocked: readonly BlockedMember[];
    }
  | {
      readonly action: "park-until-reset";
      readonly reason: "no-legal-pair";
      readonly retryAtMs?: number;
      readonly blocked: readonly BlockedMember[];
    };

export interface SelectAgentPairInput {
  readonly executorClass: AgentClass;
  readonly judgeClass: AgentClass;
  readonly cooldowns: readonly MemberCooldown[];
  readonly nowMs: number;
  /** The explicit invariant-2 opt-in (`judge.allow_same_family`). */
  readonly allowSameFamily?: boolean;
}

/** Blocked entries are deduped on (memberId, reason) — the judge list is walked once per executor candidate. */
class BlockedSet {
  private readonly seen = new Map<string, BlockedMember>();

  add(entry: BlockedMember): void {
    const key = `${entry.memberId}:${entry.reason}`;
    if (!this.seen.has(key)) this.seen.set(key, entry);
  }

  list(): readonly BlockedMember[] {
    return [...this.seen.values()];
  }
}

function activeCooldownMap(
  cooldowns: readonly MemberCooldown[],
  nowMs: number,
): ReadonlyMap<string, MemberCooldown> {
  const active = new Map<string, MemberCooldown>();
  for (const cooldown of cooldowns) {
    if (cooldown.cooldownUntilMs <= nowMs) continue;
    // Keep the LATEST expiry when a member was cooled more than once.
    const existing = active.get(cooldown.memberId);
    if (existing === undefined || cooldown.cooldownUntilMs > existing.cooldownUntilMs) {
      active.set(cooldown.memberId, cooldown);
    }
  }
  return active;
}

export function selectAgentPair(input: SelectAgentPairInput): AgentPairSelection {
  const active = activeCooldownMap(input.cooldowns, input.nowMs);
  const blocked = new BlockedSet();
  const cooledExpiries: number[] = [];

  const executorCandidates = classMembers(input.executorClass);
  const judgeCandidates = classMembers(input.judgeClass);

  for (const executor of executorCandidates) {
    if (!isExecutorMember(executor)) {
      blocked.add({ memberId: executor.id, role: executor.role, reason: "wrong-role" });
      continue;
    }
    const executorCooldown = active.get(executor.id);
    if (executorCooldown !== undefined) {
      cooledExpiries.push(executorCooldown.cooldownUntilMs);
      blocked.add({
        memberId: executor.id,
        role: "executor",
        reason: "cooldown",
        cooldownUntilMs: executorCooldown.cooldownUntilMs,
      });
      continue;
    }

    for (const judge of judgeCandidates) {
      if (!isJudgeMember(judge)) {
        blocked.add({ memberId: judge.id, role: judge.role, reason: "wrong-role" });
        continue;
      }
      const judgeCooldown = active.get(judge.id);
      if (judgeCooldown !== undefined) {
        cooledExpiries.push(judgeCooldown.cooldownUntilMs);
        blocked.add({
          memberId: judge.id,
          role: "judge",
          reason: "cooldown",
          cooldownUntilMs: judgeCooldown.cooldownUntilMs,
        });
        continue;
      }
      if (judge.backend === executor.backend && input.allowSameFamily !== true) {
        blocked.add({
          memberId: judge.id,
          role: "judge",
          reason: "same-backend-as-executor",
        });
        continue;
      }

      return { action: "selected", pair: { executor, judge }, blocked: blocked.list() };
    }
  }

  const retryAtMs = cooledExpiries.length > 0 ? Math.min(...cooledExpiries) : undefined;
  return {
    action: "park-until-reset",
    reason: "no-legal-pair",
    ...(retryAtMs === undefined ? {} : { retryAtMs }),
    blocked: blocked.list(),
  };
}
