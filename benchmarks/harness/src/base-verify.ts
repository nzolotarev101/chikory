/**
 * Base ref verification (WP-534 / WP-301) — mechanical proof that a target's
 * untouched base ref is green before scoring, avoiding false baselines and
 * silent engine divergence.
 */
import { runBounded, scrubExecutorEnv } from "@chikory/sdk";
import type { ProvisioningDecision } from "./engine.js";

/**
 * How long a base verification may take (F-241).
 *
 * This used to borrow `DEFAULT_CHECK_TIMEOUT_MS` — the 120 s cap for a JUDGE
 * check, a single assertion against an already-built workspace. A base
 * verification is a different animal: it installs a real target's dependencies
 * with that target's own package manager and then runs its ENTIRE suite. zod,
 * trpc and react-hook-form each need minutes for the install alone.
 *
 * So base verification could never pass. Every scored task in dogfood-122
 * reported `baseVerification.green: false`, the timeout was folded into a
 * generic exit-1, and the old reason blamed the output parser
 * ("Unparseable suite output"). AC-7/AC-8 require `green === true` on all five
 * tasks, so P3 rung 4 was unreachable for a reason no message named.
 */
export const DEFAULT_BASE_VERIFY_TIMEOUT_MS = 45 * 60_000;

export type BaseVerifyRunner = (input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}) => Promise<{ code: number | null; output: string }>;

export interface VerifyBaseGreenOptions {
  command: string;
  cwd: string;
  provisioning: ProvisioningDecision;
  run?: BaseVerifyRunner;
  /** Cap for install + full suite. Defaults to `DEFAULT_BASE_VERIFY_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface VerifyBaseGreenResult {
  green: boolean;
  reason: string;
  testsPassed: number;
  testsFailed: number;
}

const defaultRun: BaseVerifyRunner = async (input) => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_BASE_VERIFY_TIMEOUT_MS;
  const bounded = await runBounded("/bin/sh", ["-c", input.command], {
    cwd: input.cwd,
    env: input.env ?? scrubExecutorEnv(process.env, []),
    maxSeconds: timeoutMs / 1000,
  });
  const code = bounded.timedOut ? 1 : (bounded.exitCode ?? 1);
  const output = `${bounded.stdout}${bounded.stderr}${
    bounded.timedOut ? `\n[base verification timed out after ${timeoutMs}ms]` : ""
  }`;
  return { code, output };
};

/** Longest evidence excerpt a base-verification reason may carry (F-238). */
export const OUTPUT_TAIL_LIMIT = 400;

/**
 * The last few meaningful lines of a suite's output, for a failure reason that
 * has to survive into `summary.json` (F-238). Bounded, ANSI-stripped, and
 * single-line so a reason stays greppable next to the other reasons.
 */
export function outputTail(output: string, limit = OUTPUT_TAIL_LIMIT): string {
  // eslint-disable-next-line no-control-regex
  const clean = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "no output at all";
  const tail = lines.slice(-5).join(" ⏎ ");
  return tail.length > limit ? `…${tail.slice(-limit)}` : tail;
}

/**
 * Parse test summary line from Vitest or Jest output.
 * Handles ANSI color stripping and summary shapes like:
 *   "Tests  1128 passed (1128)"
 *   "Tests  354 failed | 774 passed (1128)"
 *   "Tests  0 passed (0)"
 *   "Tests: 1 failed, 2 passed, 3 total"
 */
export function parseTestSummary(output: string): { testsPassed: number; testsFailed: number } | null {
  // eslint-disable-next-line no-control-regex
  const clean = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");



  const lines = clean.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s*Tests[:\s]/i.test(trimmed)) {
      if (/no test files/i.test(trimmed)) {
        return { testsPassed: 0, testsFailed: 0 };
      }

      const failedMatch = trimmed.match(/(\d+)\s+failed/i);
      const passedMatch = trimmed.match(/(\d+)\s+passed/i);

      if (failedMatch || passedMatch) {
        const testsFailed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
        const testsPassed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
        return { testsPassed, testsFailed };
      }
    }
  }

  const lineMatch = clean.match(/Tests[:\s]+[^\n]+/i);
  if (lineMatch) {
    const text = lineMatch[0];
    const failedMatch = text.match(/(\d+)\s+failed/i);
    const passedMatch = text.match(/(\d+)\s+passed/i);
    if (failedMatch || passedMatch) {
      const testsFailed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
      const testsPassed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
      return { testsPassed, testsFailed };
    }
  }

  return null;
}

