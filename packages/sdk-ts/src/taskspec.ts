/**
 * task.yaml parser (WP-005) — YAML form of `TaskSpec` per
 * `docs/spec/task-spec.md`, validation rules per CONTRACTS.md §9.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { TaskSpecSchema } from "./schemas.js";
import type { LLMProvider, ModelChoice, RoutingPolicy, Stage, TaskSpec } from "./types.js";

export const DEFAULT_CADENCE = 3;
export const DEFAULT_SCORING_METHOD = "pointwise" as const;
export const DEFAULT_MAX_STEPS = 100;

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
          .object({ id: z.string().min(1), description: z.string().min(1), check: z.string().min(1).optional() })
          .strict(),
      )
      .min(1),
    budget_usd: z.number().gt(0),
    max_steps: z.number().int().positive().optional(),
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
    pacing: z.object({ mode: z.enum(["auto", "fixed"]) }).strict().optional(),
    notifications: z
      .object({
        on: z.array(z.enum(["escalate", "milestone", "terminal"])),
        slack_webhook_env: z.string().min(1).optional(),
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
    })),
    budgetUsd: raw.budget_usd,
    maxSteps: raw.max_steps ?? DEFAULT_MAX_STEPS,
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
    pacing: raw.pacing,
    notifications: raw.notifications
      ? { on: raw.notifications.on, slackWebhookEnv: raw.notifications.slack_webhook_env }
      : undefined,
  };

  const issues: string[] = [];

  // §9 rule 1 — invariant #2: judge family ≠ executor family unless opted in.
  if (spec.judge.family === spec.executor.family) {
    if (spec.judge.allowSameFamily) {
      warn(
        `[chikory] WARNING: judge family '${spec.judge.family}' equals executor family ` +
          `(allow_same_family: true). Bias mitigation is reduced — the judge shares the ` +
          `executor's blind spots (invariant #2).`,
      );
    } else {
      issues.push(
        `judge.family '${spec.judge.family}' must differ from executor.family ` +
          `'${spec.executor.family}' (invariant #2). Set allow_same_family: true to override.`,
      );
    }
  }

  // §9 rule 2 — sanity (budget/cadence/repo count enforced by schema; writability here).
  if (!spec.repos.some((r) => r.writable)) {
    issues.push("repos: at least one repo must be writable");
  }

  // §9 rule 4 — criteria ids unique (non-emptiness enforced by schema).
  const ids = new Set<string>();
  for (const c of spec.acceptanceCriteria) {
    if (ids.has(c.id)) issues.push(`acceptance_criteria: duplicate id '${c.id}'`);
    ids.add(c.id);
  }

  // §9 rule 3 — every routed provider configured in env; fail fast naming the var.
  const providers = new Set<LLMProvider>();
  for (const stage of Object.keys(spec.routing.stages) as Stage[]) {
    providers.add(spec.routing.stages[stage].provider);
  }
  for (const list of Object.values(spec.routing.failover ?? {})) {
    for (const choice of list ?? []) providers.add(choice.provider);
  }
  providers.add(spec.judge.family);
  for (const provider of providers) {
    const envVar = PROVIDER_ENV_VARS[provider];
    if (!env[envVar]) {
      issues.push(`provider '${provider}' is routed but not configured: missing env var ${envVar}`);
    }
  }

  if (issues.length > 0) throw new TaskSpecValidationError(issues);

  // Final invariant: the parsed result satisfies the frozen contract schema.
  return TaskSpecSchema.parse(spec);
}
