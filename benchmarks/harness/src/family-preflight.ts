/**
 * Bench launch family preflight (WP-536, F-165/F-170).
 *
 * The standing directive (CLAUDE.md, F-162): **Gemini executes, Codex judges,
 * never Claude.** Twice in one day a suite burned real Anthropic budget because
 * the resolved executor was `claude-code` — the `gemini-cli` default flip had
 * landed 7 minutes after launch, so nothing in the launch path *asserted* the
 * family before spending (F-165, ~$7.7 across two occurrences). F-170 is the
 * sibling on the routing side: a spec routed a `gpt-` model at the `gemini-cli`
 * executor (the `code` stage drives the executor), a foreign-family mis-route.
 *
 * These pure helpers resolve the effective families the same way
 * `buildChikorySpec` does, then flag any directive violation, so the harness can
 * echo the resolved arm and refuse to launch (override
 * `CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE=1`). Siblings of the F-119/120/121 launch
 * guards.
 */

const GEMINI = "gemini";
/** Judge families that satisfy "Codex judges" (and are not Claude). */
const CODEX_JUDGE_FAMILIES = new Set(["openai", "openai-compat"]);
/** Model prefixes that do NOT belong to a given executor family. */
const FOREIGN_MODEL_PREFIXES: Record<string, readonly string[]> = {
  gemini: ["gpt-", "claude-", "o1-", "o3-", "o4-"],
};

export interface ResolvedBenchFamilies {
  executor: { adapter: string; family: string };
  judge: { family: string };
  /**
   * `routing.stages.code.model` if the resolved spec carries one — the code
   * stage drives the EXECUTOR, so its model must match the executor family.
   */
  codeModel?: string;
}

export interface BenchFamilyOptions {
  executor?: { adapter: string; family: string };
  judge?: { family: string };
  /** Raw routing block passed through to the spec (snake_case YAML shape). */
  routing?: unknown;
}

/**
 * Resolve the effective {executor, judge, code-routing-model} exactly as
 * `buildChikorySpec` does — including the `OPENAI_COMPAT_BASE_URL` codex-proxy
 * override that rewrites the judge to `openai-compat` and every routing stage to
 * `openai-compat/default`. Kept in lockstep with `adapter.ts:buildChikorySpec`.
 */
export function resolveBenchFamilies(
  opts: BenchFamilyOptions,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBenchFamilies {
  const executor = opts.executor ?? { adapter: "gemini-cli", family: "gemini" };
  let judge = opts.judge ?? { family: executor.family === "gemini" ? "anthropic" : "gemini" };
  let routing = opts.routing;

  if (env.OPENAI_COMPAT_BASE_URL) {
    judge = { family: "openai-compat" };
    routing = {
      stages: {
        plan: { provider: "openai-compat", model: "default" },
        code: { provider: "openai-compat", model: "default" },
        review: { provider: "openai-compat", model: "default" },
        judge: { provider: "openai-compat", model: "default" },
      },
    };
  }

  return { executor, judge, codeModel: extractCodeModel(routing) };
}

function extractCodeModel(routing: unknown): string | undefined {
  if (!routing || typeof routing !== "object") return undefined;
  const stages = (routing as { stages?: unknown }).stages;
  if (!stages || typeof stages !== "object") return undefined;
  const code = (stages as { code?: unknown }).code;
  if (!code || typeof code !== "object") return undefined;
  const model = (code as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

export interface FamilyViolation {
  code: string;
  message: string;
}

/**
 * Flag every way the resolved families violate the standing directive: the
 * executor must be gemini, the judge must be a Codex (openai/openai-compat)
 * family that is both structurally different from the executor AND never Claude,
 * and the code-stage routing model must belong to the executor family.
 */
export function checkBenchFamilyDirective(r: ResolvedBenchFamilies): FamilyViolation[] {
  const violations: FamilyViolation[] = [];

  if (r.executor.family !== GEMINI) {
    violations.push({
      code: "executor-not-gemini",
      message: `executor family is '${r.executor.family}' (adapter '${r.executor.adapter}') — the directive requires gemini (Gemini executes)`,
    });
  }

  if (r.judge.family === r.executor.family) {
    violations.push({
      code: "judge-not-diverse",
      message: `judge family '${r.judge.family}' matches the executor — the judge must be a structurally different family (bias mitigation)`,
    });
  } else if (!CODEX_JUDGE_FAMILIES.has(r.judge.family)) {
    violations.push({
      code: "judge-not-codex",
      message: `judge family is '${r.judge.family}' — the directive requires codex (openai / openai-compat), never anthropic/Claude`,
    });
  }

  if (
    r.codeModel &&
    r.codeModel !== "default" &&
    isForeignExecutorModel(r.codeModel, r.executor.family)
  ) {
    violations.push({
      code: "code-routing-family-mismatch",
      message: `routing.stages.code.model '${r.codeModel}' is not a ${r.executor.family}-family model (F-170) — the code stage drives the executor`,
    });
  }

  return violations;
}

function isForeignExecutorModel(model: string, execFamily: string): boolean {
  const prefixes = FOREIGN_MODEL_PREFIXES[execFamily] ?? [];
  return prefixes.some((prefix) => model.startsWith(prefix));
}

/** One-line human echo of the resolved arm for the preflight banner. */
export function formatResolvedFamilies(r: ResolvedBenchFamilies): string {
  const code = r.codeModel ? ` · code-model ${r.codeModel}` : "";
  return `executor ${r.executor.adapter}(${r.executor.family}) · judge ${r.judge.family}${code}`;
}
