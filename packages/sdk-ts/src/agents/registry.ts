/**
 * Agent class registry loader (WP-566).
 *
 * The repo-level `agent-classes.yaml` is the operator-editable source of truth;
 * `DEFAULT_AGENT_CLASSES` is the shipped fallback so the SDK works with no file
 * present. A class declared in the file REPLACES the default of the same name
 * outright — merging member-by-member would let a stale default silently leak a
 * member back into a class the operator deliberately trimmed.
 *
 * Validation is deliberately strict and runs at load, not at rotation time. A
 * member whose model the CLI rejects, or whose price row is missing, is a
 * defect that must surface at $0 before a chain starts — not six hours in, when
 * the rotation it breaks is the only thing standing between the run and a
 * four-hour park. Two rules exist purely for that reason:
 *
 *   * every member model must resolve in BOTH `PRICE_TABLE` and
 *     `CONTEXT_WINDOW_TABLE` — `lookupPricing` returns undefined for an unknown
 *     model, which `computeCostUsd` turns into $0, so an unpriced member burns
 *     real subscription capacity while the CG-2 budget gate reads zero;
 *   * member ids are unique across the WHOLE registry, because cooldowns are
 *     keyed by member id in the cross-run endpoint ledger.
 *
 * Binary-level liveness (does this CLI actually accept this model id, is it
 * logged in) cannot be checked here — that is the launcher's preflight probe.
 */
import { readFileSync } from "node:fs";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { lookupPricing } from "../pricing.js";
import { lookupContextWindow } from "../runner/context-window.js";
import type { LLMProvider } from "../types.js";
import {
  DEFAULT_AGENT_CLASSES,
  classMembers,
  inferBackendFromModel,
  type AgentBackend,
  type AgentClass,
  type AgentClassRegistry,
  type AgentMember,
  type AgentRole,
} from "./classes.js";

export const DEFAULT_AGENT_CLASSES_PATH = "agent-classes.yaml";

/**
 * Env override for the registry path (F-253/WP-585).
 *
 * The default path is resolved against CWD, which is fine for `chikory run` in
 * the repo root but not for a caller that runs it somewhere else: the benchmark
 * harness runs `chikory run` with CWD set to the TASK WORKSPACE, where no
 * `agent-classes.yaml` exists — so the registry silently fell back to the
 * shipped defaults and the arm got a class list nobody chose. `scripts/probe-
 * agent-classes.mjs` already reads this variable; this makes the SDK agree.
 */
export const AGENT_CLASSES_PATH_ENV = "CHIKORY_AGENT_CLASSES";

export class AgentClassValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid agent class registry:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "AgentClassValidationError";
  }
}

const BackendYaml = z.enum(["anthropic", "openai", "gemini", "open"]);
const ProviderYaml = z.enum(["anthropic", "openai", "gemini", "openai-compat"]);
const AdapterYaml = z.enum(["claude-code", "codex", "gemini-cli", "native"]);

const ExecutorMemberYaml = z
  .object({
    id: z.string().min(1),
    adapter: AdapterYaml,
    family: ProviderYaml,
    backend: BackendYaml,
    model: z.string().min(1),
  })
  .strict();

const JudgeMemberYaml = z
  .object({
    id: z.string().min(1),
    transport: ProviderYaml,
    backend: BackendYaml,
    model: z.string().min(1),
  })
  .strict();

const MemberYaml = z.union([ExecutorMemberYaml, JudgeMemberYaml]);

const ClassYaml = z
  .object({
    role: z.enum(["executor", "judge"]),
    primary: MemberYaml,
    adjacent: z.array(MemberYaml).default([]),
  })
  .strict();

const RegistryYaml = z
  .object({
    version: z.literal(1),
    classes: z.record(z.string().min(1), ClassYaml),
  })
  .strict();

/** The three CLI adapters each speak exactly one vendor; `native` is router-delegated. */
const ADAPTER_BACKEND: Readonly<
  Record<string, { family: LLMProvider; backend: AgentBackend } | undefined>
> = {
  "claude-code": { family: "anthropic", backend: "anthropic" },
  codex: { family: "openai", backend: "openai" },
  "gemini-cli": { family: "gemini", backend: "gemini" },
};

