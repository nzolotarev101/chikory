/**
 * Benchmark task model (WP-301) — the unified shape every suite source loads
 * into (DevAI originals via `devai.ts`, authored YAML via `parseAuthoredTask`),
 * and the authored-task format **v1 freeze** for `benchmarks/tasks/`
 * (tasks/README.md: format "frozen when the harness lands in WP-301").
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export type TaskClass = "greenfield" | "brownfield";
export type TaskSource = "devai" | "authored";
export type TaskStatus = "draft" | "pinned" | "blocked";

/**
 * How a requirement is graded: `check` = a command exiting 0/1 in the task
 * workspace (authored tasks); `judge` = natural-language criteria graded by
 * an LLM judge (DevAI originals — Agent-as-a-Judge is the benchmark's unit).
 */
export type RequirementGrading =
  | { kind: "check"; command: string }
  | { kind: "judge"; criteria: string };

export type RequirementKind = "guard" | "discriminator" | "scored";

export interface BenchmarkRequirement {
  id: string;
  description: string;
  /** Requirement ids that must be satisfied for dependency-adjusted scoring (DevAI D-SR). */
  prerequisites: string[];
  grading: RequirementGrading;
  category?: string;
  kind?: RequirementKind;
}

/** DevAI soft preferences — reported, never part of the satisfaction rate. */
export interface BenchmarkPreference {
  id: string;
  description: string;
}

export interface BenchmarkTask {
  id: string;
  source: TaskSource;
  class: TaskClass;
  /**
   * Only `pinned` tasks are runnable. `draft` may carry TBD refs/checks;
   * `blocked` is a fully-pinned task the current harness environment cannot
   * grade reproducibly (e.g. the target repo needs a node engine the devbox
   * toolchain does not provide) — skipped, never scored, until unblocked.
   */
  status: TaskStatus;
  /** Required when `status === "blocked"`: why the env cannot grade it (F-163). */
  blockedReason?: string;
  goal: string;
  requirements: BenchmarkRequirement[];
  preferences: BenchmarkPreference[];
  repo?: { url: string; ref: string; fixRef?: string; fixPatch?: string };
  baseVerificationCommand?: string;
  /**
   * F-254 (WP-586): exact Node version this task is graded on, overriding the
   * repo's own `engines` range.
   *
   * A `pinned` task pins its repo to a 40-hex sha for reproducibility, then
   * hands the runtime back to an open range like `">=24"` — so the harness
   * picks whatever the newest locally-installed Node happens to be, and the
   * same sha scores differently on two machines or two months apart.
   * `brownfield-002` is the live proof: at ref `a061eaa1`, node **24.14.1**
   * runs 1128/1128 green, while node **24.15.0** SIGABRTs vitest 4.1.9 before
   * a single test executes. p3-rung-4 drew 24.15.0, recorded
   * `baseVerified: false`, and dropped the task out of the arm.
   */
  nodeVersion?: string;
  horizon?: string;
  metricsNotes?: string;
  tags: string[];
  /** DevAI runner hints (is_training_needed etc.) — used for filtering only. */
  flags: Record<string, boolean>;
}

export function isRunnable(task: BenchmarkTask): boolean {
  return task.status === "pinned";
}

// ── authored YAML (format v1 — the tasks/README.md v0 draft, frozen) ───────

const AuthoredRequirementYaml = z
  .object({
    id: z.string().regex(/^R\d+$/, "requirement id must be R<n>"),
    description: z.string().min(1),
    check: z.string().min(1),
    prerequisites: z.array(z.string()).optional(),
    kind: z.enum(["guard", "discriminator", "scored"]).optional(),
  })
  .strict();

