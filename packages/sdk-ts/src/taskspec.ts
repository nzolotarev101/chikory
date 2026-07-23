/**
 * task.yaml parser (WP-005) — YAML form of `TaskSpec` per
 * `docs/spec/task-spec.md`, validation rules per CONTRACTS.md §9.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { endpointCapabilityFamily, resolveEndpointCapabilities } from "./endpoint-capability.js";
import { TaskSpecSchema } from "./schemas.js";
import type { LLMProvider, ModelChoice, RoutingPolicy, Stage, TaskSpec } from "./types.js";

export const DEFAULT_CADENCE = 3;
export const DEFAULT_SCORING_METHOD = "pointwise" as const;
export const DEFAULT_MAX_STEPS = 100;
/**
 * Ceiling for `step_limits.max_seconds`: the executeStep activity's Temporal
 * startToCloseTimeout is 15 minutes (agent-loop.ts) — a step bound at/above it
 * would be killed by Temporal mid-flight instead of reaped by the runner.
 * 840s leaves the kill-grace + artifact-capture headroom inside the window.
 */
export const MAX_STEP_MAX_SECONDS = 840;

/** Env var that must be present for a provider to count as configured. */
export const PROVIDER_ENV_VARS: Record<LLMProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compat": "OPENAI_COMPAT_BASE_URL",
};

/** Default model per provider/stage when routing is omitted. */
const DEFAULT_MODELS: Record<LLMProvider, Record<"light" | "heavy", string>> = {
  anthropic: { light: "claude-haiku-4-5-20251001", heavy: "claude-fable-5" },
  openai: { light: "gpt-5.2-mini", heavy: "gpt-5.2" },
  gemini: { light: "gemini-2.5-flash", heavy: "gemini-2.5-pro" },
  "openai-compat": { light: "default", heavy: "default" },
};

/** Different-family judge auto-picked when routing is omitted (invariant #2). */
const DEFAULT_JUDGE_FAMILY: Record<LLMProvider, LLMProvider> = {
  anthropic: "gemini",
  openai: "anthropic",
  gemini: "anthropic",
  "openai-compat": "anthropic",
};

/** Fixed-default routing for an executor family (task-spec.md "Rules of note"). */
export function defaultPolicy(executorFamily: LLMProvider, judgeFamily?: LLMProvider): RoutingPolicy {
  const judge = judgeFamily ?? DEFAULT_JUDGE_FAMILY[executorFamily];
  const choice = (provider: LLMProvider, tier: "light" | "heavy"): ModelChoice => ({
    provider,
    model: DEFAULT_MODELS[provider][tier],
  });
  return {
    stages: {
      plan: choice(executorFamily, "light"),
      code: choice(executorFamily, "heavy"),
      review: choice(executorFamily, "heavy"),
      judge: choice(judge, "heavy"),
    },
  };
}

export interface MissingProviderEnv {
  provider: LLMProvider;
  envVar: string;
}

/**
 * Providers a spec routes through (stages + failover + judge family) whose
 * required env var (§9.3) is absent. Shared by parse-time validation and the
 * F-99 resume precondition — a resume from a shell that never exported the
 * judge/router env must fail fast, not loop silently in activity retries.
 */
export function missingProviderEnv(
  spec: TaskSpec,
  env: Record<string, string | undefined>,
): MissingProviderEnv[] {
  const providers = new Set<LLMProvider>();
  for (const stage of Object.keys(spec.routing.stages) as Stage[]) {
    providers.add(spec.routing.stages[stage].provider);
  }
  for (const list of Object.values(spec.routing.failover ?? {})) {
    for (const choice of list ?? []) providers.add(choice.provider);
  }
  providers.add(spec.judge.family);
  const missing: MissingProviderEnv[] = [];
  for (const provider of providers) {
    const envVar = PROVIDER_ENV_VARS[provider];
    if (!env[envVar]) missing.push({ provider, envVar });
  }
  return missing;
}

export class TaskSpecValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid task spec:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "TaskSpecValidationError";
  }
}

// ── raw YAML shape (snake_case) ─────────────────────────────────────────────

const ModelChoiceYaml = z
  .object({ provider: z.enum(["anthropic", "openai", "gemini", "openai-compat"]), model: z.string().min(1) })
  .strict();

const StagesYaml = z
  .object({ plan: ModelChoiceYaml, code: ModelChoiceYaml, review: ModelChoiceYaml, judge: ModelChoiceYaml })
  .strict();