function hasContextWindow(model: string): boolean {
  const sentinel = -1;
  return lookupContextWindow(model, sentinel) !== sentinel;
}

function materializeMember(
  raw: z.infer<typeof MemberYaml>,
  role: AgentRole,
): AgentMember {
  if (role === "executor") {
    const executor = raw as z.infer<typeof ExecutorMemberYaml>;
    return {
      id: executor.id,
      role: "executor",
      adapter: executor.adapter,
      family: executor.family,
      backend: executor.backend,
      model: executor.model,
    };
  }
  const judge = raw as z.infer<typeof JudgeMemberYaml>;
  return {
    id: judge.id,
    role: "judge",
    transport: judge.transport,
    backend: judge.backend,
    model: judge.model,
  };
}

function validateMember(
  member: AgentMember,
  classId: string,
  role: AgentRole,
  issues: string[],
): void {
  const where = `class '${classId}' member '${member.id}'`;

  if (member.role !== role) {
    issues.push(`${where}: role '${member.role}' does not match the class role '${role}'`);
  }

  if (member.role === "executor") {
    const expected = ADAPTER_BACKEND[member.adapter];
    if (expected !== undefined) {
      if (member.family !== expected.family) {
        issues.push(
          `${where}: adapter '${member.adapter}' must use family '${expected.family}', got '${member.family}'`,
        );
      }
      if (member.backend !== expected.backend) {
        issues.push(
          `${where}: adapter '${member.adapter}' must use backend '${expected.backend}', got '${member.backend}'`,
        );
      }
    }
  }

  // A declared backend that contradicts the model name is the invariant-2 hole
  // in disguise: the keyless judge proxy routes by MODEL NAME, so a member
  // declaring `backend: openai` while naming `claude-opus-5` would be paired
  // against an Anthropic executor and then quietly run on Anthropic anyway.
  const inferred = inferBackendFromModel(member.model);
  if (inferred !== "open" && inferred !== member.backend) {
    issues.push(
      `${where}: declares backend '${member.backend}' but model '${member.model}' is a ` +
        `'${inferred}' model — the judge proxy dispatches on the model name, so the declared ` +
        `backend would be a lie and invariant #2 would be enforced against the wrong vendor`,
    );
  }

  if (lookupPricing(member.model) === undefined) {
    issues.push(
      `${where}: model '${member.model}' has no PRICE_TABLE row — an unpriced member costs $0 ` +
        `and blinds the budget gate (add it to src/pricing.ts)`,
    );
  }
  if (!hasContextWindow(member.model)) {
    issues.push(
      `${where}: model '${member.model}' has no CONTEXT_WINDOW_TABLE row ` +
        `(add it to src/runner/context-window.ts)`,
    );
  }
}

function validateRegistry(registry: AgentClassRegistry): void {
  const issues: string[] = [];
  const seenMemberIds = new Map<string, string>();

  for (const [classId, agentClass] of Object.entries(registry.classes)) {
    if (agentClass.id !== classId) {
      issues.push(`class '${classId}': declared id '${agentClass.id}' does not match its key`);
    }

    const members = classMembers(agentClass);
    const localIds = new Set<string>();
    for (const member of members) {
      if (localIds.has(member.id)) {
        issues.push(
          `class '${classId}': member id '${member.id}' appears twice — a primary repeated in ` +
            `the adjacent group would be retried immediately after it was cooled`,
        );
      }
      localIds.add(member.id);

      const owner = seenMemberIds.get(member.id);
      if (owner !== undefined && owner !== classId) {
        issues.push(
          `member id '${member.id}' is declared in both '${owner}' and '${classId}' — ids must be ` +
            `globally unique because cooldowns are keyed by member id in the endpoint ledger`,
        );
      }
      seenMemberIds.set(member.id, classId);

      validateMember(member, classId, agentClass.role, issues);
    }
  }

  if (issues.length > 0) throw new AgentClassValidationError(issues);
}

