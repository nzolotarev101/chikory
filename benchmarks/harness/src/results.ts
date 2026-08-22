/**
 * Results artifacts (WP-301) — benchmark.md: "results as artifacts"; every
 * published number links to its raw trace. One dir per suite run:
 * `benchmarks/results/<stamp>-<adapter>/` with a per-task JSON + summary.json.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { AdapterResult } from "./adapter.js";
import { dependencySatisfiedIds, type TaskGradeReport } from "./grade.js";
import type { VerifyBaseGreenResult } from "./base-verify.js";
import type { BenchmarkTask } from "./task.js";

export interface DiscriminationRequirementEntry {
  id: string;
  classification: "discriminating" | "non-discriminating" | "unsatisfiable" | "inconclusive";
}

export interface DiscriminationLedgerEntry {
  taskId: string;
  baseRef: string;
  fixRef: string;
  verdict: "discriminating" | "not-discriminating" | "inconclusive";
  probedAt: string;
  requirements: DiscriminationRequirementEntry[];
}

export type DiscriminationLedger = Record<string, DiscriminationLedgerEntry>;

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
  repoRef?: string;
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
  iSrCi?: ConfidenceInterval;
  iSrRange?: { low: number; high: number };
  dSrCi?: ConfidenceInterval;
  dSrRange?: { low: number; high: number };
  perTask: {
    taskId: string;
    satisfied: number;
    dependencySatisfied: number;
    total: number;
    exitCode: number | null;
    wallClockMs: number;
    baseVerified: boolean;
    discriminationVerified: boolean;
    /**
     * F-252 (WP-584): did the system under test reach a terminal state, or was
     * it killed at the cap mid-run? Three of p3-rung-4's five tasks were graded
     * off workspaces whose runs never sealed, and the artifact said nothing.
     */
    sealed: boolean;
  }[];
  tasksDir?: string;
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

export function getLedgerEntry(
  ledger: DiscriminationLedger | DiscriminationLedgerEntry[] | undefined,
  taskId: string,
): DiscriminationLedgerEntry | undefined {
  if (!ledger) return undefined;
  if (Array.isArray(ledger)) {
    return ledger.find((e) => e && e.taskId === taskId);
  }
  if (typeof ledger === "object") {
    return ledger[taskId];
  }
  return undefined;
}

/**
 * F-275: a ledger file that will not parse is evidence of damage, not an empty
 * ledger. Starting over from `{}` would let the next `--record` write overwrite
 * every verdict already recorded, so both readers REFUSE instead.
 * Accepts either persisted shape (object keyed by task id, or a flat array).
 */
