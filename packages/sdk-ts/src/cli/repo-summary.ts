/**
 * Shared multi-repo activity summary for `chikory status` / `chikory trace`
 * (WP-214). Pure functions over journal rows.
 *
 * Repo attribution for diff evidence prefers the structured `ArtifactRef.repo`
 * field (F-131); the summary-string parse survives only as a fallback for
 * journals written before the field existed.
 */
import type { JudgePayload } from "../runner/activities.js";
import type { ArtifactRef, Checkpoint, JournalEntry } from "../types.js";

export interface RepoActivitySummary {
  repoCount: number;
  repos: Array<{ name: string; diffBytes: number; commit: string }>;
}

/** Pre-F-131 fallback: recover the repo name from the human-readable summary. */
function repoNameFromDiffSummary(summary: string): string | undefined {
  const prefix = "workspace diff for ";
  if (!summary.startsWith(prefix)) return undefined;
  const rest = summary.slice(prefix.length);
  const sinceIndex = rest.lastIndexOf(" since ");
  return sinceIndex > 0 ? rest.slice(0, sinceIndex) : undefined;
}

export function diffRefRepoName(ref: ArtifactRef): string | undefined {
  return ref.repo ?? repoNameFromDiffSummary(ref.summary);
}

/**
 * Latest multi-repo checkpoint (>1 committed checkout — multi-repo keys are
 * resolved workspace names, F-129) plus per-repo diff bytes accumulated from
 * judge evidence refs. `undefined` for single-repo runs: their rendering is
 * unchanged (WP-214 constraint).
 */
export function summarizeRepoActivity(entries: JournalEntry[]): RepoActivitySummary | undefined {
  const latestMultiRepoCheckpoint = [...entries]
    .reverse()
    .filter((entry) => entry.kind === "checkpoint")
    .map((entry) => entry.payload as Checkpoint)
    .find((checkpoint) => Object.keys(checkpoint.gitCommits).length > 1);
  if (latestMultiRepoCheckpoint === undefined) return undefined;

  const diffBytesByRepo = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "judge") continue;
    const judge = entry.payload as JudgePayload;
    for (const ref of judge.evidenceRefs) {
      if (ref.kind !== "diff") continue;
      const repoName = diffRefRepoName(ref);
      if (repoName === undefined) continue;
      diffBytesByRepo.set(repoName, (diffBytesByRepo.get(repoName) ?? 0) + ref.bytes);
    }
  }

  const repos = Object.entries(latestMultiRepoCheckpoint.gitCommits).map(([name, commit]) => ({
    name,
    diffBytes: diffBytesByRepo.get(name) ?? 0,
    commit,
  }));
  return { repoCount: repos.length, repos };
}
