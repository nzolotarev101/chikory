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
import { join } from "node:path";
import { promisify } from "node:util";

import { scrubExecutorEnv } from "../executors/env.js";
import { runBounded } from "../executors/process.js";
import type {
  AcceptanceCriterion,
  ArtifactStore,
  JudgeEvidence,
  TestResultArtifact,
} from "../types.js";
import { scanDiffForNewDependencies } from "./scan-dependencies.js";
import { scanDiffForLayeringViolations } from "./scan-layering.js";
import { scanDiffForSecrets } from "./scan-secrets.js";

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
  /**
   * WP-263(b): the check DID NOT COMPLETE (killed at the per-check cap) — an
   * infrastructure failure, not evidence the code is red. The verdict's
   * rule-3 stuck-criterion logic must not count it (the check-level analog
   * of WP-233's infra/substantive classification; dogfood-072 F-76/F-79).
   */
  infraFailed: boolean;
}

export interface CollectedEvidence {
  evidence: JudgeEvidence;
  /** Bounded diff excerpt for the prompt (full diff is in `evidence.diffRefs`). */
  diffText: string;
  /** Bounded per-repo diff excerpts for multi-repo prompts. */
  diffSections: DiffSection[];
  /** WP-215 deterministic secret-kind labels the judge sees alongside the diff. */
  secretScanLabels: string[];
  /** WP-215 deterministic new-dependency package names the judge sees alongside the diff. */
  newDependencyLabels: string[];
  /** Deterministic architecture-layer violation labels the judge sees alongside the diff. */
  architectureLabels: string[];
  checkRuns: CheckRun[];
  /** Raw evidence size (diff + check output bytes) — span attribute (WP-134). */
  evidenceBytes: number;
}

export interface EvidenceWorkspaceRepo {
  name: string;
  relativePath: string;
  writable: boolean;
}

export interface DiffSection {
  repoName: string;
  relativePath: string;
  sinceCommit: string;
  label: string;
  diffText: string;
  evidenceText: string;
}

