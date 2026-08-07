/**
 * Results artifacts (WP-301) — benchmark.md: "results as artifacts"; every
 * published number links to its raw trace. One dir per suite run:
 * `benchmarks/results/<stamp>-<adapter>/` with a per-task JSON + summary.json.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

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
  /** Every task's requirements, including base-unverified ones. NOT the I-SR denominator. */
  requirementsTotal: number;
  requirementsSatisfied: number;
  /**
   * F-252 (WP-584): the k and n `iSr`/`dSr` are actually computed from —
   * base-verified tasks only. These exist so a consumer can rebuild the rate
   * and its confidence interval without re-deriving a denominator of its own.
   * `buildArmDetail` used to recompute from `requirementsTotal`, publishing
   * 17/19 = 0.8947 for the same run whose summary said 14/15 = 0.9333.
   *
   * Optional because `summary.json` is a persisted artifact: files written
   * before these fields existed are still read by `compare`.
   */
  requirementsVerifiedTotal?: number;
  requirementsVerifiedSatisfied?: number;
  dependencyVerifiedSatisfied?: number;
  /** Independent satisfaction rate (DevAI I-SR), 0..1. Base-verified tasks only. */
  iSr: number;
  /** Dependency-adjusted satisfaction rate (DevAI D-SR), 0..1. Base-verified tasks only. */
  dSr: number;
  perTask: {
    taskId: string;
    satisfied: number;
    dependencySatisfied: number;
    total: number;
    exitCode: number | null;
    wallClockMs: number;
    baseVerified: boolean;
    /**
     * F-252 (WP-584): did the system under test reach a terminal state, or was
     * it killed at the cap mid-run? Three of p3-rung-4's five tasks were graded
     * off workspaces whose runs never sealed, and the artifact said nothing.
     */
    sealed: boolean;
  }[];
}

/**
 * A run that timed out never sealed: the adapter reports no exit code because
 * the deadline killed it, and notes the timeout.
 */
export function isRunSealed(run: AdapterResult): boolean {
  return !run.notes.includes("timed out");
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
    requirementsVerifiedTotal: verifiedTotal,
    requirementsVerifiedSatisfied: verifiedSatisfied,
    dependencyVerifiedSatisfied: verifiedDependencySatisfied,
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
      sealed: isRunSealed(r.run),
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

/**
 * F-261 (WP-588): the raw-results pointer a published bundle carries must be a
 * reference a reader can still follow.
 *
 * `dirname(resolve(reference))` alone produced two unusable pointers on the
 * dogfood-123 rung-4 bundle: an ABSOLUTE host path (meaningless off this
 * machine) that pointed INSIDE `.chikory/runs/<run-id>/workspace` — a run
 * workspace `scripts/prune-runs.sh` deletes. A published number whose trace
 * link dies with the next prune is not auditable, which is the field's entire
 * purpose.
 *
 * So: refuse an ephemeral run workspace outright (fail loud at publication
 * time, not at read time), and otherwise emit the path relative to the
 * enclosing git repo root so the pointer survives being copied elsewhere.
 * A reference outside any repo keeps its absolute path — there is nothing
 * better to say about it.
 */
export function publishableRawResultsDir(reference: string): string {
  return publishableRepoPath(dirname(resolve(reference)), "raw results directory");
}

/**
 * Anchor a directory a published artifact points at, so the pointer resolves
 * from one stated place — the enclosing git repo root — instead of from
 * whatever CWD happened to run the command.
 *
 * F-267 (WP-591): the leaderboard stored `--bundle` verbatim, so
 * `benchmarks/publications/leaderboard/leaderboard.json` published
 * `../publications/p3-rung-4` — a path that only resolves from
 * `benchmarks/harness/`, and resolves to nothing from the artifact's own
 * directory or from the repo root. That is F-262 again: the acceptance check
 * asserted the field was a non-empty string, never that it RESOLVED.
 */
export function publishableRepoPath(target: string, what = "published path"): string {
  const absolute = resolve(target);
  const segments = absolute.split(sep);
  const runsAt = segments.findIndex(
    (segment, i) => segment === ".chikory" && segments[i + 1] === "runs",
  );
  if (runsAt !== -1) {
    throw new Error(
      `${what} ${absolute} is inside an ephemeral Chikory run workspace; ` +
        `a published comparison must cite durable evidence (re-run compare against the ` +
        `operator's benchmarks/results/… copy, not a run workspace copy of it)`,
    );
  }
  for (let dir = absolute; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) {
      const rel = relative(dir, absolute);
      return rel.length > 0 ? rel : ".";
    }
    if (dirname(dir) === dir) return absolute;
  }
}

function buildArmDetail(
  summary: SuiteSummary,
  label?: string,
  reference?: string,
): ArmComparisonDetail {
  // F-252 (WP-584): ONE definition of I-SR. This used to recompute from the
  // unfiltered `requirementsTotal`, silently readmitting tasks whose base ref
  // was never green — publishing a different headline number than the
  // `summary.json` it claims to be reporting. The verified counts are the
  // denominator `summarize` already used; fall back to the unfiltered totals
  // only for summaries written before they existed.
  const verifiedTotal = summary.requirementsVerifiedTotal ?? summary.requirementsTotal;
  const verifiedSatisfied = summary.requirementsVerifiedSatisfied ?? summary.requirementsSatisfied;
  const dependencySatisfied =
    summary.dependencyVerifiedSatisfied ??
    summary.perTask.reduce((sum, t) => sum + t.dependencySatisfied, 0);

  const iSr = verifiedTotal > 0 ? verifiedSatisfied / verifiedTotal : 0;
  const dSr = verifiedTotal > 0 ? dependencySatisfied / verifiedTotal : 0;

  const iSrCi = wilsonScoreInterval(verifiedSatisfied, verifiedTotal);
  const dSrCi = wilsonScoreInterval(dependencySatisfied, verifiedTotal);

  return {
    label: label ?? summary.adapter,
    suite: summary.suite,
    adapter: summary.adapter,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    tasks: summary.tasks,
    tasksVerified: summary.tasksVerified,
    // The k and n BEHIND the published rate, not the suite's raw totals — a
    // bundle that prints 0.9333 next to 17/19 is not auditable (F-252).
    requirementsTotal: verifiedTotal,
    requirementsSatisfied: verifiedSatisfied,
    dependencySatisfied,
    iSr,
    iSrCi,
    iSrRange: { low: iSrCi.lower, high: iSrCi.upper },
    dSr,
    dSrCi,
    dSrRange: { low: dSrCi.lower, high: dSrCi.upper },
    reference,
    ...(reference !== undefined && reference.length > 0
      ? { rawResultsDir: publishableRawResultsDir(reference) }
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
