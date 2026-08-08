/**
 * Suite loading + orchestration (WP-301): discover tasks from a directory
 * (DevAI instance JSONs and/or authored YAMLs), run each through an adapter
 * in an isolated workspace, grade, and write artifacts.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { type AdapterResult, type RunnerAdapter } from "./adapter.js";
import { gradeTask, type GradeContext, type JudgeFn } from "./grade.js";
import {
  summarize,
  suiteOutDirName,
  writeSuiteSummary,
  writeTaskResult,
  sanitizeFileName,
  type DiscriminationLedger,
  type DiscriminationLedgerEntry,
  type SuiteSummary,
  type TaskResult,
} from "./results.js";
import { parseDevAITask } from "./devai.js";
import { isRunnable, validateAuthoredTask, type BenchmarkTask } from "./task.js";
import { decideTargetNode, loadTargetEngineSource, discoverNodeToolchains, pinnedNodeProvisioning, type ProvisioningDecision } from "./engine.js";

export interface LoadReport {
  tasks: BenchmarkTask[];
  /** file → issues; non-empty means the corpus does not validate. */
  invalid: Record<string, string[]>;
  /**
   * task id → the file it was loaded from. F-281: `probe --tasks` needs a path
   * per task, and re-walking the directory itself let the sweep's selection
   * drift from the one `run` uses. One walk, one set of rules.
   */
  sources: Record<string, string>;
}

/** Load every task in a directory: `.json` = DevAI instance, `.yaml` = authored. */
export function loadTaskDir(dir: string): LoadReport {
  const tasks: BenchmarkTask[] = [];
  const invalid: Record<string, string[]> = {};
  const sources: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const ext = extname(name);
    const path = join(dir, name);
    if (ext === ".json" && name !== "manifest.json") {
      try {
        const task = parseDevAITask(readFileSync(path, "utf8"), name);
        tasks.push(task);
        sources[task.id] = path;
      } catch (err) {
        invalid[name] = [(err as Error).message];
      }
    } else if (ext === ".yaml" || ext === ".yml") {
      const { task, issues } = validateAuthoredTask(readFileSync(path, "utf8"), name);
      if (task) {
        tasks.push(task);
        sources[task.id] = path;
      } else invalid[name] = issues;
    }
  }
  return { tasks, invalid, sources };
}

export interface RunSuiteOptions {
  suite: string;
  tasks: BenchmarkTask[];
  adapter: RunnerAdapter;
  /** Root under which per-suite-run artifact dirs are created. */
  resultsDir: string;
  judge?: JudgeFn;
  ledger?: DiscriminationLedger | DiscriminationLedgerEntry[];
  checkTimeoutMs?: number;
  adapterTimeoutMs?: number;
  /** F-241: cap for install + full base suite; NOT the 120 s judge-check cap. */
  baseVerifyTimeoutMs?: number;
  /** Skip non-runnable (draft) tasks instead of failing. Default true. */
  skipDrafts?: boolean;
  log?: (line: string) => void;
  now?: () => Date;
}