export interface CollectPerRepoDiffsInput {
  workspaceDir: string;
  /** Diff base for the legacy single-root path. */
  sinceCommit: string;
  /** Resolved workspace repos. Absent keeps the legacy single-root evidence path. */
  workspaceRepos?: EvidenceWorkspaceRepo[];
  /** Per-resolved-repo diff base; keys are `EvidenceWorkspaceRepo.name`. */
  repoDiffBases?: Record<string, string>;
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

function diffEvidenceLabel(repoName: string, relativePath: string): string {
  return `repo ${repoName} (${relativePath})`;
}

function labeledDiffEvidence(label: string, diffText: string): string {
  return `### ${label}\n${diffText}`;
}

export async function collectPerRepoDiffs(input: CollectPerRepoDiffsInput): Promise<{
  perRepoDiff: boolean;
  sections: DiffSection[];
}> {
  const writableRepos = input.workspaceRepos?.filter((repo) => repo.writable) ?? [];
  const perRepoDiff =
    writableRepos.length > 1 ||
    (writableRepos.length === 1 && writableRepos[0]?.relativePath !== ".");
  const sections: DiffSection[] = [];
  if (perRepoDiff) {
    for (const repo of writableRepos) {
      const repoDir = repo.relativePath === "." ? input.workspaceDir : join(input.workspaceDir, repo.relativePath);
      const sinceCommit = input.repoDiffBases?.[repo.name] ?? input.sinceCommit;
      await git(repoDir, ["add", "-N", "."]);
      const repoDiff = await git(repoDir, ["diff", sinceCommit]);
      const label = diffEvidenceLabel(repo.name, repo.relativePath);
      sections.push({
        repoName: repo.name,
        relativePath: repo.relativePath,
        sinceCommit,
        label,
        diffText: repoDiff,
        evidenceText: labeledDiffEvidence(label, repoDiff),
      });
    }
  } else {
    await git(input.workspaceDir, ["add", "-N", "."]);
    const diff = await git(input.workspaceDir, ["diff", input.sinceCommit]);
    const repoName = writableRepos[0]?.name ?? ".";
    const relativePath = writableRepos[0]?.relativePath ?? ".";
    const label = diffEvidenceLabel(repoName, relativePath);
    sections.push({
      repoName,
      relativePath,
      sinceCommit: input.sinceCommit,
      label,
      diffText: diff,
      evidenceText: diff,
    });
  }
  return { perRepoDiff, sections };
}

/** Run one criterion `check` in the workspace; exit code is the verdict input. WP-264 / dogfood-073 F-78 ports WP-255(a)'s process-group kill so pipe-holding grandchildren cannot outlive the cap. */
async function runCheck(
  workspaceDir: string,
  criterion: AcceptanceCriterion,
  timeoutMs: number,
  workspaceRepos: EvidenceWorkspaceRepo[],
): Promise<CheckRun> {
  const repo = criterion.repo
    ? workspaceRepos.find((candidate) => candidate.name === criterion.repo)
    : undefined;
  if (criterion.repo && !repo) {
    return {
      criterionId: criterion.id,
      command: criterion.check!,
      exitCode: 1,
      output: `check target repo not found: ${criterion.repo}`,
      durationMs: 0,
      infraFailed: false,
    };
  }
  const checkCwd = repo
    ? repo.relativePath === "."
      ? workspaceDir
      : join(workspaceDir, repo.relativePath)
    : workspaceDir;
  const bounded = await runBounded("/bin/sh", ["-c", criterion.check!], {
    cwd: checkCwd,
    env: scrubExecutorEnv(process.env, []),
    maxSeconds: timeoutMs / 1000,
  });
  const exitCode = bounded.timedOut ? 1 : (bounded.exitCode ?? 1);
  const output = `${bounded.stdout}${bounded.stderr}${bounded.timedOut ? `\n[check timed out after ${timeoutMs}ms]` : ""}`;
  return {
    criterionId: criterion.id,
    command: criterion.check!,
    exitCode,
    output: bound(output, 64 * 1024),
    durationMs: bounded.durationMs,
    infraFailed: bounded.timedOut,
  };
}

export interface CollectEvidenceInput {
  workspaceDir: string;
  store: ArtifactStore;
  criteria: AcceptanceCriterion[];
  /** Diff base: commit of the checkpoint covering the previous verdict (or run base). */
  sinceCommit: string;
  /** Resolved workspace repos. Absent keeps the legacy single-root evidence path. */
  workspaceRepos?: EvidenceWorkspaceRepo[];
  /** Per-resolved-repo diff base; keys are `EvidenceWorkspaceRepo.name`. */
  repoDiffBases?: Record<string, string>;
  criteriaHistory: Record<string, boolean[]>;
  /** Compacted summaries of the steps since the last verdict. */
  stepSummaries: string[];
  checkTimeoutMs?: number;
}

export async function collectEvidence(input: CollectEvidenceInput): Promise<CollectedEvidence> {
  // Workspace diff since the last verdict — committed step work plus whatever
  // is still uncommitted (the judge runs before the covering checkpoint).
  const { perRepoDiff, sections } = await collectPerRepoDiffs(input);
  const diff = sections
    .map((section) => (perRepoDiff ? section.evidenceText : section.diffText))
    .join("\n");
  const secretScanLabels = scanDiffForSecrets(diff);
  const newDependencyLabels = scanDiffForNewDependencies(diff);
  const architectureLabels = scanDiffForLayeringViolations(diff);
  const diffRefs = await Promise.all(
    sections.map((section) =>
      input.store.put(perRepoDiff ? section.evidenceText : section.diffText, {
        kind: "diff",
        summary: perRepoDiff
          ? `workspace diff for ${section.repoName} since ${section.sinceCommit.slice(0, 12)} (${section.diffText.length} bytes)`
          : `workspace diff since ${section.sinceCommit.slice(0, 12)} (${section.diffText.length} bytes)`,
        // F-131: repo attribution rides the ref as data — consumers must not
        // parse it back out of the human-readable summary.
        ...(perRepoDiff ? { repo: section.repoName } : {}),
      }),
    ),
  );

  // Judge-executed acceptance checks (JD-4) — sequential: checks may share
  // workspace state (build artifacts, ports).
  const checkRuns: CheckRun[] = [];
  for (const criterion of input.criteria) {
    if (!criterion.check) continue;
    checkRuns.push(
      await runCheck(
        input.workspaceDir,
        criterion,
        input.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
        input.workspaceRepos ?? [],
      ),
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
    diffRefs,
    testResults,
    criteria: input.criteria,
    criteriaHistory: input.criteriaHistory,
    stepSummaries: input.stepSummaries,
    artifacts: [],
  };
  return {
    evidence,
    diffText: bound(diff, MAX_DIFF_PROMPT_CHARS),
    diffSections: perRepoDiff
      ? sections.map((section) => ({
          ...section,
          diffText: bound(section.diffText, MAX_DIFF_PROMPT_CHARS),
          evidenceText: bound(section.evidenceText, MAX_DIFF_PROMPT_CHARS),
        }))
      : [],
    secretScanLabels,
    newDependencyLabels,
    architectureLabels,
    checkRuns,
    evidenceBytes: diff.length + checkRuns.reduce((a, r) => a + r.output.length, 0),
  };
}
