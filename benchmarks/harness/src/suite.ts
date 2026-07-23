/**
 * Suite loading + orchestration (WP-301): discover tasks from a directory
 * (DevAI instance JSONs and/or authored YAMLs), run each through an adapter
 * in an isolated workspace, grade, and write artifacts.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import type { AdapterResult, RunnerAdapter } from "./adapter.js";
import { gradeTask, type GradeContext, type JudgeFn } from "./grade.js";
import {
  summarize,
  suiteOutDirName,
  writeSuiteSummary,
  writeTaskResult,
  sanitizeFileName,
  type SuiteSummary,
  type TaskResult,
} from "./results.js";
import { parseDevAITask } from "./devai.js";
import { isRunnable, validateAuthoredTask, type BenchmarkTask } from "./task.js";

export interface LoadReport {
  tasks: BenchmarkTask[];
  /** file → issues; non-empty means the corpus does not validate. */
  invalid: Record<string, string[]>;
}

/** Load every task in a directory: `.json` = DevAI instance, `.yaml` = authored. */
export function loadTaskDir(dir: string): LoadReport {
  const tasks: BenchmarkTask[] = [];
  const invalid: Record<string, string[]> = {};
  for (const name of readdirSync(dir).sort()) {
    const ext = extname(name);
    const path = join(dir, name);
    if (ext === ".json" && name !== "manifest.json") {
      try {
        tasks.push(parseDevAITask(readFileSync(path, "utf8"), name));
      } catch (err) {
        invalid[name] = [(err as Error).message];
      }
    } else if (ext === ".yaml" || ext === ".yml") {
      const { task, issues } = validateAuthoredTask(readFileSync(path, "utf8"), name);
      if (task) tasks.push(task);
      else invalid[name] = issues;
    }
  }
  return { tasks, invalid };
}

export interface RunSuiteOptions {
  suite: string;
  tasks: BenchmarkTask[];
  adapter: RunnerAdapter;
  /** Root under which per-suite-run artifact dirs are created. */
  resultsDir: string;
  judge?: JudgeFn;
  checkTimeoutMs?: number;
  adapterTimeoutMs?: number;
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
    });
    const gradeCtx: GradeContext = {
      workspaceDir,
      timeoutMs: opts.checkTimeoutMs,
      judge: opts.judge,
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
    };
    writeTaskResult(outDir, result);
    results.push(result);
    log(
      `  ${task.id}: ${grading.satisfied}/${grading.total} satisfied ` +
        `(dep-adjusted ${grading.dependencySatisfied}) exit=${run.exitCode}`,
    );
  }

  const summary = summarize(opts.suite, opts.adapter.name, startedAt, now().toISOString(), results);
  writeSuiteSummary(outDir, summary);
  return { summary, outDir };
}