/**
 * Prove that a target's untouched base ref is green under the given provisioning decision.
 */
export async function verifyBaseGreen(options: VerifyBaseGreenOptions): Promise<VerifyBaseGreenResult> {
  const { command, cwd, provisioning, run = defaultRun, timeoutMs } = options;

  if (provisioning.type === "unavailable") {
    const needed = provisioning.neededVersion ?? "unknown";
    return {
      green: false,
      reason: `Node.js version ${needed} is unavailable`,
      testsPassed: 0,
      testsFailed: 0,
    };
  }

  // F-199: the base suite is target-authored code, so it must not inherit the
  // harness host's provider credentials. This call site always supplies an env,
  // which made `defaultRun`'s scrub fallback unreachable — scrub here instead.
  let env: Record<string, string> = {};
  for (const [key, value] of Object.entries(scrubExecutorEnv(process.env, []))) {
    if (value !== undefined) env[key] = value;
  }
  // F-243: the toolchain analogue of F-199. Yarn 1's launcher honours a
  // `yarnPath` from a HOME-level `~/.yarnrc.yml`, so on any machine that has
  // ever used Yarn Berry, even a version-pinned `npx -y yarn@1.22.22` re-execs
  // Berry from ANY directory. brownfield-001 could not verify its base for this
  // reason alone, and the failure looked like a lockfile problem in the target.
  // A task's declared package manager must mean what it says.
  env.YARN_IGNORE_PATH = "1";
  if (provisioning.type === "provision") {
    const currentPath = env.PATH ?? "";
    env = {
      ...env,
      PATH: currentPath ? `${provisioning.binDir}:${currentPath}` : provisioning.binDir,
    };
  }

  const { code, output } = await run({
    command,
    cwd,
    env,
    timeoutMs: timeoutMs ?? DEFAULT_BASE_VERIFY_TIMEOUT_MS,
  });

  const counts = parseTestSummary(output);

  // F-238: the exit code is decided BEFORE the parse. A command that failed to
  // install, could not find its package manager, or timed out never reaches a
  // test summary, and reporting that as "unparseable output" blamed the parser
  // for a suite that never ran. dogfood-122 read
  // `Unparseable suite output: could not find test summary` on every scored
  // task and could not tell which of those had happened.
  if (code !== 0) {
    return {
      green: false,
      reason: counts
        ? `Verification command failed with exit code ${code ?? 1}`
        : `Verification command failed with exit code ${code ?? 1} before producing a test summary — ${outputTail(output)}`,
      testsPassed: counts?.testsPassed ?? 0,
      testsFailed: counts?.testsFailed ?? 0,
    };
  }

  if (!counts) {
    return {
      green: false,
      reason: `Unparseable suite output: command exited 0 but printed no test summary — ${outputTail(output)}`,
      testsPassed: 0,
      testsFailed: 0,
    };
  }

  const { testsPassed, testsFailed } = counts;

  if (testsPassed === 0 || testsFailed > 0) {
    const reason =
      testsPassed === 0
        ? "Suite collected 0 tests (trap B)"
        : `Suite has ${testsFailed} failing test(s)`;
    return {
      green: false,
      reason,
      testsPassed,
      testsFailed,
    };
  }

  return {
    green: true,
    reason: `Base suite is green (${testsPassed} passed, ${testsFailed} failed)`,
    testsPassed,
    testsFailed,
  };
}