const RawTaskSpecYaml = z
  .object({
    name: z.string().min(1),
    goal: z.string().min(1),
    repos: z
      .array(
        z
          .object({ url: z.string().min(1), ref: z.string().min(1).optional(), writable: z.boolean() })
          .strict(),
      )
      .min(1),
    acceptance_criteria: z
      .array(
        z
          .object({
            id: z.string().min(1),
            description: z.string().min(1),
            check: z.string().min(1).optional(),
            repo: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1),
    budget_usd: z.number().gt(0),
    max_steps: z.number().int().positive().optional(),
    min_nodes: z.number().int().positive().optional(),
    step_limits: z
      .object({
        max_seconds: z.number().positive().optional(),
        max_turns: z.number().int().positive().optional(),
        max_cost_usd: z.number().gt(0).optional(),
      })
      .strict()
      .optional(),
    executor: z
      .object({ adapter: z.string().min(1), family: z.enum(["anthropic", "openai", "gemini", "openai-compat"]) })
      .strict(),
    judge: z
      .object({
        family: z.enum(["anthropic", "openai", "gemini", "openai-compat"]),
        model: z.string().min(1).optional(),
        cadence: z.number().int().min(1).optional(),
        allow_same_family: z.boolean().optional(),
        scoring_method: z.enum(["pointwise", "pairwise"]).optional(),
        max_cost_share: z.number().gt(0).lte(1).optional(),
        rubric_packs: z.array(z.string()).optional(),
      })
      .strict(),
    routing: z
      .object({
        stages: StagesYaml,
        failover: z
          .object({
            plan: z.array(ModelChoiceYaml).optional(),
            code: z.array(ModelChoiceYaml).optional(),
            review: z.array(ModelChoiceYaml).optional(),
            judge: z.array(ModelChoiceYaml).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    pacing: z
      .object({
        mode: z.enum(["auto", "fixed"]),
        auto_calibrate: z.boolean().optional(),
        autoCalibrate: z.boolean().optional(),
      })
      .strict()
      .optional(),
    unattended: z
      .object({
        escalation: z.enum(["await_approval", "seal_resumable_failed"]),
      })
      .strict()
      .optional(),
    soak: z
      .object({
        sleep_ms: z.number().int().positive(),
        max_reentries: z.number().int().positive(),
        max_total_sleep_ms: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    bounded_work_unit: z
      .object({
        min_durable_steps: z.number().int().positive(),
        directive: z.string().min(1).optional(),
        work_chunks: z
          .array(
            z
              .object({
                name: z.string().min(1),
                directive: z.string().min(1),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    notifications: z
      .object({
        on: z.array(z.enum(["escalate", "milestone", "terminal"])),
        slack_webhook_env: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    horizon: z
      .object({
        deadline: z.string().datetime().optional(),
        expected_duration_ms: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface ParseTaskSpecOptions {
  /** Environment for provider-key resolution (rule §9.3). Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Sink for the same-family loud warning (invariant #2). Default: console.warn. */
  warn?: (message: string) => void;
}

export function parseTaskSpec(yamlText: string, opts: ParseTaskSpecOptions = {}): TaskSpec {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));

  let rawValue: unknown;
  try {
    rawValue = parseYaml(yamlText);
  } catch (err) {
    throw new TaskSpecValidationError([`YAML parse error: ${(err as Error).message}`]);
  }

  const parsed = RawTaskSpecYaml.safeParse(rawValue);
  if (!parsed.success) {
    throw new TaskSpecValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const raw = parsed.data;

  const spec: TaskSpec = {
    name: raw.name,
    goal: raw.goal,
    repos: raw.repos.map((r) => ({ url: r.url, ref: r.ref, writable: r.writable })),
    acceptanceCriteria: raw.acceptance_criteria.map((c) => ({
      id: c.id,
      description: c.description,
      check: c.check,
      repo: c.repo,
    })),
    budgetUsd: raw.budget_usd,
    maxSteps: raw.max_steps ?? DEFAULT_MAX_STEPS,
    ...(raw.min_nodes !== undefined ? { minNodes: raw.min_nodes } : {}),
    ...(raw.step_limits !== undefined
      ? {
          stepLimits: {
            ...(raw.step_limits.max_seconds !== undefined
              ? { maxSeconds: raw.step_limits.max_seconds }
              : {}),
            ...(raw.step_limits.max_turns !== undefined
              ? { maxTurns: raw.step_limits.max_turns }
              : {}),
            ...(raw.step_limits.max_cost_usd !== undefined
              ? { maxCostUsd: raw.step_limits.max_cost_usd }
              : {}),
          },
        }
      : {}),
    executor: { adapter: raw.executor.adapter, family: raw.executor.family },
    judge: {
      family: raw.judge.family,
      model: raw.judge.model,
      cadence: raw.judge.cadence ?? DEFAULT_CADENCE,
      allowSameFamily: raw.judge.allow_same_family,
      scoringMethod: raw.judge.scoring_method ?? DEFAULT_SCORING_METHOD,
      maxCostShare: raw.judge.max_cost_share,
      rubricPacks: raw.judge.rubric_packs,
    },
    routing: raw.routing ?? defaultPolicy(raw.executor.family, raw.judge.family),
    pacing: raw.pacing
      ? {
          mode: raw.pacing.mode,
          autoCalibrate: raw.pacing.autoCalibrate ?? raw.pacing.auto_calibrate,
        }
      : undefined,
    unattended: raw.unattended,
    soak: raw.soak
      ? {
          sleepMs: raw.soak.sleep_ms,
          maxReentries: raw.soak.max_reentries,
          maxTotalSleepMs: raw.soak.max_total_sleep_ms,
        }
      : undefined,
    boundedWorkUnit: raw.bounded_work_unit
      ? {
          minDurableSteps: raw.bounded_work_unit.min_durable_steps,
          directive: raw.bounded_work_unit.directive,
          workChunks: raw.bounded_work_unit.work_chunks?.map((chunk) => ({
            name: chunk.name,
            directive: chunk.directive,
          })),
        }
      : undefined,
    notifications: raw.notifications
      ? { on: raw.notifications.on, slackWebhookEnv: raw.notifications.slack_webhook_env }
      : undefined,
    ...(raw.horizon
      ? {
          horizon: {
            ...(raw.horizon.deadline !== undefined
              ? { deadlineMs: Date.parse(raw.horizon.deadline) }
              : {}),
            ...(raw.horizon.expected_duration_ms !== undefined
              ? { expectedDurationMs: raw.horizon.expected_duration_ms }
              : {}),
          },
        }
      : {}),
  };

  const issues: string[] = [];
  const capabilities = resolveEndpointCapabilities({ routing: spec.routing, executor: spec.executor });
  const executorFamily = endpointCapabilityFamily(capabilities.code[0]) ?? spec.executor.family;
  const judgeSameFamilyCapability = capabilities.judge.find(
    (capability) => endpointCapabilityFamily(capability) === executorFamily,
  );
  const judgeFamily = endpointCapabilityFamily(judgeSameFamilyCapability ?? capabilities.judge[0]) ?? spec.judge.family;

  // §9 rule 1 — invariant #2: judge family ≠ executor family unless opted in.
  if (judgeSameFamilyCapability) {
    if (spec.judge.allowSameFamily) {
      warn(
        `[chikory] WARNING: judge family '${judgeFamily}' equals executor family ` +
          `(allow_same_family: true). Bias mitigation is reduced — the judge shares the ` +
          `executor's blind spots (invariant #2).`,
      );
    } else {
      issues.push(
        `judge.family '${judgeFamily}' must differ from executor.family ` +
          `'${executorFamily}' (invariant #2). Set allow_same_family: true to override.`,
      );
    }
  }

  // §9 rule 2 — sanity (budget/cadence/repo count enforced by schema; writability here).
  if (!spec.repos.some((r) => r.writable)) {
    issues.push("repos: at least one repo must be writable");
  }
  if (spec.stepLimits?.maxSeconds !== undefined && spec.stepLimits.maxSeconds > MAX_STEP_MAX_SECONDS) {
    issues.push(
      `step_limits.max_seconds: ${spec.stepLimits.maxSeconds} exceeds ${MAX_STEP_MAX_SECONDS} ` +
        `(the executeStep activity's Temporal startToCloseTimeout would kill the step first)`,
    );
  }

  // §9 rule 4 — criteria ids unique (non-emptiness enforced by schema).
  const ids = new Set<string>();
  for (const c of spec.acceptanceCriteria) {
    if (ids.has(c.id)) issues.push(`acceptance_criteria: duplicate id '${c.id}'`);
    ids.add(c.id);
  }

  // §9 rule 3 — every routed provider configured in env; fail fast naming the var.
  for (const { provider, envVar } of missingProviderEnv(spec, env)) {
    issues.push(`provider '${provider}' is routed but not configured: missing env var ${envVar}`);
  }

  const codeCapability = capabilities.code[0];
  if (codeCapability?.kind === "executor") {
    if (codeCapability.adapter === "claude-code" && spec.executor.family !== codeCapability.family) {
      issues.push("executor.adapter 'claude-code' must use executor.family 'anthropic'");
    }
    if (codeCapability.adapter === "codex" && spec.executor.family !== codeCapability.family) {
      issues.push("executor.adapter 'codex' must use executor.family 'openai'");
    }
  }

  if (issues.length > 0) throw new TaskSpecValidationError(issues);

  // Final invariant: the parsed result satisfies the frozen contract schema.
  return TaskSpecSchema.parse(spec);
}
