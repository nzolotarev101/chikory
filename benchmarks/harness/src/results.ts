/**
 * Results artifacts (WP-301) — benchmark.md: "results as artifacts"; every
 * published number links to its raw trace. One dir per suite run:
 * `benchmarks/results/<stamp>-<adapter>/` with a per-task JSON + summary.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { AdapterResult } from "./adapter.js";
import type { TaskGradeReport } from "./grade.js";
import type { VerifyBaseGreenResult } from "./base-verify.js";

export interface TaskResult {
  taskId: string;
  source: string;
  class: string;
  adapter: string;
  startedAt: string;
  endedAt: string;
  run: AdapterResult;
  grading: TaskGradeReport;
  baseVerification?: VerifyBaseGreenResult;
}


export interface SuiteSummary {
  suite: string;
  adapter: string;
  startedAt: string;
  endedAt: string;
  tasks: number;
  tasksVerified: number;
  unverifiedTasks: { taskId: string; reason: string }[];
  requirementsTotal: number;
  requirementsSatisfied: number;
  /** Independent satisfaction rate (DevAI I-SR), 0..1. */
  iSr: number;
  /** Dependency-adjusted satisfaction rate (DevAI D-SR), 0..1. */
  dSr: number;
  perTask: {
    taskId: string;
    satisfied: number;
    dependencySatisfied: number;
    total: number;
    exitCode: number | null;
    wallClockMs: number;
    baseVerified: boolean;
  }[];
}

export function isTaskVerified(result: TaskResult): boolean {
  if (result.baseVerification === undefined) {
    return true;
  }
  return result.baseVerification.green === true;
}

