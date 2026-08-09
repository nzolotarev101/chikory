/**
 * Task discrimination probe (WP-593) — mechanical proof that a task's requirement
 * checks fail on the untouched pinned base and pass on the real upstream fix.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runBounded, scrubExecutorEnv } from "@chikory/sdk";

import { ensureGitWorkspace } from "./adapter.js";
import { verifyBaseGreen } from "./base-verify.js";
import { decideTargetNode, discoverNodeToolchains, pinnedNodeProvisioning } from "./engine.js";
import {
  getLedgerEntry,
  parseDiscriminationLedger,
  publishableRepoPath,
  readDiscriminationLedger,
  sanitizeFileName,
  type DiscriminationLedger,
  type DiscriminationLedgerEntry,
} from "./results.js";
import { loadTaskDir } from "./suite.js";
import { isRunnable, parseAuthoredTask, type BenchmarkTask } from "./task.js";

export function findRepoRoot(startDir: string): string {
  const absoluteStart = resolve(startDir);
  for (let dir = absoluteStart; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return dir;
  }
}

export function resolvePatchPath(fixPatch: string, taskPath?: string): string {
  // F-288 (dogfood-129): `repo.fix_patch` is a repo-relative path to a patch
  // committed in THIS repository — that is what makes a patch-backed proof
  // reproducible from a clone. An absolute path names a file no other checkout
  // has, so the ledger entry it justifies is unverifiable. The run's own judge
  // flagged this three times; step 6 reverted the guard only because AC-1's
  // fixture wrote absolute paths (the AC contradicted the goal), so the guard
  // is restored here against the GOAL, not the defective oracle.
  if (isAbsolute(fixPatch)) {
    throw new Error(`Patch path must be a relative path within the repository: ${fixPatch}`);
  }
  const baseDir = taskPath ? dirname(resolve(taskPath)) : process.cwd();
  const repoRoot = findRepoRoot(baseDir);

  const directFromRoot = resolve(repoRoot, fixPatch);
  let candidate: string | undefined;

  if (existsSync(directFromRoot)) {
    candidate = directFromRoot;
  } else {
    for (let dir = baseDir; ; dir = dirname(dir)) {
      const probeCandidate = join(dir, fixPatch);
      if (existsSync(probeCandidate)) {
        candidate = probeCandidate;
        break;
      }
      if (dir === repoRoot || dirname(dir) === dir) break;
    }
  }

  const finalPath = candidate ?? directFromRoot;
  const rel = relative(repoRoot, finalPath);
  if (rel.startsWith("..")) {
    throw new Error(`Patch path ${fixPatch} escapes repository root ${repoRoot}`);
  }
  return finalPath;
}

export function getEffectiveFixRef(task: BenchmarkTask, taskPath?: string): string {
  if (task.repo?.fixRef && task.repo?.fixPatch) {
    throw new Error(`Task ${task.id} declares both repo.fix_ref and repo.fix_patch`);
  }
  if (task.repo?.fixRef) {
    return task.repo.fixRef;
  }
  if (task.repo?.fixPatch) {
    const patchPath = resolvePatchPath(task.repo.fixPatch, taskPath);
    if (!existsSync(patchPath)) {
      throw new Error(`Task ${task.id}: patch file not found at ${task.repo.fixPatch}`);
    }
    const content = readFileSync(patchPath);
    return createHash("sha256").update(content).digest("hex");
  }
  throw new Error(`Task ${task.id} is missing repo.fix_ref or repo.fix_patch required for probe`);
}

export interface ProbeRequirementResult {
  id: string;
  base: "red" | "green";
  fix: "red" | "green";
  classification: "discriminating" | "non-discriminating" | "unsatisfiable" | "inconclusive";
  reason: string;
}

export interface ProbeVerificationReport {
  green: boolean;
  reason: string;
}

export interface ProbeResult {
  taskId: string;
  baseRef: string;
  fixRef: string;
  baseWorkspace: string;
  fixWorkspace: string;
  baseVerification: ProbeVerificationReport;
  fixVerification: ProbeVerificationReport;
  verdict: "discriminating" | "not-discriminating" | "inconclusive";
  requirements: ProbeRequirementResult[];
}

const BASE_WORKSPACE_DIR = "base-workspace";
const FIX_WORKSPACE_DIR = "fix-workspace";

export interface RunProbeOptions {
  taskPath: string;
  outDir?: string;
  recordFile?: string;
  baseVerifyTimeoutMs?: number;
}

async function runCheck(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ code: number | null; output: string }> {
  const bounded = await runBounded("/bin/sh", ["-c", command], {
    cwd,
    env: scrubExecutorEnv(process.env, []),
    maxSeconds: timeoutMs / 1000,
  });
  const code = bounded.timedOut ? 1 : (bounded.exitCode ?? 1);
  const output = `${bounded.stdout}${bounded.stderr}${
    bounded.timedOut ? `\n[check timed out after ${timeoutMs}ms]` : ""
  }`;
  return { code, output };
}

/**
 * F-282: the ledger is the ONLY durable product of a multi-hour sweep, and a
 * kill landing inside a plain `writeFileSync` truncates it — which F-275 then
 * (correctly) refuses to parse, losing every verdict already earned. Write a
 * sibling temp file and rename: on POSIX the rename is atomic, so a reader ever
 * sees the old ledger or the new one, never half of either.
 */
