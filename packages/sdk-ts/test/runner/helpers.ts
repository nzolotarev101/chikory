/**
 * Shared fixtures for the runner integration suites (WP-121..124): a
 * scripted executor adapter (deterministic costs/failures, no LLM — the
 * runner's seam is ExecutorAdapter, which is exactly what these tests
 * exercise), a tiny git source repo, and TaskSpec construction.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { DefaultLogger, Runtime } from "@temporalio/worker";

import type {
  AdapterRegistry,
  ArtifactStore,
  ExecutorAdapter,
  RunStatus,
  StepRecord,
  TaskSpec,
} from "../../src/index.js";

// Keep worker lifecycle INFO chatter out of test output. Safe to call more
// than once across suite files — install only wins for the first.
try {
  Runtime.install({ logger: new DefaultLogger("WARN") });
} catch {
  // Runtime already installed by an earlier suite in this process.
}

declare module "vitest" {
  export interface ProvidedContext {
    temporalAddress: string | null;
    workflowBundlePath: string | null;
  }
}

const execFileAsync = promisify(execFile);

export interface ScriptedConfig {
  costPerStep: number;
  delayMs: number;
  /** 1-based attempt numbers that FAIL. */
  failSteps: number[];
  /** Every attempt FAILs (loop-breaker tests, WP-124). */
  failAll?: boolean;
}

const SCRIPTED_DEFAULTS: ScriptedConfig = { costPerStep: 0.01, delayMs: 0, failSteps: [] };

/** git init + first commit, including the scripted adapter's config. */
export async function initSourceRepo(
  dir: string,
  config: Partial<ScriptedConfig> = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const git = (...args: string[]) => execFileAsync("git", ["-C", dir, ...args]);
  await execFileAsync("git", ["init", "-b", "main", dir]);
  await git("config", "user.name", "test");
  await git("config", "user.email", "test@chikory.local");
  await writeFile(join(dir, "README.md"), "# scripted test repo\n");
  await writeFile(
    join(dir, "scripted.json"),
    JSON.stringify({ ...SCRIPTED_DEFAULTS, ...config }),
  );
  await git("add", "-A");
  await git("commit", "-m", "init");
  return dir;
}

/**
 * Deterministic ExecutorAdapter: each attempt bumps a counter file in the
 * workspace, writes `step-<n>.txt`, and reports the configured cost. No
 * subprocess, no model — the runner sees the exact step contract.
 */
export function createScriptedAdapter(ctx: { store: ArtifactStore }): ExecutorAdapter {
  return {
    name: "scripted",
    modelFamily: "anthropic",
    async runStep(input): Promise<StepRecord> {
      const cfg: ScriptedConfig = {
        ...SCRIPTED_DEFAULTS,
        ...JSON.parse(await readFile(join(input.workspaceDir, "scripted.json"), "utf8")),
      };
      const countPath = join(input.workspaceDir, "scripted-count.txt");
      const attempt = existsSync(countPath)
        ? Number.parseInt(await readFile(countPath, "utf8"), 10) + 1
        : 1;
      await writeFile(countPath, String(attempt));

      if (cfg.delayMs > 0) await new Promise((r) => setTimeout(r, cfg.delayMs));

      const fail = cfg.failAll === true || cfg.failSteps.includes(attempt);
      if (!fail) {
        await writeFile(join(input.workspaceDir, `step-${attempt}.txt`), input.instruction);
      }

      const [diffRef, transcriptRef] = await Promise.all([
        ctx.store.put(`scripted diff, attempt ${attempt}`, {
          kind: "diff",
          summary: `scripted attempt ${attempt} diff`,
        }),
        ctx.store.put(`scripted transcript, attempt ${attempt}`, {
          kind: "transcript",
          summary: `scripted attempt ${attempt} transcript`,
        }),
      ]);

      const base = {
        diffRef,
        transcriptRef,
        summary: fail ? `scripted attempt ${attempt}: failed` : `scripted attempt ${attempt}: ok`,
        toolCalls: 1,
        tokens: { input: 100, output: 50 },
        costUsd: cfg.costPerStep,
        costEstimated: false,
        durationMs: cfg.delayMs,
      };
      return fail
        ? {
            ...base,
            status: "FAILED",
            failure: { reason: `scripted failure at attempt ${attempt}`, retriable: true },
          }
        : { ...base, status: "SUCCESS" };
    },
  };
}

export const scriptedRegistry: AdapterRegistry = {
  scripted: (ctx) => createScriptedAdapter(ctx),
};

export function makeSpec(overrides: { repoUrl: string } & Partial<TaskSpec>): TaskSpec {
  const { repoUrl, ...rest } = overrides;
  return {
    name: "runner-test",
    goal: "exercise the journaled agent loop",
    repos: [{ url: repoUrl, writable: true }],
    acceptanceCriteria: [{ id: "AC-1", description: "scripted steps executed" }],
    budgetUsd: 100,
    maxSteps: 4,
    executor: { adapter: "scripted", family: "anthropic" },
    judge: { family: "gemini", cadence: 2 },
    routing: {
      stages: {
        plan: { provider: "anthropic", model: "claude-fable-5" },
        code: { provider: "anthropic", model: "claude-fable-5" },
        review: { provider: "anthropic", model: "claude-fable-5" },
        judge: { provider: "gemini", model: "gemini-2.5-pro" },
      },
    },
    ...rest,
  };
}

export const TERMINAL_STATUSES: RunStatus[] = ["SUCCESS", "FAILED", "CANCELLED"];

export async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  opts: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms${opts.what ? `: ${opts.what}` : ""}`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 250));
  }
}