const AuthoredTaskYaml = z
  .object({
    id: z.string().regex(/^(brownfield|greenfield)-\d{3}$/, "id must be <class>-<nnn>"),
    class: z.enum(["brownfield", "greenfield"]),
    status: z.enum(["draft", "pinned", "blocked"]),
    blocked_reason: z.string().min(1).optional(),
    repo: z
      .object({
        url: z.string().min(1),
        ref: z.string().min(1),
        fix_ref: z.string().min(1).optional(),
        fix_patch: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    base_verification_command: z.string().min(1).optional(),
    /** F-254: exact `x.y.z` Node the task is graded on; overrides repo `engines`. */
    node_version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "node_version must be an exact x.y.z version")
      .optional(),
    horizon: z.union([z.string(), z.number()]).optional(),
    goal: z.string().min(1),
    requirements: z.array(AuthoredRequirementYaml).min(1),
    metrics_notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export class TaskFormatError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid benchmark task ${file}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "TaskFormatError";
  }
}

const SHA_RE = /^[0-9a-f]{40}$/;

/** Detect a prerequisite cycle via DFS; returns the first cycle member found. */
function findCycle(reqs: BenchmarkRequirement[]): string | undefined {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): string | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "visiting") return id;
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.prerequisites ?? []) {
      const hit = visit(dep);
      if (hit) return hit;
    }
    state.set(id, "done");
    return undefined;
  };
  for (const r of reqs) {
    const hit = visit(r.id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Validate + load an authored task YAML. Returns issues instead of throwing
 * so `bench validate` can report every problem in a corpus in one pass.
 */
export function validateAuthoredTask(
  yamlText: string,
  _file: string,
): { task?: BenchmarkTask; issues: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return { issues: [`YAML parse error: ${(err as Error).message}`] };
  }
  const parsed = AuthoredTaskYaml.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const t = parsed.data;
  const issues: string[] = [];

  if (!t.id.startsWith(`${t.class}-`)) {
    issues.push(`id '${t.id}' does not match class '${t.class}'`);
  }

  const seen = new Set<string>();
  for (const r of t.requirements) {
    if (seen.has(r.id)) issues.push(`duplicate requirement id ${r.id}`);
    seen.add(r.id);
  }
  for (const r of t.requirements) {
    for (const dep of r.prerequisites ?? []) {
      if (!seen.has(dep)) issues.push(`${r.id}: unknown prerequisite '${dep}'`);
      if (dep === r.id) issues.push(`${r.id}: self-prerequisite`);
    }
  }

  if (t.class === "brownfield" && !t.repo) {
    issues.push("brownfield task requires repo.url + repo.ref");
  }
  if (t.repo && t.repo.fix_ref !== undefined && t.repo.fix_patch !== undefined) {
    issues.push("task cannot declare both repo.fix_ref and repo.fix_patch");
  }

  // Pinned/blocked = reproducible-quality: real repo ref, every check executable
  // (no TBD). A `blocked` task is a pinned task the env can't grade yet, so it
  // must stay just as concrete — plus carry the reason it's shelved.
  if (t.status === "pinned" || t.status === "blocked") {
    if (t.repo) {
      if (t.repo.url === "TBD") issues.push(`${t.status} task has repo.url TBD`);
      if (!SHA_RE.test(t.repo.ref)) {
        issues.push(`${t.status} task repo.ref must be a full 40-hex commit sha, got '${t.repo.ref}'`);
      }
      if (t.repo.fix_ref !== undefined && !SHA_RE.test(t.repo.fix_ref)) {
        issues.push(`${t.status} task repo.fix_ref must be a full 40-hex commit sha, got '${t.repo.fix_ref}'`);
      }
    }
    for (const r of t.requirements) {
      if (r.check.trim() === "TBD") issues.push(`${t.status} task has ${r.id} check TBD`);
    }
  }
  if (t.status === "blocked" && !t.blocked_reason) {
    issues.push("blocked task requires blocked_reason (why the env cannot grade it)");
  }
  if (t.status !== "blocked" && t.blocked_reason) {
    issues.push("blocked_reason is only valid on a blocked task");
  }

  const allGuards = t.requirements.every((r) => r.kind === "guard");
  if (allGuards) {
    issues.push(`task ${t.id} has no scored requirements (every requirement is declared a guard)`);
  }

  const requirements: BenchmarkRequirement[] = t.requirements.map((r) => ({
    id: r.id,
    description: r.description,
    prerequisites: r.prerequisites ?? [],
    grading: { kind: "check", command: r.check },
    kind: r.kind ?? "discriminator",
  }));

  const cycleMember = findCycle(requirements);
  if (cycleMember) issues.push(`prerequisite cycle involving ${cycleMember}`);

  if (issues.length > 0) return { issues };

  const task: BenchmarkTask = {
    id: t.id,
    source: "authored",
    class: t.class,
    status: t.status,
    ...(t.blocked_reason ? { blockedReason: t.blocked_reason } : {}),
    goal: t.goal,
    requirements,
    preferences: [],
    repo:
      t.repo && t.repo.url !== "TBD"
        ? {
            url: t.repo.url,
            ref: t.repo.ref,
            ...(t.repo.fix_ref ? { fixRef: t.repo.fix_ref } : {}),
            ...(t.repo.fix_patch ? { fixPatch: t.repo.fix_patch } : {}),
          }
        : undefined,
    baseVerificationCommand: t.base_verification_command,
    nodeVersion: t.node_version,
    horizon: t.horizon === undefined ? undefined : String(t.horizon),
    metricsNotes: t.metrics_notes,
    tags: t.tags ?? [],
    flags: {},
  };
  return { task, issues: [] };
}

/** Throwing form for callers that need exactly one valid task. */
export function parseAuthoredTask(yamlText: string, file: string): BenchmarkTask {
  const { task, issues } = validateAuthoredTask(yamlText, file);
  if (!task) throw new TaskFormatError(file, issues);
  return task;
}