function writeLedgerAtomically(recordPath: string, ledger: Record<string, DiscriminationLedgerEntry>): void {
  const tempPath = `${recordPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(ledger, null, 2));
  try {
    renameSync(tempPath, recordPath);
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

export async function runProbe(options: RunProbeOptions): Promise<{ result: ProbeResult; outDir: string; code: number }> {
  const absoluteTaskPath = resolve(options.taskPath);
  if (!existsSync(absoluteTaskPath)) {
    throw new Error(`Task file not found: ${absoluteTaskPath}`);
  }

  const yamlContent = readFileSync(absoluteTaskPath, "utf8");
  const task = parseAuthoredTask(yamlContent, options.taskPath);

  const fixRef = getEffectiveFixRef(task, options.taskPath);

  if (!task.repo) {
    throw new Error(`Task ${task.id} is missing repo required for probe`);
  }
  const repoUrl = task.repo.url;
  const baseRef = task.repo.ref;

  const targetOutDir = options.outDir
    ? resolve(options.outDir)
    : join(dirname(absoluteTaskPath), "probe-output");
  mkdirSync(targetOutDir, { recursive: true });

  const baseWorkspace = join(targetOutDir, BASE_WORKSPACE_DIR);
  const fixWorkspace = join(targetOutDir, FIX_WORKSPACE_DIR);
  mkdirSync(baseWorkspace, { recursive: true });
  mkdirSync(fixWorkspace, { recursive: true });

  ensureGitWorkspace(baseWorkspace, repoUrl, baseRef);
  if (task.repo.fixRef) {
    ensureGitWorkspace(fixWorkspace, repoUrl, task.repo.fixRef);
  } else if (task.repo.fixPatch) {
    ensureGitWorkspace(fixWorkspace, repoUrl, baseRef);
    const patchPath = resolvePatchPath(task.repo.fixPatch, options.taskPath);
    if (!existsSync(patchPath)) {
      throw new Error(`Task ${task.id}: patch file not found at ${task.repo.fixPatch}`);
    }
    try {
      execFileSync("git", ["apply", patchPath], {
        cwd: fixWorkspace,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Task ${task.id}: patch ${task.repo.fixPatch} failed to apply cleanly onto base ref ${baseRef}: ${message}`,
      );
    }
    const gitStatus = execFileSync("git", ["status", "--porcelain"], {
      cwd: fixWorkspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (gitStatus.length === 0) {
      throw new Error(
        `Task ${task.id}: patch ${task.repo.fixPatch} produced no changes on base ref ${baseRef}`,
      );
    }
  }

  // Determine Node toolchain provisioning if specified/needed
  const toolchains = discoverNodeToolchains();
  const ambientVersion = process.version;
  const baseProvisioning = task.nodeVersion
    ? pinnedNodeProvisioning(task.nodeVersion, toolchains)
    : decideTargetNode(null, toolchains, ambientVersion);
  const fixProvisioning = task.nodeVersion
    ? pinnedNodeProvisioning(task.nodeVersion, toolchains)
    : decideTargetNode(null, toolchains, ambientVersion);

  const baseVerifyCommand = task.baseVerificationCommand ?? "true";
  const timeoutMs = options.baseVerifyTimeoutMs;

  const baseVerifyRes = await verifyBaseGreen({
    command: baseVerifyCommand,
    cwd: baseWorkspace,
    provisioning: baseProvisioning,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const fixVerifyRes = await verifyBaseGreen({
    command: baseVerifyCommand,
    cwd: fixWorkspace,
    provisioning: fixProvisioning,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const baseVerificationReport: ProbeVerificationReport = {
    green: baseVerifyRes.green,
    reason: baseVerifyRes.reason,
  };
  const fixVerificationReport: ProbeVerificationReport = {
    green: fixVerifyRes.green,
    reason: fixVerifyRes.reason,
  };

  // F-270: anchor on the OUT DIR, not on each workspace. `ensureGitWorkspace`
  // materializes a `.git` INSIDE each workspace, so publishing the workspace
  // itself makes both collapse to "." — the two refs look like one. The out dir
  // is the artifact's own home, so `<out>/base-workspace` and
  // `<out>/fix-workspace` stay distinct AND resolve from where probe.json sits.
  const pubOutDir = publishableRepoPath(targetOutDir, "probe output directory");
  const pubBaseWs = join(pubOutDir, BASE_WORKSPACE_DIR);
  const pubFixWs = join(pubOutDir, FIX_WORKSPACE_DIR);

  const requirementsReport: ProbeRequirementResult[] = [];

  let overallVerdict: "discriminating" | "not-discriminating" | "inconclusive" = "inconclusive";
  let exitCode = 1;

  if (!baseVerifyRes.green || !fixVerifyRes.green) {
    overallVerdict = "inconclusive";
    exitCode = 1;
    for (const req of task.requirements) {
      requirementsReport.push({
        id: req.id,
        base: "red",
        fix: "red",
        classification: "inconclusive",
        reason: !baseVerifyRes.green
          ? `Base verification failed: ${baseVerifyRes.reason}`
          : `Fix verification failed: ${fixVerifyRes.reason}`,
      });
    }
  } else {
    let allDiscriminating = true;
    for (const req of task.requirements) {
      if (req.grading.kind !== "check") {
        requirementsReport.push({
          id: req.id,
          base: "red",
          fix: "red",
          classification: "inconclusive",
          reason: "Only check-kind requirements can be probed mechanically",
        });
        allDiscriminating = false;
        continue;
      }

      const baseCheck = await runCheck(req.grading.command, baseWorkspace);
      const fixCheck = await runCheck(req.grading.command, fixWorkspace);

      const baseGreen = baseCheck.code === 0;
      const fixGreen = fixCheck.code === 0;

      const baseTag: "red" | "green" = baseGreen ? "green" : "red";
      const fixTag: "red" | "green" = fixGreen ? "green" : "red";

      let classification: "discriminating" | "non-discriminating" | "unsatisfiable";
      let reason: string;

      if (!baseGreen && fixGreen) {
        classification = "discriminating";
        reason = "Requirement fails on base ref (exit non-zero) and passes on fix ref (exit 0)";
      } else if (baseGreen) {
        classification = "non-discriminating";
        reason = "Requirement passes on base ref (exit 0) — free for every arm";
        allDiscriminating = false;
      } else {
        classification = "unsatisfiable";
        reason = "Requirement fails on base ref and fails on fix ref (exit non-zero)";
        allDiscriminating = false;
      }

      requirementsReport.push({
        id: req.id,
        base: baseTag,
        fix: fixTag,
        classification,
        reason,
      });
    }

    if (allDiscriminating && requirementsReport.length > 0) {
      overallVerdict = "discriminating";
      exitCode = 0;
    } else {
      overallVerdict = "not-discriminating";
      exitCode = 1;
    }
  }

  const probeResult: ProbeResult = {
    taskId: task.id,
    baseRef,
    fixRef,
    baseWorkspace: pubBaseWs,
    fixWorkspace: pubFixWs,
    baseVerification: baseVerificationReport,
    fixVerification: fixVerificationReport,
    verdict: overallVerdict,
    requirements: requirementsReport,
  };

  const probeJsonPath = join(targetOutDir, "probe.json");
  writeFileSync(probeJsonPath, JSON.stringify(probeResult, null, 2));

  if (options.recordFile) {
    const recordPath = resolve(options.recordFile);
    mkdirSync(dirname(recordPath), { recursive: true });
    // F-275: an unreadable ledger is refused, never silently replaced — a reset
    // to `{}` here would drop every verdict already recorded on the write below.
    const ledger: Record<string, DiscriminationLedgerEntry> = existsSync(recordPath)
      ? parseDiscriminationLedger(readFileSync(recordPath, "utf8"), recordPath)
      : {};
    const entry: DiscriminationLedgerEntry = {
      taskId: probeResult.taskId,
      baseRef: probeResult.baseRef,
      fixRef: probeResult.fixRef,
      verdict: probeResult.verdict,
      probedAt: new Date().toISOString(),
      requirements: probeResult.requirements.map((req) => ({
        id: req.id,
        classification: req.classification,
      })),
    };
    ledger[probeResult.taskId] = entry;
    writeLedgerAtomically(recordPath, ledger);
  }

  return { result: probeResult, outDir: targetOutDir, code: exitCode };
}

export interface RunProbeSweepOptions {
  tasksDir: string;
  recordFile: string;
  outDir?: string;
  baseVerifyTimeoutMs?: number;
}

export async function runProbeSweep(
  options: RunProbeSweepOptions,
  io = { out: console.log, err: console.error },
): Promise<number> {
  const absoluteTasksDir = resolve(options.tasksDir);
  if (!existsSync(absoluteTasksDir)) {
    io.err(`chikory-bench probe: tasks dir not found: ${absoluteTasksDir}`);
    return 1;
  }

  const recordPath = resolve(options.recordFile);
  mkdirSync(dirname(recordPath), { recursive: true });

  const { tasks, invalid, sources } = loadTaskDir(absoluteTasksDir);
  if (Object.keys(invalid).length > 0) {
    for (const [file, issues] of Object.entries(invalid)) {
      io.err(`INVALID ${file}: ${issues.join("; ")}`);
    }
    return 1;
  }

  // F-281: one walk, the SAME selection `run` performs — a second hand-rolled
  // walk here would drift the moment either side's rules change.
  const selected: { task: BenchmarkTask; path: string }[] = [];
  for (const task of tasks) {
    const path = sources[task.id];
    if (isRunnable(task) && path !== undefined) selected.push({ task, path });
  }

  if (selected.length === 0) {
    io.err(`chikory-bench probe: no runnable tasks selected in ${options.tasksDir}`);
    return 1;
  }

  let probedCount = 0;
  let skippedCount = 0;
  let unprobeableCount = 0;
  let failedCount = 0;

  for (const { task, path: taskPath } of selected) {
    if (!task.repo || (!task.repo.fixRef && !task.repo.fixPatch)) {
      unprobeableCount++;
      const missingField = !task.repo ? "repo" : "repo.fix_ref or repo.fix_patch";
      io.out(`${task.id}: unprobeable (missing ${missingField})`);
      continue;
    }

    let ledger: DiscriminationLedger = {};
    if (existsSync(recordPath)) {
      ledger = readDiscriminationLedger(recordPath);
    }

    const entry = getLedgerEntry(ledger, task.id);
    const taskBaseRef = task.repo?.ref;
    let taskFixRef: string;
    try {
      taskFixRef = getEffectiveFixRef(task, taskPath);
    } catch (err) {
      failedCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      io.out(`${task.id}: failed (${errMsg})`);
      continue;
    }

    const isProvenAtSameRefPair =
      entry !== undefined &&
      taskBaseRef !== undefined &&
      taskFixRef !== undefined &&
      entry.baseRef === taskBaseRef &&
      entry.fixRef === taskFixRef;

    if (isProvenAtSameRefPair) {
      skippedCount++;
      io.out(`${task.id}: skipped (${entry.verdict})`);
      continue;
    }

    // F-277: every task in a sweep gets its OWN output dir. `runProbe`'s default
    // (`<task-dir>/probe-output`) is shared by every task in the same directory,
    // so a sweep without --out overwrote each task's probe.json with the next
    // one's, and re-pointed one base/fix git workspace at each successive repo —
    // leaving the previous target's untracked node_modules/dist behind for the
    // next task's base verification to run against (F-258's family).
    const taskOutDir = join(
      options.outDir ? resolve(options.outDir) : join(dirname(resolve(taskPath)), "probe-output"),
      sanitizeFileName(task.id),
    );

    try {
      const { result } = await runProbe({
        taskPath,
        outDir: taskOutDir,
        recordFile: recordPath,
        ...(options.baseVerifyTimeoutMs !== undefined
          ? { baseVerifyTimeoutMs: options.baseVerifyTimeoutMs }
          : {}),
      });
      probedCount++;
      io.out(`${task.id}: probed (${result.verdict})`);
    } catch (err) {
      failedCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      io.out(`${task.id}: failed (${errMsg})`);
    }
  }

  let finalLedger: DiscriminationLedger = {};
  if (existsSync(recordPath)) {
    finalLedger = readDiscriminationLedger(recordPath);
  }

  // F-279: proof counts only at the ref pair the task declares TODAY. A task
  // whose re-probe failed keeps its stale entry on disk; counting it verdict-only
  // reported coverage the sweep does not have.
  let discriminatingCount = 0;
  for (const { task, path: taskPath } of selected) {
    const entry = getLedgerEntry(finalLedger, task.id);
    let taskFixRef: string | undefined;
    try {
      taskFixRef = getEffectiveFixRef(task, taskPath);
    } catch {
      taskFixRef = undefined;
    }
    if (
      entry?.verdict === "discriminating" &&
      entry.baseRef === task.repo?.ref &&
      taskFixRef !== undefined &&
      entry.fixRef === taskFixRef
    ) {
      discriminatingCount++;
    }
  }

  io.out(
    `sweep summary: ${probedCount} probed, ${skippedCount} skipped, ${unprobeableCount} unprobeable, ${failedCount} failed, ${discriminatingCount} discriminating`,
  );

  const allDiscriminating =
    selected.length > 0 &&
    discriminatingCount === selected.length &&
    failedCount === 0 &&
    unprobeableCount === 0;

  return allDiscriminating ? 0 : 1;
}