export function suiteOutDirName(adapter: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${stamp}-${adapter}`;
}

export function summarize(
  suite: string,
  adapter: string,
  startedAt: string,
  endedAt: string,
  results: TaskResult[],
): SuiteSummary {
  const requirementsTotal = results.reduce((s, r) => s + r.grading.total, 0);
  const requirementsSatisfied = results.reduce((s, r) => s + r.grading.satisfied, 0);

  const verifiedResults = results.filter((r) => isTaskVerified(r));
  const verifiedTotal = verifiedResults.reduce((s, r) => s + r.grading.total, 0);
  const verifiedSatisfied = verifiedResults.reduce((s, r) => s + r.grading.satisfied, 0);
  const verifiedDependencySatisfied = verifiedResults.reduce((s, r) => s + r.grading.dependencySatisfied, 0);

  const unverifiedTasks = results
    .filter((r) => !isTaskVerified(r))
    .map((r) => ({
      taskId: r.taskId,
      reason: r.baseVerification?.reason ?? "Unverified base ref",
    }));

  return {
    suite,
    adapter,
    startedAt,
    endedAt,
    tasks: results.length,
    tasksVerified: verifiedResults.length,
    unverifiedTasks,
    requirementsTotal,
    requirementsSatisfied,
    iSr: verifiedTotal > 0 ? verifiedSatisfied / verifiedTotal : 0,
    dSr: verifiedTotal > 0 ? verifiedDependencySatisfied / verifiedTotal : 0,
    perTask: results.map((r) => ({
      taskId: r.taskId,
      satisfied: r.grading.satisfied,
      dependencySatisfied: r.grading.dependencySatisfied,
      total: r.grading.total,
      exitCode: r.run.exitCode,
      wallClockMs: r.run.wallClockMs,
      baseVerified: isTaskVerified(r),
    })),
  };
}

export function writeTaskResult(outDir: string, result: TaskResult): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${sanitizeFileName(result.taskId)}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

export function writeSuiteSummary(outDir: string, summary: SuiteSummary): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "summary.json");
  writeFileSync(path, JSON.stringify(summary, null, 2));
  return path;
}

/** DevAI task names are filename-safe already; sanitize defensively anyway. */
export function sanitizeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  low: number;
  high: number;
}

export interface ArmComparisonDetail {
  label: string;
  suite: string;
  adapter: string;
  startedAt: string;
  endedAt: string;
  tasks: number;
  tasksVerified: number;
  requirementsTotal: number;
  requirementsSatisfied: number;
  dependencySatisfied: number;
  iSr: number;
  iSrCi: ConfidenceInterval;
  iSrRange: { low: number; high: number };
  dSr: number;
  dSrCi: ConfidenceInterval;
  dSrRange: { low: number; high: number };
  /** The summary.json this arm was read from. */
  reference?: string;
  /**
   * The raw results DIRECTORY the arm's summary came from — benchmark.md's
   * "every published number links to its raw trace". A published comparison is
   * only auditable if each arm names the directory holding its per-task JSON,
   * not just the summary file, so this is derived from `reference` and always
   * present when one was supplied.
   */
  rawResultsDir?: string;
}

export interface SuiteComparisonResult {
  armA: ArmComparisonDetail;
  armB: ArmComparisonDetail;
  arms: ArmComparisonDetail[];
  taskIds: string[];
}

export interface CompareOptions {
  refA?: string;
  refB?: string;
  labelA?: string;
  labelB?: string;
}

/**
 * 95% Wilson score interval for proportion k / n.
 * Uses z = 1.959963984540054 (standard normal 95% confidence).
 */
export function wilsonScoreInterval(k: number, n: number, z = 1.959963984540054): ConfidenceInterval {
  if (n <= 0) return { lower: 0, upper: 0, low: 0, high: 0 };
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const stdErr = Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const halfWidth = (z * stdErr) / denominator;
  const lower = Math.max(0, center - halfWidth);
  const upper = Math.min(1, center + halfWidth);
  return { lower, upper, low: lower, high: upper };
}

function buildArmDetail(
  summary: SuiteSummary,
  label?: string,
  reference?: string,
): ArmComparisonDetail {
  const dependencySatisfied = summary.perTask.reduce((sum, t) => sum + t.dependencySatisfied, 0);
  const iSr = summary.requirementsTotal > 0 ? summary.requirementsSatisfied / summary.requirementsTotal : 0;
  const dSr = summary.requirementsTotal > 0 ? dependencySatisfied / summary.requirementsTotal : 0;

  const iSrCi = wilsonScoreInterval(summary.requirementsSatisfied, summary.requirementsTotal);
  const dSrCi = wilsonScoreInterval(dependencySatisfied, summary.requirementsTotal);

  return {
    label: label ?? summary.adapter,
    suite: summary.suite,
    adapter: summary.adapter,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    tasks: summary.tasks,
    tasksVerified: summary.tasksVerified,
    requirementsTotal: summary.requirementsTotal,
    requirementsSatisfied: summary.requirementsSatisfied,
    dependencySatisfied,
    iSr,
    iSrCi,
    iSrRange: { low: iSrCi.lower, high: iSrCi.upper },
    dSr,
    dSrCi,
    dSrRange: { low: dSrCi.lower, high: dSrCi.upper },
    reference,
    ...(reference !== undefined && reference.length > 0
      ? { rawResultsDir: dirname(resolve(reference)) }
      : {}),
  };
}

/**
 * Compare two 5-task summary.json objects. Requires identical 5-task sets,
 * tasksVerified === tasks === 5, and no unverifiedTasks.
 */
export function compareSummaries(
  summaryA: SuiteSummary,
  summaryB: SuiteSummary,
  options?: CompareOptions | string,
  refBParam?: string,
): SuiteComparisonResult {
  const refA = typeof options === "string" ? options : options?.refA;
  const refB = typeof options === "string" ? refBParam : options?.refB;
  const labelA = typeof options === "object" ? options?.labelA : undefined;
  const labelB = typeof options === "object" ? options?.labelB : undefined;

  if (summaryA.tasks !== 5 || summaryB.tasks !== 5) {
    throw new Error(`Comparison requires exactly 5 tasks per arm, got ${summaryA.tasks} and ${summaryB.tasks}`);
  }
  if (summaryA.tasksVerified !== 5 || summaryB.tasksVerified !== 5) {
    throw new Error(`Comparison requires tasksVerified === 5, got ${summaryA.tasksVerified} and ${summaryB.tasksVerified}`);
  }
  if (summaryA.unverifiedTasks.length > 0 || summaryB.unverifiedTasks.length > 0) {
    throw new Error("Comparison requires no unverified tasks");
  }

  const tasksA = summaryA.perTask.map((t) => t.taskId);
  const tasksB = summaryB.perTask.map((t) => t.taskId);

  const setA = new Set(tasksA);
  const setB = new Set(tasksB);

  if (tasksA.length !== 5 || setA.size !== 5 || tasksB.length !== 5 || setB.size !== 5) {
    throw new Error("Comparison requires identical five-task sets between arms");
  }

  if (tasksA.some((id) => !setB.has(id))) {
    throw new Error("Comparison requires identical five-task sets between arms");
  }

  const armA = buildArmDetail(summaryA, labelA, refA);
  const armB = buildArmDetail(summaryB, labelB, refB);

  const taskIds = [...tasksA];

  return { armA, armB, arms: [armA, armB], taskIds };
}
