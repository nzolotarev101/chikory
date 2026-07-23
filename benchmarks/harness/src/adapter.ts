/**
 * Runner adapters (WP-301) — the matrix cells of benchmark.md: the system
 * under test produces a workspace; the harness grades it afterwards.
 *
 * - `commandAdapter`: any CLI agent as a baseline cell (raw `claude`, `codex`,
 *   OpenHands, native-loop-without-judge) — the honest-ablation row.
 * - `chikoryAdapter`: `chikory run` on a generated task.yaml; the journal
 *   (`chikory trace --json`, the JIF interchange) is kept as the run artifact.
 */
import { spawn } from "node:child_process";
import { createWriteStream, cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import type { BenchmarkTask } from "./task.js";

export interface AdapterContext {
  /** The task workspace the system under test works in and grading runs against. */
  workspaceDir: string;
  /** Per-task artifact dir (goal file, generated spec, journal JSON). */
  outDir: string;
  timeoutMs?: number;
}

export interface AdapterResult {
  exitCode: number | null;
  wallClockMs: number;
  /** Paths of artifacts the adapter produced (relative meaning left to adapter). */
  artifacts: string[];
  notes: string[];
}

export interface RunnerAdapter {
  name: string;
  run(task: BenchmarkTask, ctx: AdapterContext): Promise<AdapterResult>;
}

export const DEFAULT_ADAPTER_TIMEOUT_MS = 4 * 60 * 60 * 1_000; // multi-hour tasks by design

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  logPath: string,
): Promise<{ code: number | null; timedOut: boolean; output: string }> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    const logStream = createWriteStream(logPath, { flags: "w" });
    const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const cap = (c: Buffer) => {
      if (chunks.join("").length < 1_000_000) chunks.push(c.toString());
      logStream.write(c);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (code: number | null) => {
      clearTimeout(timer);
      logStream.end();
      resolve({ code, timedOut, output: chunks.join("") });
    };
    child.on("close", finish);
    child.on("error", () => finish(null));
  });
}

/**
 * Baseline cell: run a command template in the workspace. Placeholders:
 * `{workspace}`, `{goalFile}` (task goal written to a file — no quoting games),
 * `{taskId}`.
 */
export function commandAdapter(name: string, template: string): RunnerAdapter {
  return {
    name,
    async run(task, ctx) {
      mkdirSync(ctx.outDir, { recursive: true });
      const goalFile = join(ctx.outDir, "goal.md");
      writeFileSync(goalFile, task.goal);
      const command = template
        .replaceAll("{workspace}", ctx.workspaceDir)
        .replaceAll("{goalFile}", goalFile)
        .replaceAll("{taskId}", task.id);
      const logPath = join(ctx.outDir, "adapter.log");
      const started = Date.now();
      const { code, timedOut } = await runShell(
        command,
        ctx.workspaceDir,
        ctx.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS,
        logPath,
      );
      return {
        exitCode: code,
        wallClockMs: Date.now() - started,
        artifacts: [goalFile, logPath],
        notes: timedOut ? ["timed out"] : [],
      };
    },
  };
}

export interface ChikoryAdapterOptions {
  /** `chikory` binary invocation, default `chikory` on PATH (devbox shell). */
  bin?: string;
  budgetUsd?: number;
  maxSteps?: number;
  /**
   * Per-step executor turn cap (task.yaml `step_limits.max_turns`). Default 50:
   * the claude-code adapter default of 25 forced 3-6h brownfield tasks into
   * restart churn — every capped step re-read ~1.1M input tokens (dogfood-111).
   */
  stepMaxTurns?: number;
  executor?: { adapter: string; family: string };
  judge?: { family: string; cadence?: number };
  /** Raw routing block passed through to the spec (snake_case YAML shape). */
  routing?: unknown;
}

/**
 * BenchmarkTask → chikory task.yaml (docs/spec/task-spec.md shape).
 * Check-graded requirements become acceptance criteria with checks; judge-graded
 * ones become check-less criteria (graded post-hoc by the harness judge, not
 * the in-loop judge — the benchmark grades the OUTCOME, DevAI-style).
 */