export function parseDiscriminationLedger(text: string, source: string): DiscriminationLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `discrimination ledger ${source} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object"
      ? Object.values(parsed as Record<string, unknown>)
      : undefined;
  if (items === undefined) {
    throw new Error(`discrimination ledger ${source} must be a JSON object or array of entries`);
  }
  const ledger: DiscriminationLedger = {};
  for (const item of items) {
    if (item === null || typeof item !== "object") {
      throw new Error(`discrimination ledger ${source} contains a non-object entry`);
    }
    const entry = item as Partial<DiscriminationLedgerEntry>;
    if (typeof entry.taskId !== "string" || entry.taskId === "") {
      throw new Error(`discrimination ledger ${source} contains an entry with no taskId`);
    }
    ledger[entry.taskId] = entry as DiscriminationLedgerEntry;
  }
  return ledger;
}

export function readDiscriminationLedger(path: string): DiscriminationLedger {
  return parseDiscriminationLedger(readFileSync(path, "utf8"), path);
}

export function isTaskDiscriminationVerified(
  result: TaskResult,
  ledger?: DiscriminationLedger | DiscriminationLedgerEntry[],
  task?: BenchmarkTask,
): { verified: boolean; reason?: string } {
  if (!ledger) {
    return { verified: true };
  }
  const entry = getLedgerEntry(ledger, result.taskId);
  if (!entry) {
    return {
      verified: false,
      reason: `Task ${result.taskId} was never probed`,
    };
  }
  if (result.repoRef === undefined) {
    return {
      verified: false,
      reason: `Stored result recorded no scored ref`,
    };
  }
  if (entry.baseRef !== result.repoRef) {
    return {
      verified: false,
      reason: `Task probed at ref ${entry.baseRef}, but scored at ref ${result.repoRef} (stale proof)`,
    };
  }

  const reqs = task
    ? task.requirements.map((r) => ({ id: r.id, kind: r.kind ?? "discriminator" }))
    : result.grading.grades.map((g) => ({ id: g.requirementId, kind: g.kind ?? "discriminator" }));

  const scoredReqs = reqs.filter((r) => r.kind !== "guard");
  if (reqs.length > 0 && scoredReqs.length === 0) {
    return {
      verified: false,
      reason: `Task ${result.taskId} has no scored requirements (every requirement is declared a guard)`,
    };
  }
  if (scoredReqs.length === 0) {
    return {
      verified: false,
      reason: `Task ${result.taskId} has no scored requirements`,
    };
  }

  if (entry.requirements && entry.requirements.length > 0) {
    for (const req of scoredReqs) {
      const ledgerReq = entry.requirements.find((lr) => lr.id === req.id);
      if (!ledgerReq) {
        return {
          verified: false,
          reason: `Requirement ${req.id} was not probed in ledger`,
        };
      }
      if (ledgerReq.classification !== "discriminating") {
        return {
          verified: false,
          reason: `Requirement ${req.id} is declared scored but discrimination ledger classifies it as '${ledgerReq.classification}'`,
        };
      }
    }
  } else if (entry.verdict !== "discriminating") {
    return {
      verified: false,
      reason: `Task discrimination verdict was '${entry.verdict}' (not discriminating)`,
    };
  }

  return { verified: true };
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
  ledger?: DiscriminationLedger | DiscriminationLedgerEntry[],
  tasks?: Map<string, BenchmarkTask> | BenchmarkTask[],
  tasksDir?: string,
): SuiteSummary {
  const tasksMap =
    tasks instanceof Map
      ? tasks
      : Array.isArray(tasks)
        ? new Map(tasks.map((t) => [t.id, t]))
        : undefined;

  const requirementsTotal = results.reduce((s, r) => s + r.grading.total, 0);
  const requirementsSatisfied = results.reduce((s, r) => s + r.grading.satisfied, 0);

  const unverifiedTasks: { taskId: string; reason: string }[] = [];
  const verifiedResults: TaskResult[] = [];
  const perTaskInfo: SuiteSummary["perTask"] = [];

  let verifiedScoredTotal = 0;
  let verifiedScoredSatisfied = 0;
  let verifiedScoredDepSatisfied = 0;

  for (const r of results) {
    const task = tasksMap?.get(r.taskId);
    if (task) {
      for (const g of r.grading.grades) {
        if (!g.kind) {
          const req = task.requirements.find((req) => req.id === g.requirementId);
          if (req) {
            g.kind = req.kind ?? "discriminator";
          }
        }
      }
    }

    const baseVerified = isTaskVerified(r);
    const discCheck = isTaskDiscriminationVerified(r, ledger, task);
    const discriminationVerified = discCheck.verified;

    const guardGrades = r.grading.grades.filter((g) => g.kind === "guard");
    const scoredGrades = r.grading.grades.filter((g) => g.kind !== "guard");
    const guardsPassed = guardGrades.every((g) => g.satisfied);

    let taskScoredSatisfied = 0;
    let taskScoredDepSatisfied = 0;

    if (guardsPassed) {
      taskScoredSatisfied = scoredGrades.filter((g) => g.satisfied).length;
      if (task) {
        const gradeById = new Map(r.grading.grades.map((g) => [g.requirementId, g.satisfied]));
        const depOk = dependencySatisfiedIds(task, gradeById);
        taskScoredDepSatisfied = scoredGrades.filter((g) => depOk.has(g.requirementId)).length;
      } else {
        // No task definition available. `grading.dependencySatisfied` was recorded at grade
        // time over EVERY requirement, guards included, while this numerator feeds a
        // denominator that is the SCORED subset only. Honour the recorded count when the two
        // populations coincide; otherwise fall back to the scored-satisfied count rather than
        // emit a rate above 1.0 with a null Wilson interval (F-446).
        taskScoredDepSatisfied =
          guardGrades.length === 0
            ? Math.min(r.grading.dependencySatisfied, scoredGrades.length)
            : taskScoredSatisfied;
      }
    } else {
      taskScoredSatisfied = 0;
      taskScoredDepSatisfied = 0;
    }

    if (baseVerified && discriminationVerified) {
      verifiedResults.push(r);
      verifiedScoredTotal += scoredGrades.length;
      verifiedScoredSatisfied += taskScoredSatisfied;
      verifiedScoredDepSatisfied += taskScoredDepSatisfied;
    } else {
      let reason: string;
      if (!baseVerified) {
        reason = r.baseVerification?.reason ?? "Unverified base ref";
      } else {
        reason = discCheck.reason ?? "Discrimination unverified";
      }
      unverifiedTasks.push({ taskId: r.taskId, reason });
    }

    perTaskInfo.push({
      taskId: r.taskId,
      satisfied: r.grading.satisfied,
      dependencySatisfied: r.grading.dependencySatisfied,
      total: r.grading.total,
      exitCode: r.run.exitCode,
      wallClockMs: r.run.wallClockMs,
      baseVerified,
      discriminationVerified,
      sealed: isRunSealed(r.run),
    });
  }

  const hasKinds = results.some((r) => r.grading.grades.some((g) => g.kind === "guard"));
  const finalVerifiedTotal =
    hasKinds || ledger !== undefined
      ? verifiedScoredTotal
      : verifiedResults.reduce((s, r) => s + r.grading.total, 0);
  const finalVerifiedSatisfied =
    hasKinds || ledger !== undefined
      ? verifiedScoredSatisfied
      : verifiedResults.reduce((s, r) => s + r.grading.satisfied, 0);
  const finalVerifiedDepSatisfied =
    hasKinds || ledger !== undefined
      ? verifiedScoredDepSatisfied
      : verifiedResults.reduce((s, r) => s + r.grading.dependencySatisfied, 0);

  const iSrCi = wilsonScoreInterval(finalVerifiedSatisfied, finalVerifiedTotal);
  const dSrCi = wilsonScoreInterval(finalVerifiedDepSatisfied, finalVerifiedTotal);

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
    requirementsVerifiedTotal: finalVerifiedTotal,
    requirementsVerifiedSatisfied: finalVerifiedSatisfied,
    dependencyVerifiedSatisfied: finalVerifiedDepSatisfied,
    iSr: finalVerifiedTotal > 0 ? finalVerifiedSatisfied / finalVerifiedTotal : 0,
    dSr: finalVerifiedTotal > 0 ? finalVerifiedDepSatisfied / finalVerifiedTotal : 0,
    iSrCi,
    iSrRange: { low: iSrCi.lower, high: iSrCi.upper },
    dSrCi,
    dSrRange: { low: dSrCi.lower, high: dSrCi.upper },
    perTask: perTaskInfo,
    ...(tasksDir !== undefined ? { tasksDir } : {}),
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
  tasksDir?: string;
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
function hasRunWorkspaceMarker(segments: string[]): boolean {
  return segments.some((segment, i) => segment === ".chikory" && segments[i + 1] === "runs");
}

/** `realpathSync`, falling back to the input for a path that does not exist. */
function realPath(target: string): string {
  try {
    return realpathSync(resolve(target));
  } catch {
    return resolve(target);
  }
}

export function publishableRepoPath(target: string, what = "published path"): string {
  const absolute = resolve(target);
  let repoRoot: string | undefined;
  for (let dir = absolute; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) {
      repoRoot = dir;
      break;
    }
    if (dirname(dir) === dir) break;
  }

  const baseDir = repoRoot ?? "/";
  const rel = relative(baseDir, absolute);
  const refuse = (): never => {
    throw new Error(
      `${what} ${absolute} is inside an ephemeral Chikory run workspace; ` +
        `a published comparison must cite durable evidence (re-run compare against the ` +
        `operator's benchmarks/results/… copy, not a run workspace copy of it)`,
    );
  };
  if (hasRunWorkspaceMarker(rel.split(sep))) refuse();

  // F-294: a run workspace is ITSELF a git worktree, so anchoring on the target's
  // OWN repo root hides `.chikory/runs` from the relative path — the F-261/F-267
  // guard above silently stopped firing for the only shape it exists for (the
  // dogfood-123 defect). The unit test missed it because its path was fictional:
  // with no `.git` anywhere on disk the walk finds no repo root and the relative
  // check still sees the marker. Re-check the ROOT itself, and refuse unless the
  // caller is running inside that same workspace — the harness probing its own
  // tree is fine (harvest copies that evidence out), citing someone else's
  // workspace is the unresolvable pointer F-261 was opened for.
  if (repoRoot !== undefined && hasRunWorkspaceMarker(repoRoot.split(sep))) {
    // Compare REAL paths: on macOS `process.cwd()` reports `/private/var/…` for a
    // `/var/…` tmpdir, which would read as "outside" a workspace we are in fact in.
    const fromRoot = relative(realPath(repoRoot), realPath(process.cwd()));
    const cwdIsInside = fromRoot === "" || !fromRoot.split(sep).includes("..");
    if (!cwdIsInside) refuse();
  }

  if (repoRoot) {
    return rel.length > 0 ? rel : ".";
  }
  return absolute;
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
    ...(summary.tasksDir !== undefined ? { tasksDir: summary.tasksDir } : {}),
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
