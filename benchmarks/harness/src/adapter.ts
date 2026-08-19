/**
 * Runner adapters (WP-301) — the matrix cells of benchmark.md: the system
 * under test produces a workspace; the harness grades it afterwards.
 *
 * - `commandAdapter`: any CLI agent as a baseline cell (raw `claude`, `codex`,
 *   OpenHands, native-loop-without-judge) — the honest-ablation row.
 * - `chikoryAdapter`: `chikory run` on a generated task.yaml; the journal
 *   (`chikory trace --json`, the JIF interchange) is kept as the run artifact.
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { runBounded } from "@chikory/sdk";

import type { BenchmarkTask } from "./task.js";
import { type ProvisioningDecision } from "./engine.js";
import { verifyBaseGreen, type VerifyBaseGreenResult } from "./base-verify.js";

export interface AdapterContext {
  /** The task workspace the system under test works in and grading runs against. */
  workspaceDir: string;
  /** Per-task artifact dir (goal file, generated spec, journal JSON). */
  outDir: string;
  timeoutMs?: number;
  nodeProvisioning?: ProvisioningDecision;
  /** F-241: cap for install + full base suite; NOT the 120 s judge-check cap. */
  baseVerifyTimeoutMs?: number;
}

export interface AdapterResult {
  exitCode: number | null;
  wallClockMs: number;
  /** Paths of artifacts the adapter produced (relative meaning left to adapter). */
  artifacts: string[];
  notes: string[];
  baseVerification?: VerifyBaseGreenResult;
}

export interface RunnerAdapter {
  name: string;
  run(task: BenchmarkTask, ctx: AdapterContext): Promise<AdapterResult>;
}

export const DEFAULT_ADAPTER_TIMEOUT_MS = 4 * 60 * 60 * 1_000; // multi-hour tasks by design

/**
 * F-250 (WP-582): this used to be a local re-implementation of bounded exec —
 * `spawn("bash", …)` with no `detached`, killed with `child.kill("SIGKILL")`.
 * That signals only the direct `bash`; grandchildren (the `chikory` node
 * process, its Temporal worker) keep the stdout pipe open, so `close` never
 * fires and the run outlives its cap. p3-rung-4's `brownfield-002` ran **9h47m
 * against a 4h cap — 2.45×**, the exact overrun signature of F-59/WP-255.
 *
 * `runBounded` fixed that in the SDK a long time ago (`detached: true`,
 * `process.kill(-pid, …)`, SIGTERM→SIGKILL grace). Forking a second bounded-exec
 * is what let the old bug come back; there is now one implementation.
 */
