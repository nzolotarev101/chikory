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
  /** Members a wall may rotate into (WP-585); empty when no classes declared. */
  classMembers?: ResolvedClassMember[];
}

export interface BenchFamilyOptions {
  executor?: { adapter: string; family: string };
  judge?: { family: string };
  /** Raw routing block passed through to the spec (snake_case YAML shape). */
  routing?: unknown;
  /** Parsed `agent-classes.yaml` (WP-585) — the members a wall may rotate INTO. */
  agentClasses?: unknown;
}

/** One declared class member, reduced to what the directive check cares about. */
export interface ResolvedClassMember {
  classId: string;
  memberId: string;
  /** True vendor. A TRANSPORT is not a vendor — `backend` outranks `family`. */
  backend: string;
  model?: string;
}

/**
 * Every member a rotation could land on, primary and adjacent alike.
 *
 * F-253 (WP-585) hands the bench arm declared classes so a quota wall rotates
 * instead of parking — which means the members are now part of the ARM, and the
 * directive has to be checked against all of them, not just the primary pair.
 * The repo's own `agent-classes.yaml` lists `sonnet-5` and `opus-5` as
 * fallbacks; wiring it into a benchmark unchecked would let a Gemini wall
 * silently rotate the arm onto Claude — spending real Anthropic budget and
 * publishing an I-SR measured on a mixed executor. That is exactly the failure
 * (F-165) this preflight exists to prevent, arriving through a new door.
 */
export function resolveClassMembers(agentClasses: unknown): ResolvedClassMember[] {
  if (!agentClasses || typeof agentClasses !== "object") return [];
  const classes = (agentClasses as { classes?: unknown }).classes;
  if (!classes || typeof classes !== "object") return [];

  const members: ResolvedClassMember[] = [];
  for (const [classId, declared] of Object.entries(classes as Record<string, unknown>)) {
    if (!declared || typeof declared !== "object") continue;
    const block = declared as { primary?: unknown; adjacent?: unknown };
    const candidates = [block.primary, ...(Array.isArray(block.adjacent) ? block.adjacent : [])];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const m = candidate as { id?: unknown; backend?: unknown; family?: unknown; model?: unknown };
      members.push({
        classId,
        memberId: typeof m.id === "string" ? m.id : "<unnamed>",
        backend:
          typeof m.backend === "string"
            ? m.backend
            : typeof m.family === "string"
              ? m.family
              : "unknown",
        ...(typeof m.model === "string" ? { model: m.model } : {}),
      });
    }
  }
  return members;
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

  return {
    executor,
    judge,
    codeModel: extractCodeModel(routing),
    classMembers: resolveClassMembers(opts.agentClasses),
  };
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

  // WP-585: a declared fallback is part of the arm. `never Claude` has to hold
  // for every member a wall could rotate into, not just the primary pair — and
  // `backend` is the authority, because every keyless judge reaches its model
  // over the `openai-compat` TRANSPORT and a transport is not a vendor.
  for (const member of r.classMembers ?? []) {
    if (member.backend === "anthropic") {
      violations.push({
        code: "class-member-anthropic",
        message:
          `agent class '${member.classId}' declares member '${member.memberId}' ` +
          `(backend anthropic${member.model ? `, model ${member.model}` : ""}) — a wall could ` +
          "rotate this arm onto Claude, which the directive forbids and which would publish " +
          "an I-SR measured on a mixed executor",
      });
    }
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