/** Parse + validate registry YAML. Declared classes REPLACE same-named defaults. */
export function parseAgentClassRegistry(
  text: string,
  base: AgentClassRegistry = DEFAULT_AGENT_CLASSES,
): AgentClassRegistry {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new AgentClassValidationError([
      `YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }

  const parsed = RegistryYaml.safeParse(raw);
  if (!parsed.success) {
    throw new AgentClassValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  const classes: Record<string, AgentClass> = { ...base.classes };
  for (const [classId, rawClass] of Object.entries(parsed.data.classes)) {
    classes[classId] = {
      id: classId,
      role: rawClass.role,
      primary: materializeMember(rawClass.primary, rawClass.role),
      adjacent: rawClass.adjacent.map((member) => materializeMember(member, rawClass.role)),
    };
  }

  const registry: AgentClassRegistry = { version: 1, classes };
  validateRegistry(registry);
  return registry;
}

export interface LoadAgentClassRegistryOptions {
  /** Registry file path; default `agent-classes.yaml` relative to cwd. */
  readonly path?: string;
  /** Injected file text (tests) — bypasses the filesystem entirely. */
  readonly text?: string;
  readonly base?: AgentClassRegistry;
}

/**
 * Load the registry. A missing file is NOT an error — the shipped defaults are
 * a complete, valid registry. A present-but-broken file always is.
 */
export function loadAgentClassRegistry(
  opts: LoadAgentClassRegistryOptions = {},
): AgentClassRegistry {
  const base = opts.base ?? DEFAULT_AGENT_CLASSES;
  if (opts.text !== undefined) return parseAgentClassRegistry(opts.text, base);

  const envPath = process.env[AGENT_CLASSES_PATH_ENV];
  const path = opts.path ?? (envPath !== undefined && envPath !== "" ? envPath : DEFAULT_AGENT_CLASSES_PATH);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // An EXPLICITLY named registry that cannot be read is an error, not a
    // fallback: silently substituting the shipped defaults would hand the run a
    // different class list — and a different vendor set — than the operator
    // asked for. Only the unnamed default may fall back.
    if (opts.path !== undefined || envPath) {
      throw new AgentClassValidationError([`cannot read agent class registry at '${path}'`]);
    }
    validateRegistry(base);
    return base;
  }
  return parseAgentClassRegistry(text, base);
}

/** Resolve a class by name, asserting its role. Throws with the available names. */
export function resolveAgentClass(
  registry: AgentClassRegistry,
  classId: string,
  role: AgentRole,
): AgentClass {
  const agentClass = registry.classes[classId];
  if (agentClass === undefined) {
    const available = Object.keys(registry.classes).sort().join(", ") || "none";
    throw new AgentClassValidationError([
      `no agent class named '${classId}' (declared: ${available})`,
    ]);
  }
  if (agentClass.role !== role) {
    throw new AgentClassValidationError([
      `agent class '${classId}' has role '${agentClass.role}', but a '${role}' class is required here`,
    ]);
  }
  return agentClass;
}

/**
 * Synthesize a single-member class from a legacy inline declaration, so the
 * selection path is identical whether a spec names a class or the pre-class
 * `{adapter, family}` / `{provider, model}` pair. Backwards compatibility is
 * not a special case in the scheduler — it is a class of size one.
 */
export function singletonExecutorClass(input: {
  readonly adapter: string;
  readonly family: LLMProvider;
  readonly model: string;
}): AgentClass {
  const known = AdapterYaml.safeParse(input.adapter);
  const id = `inline-executor:${input.adapter}`;
  return {
    id,
    role: "executor",
    primary: {
      id,
      role: "executor",
      adapter: input.adapter,
      family: input.family,
      // An adapter with no fixed vendor — `native` (router-delegated) or one a
      // caller registered itself — gets `open`, which never collides under
      // invariant #2. This must NOT throw: a legacy spec has no peers to rotate
      // to anyway, and throwing here would fail every step of every run using a
      // caller-supplied adapter.
      backend: (known.success ? ADAPTER_BACKEND[known.data]?.backend : undefined) ?? "open",
      model: input.model,
    },
    adjacent: [],
  };
}

export function singletonJudgeClass(input: {
  readonly transport: LLMProvider;
  readonly backend: AgentBackend;
  readonly model: string;
}): AgentClass {
  return {
    id: `inline-judge:${input.transport}`,
    role: "judge",
    primary: {
      id: `inline-judge:${input.transport}`,
      role: "judge",
      transport: input.transport,
      backend: input.backend,
      model: input.model,
    },
    adjacent: [],
  };
}