async function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  logPath: string,
): Promise<{ code: number | null; timedOut: boolean; output: string }> {
  const logStream = createWriteStream(logPath, { flags: "w" });
  const chunks: string[] = [];
  let captured = 0;
  try {
    const result = await runBounded("bash", ["-c", command], {
      cwd,
      maxSeconds: timeoutMs / 1000,
      onOutput: (chunk) => {
        // Same 1 MB capture cap as before: `output` only feeds the run-id regex
        // below, and a multi-hour arm's full log belongs on disk, not in heap.
        if (captured < 1_000_000) {
          chunks.push(chunk.toString());
          captured += chunk.length;
        }
        logStream.write(chunk);
      },
    });
    return { code: result.exitCode, timedOut: result.timedOut, output: chunks.join("") };
  } catch {
    // `runBounded` rejects when the process cannot be spawned at all.
    return { code: null, timedOut: false, output: chunks.join("") };
  } finally {
    // `.end()` alone is fire-and-forget: the flush to disk is async, so a
    // caller reading logPath right after runShell resolves can race an
    // incomplete write (observed as an empty adapter.log under CI load).
    await new Promise<void>((resolve, reject) => {
      logStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

async function withProvisionedPath<T>(nodeProvisioning: ProvisioningDecision | undefined, fn: () => Promise<T>): Promise<T> {
  if (nodeProvisioning?.type === "unavailable") {
    throw new Error(`Cannot run task: required Node.js version is unavailable: ${nodeProvisioning.neededVersion}`);
  }
  const originalPath = process.env.PATH;
  if (nodeProvisioning?.type === "provision") {
    process.env.PATH = `${nodeProvisioning.binDir}:${originalPath}`;
  }
  try {
    return await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

/**
 * Materialize repo.url at repo.ref in workspaceDir. If .git exists, verify origin URL and HEAD;
 * re-fetch and checkout repo.ref if mismatched, or fail closed.
 *
 * Every git call goes through `execFileSync` with an ARGUMENT ARRAY, never an
 * interpolated shell string: `url` and `ref` come from a task YAML, and a task
 * file is not a trusted shell author.
 */
export function ensureGitWorkspace(workspaceDir: string, repoUrl: string, repoRef: string): void {
  const gitDir = join(workspaceDir, ".git");
  const normalizedUrl = repoUrl.trim();
  const normalizedRef = repoRef.trim();
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: workspaceDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

  if (!existsSync(gitDir)) {
    git(["clone", normalizedUrl, "."]);
    git(["checkout", normalizedRef]);
  } else {
    let originUrl = "";
    try {
      originUrl = git(["config", "--get", "remote.origin.url"]).trim();
    } catch {
      // origin remote might not exist
    }

    let currentHead = "";
    try {
      currentHead = git(["rev-parse", "HEAD"]).trim();
    } catch {
      // HEAD ref might not be valid
    }

    const urlMatches = originUrl === normalizedUrl;
    const headMatches = currentHead === normalizedRef;

    if (!urlMatches || !headMatches) {
      if (!urlMatches) {
        try {
          git(["remote", "set-url", "origin", normalizedUrl]);
        } catch {
          git(["remote", "add", "origin", normalizedUrl]);
        }
      }
      try {
        git(["fetch", "origin"]);
      } catch {
        git(["fetch", "origin", normalizedRef]);
      }
      git(["checkout", "-f", normalizedRef]);
    }
  }

  const verifyHead = git(["rev-parse", "HEAD"]).trim();
  if (verifyHead !== normalizedRef) {
    let expectedSha = normalizedRef;
    try {
      expectedSha = git(["rev-parse", normalizedRef]).trim();
    } catch {
      // ignore
    }
    if (verifyHead !== expectedSha) {
      throw new Error(`Workspace HEAD (${verifyHead}) does not match expected repo ref (${normalizedRef})`);
    }
  }
}

interface PinnedBaseVerification {
  verification: VerifyBaseGreenResult;
  /** Set when the clone/checkout itself failed — there is nothing to run against. */
  materializeError?: string;
}

/**
 * Materialize a task's pinned base into `cwd` and prove its suite is green there.
 *
 * F-258: extracted so BOTH adapters produce identical reason text for identical
 * conditions. The two arms of a published comparison are only comparable if
 * `baseVerified` means the same thing in each — which it did not, because
 * `chikoryAdapter` did not verify at all and let `runSuite`'s fallback verify
 * the POST-agent workspace instead.
 *
 * The caller decides WHERE `cwd` is, and that differs by adapter for a real
 * reason: `commandAdapter`'s agent works in the graded workspace, so verifying
 * in place is both correct and free. `chikoryAdapter`'s agent works in
 * `dataDir/runs/<id>/workspace` and the harness copies that back over the graded
 * workspace afterwards, so it must verify in a scratch clone it then deletes —
 * see the call site.
 */
async function verifyPinnedBase(
  task: BenchmarkTask,
  cwd: string,
  ctx: AdapterContext,
): Promise<PinnedBaseVerification> {
  const repo = task.repo;
  if (repo === undefined) throw new Error("verifyPinnedBase called for a task with no repo pin");

  try {
    ensureGitWorkspace(cwd, repo.url, repo.ref);
  } catch (err) {
    const materializeError = (err as Error).message;
    return {
      verification: {
        green: false,
        reason: `Failed to materialize base ref: ${materializeError}`,
        testsPassed: 0,
        testsFailed: 0,
      },
      materializeError,
    };
  }

  if (!task.baseVerificationCommand) {
    return {
      verification: {
        green: false,
        reason: "No base verification command declared (base_verification_command is missing)",
        testsPassed: 0,
        testsFailed: 0,
      },
    };
  }

  try {
    return {
      verification: await verifyBaseGreen({
        command: task.baseVerificationCommand,
        cwd,
        provisioning: ctx.nodeProvisioning ?? { type: "ambient" },
        ...(ctx.baseVerifyTimeoutMs !== undefined ? { timeoutMs: ctx.baseVerifyTimeoutMs } : {}),
      }),
    };
  } catch (err) {
    return {
      verification: {
        green: false,
        reason: `Failed to verify base ref: ${(err as Error).message}`,
        testsPassed: 0,
        testsFailed: 0,
      },
    };
  }
}

/**
 * Baseline cell: run a command template in the workspace. Placeholders:
 * `{workspace}`, `{goalFile}` (task goal written to a file — no quoting games),
 * `{taskId}`. Materializes brownfield repo.url@ref if specified.
 */
export function commandAdapter(name: string, template: string): RunnerAdapter {
  return {
    name,
    async run(task, ctx) {
      return withProvisionedPath(ctx.nodeProvisioning, async () => {
        mkdirSync(ctx.outDir, { recursive: true });
        const goalFile = join(ctx.outDir, "goal.md");
        writeFileSync(goalFile, task.goal);
        const logPath = join(ctx.outDir, "adapter.log");
        const started = Date.now();

        let baseVerification: VerifyBaseGreenResult | undefined;
        if (task.repo) {
          // In place: this adapter's agent works in the graded workspace, so the
          // pristine clone it verifies IS the tree the agent then edits.
          const base = await verifyPinnedBase(task, ctx.workspaceDir, ctx);
          baseVerification = base.verification;
          if (base.materializeError !== undefined) {
            return {
              exitCode: 1,
              wallClockMs: Date.now() - started,
              artifacts: [goalFile, logPath],
              notes: [`Failed to materialize repo base: ${base.materializeError}`],
              baseVerification,
            };
          }
        }

        const command = template
          .replaceAll("{workspace}", ctx.workspaceDir)
          .replaceAll("{goalFile}", goalFile)
          .replaceAll("{taskId}", task.id);
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
          ...(baseVerification !== undefined ? { baseVerification } : {}),
        };
      });
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
  /**
   * F-253 (WP-585): which declared classes this arm runs on, so a quota wall
   * rotates to a peer instead of parking. These are class-id REFERENCES into
   * the registry (`agent_classes: {executor, judge}` per task-spec.md), not an
   * inline registry — the registry itself is resolved by the runner from
   * `CHIKORY_AGENT_CLASSES`.
   */
  agentClasses?: { executor?: string; judge?: string };
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
  // F-257: this guess only makes sense with no agent_classes to derive the
  // judge family from — `spec.judge.family` is checked independently of
  // `routing.stages` by `missingProviderEnv`, so a stale guess left in place
  // when agent_classes IS set (the bench-run.sh call never passes opts.judge)
  // demanded ANTHROPIC_API_KEY even though the derived routing correctly
  // pointed the judge stage at the class member's own openai-compat transport.
  let judge =
    opts.judge ??
    (opts.agentClasses !== undefined
      ? {}
      : { family: executor.family === "gemini" ? "anthropic" : "gemini" });
  let routing = opts.routing;

  // F-256: when agent_classes is set, routing must be DERIVED from the class
  // members (parseTaskSpec refuses both `agent_classes` and an explicit
  // `routing` together) — this override predates WP-585 and would just
  // duplicate what `policyFromMembers` already produces from the class
  // members' own transport/model.
  if (process.env.OPENAI_COMPAT_BASE_URL && opts.agentClasses === undefined) {
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
    // F-247 (WP-579): nobody is watching a benchmark arm. Without this an
    // ESCALATE parks in AWAITING_APPROVAL forever waiting for a `chikory
    // approve` that will never come — p3-rung-4's `brownfield-001` sat there
    // until the harness SIGKILLed it 4 hours later, leaving the Temporal
    // workflow Running and orphaning the server for the next launch.
    // `seal_resumable_failed` ends the run at its last checkpoint instead.
    unattended: { escalation: "seal_resumable_failed" },
    executor,
    judge,
    ...(routing !== undefined ? { routing } : {}),
    // F-253 (WP-585): without declared classes `agents.executorClass` is
    // undefined, `recordWallAndCheckPeer` is skipped, and every wall parks
    // instead of rotating to a peer — the whole WP-566…WP-576 rotation system
    // is inert. p3-rung-4 hit 5 walls and logged zero `agent_rotation` entries.
    ...(opts.agentClasses !== undefined ? { agent_classes: opts.agentClasses } : {}),
  };
}

export function chikoryAdapter(opts: ChikoryAdapterOptions = {}): RunnerAdapter {
  const bin = opts.bin ?? "chikory";
  return {
    name: "chikory",
    async run(task, ctx) {
      return withProvisionedPath(ctx.nodeProvisioning, async () => {
        mkdirSync(ctx.outDir, { recursive: true });
        const spec = buildChikorySpec(task, opts, ctx.workspaceDir);
        const specPath = join(ctx.outDir, "task.yaml");
        writeFileSync(specPath, stringifyYaml(spec));
        const dataDir = join(ctx.outDir, ".chikory");
        const logPath = join(ctx.outDir, "adapter.log");

        // F-258: verify the base BEFORE the agent runs, in a scratch clone this
        // adapter owns and then deletes.
        //
        // This used to be omitted entirely, and `runSuite`'s fallback picked it
        // up — but by the time that fallback runs, `ctx.workspaceDir` holds the
        // POST-agent tree copied out of `dataDir/runs/<id>/workspace` below. So
        // "is the base green" was answered by testing the agent's own output.
        // p3-rung-4's `brownfield-001` (a real zod v3→v4 upgrade) failed it on
        // `Your lockfile needs to be updated, but yarn was run with
        // --frozen-lockfile` — a frozen install against the `yarn.lock` the
        // agent had legitimately rewritten. The same pin, same command, verified
        // green (117 passed) through `commandAdapter`, which verifies pre-agent.
        // The other four tasks passed by luck: they do not perturb their
        // lockfiles enough to trip a frozen install.
        //
        // The scratch dir is NOT `ctx.workspaceDir`, unlike `commandAdapter`:
        // the `cpSync(..., { force: true })` below MERGES the final agent
        // workspace into it rather than replacing it, so a base-verification
        // `node_modules` (base-ref dependency versions) left behind would
        // survive into the graded artifact and could decide a grading check.
        // Deleting it also keeps the footprint transient — dogfood-122 died of
        // a full disk.
        let baseVerification: VerifyBaseGreenResult | undefined;
        if (task.repo) {
          const baseDir = join(ctx.outDir, "base-verify");
          mkdirSync(baseDir, { recursive: true });
          try {
            baseVerification = (await verifyPinnedBase(task, baseDir, ctx)).verification;
          } finally {
            rmSync(baseDir, { recursive: true, force: true });
          }
        }

        console.log(`\n  [chikory] Running ${task.id}...`);
        console.log(`  [chikory] Logs are streaming to: tail -f ${logPath}\n`);

        // Deliberately AFTER the base verification: `wallClockMs` is the time the
        // agent ran, and it is checked against the adapter cap (WP-582). A 45 min
        // base verify folded into it would make every arm look like an overrun.
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
                // verbatimSymlinks: node's cpSync otherwise resolves a RELATIVE
                // symlink against the SOURCE dir and writes it back absolute, so
                // a target repo's own symlinks (zod's CLAUDE.md/.cursorrules/
                // README.md) come out pointing into `.chikory/runs/<id>/workspace`
                // — the graded artifact stops being self-contained and shows 3
                // phantom ` M` files in every scope review (F-166).
                cpSync(finalWs, ctx.workspaceDir, {
                  recursive: true,
                  force: true,
                  verbatimSymlinks: true,
                });
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
          ...(baseVerification !== undefined ? { baseVerification } : {}),
        };
      });
    },
  };
}
