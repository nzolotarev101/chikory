/**
 * Judge evidence collection (WP-131, judge.md "Evidence, not vibes" / JD-4).
 *
 * The judge never trusts the executor's claims: the workspace diff is taken
 * straight from git, and acceptance-criterion `check` commands are executed
 * by the judge itself in the workspace. Large payloads land in the artifact
 * store; only size-bounded excerpts enter the judge prompt (CM-3 applies to
 * judging too).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { scrubExecutorEnv } from "../executors/env.js";
import type {
  AcceptanceCriterion,
  ArtifactStore,
  JudgeEvidence,
  TestResultArtifact,
} from "../types.js";

const execFileAsync = promisify(execFile);

/** Per-check wall-clock bound — a hung test command must not hang the judge. */
export const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
/** Prompt-side cap on the diff excerpt (chars). */
export const MAX_DIFF_PROMPT_CHARS = 24_000;
/** Prompt-side cap per check-command output (chars). */
export const MAX_CHECK_OUTPUT_CHARS = 4_000;

export interface CheckRun {
  criterionId: string;
  command: string;
  exitCode: number;
  /** Combined stdout+stderr, tail-bounded. */
  output: string;
  durationMs: number;
}

export interface CollectedEvidence {
  evidence: JudgeEvidence;
  /** Bounded diff excerpt for the prompt (full diff is in `evidence.diffRefs`). */
  diffText: string;
  checkRuns: CheckRun[];
  /** Raw evidence size (diff + check output bytes) — span attribute (WP-134). */
  evidenceBytes: number;
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

function bound(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} chars]`;
}

/** Run one criterion `check` in the workspace; exit code is the verdict input. */
async function runCheck(
  workspaceDir: string,
  criterion: AcceptanceCriterion,
  timeoutMs: number,
): Promise<CheckRun> {
  const started = Date.now();
  let exitCode = 0;
  let output = "";
  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", criterion.check!], {
      cwd: workspaceDir,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: scrubExecutorEnv(process.env, []),
    });
    output = stdout + stderr;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    exitCode = typeof e.code === "number" ? e.code : 1;
    output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.killed ? `\n[check timed out after ${timeoutMs}ms]` : ""}`;
  }
  return {
    criterionId: criterion.id,
    command: criterion.check!,
    exitCode,
    output: bound(output, 64 * 1024),
    durationMs: Date.now() - started,
  };
}

export interface CollectEvidenceInput {
  workspaceDir: string;
  store: ArtifactStore;
  criteria: AcceptanceCriterion[];
  /** Diff base: commit of the checkpoint covering the previous verdict (or run base). */
  sinceCommit: string;
  criteriaHistory: Record<string, boolean[]>;
  /** Compacted summaries of the steps since the last verdict. */
  stepSummaries: string[];
  checkTimeoutMs?: number;
}

export async function collectEvidence(input: CollectEvidenceInput): Promise<CollectedEvidence> {
  // Workspace diff since the last verdict — committed step work plus whatever
  // is still uncommitted (the judge runs before the covering checkpoint).
  await git(input.workspaceDir, ["add", "-N", "."]);
  const diff = await git(input.workspaceDir, ["diff", input.sinceCommit]);
  const diffRef = await input.store.put(diff, {
    kind: "diff",
    summary: `workspace diff since ${input.sinceCommit.slice(0, 12)} (${diff.length} bytes)`,
  });

  // Judge-executed acceptance checks (JD-4) — sequential: checks may share
  // workspace state (build artifacts, ports).
  const checkRuns: CheckRun[] = [];
  for (const criterion of input.criteria) {
    if (!criterion.check) continue;
    checkRuns.push(
      await runCheck(input.workspaceDir, criterion, input.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS),
    );
  }

  let testResults: TestResultArtifact | undefined;
  if (checkRuns.length > 0) {
    const rawOutput = checkRuns
      .map((r) => `$ ${r.command}\n[exit ${r.exitCode}, ${r.durationMs}ms]\n${r.output}`)
      .join("\n\n");
    const ref = await input.store.put(rawOutput, {
      kind: "test_results",
      summary: `${checkRuns.length} acceptance checks: ${checkRuns.filter((r) => r.exitCode === 0).length} passed, ${checkRuns.filter((r) => r.exitCode !== 0).length} failed`,
    });
    testResults = {
      ref,
      command: checkRuns.map((r) => r.command).join(" && "),
      exitCode: checkRuns.find((r) => r.exitCode !== 0)?.exitCode ?? 0,
      passed: checkRuns.filter((r) => r.exitCode === 0).length,
      failed: checkRuns.filter((r) => r.exitCode !== 0).length,
      durationMs: checkRuns.reduce((a, r) => a + r.durationMs, 0),
    };
  }

  const evidence: JudgeEvidence = {
    diffRefs: [diffRef],
    testResults,
    criteria: input.criteria,
    criteriaHistory: input.criteriaHistory,
    stepSummaries: input.stepSummaries,
    artifacts: [],
  };
  return {
    evidence,
    diffText: bound(diff, MAX_DIFF_PROMPT_CHARS),
    checkRuns,
    evidenceBytes: diff.length + checkRuns.reduce((a, r) => a + r.output.length, 0),
  };
}
