/**
 * Requirement grading (WP-301) — per-requirement satisfaction, the DevAI unit.
 *
 * Two rates, per the DevAI methodology:
 * - **I-SR** (independent): requirement graded on its own.
 * - **D-SR** (dependency-adjusted): a requirement counts only if it AND its
 *   transitive prerequisites are satisfied.
 */
import { spawn } from "node:child_process";

import { DEFAULT_CHECK_TIMEOUT_MS } from "@chikory/sdk";

import type { BenchmarkRequirement, BenchmarkTask } from "./task.js";

export interface RequirementGrade {
  requirementId: string;
  satisfied: boolean;
  /** Set when the requirement could not actually be graded (counts unsatisfied). */
  skipped?: "no-judge-configured";
  detail: string;
}

export interface JudgeVerdict {
  satisfied: boolean;
  rationale: string;
}

/** Judge hook: grades one natural-language criterion against a workspace. */
export type JudgeFn = (input: {
  criteria: string;
  workspaceDir: string;
}) => Promise<JudgeVerdict>;

export interface GradeContext {
  workspaceDir: string;
  timeoutMs?: number;
  judge?: JudgeFn;
}

export interface TaskGradeReport {
  grades: RequirementGrade[];
  total: number;
  satisfied: number;
  /** D-SR numerator: satisfied with all transitive prerequisites satisfied. */
  dependencySatisfied: number;
}

function runCheck(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const cap = (chunk: Buffer) => {
      if (output.length < 8_192) output += chunk.toString();
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: String(err) });
    });
  });
}

async function gradeOne(
  req: BenchmarkRequirement,
  ctx: GradeContext,
): Promise<RequirementGrade> {
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  if (req.grading.kind === "check") {
    const { code, output } = await runCheck(req.grading.command, ctx.workspaceDir, timeoutMs);
    return {
      requirementId: req.id,
      satisfied: code === 0,
      detail: `check exit ${code}${output ? `: ${output.slice(0, 500)}` : ""}`,
    };
  }
  if (!ctx.judge) {
    return {
      requirementId: req.id,
      satisfied: false,
      skipped: "no-judge-configured",
      detail: "judge-graded requirement but no judge configured (counts unsatisfied)",
    };
  }
  const verdict = await ctx.judge({ criteria: req.grading.criteria, workspaceDir: ctx.workspaceDir });
  return { requirementId: req.id, satisfied: verdict.satisfied, detail: verdict.rationale };
}

/** Transitively: this requirement and every prerequisite satisfied. */
function dependencySatisfiedIds(task: BenchmarkTask, gradeById: Map<string, boolean>): Set<string> {
  const byId = new Map(task.requirements.map((r) => [r.id, r]));
  const memo = new Map<string, boolean>();
  const ok = (id: string): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    memo.set(id, false); // cycle guard — loaders reject cycles, but stay total
    const req = byId.get(id);
    const result =
      req !== undefined &&
      gradeById.get(id) === true &&
      req.prerequisites.every((dep) => ok(dep));
    memo.set(id, result);
    return result;
  };
  return new Set(task.requirements.filter((r) => ok(r.id)).map((r) => r.id));
}

export async function gradeTask(task: BenchmarkTask, ctx: GradeContext): Promise<TaskGradeReport> {
  const grades: RequirementGrade[] = [];
  for (const req of task.requirements) {
    grades.push(await gradeOne(req, ctx));
  }
  const gradeById = new Map(grades.map((g) => [g.requirementId, g.satisfied]));
  const depOk = dependencySatisfiedIds(task, gradeById);
  return {
    grades,
    total: grades.length,
    satisfied: grades.filter((g) => g.satisfied).length,
    dependencySatisfied: depOk.size,
  };
}
