/**
 * Base ref verification (WP-534 / WP-301) — mechanical proof that a target's
 * untouched base ref is green before scoring, avoiding false baselines and
 * silent engine divergence.
 */
import { DEFAULT_CHECK_TIMEOUT_MS, runBounded, scrubExecutorEnv } from "@chikory/sdk";
import type { ProvisioningDecision } from "./engine.js";
import type { BenchmarkTask } from "./task.js";

export type BaseVerifyRunner = (input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
}) => Promise<{ code: number | null; output: string }>;

export interface VerifyBaseGreenOptions {
  command: string;
  cwd: string;
  provisioning: ProvisioningDecision;
  run?: BaseVerifyRunner;
}

export interface VerifyBaseGreenResult {
  green: boolean;
  reason: string;
  testsPassed: number;
  testsFailed: number;
}

async function defaultRun(input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
}): Promise<{ code: number | null; output: string }> {
  const bounded = await runBounded("/bin/sh", ["-c", input.command], {
    cwd: input.cwd,
    env: input.env ?? scrubExecutorEnv(process.env, []),
    maxSeconds: DEFAULT_CHECK_TIMEOUT_MS / 1000,
  });
  const code = bounded.timedOut ? 1 : (bounded.exitCode ?? 1);
  const output = `${bounded.stdout}${bounded.stderr}${
    bounded.timedOut ? `\n[check timed out after ${DEFAULT_CHECK_TIMEOUT_MS}ms]` : ""
  }`;
  return { code, output };
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
 * Extract the base verification command from a BenchmarkTask.
 * Looks for requirement checks that mention test or suite, falling back
 * to any check requirement or a default "pnpm test".
 */
export function findBaseVerificationCommand(task: BenchmarkTask): string {
  for (const req of task.requirements) {
    if (req.grading.kind === "check") {
      const desc = req.description.toLowerCase();
      if (desc.includes("suite") || desc.includes("test")) {
        return req.grading.command;
      }
    }
  }
  for (const req of task.requirements) {
    if (req.grading.kind === "check") {
      return req.grading.command;
    }
  }
  return "pnpm test";
}

/**
 * Prove that a target's untouched base ref is green under the given provisioning decision.
 */
export async function verifyBaseGreen(options: VerifyBaseGreenOptions): Promise<VerifyBaseGreenResult> {
  const { command, cwd, provisioning, run = defaultRun } = options;

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
  if (provisioning.type === "provision") {
    const currentPath = env.PATH ?? "";
    env = {
      ...env,
      PATH: currentPath ? `${provisioning.binDir}:${currentPath}` : provisioning.binDir,
    };
  }

  const { code, output } = await run({ command, cwd, env });

  const counts = parseTestSummary(output);
  if (!counts) {
    return {
      green: false,
      reason: "Unparseable suite output: could not find test summary",
      testsPassed: 0,
      testsFailed: 0,
    };
  }

  const { testsPassed, testsFailed } = counts;

  if (code !== 0) {
    return {
      green: false,
      reason: `Verification command failed with exit code ${code ?? 1}`,
      testsPassed,
      testsFailed,
    };
  }

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