export async function runSuite(opts: RunSuiteOptions): Promise<{ summary: SuiteSummary; outDir: string }> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const outDir = join(opts.resultsDir, suiteOutDirName(opts.adapter.name, now()));
  mkdirSync(outDir, { recursive: true });

  const results: TaskResult[] = [];
  for (const task of opts.tasks) {
    if (!isRunnable(task)) {
      // Env-unfit (blocked) tasks are ALWAYS skipped — scoring them would emit a
      // meaningless red the judge can't reproduce (F-163). Drafts obey skipDrafts.
      if (task.status === "blocked") {
        log(`skip ${task.id} (blocked: ${task.blockedReason ?? "env cannot grade"})`);
        continue;
      }
      if (opts.skipDrafts ?? true) {
        log(`skip ${task.id} (draft)`);
        continue;
      }
      throw new Error(`task ${task.id} is a draft and skipDrafts=false`);
    }
    const taskOut = join(outDir, sanitizeFileName(task.id));
    const workspaceDir = join(taskOut, "workspace");
    mkdirSync(workspaceDir, { recursive: true });

    // Dynamic Node engine provisioning check.
    //
    // F-254 (WP-586): an explicit `node_version` on the task WINS over the
    // repo's own `engines` range. A range like `">=24"` makes the newest
    // locally-installed Node the de-facto runtime, so a fully-pinned task still
    // scores differently across machines and across time — `brownfield-002` is
    // 1128/1128 green on 24.14.1 and SIGABRTs vitest on 24.15.0.
    const engineSource = loadTargetEngineSource(task, workspaceDir);
    let nodeProvisioning: ProvisioningDecision;
    if (task.nodeVersion !== undefined) {
      nodeProvisioning = pinnedNodeProvisioning(task.nodeVersion, discoverNodeToolchains());
    } else if (engineSource.type === "error") {
      nodeProvisioning = {
        type: "unavailable",
        neededVersion: "unknown (read failed)",
        available: discoverNodeToolchains().map(t => t.version),
        error: engineSource.error,
      };
    } else {
      nodeProvisioning = decideTargetNode(engineSource.content, discoverNodeToolchains(), process.version);
    }

    if (nodeProvisioning.type === "unavailable") {
      const reason = nodeProvisioning.error
        ? `failed to read engine source: ${nodeProvisioning.error}`
        : `required Node.js version ${nodeProvisioning.neededVersion} is unavailable. Found: ${nodeProvisioning.available.join(", ")}`;
      log(`skip ${task.id} (blocked: ${reason})`);
      continue;
    }

    // Brownfield repos are cloned by the system under test (chikory does its
    // own clone from repo.url@ref); for baselines the workspace starts empty.
    if (task.repo === undefined && task.class === "brownfield") {
      log(`warn ${task.id}: brownfield without repo pin`);
    }

    log(`run ${task.id} via ${opts.adapter.name}`);
    const taskStarted = now().toISOString();
    const run: AdapterResult = await opts.adapter.run(task, {
      workspaceDir,
      outDir: taskOut,
      timeoutMs: opts.adapterTimeoutMs,
      nodeProvisioning,
      ...(opts.baseVerifyTimeoutMs !== undefined
        ? { baseVerifyTimeoutMs: opts.baseVerifyTimeoutMs }
        : {}),
    });

    // F-258: base verification belongs to the ADAPTER, because only the adapter
    // knows where its agent works and therefore where a pristine tree still
    // exists. `workspaceDir` is not that place: by the time control reaches here
    // it holds whatever the adapter left behind, and for any adapter whose agent
    // works elsewhere (`chikoryAdapter` clones into `dataDir/runs/<id>/workspace`)
    // that is the POST-agent tree. This used to run `verifyBaseGreen` against it
    // anyway, which answered "was the base green?" by testing the agent's own
    // output — silently, and greenly enough that four of five p3-rung-4 tasks
    // looked correct. It also ran a full dependency install inside the graded
    // workspace immediately before `gradeTask`.
    //
    // Both shipped adapters now report their own. An adapter that does not is a
    // contract violation, and a contract violation must be loud, not guessed at.
    let baseVerification = run.baseVerification;
    if (baseVerification === undefined && task.repo !== undefined) {
      baseVerification = {
        green: false,
        reason:
          `adapter '${opts.adapter.name}' did not report a base verification for a repo-pinned ` +
          `task — the harness cannot verify one after the fact, because the workspace it would ` +
          `test is the adapter's output, not the pinned base`,
        testsPassed: 0,
        testsFailed: 0,
      };
    }
    const gradeCtx: GradeContext = {
      workspaceDir,
      timeoutMs: opts.checkTimeoutMs,
      judge: opts.judge,
      nodeProvisioning,
    };
    const grading = await gradeTask(task, gradeCtx);
    const result: TaskResult = {
      taskId: task.id,
      source: task.source,
      class: task.class,
      adapter: opts.adapter.name,
      startedAt: taskStarted,
      endedAt: now().toISOString(),
      run,
      grading,
      baseVerification,
      ...(task.repo?.ref ? { repoRef: task.repo.ref } : {}),
    };

    writeTaskResult(outDir, result);
    results.push(result);
    log(
      `  ${task.id}: ${grading.satisfied}/${grading.total} satisfied ` +
        `(dep-adjusted ${grading.dependencySatisfied}) exit=${run.exitCode}`,
    );
  }

  const summary = summarize(opts.suite, opts.adapter.name, startedAt, now().toISOString(), results, opts.ledger);
  writeSuiteSummary(outDir, summary);
  return { summary, outDir };
}
