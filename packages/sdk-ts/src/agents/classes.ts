/**
 * Agent classes (WP-566) — a named group of interchangeable agents, declared as
 * one PRIMARY plus an ordered ADJACENT group.
 *
 * Why this exists: a chain run outlives any single subscription window
 * (dogfood-122 ran 18h 47m). Before this, one quota wall on the single declared
 * executor parked the whole chain on a durable timer — a live run slept
 * `sleepMs 14768000` (4h 6m) waiting out a Gemini wall while two other
 * locally-authenticated CLI agents sat idle. A class lets the scheduler rotate
 * to a peer instead of sleeping.
 *
 * The `backend` field is load-bearing and is NOT a duplicate of `family`.
 * `family`/`transport` are plumbing (which env var, which router adapter);
 * `backend` is the TRUE vendor behind the endpoint. Every keyless judge rides
 * the `openai-compat` transport through `scripts/cli-judge-proxy.mjs`, so a
 * transport-keyed diversity check reads executor `codex` + judge `gpt-5.6-sol`
 * as two different families while both are in fact GPT-5.6. Invariant #2
 * (judge family ≠ executor family) is therefore enforced on `backend`.
 *
 * This module is plain data + pure helpers: no env reads, no IO, no adapter
 * construction. The YAML loader lives in `registry.ts`, selection in
 * `select.ts`.
 */
import type { ExecutorAdapterName } from "../endpoint-capability.js";
import type { LLMProvider } from "../types.js";

/** The two roles a class can serve. `judge` also covers the plan/review stages. */
export type AgentRole = "executor" | "judge";

/**
 * The real vendor behind an endpoint, independent of how we reach it.
 * `open` covers self-hosted/open-weight models, which share no vendor quota
 * with the three frontier families and so never collide under invariant #2.
 */
export type AgentBackend = "anthropic" | "openai" | "gemini" | "open";

/** Why a member is on cooldown — also the reason recorded on a rotation. */
export type RotationTrigger = "limit" | "auth" | "crash" | "predicted-limit";

/** An executor member is a CLI agent: an adapter name plus the model to pass it. */
export interface ExecutorAgentMember {
  readonly id: string;
  readonly role: "executor";
  /**
   * Mirrors `TaskSpec.executor.adapter`, which is deliberately an open string:
   * tests register their own adapters ("scripted") in the registry passed to
   * the worker. DECLARED class members are still restricted to the known
   * adapters by the zod enum in `registry.ts` — strictness belongs at the
   * operator-authored boundary, not on a synthesized single-member class.
   */
  readonly adapter: ExecutorAdapterName | (string & {});
  /** LLMProvider plumbing — drives `spec.executor.family` and the env scrub. */
  readonly family: LLMProvider;
  /** True vendor. Invariant #2 keys on this, never on `family`. */
  readonly backend: AgentBackend;
  readonly model: string;
}

/** A judge member is reached through the router, usually the keyless proxy shim. */
export interface JudgeAgentMember {
  readonly id: string;
  readonly role: "judge";
  /** Router transport — `openai-compat` for the keyless CLI-backed judge. */
  readonly transport: LLMProvider;
  /** True vendor behind the transport. Invariant #2 keys on this. */
  readonly backend: AgentBackend;
  readonly model: string;
}

export type AgentMember = ExecutorAgentMember | JudgeAgentMember;

export interface AgentClass {
  readonly id: string;
  readonly role: AgentRole;
  /** Always tried first — the declared default the operator armed the run with. */
  readonly primary: AgentMember;
  /** Tried in declared order once the primary is unavailable. */
  readonly adjacent: readonly AgentMember[];
}

export interface AgentClassRegistry {
  readonly version: 1;
  readonly classes: Readonly<Record<string, AgentClass>>;
}

/** A member held out of selection until `cooldownUntilMs`. */
export interface MemberCooldown {
  readonly memberId: string;
  readonly reason: RotationTrigger;
  readonly observedAtMs: number;
  readonly cooldownUntilMs: number;
}

/**
 * Infer the real vendor from a model id.
 *
 * This mirrors how `scripts/cli-judge-proxy.mjs` actually dispatches a request:
 * the keyless judge reaches every vendor over one `openai-compat` transport, and
 * the proxy picks the backing CLI by looking at the model NAME. So for that path
 * the model name is not a hint about the vendor — it IS the vendor. Used to
 * cross-check a declared `backend` and to give a legacy inline judge a truthful
 * one. Returns `open` when nothing matches, which never collides under
 * invariant #2 (an unknown vendor is not evidence of a shared vendor).
 */
export function inferBackendFromModel(model: string): AgentBackend {
  const lower = model.toLowerCase();
  if (/\b(gpt|codex)|^o[134]\b/.test(lower)) return "openai";
  if (/claude|sonnet|opus|haiku|fable/.test(lower)) return "anthropic";
  if (/gemini/.test(lower)) return "gemini";
  return "open";
}

/** Primary first, then the adjacent group in declared order. This IS the preference order. */
export function classMembers(agentClass: AgentClass): readonly AgentMember[] {
  return [agentClass.primary, ...agentClass.adjacent];
}

export function isExecutorMember(member: AgentMember): member is ExecutorAgentMember {
  return member.role === "executor";
}

export function isJudgeMember(member: AgentMember): member is JudgeAgentMember {
  return member.role === "judge";
}

export function findMember(agentClass: AgentClass, memberId: string): AgentMember | undefined {
  return classMembers(agentClass).find((member) => member.id === memberId);
}

/**
 * Default registry, shipped as code so the SDK works with no `agent-classes.yaml`
 * present. The repo-level file overrides and extends these (see `registry.ts`).
 *
 * The primary pair encodes the standing arming directive — Gemini executes,
 * Codex judges — which is unchanged by this feature: a declared primary is
 * always tried before any adjacent member. What changes is that the adjacent
 * group exists at all, and that it may name any vendor.
 *
 * Model ids are the ones the real CLIs accept. `gemini-3.7-flash-high` is
 * verbatim from `agy models`; note that `agy` offers only 4.6-era Claude
 * (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`), which is why the Claude
 * members route through the `claude` CLI and the proxy's `claude` backend
 * rather than through Antigravity.
 */
export const DEFAULT_AGENT_CLASSES: AgentClassRegistry = {
  version: 1,
  classes: {
    "executor-default": {
      id: "executor-default",
      role: "executor",
      primary: {
        id: "gemini-3-7-flash",
        role: "executor",
        adapter: "gemini-cli",
        family: "gemini",
        backend: "gemini",
        model: "gemini-3.7-flash-high",
      },
      adjacent: [
        {
          id: "gpt-5-6-terra",
          role: "executor",
          adapter: "codex",
          family: "openai",
          backend: "openai",
          model: "gpt-5.6-terra",
        },
        {
          id: "sonnet-5",
          role: "executor",
          adapter: "claude-code",
          family: "anthropic",
          backend: "anthropic",
          model: "claude-sonnet-5",
        },
      ],
    },
    "judge-default": {
      id: "judge-default",
      role: "judge",
      primary: {
        id: "gpt-5-6-sol",
        role: "judge",
        transport: "openai-compat",
        backend: "openai",
        model: "gpt-5.6-sol xhigh",
      },
      adjacent: [
        {
          id: "opus-5",
          role: "judge",
          transport: "openai-compat",
          backend: "anthropic",
          model: "claude-opus-5",
        },
        {
          id: "gemini-3-1-pro",
          role: "judge",
          transport: "openai-compat",
          backend: "gemini",
          model: "gemini-3.1-pro-high",
        },
      ],
    },
  },
};