export function buildChikorySpec(
  task: BenchmarkTask,
  opts: ChikoryAdapterOptions,
  workspaceDir: string,
): Record<string, unknown> {
  const executor = opts.executor ?? { adapter: "gemini-cli", family: "gemini" };
  let judge = opts.judge ?? { family: executor.family === "gemini" ? "anthropic" : "gemini" };
  let routing = opts.routing;

  if (process.env.OPENAI_COMPAT_BASE_URL) {
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
    name: `bench-${task.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    goal: task.goal,
    repos: [
      task.repo
        ? { url: task.repo.url, ref: task.repo.ref, writable: true }
        : // Greenfield: the workspace itself is the (empty, git-init'd) repo.
          { url: workspaceDir, writable: true },
    ],
    acceptance_criteria: task.requirements.map((r) => ({
      id: r.id,
      description: r.description,
      ...(r.grading.kind === "check" ? { check: r.grading.command } : {}),
    })),
    budget_usd: opts.budgetUsd ?? 25,
    max_steps: opts.maxSteps ?? 60,
    // max_seconds 840 = the parse-time ceiling (Temporal activity timeout):
    // at dogfood-111's observed pace 50 turns ≈ 540s — the default 600s
    // wall-clock cap would kill the step before the turn cap bounds it.
    step_limits: { max_turns: opts.stepMaxTurns ?? 50, max_seconds: 840 },
    executor,
    judge,
    ...(routing !== undefined ? { routing } : {}),
  };
}

export function chikoryAdapter(opts: ChikoryAdapterOptions = {}): RunnerAdapter {
  const bin = opts.bin ?? "chikory";
  return {
    name: "chikory",
    async run(task, ctx) {
      mkdirSync(ctx.outDir, { recursive: true });
      const spec = buildChikorySpec(task, opts, ctx.workspaceDir);
      const specPath = join(ctx.outDir, "task.yaml");
      writeFileSync(specPath, stringifyYaml(spec));
      const dataDir = join(ctx.outDir, ".chikory");
      const logPath = join(ctx.outDir, "adapter.log");
      
      console.log(`\n  [chikory] Running ${task.id}...`);
      console.log(`  [chikory] Logs are streaming to: tail -f ${logPath}\n`);

      const started = Date.now();
      const { code, timedOut, output } = await runShell(
        `${bin} run ${JSON.stringify(specPath)} --data-dir ${JSON.stringify(dataDir)}`,
        ctx.workspaceDir,
        ctx.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS,
        logPath,
      );

      // Copy the final sandboxed workspace back to the harness workspaceDir for
      // grading. Authoritative pick: the run-id the CLI announced for THIS
      // invocation (`run-id: run-<uuid>`). Stale Temporal workflows from earlier
      // bench invocations can materialize extra run-* dirs in this dataDir
      // (F-157/F-158) — newest-journal mtime is only the fallback when the
      // announcement line is missing (e.g. the CLI died before printing it).
      try {
        const runsDir = join(dataDir, "runs");
        if (existsSync(runsDir)) {
          const announced = [...output.matchAll(/^run-id: (run-[0-9a-f-]+)$/gm)].map(
            (m) => m[1],
          );
          const announcedId = announced[announced.length - 1];
          let gradedId: string | undefined;
          if (announcedId !== undefined && existsSync(join(runsDir, announcedId, "workspace"))) {
            gradedId = announcedId;
          } else {
            const runDirs = readdirSync(runsDir)
              .filter((n) => n.startsWith("run-"))
              .map((n) => {
                const journal = join(runsDir, n, "journal.db");
                return {
                  name: n,
                  mtime: existsSync(journal) ? statSync(journal).mtimeMs : 0,
                };
              })
              .sort((a, b) => b.mtime - a.mtime);
            if (runDirs.length > 1) {
              console.warn(
                `  [chikory] ${runDirs.length} run dirs in ${runsDir} and no usable run-id ` +
                  `announcement (stale Temporal re-attach?); grading newest journal: ${runDirs[0].name}`,
              );
            }
            gradedId = runDirs[0]?.name;
          }
          if (gradedId !== undefined) {
            const finalWs = join(runsDir, gradedId, "workspace");
            if (existsSync(finalWs)) {
              cpSync(finalWs, ctx.workspaceDir, { recursive: true, force: true });
            }
          }
        }
      } catch (err) {
        console.error("  [chikory] Failed to copy workspace for grading:", err);
      }

      return {
        exitCode: code,
        wallClockMs: Date.now() - started,
        artifacts: [specPath, logPath, dataDir],
        notes: timedOut ? ["timed out"] : [],
      };
    },
  };
}
