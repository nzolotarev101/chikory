import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Journal } from "../journal/journal.js";
import type { Checkpoint, JournalEntry, TaskSpec, TokenUsage } from "../types.js";
import { branchNameForTarget, type BranchTarget } from "../cli/branch-target.js";
import { journalPath, runDir, workspaceDir } from "./paths.js";
import { resolveCheckpointCommit } from "./activities.js";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

function appendJournalCopy(child: Journal, entry: JournalEntry): void {
  child.append({
    kind: entry.kind,
    payload: entry.payload,
    costDeltaUsd: entry.costDeltaUsd,
    ...(entry.tokens !== undefined ? { tokens: entry.tokens as TokenUsage } : {}),
    artifactRefs: entry.artifactRefs,
  });
}

export interface BranchForkResult {
  parentRunId: string;
  childRunId: string;
  checkpointId: string;
  checkpointCommit: string;
  spec: TaskSpec;
}

export async function forkRunAtCheckpoint(input: {
  dataDir: string;
  target: BranchTarget;
  childRunId?: string;
}): Promise<BranchForkResult> {
  const parentJournalPath = journalPath(input.dataDir, input.target.runId);
  if (!existsSync(parentJournalPath)) {
    throw new Error(
      `run '${input.target.runId}' was not found under ${input.dataDir}/runs (list runs: chikory status)`,
    );
  }

  const parent = new Journal(parentJournalPath);
  let spec: TaskSpec;
  let cutoffIdx = -1;
  try {
    const run = parent.getRun();
    if (!run) throw new Error(`run '${input.target.runId}' has no run metadata`);
    spec = run.task;
    if (input.target.step !== "base") {
      const checkpoint = parent
        .entries("checkpoint")
        .find((entry) => (entry.payload as Checkpoint).id === input.target.checkpointId);
      if (!checkpoint) {
        throw new Error(
          `checkpoint '${input.target.checkpointId}' was not found in run '${input.target.runId}' ` +
            `(inspect checkpoints: chikory status ${input.target.runId})`,
        );
      }
      cutoffIdx = checkpoint.idx;
    }
  } finally {
    parent.close();
  }

  const checkpointCommit = await resolveCheckpointCommit({
    dataDir: input.dataDir,
    runId: input.target.runId,
    checkpointId: input.target.checkpointId,
  });
  const childRunId =
    input.childRunId ?? `${branchNameForTarget(input.target)}-${randomUUID().slice(0, 8)}`;
  const childWs = workspaceDir(input.dataDir, childRunId);
  if (existsSync(childWs)) {
    throw new Error(`branch child workspace already exists: ${childWs}`);
  }

  await mkdir(runDir(input.dataDir, childRunId), { recursive: true });
  await execFileAsync("git", [
    "-C",
    workspaceDir(input.dataDir, input.target.runId),
    "worktree",
    "add",
    "--detach",
    childWs,
    checkpointCommit,
  ]);
  await git(childWs, ["checkout", "-b", `chikory/run-${childRunId}`]);
  await git(childWs, ["config", "user.name", "chikory"]);
  await git(childWs, ["config", "user.email", "runner@chikory.local"]);

  const child = new Journal(journalPath(input.dataDir, childRunId));
  const parentAgain = new Journal(parentJournalPath);
  try {
    child.createRun(childRunId, spec);
    for (const entry of parentAgain.entries()) {
      if (entry.idx > cutoffIdx) break;
      appendJournalCopy(child, entry);
    }
    child.append({
      kind: "control_event",
      payload: {
        event: "branch_fork",
        source: "operator",
        parentRunId: input.target.runId,
        forkCheckpointId: input.target.checkpointId,
        forkCommit: checkpointCommit,
      },
      costDeltaUsd: 0,
      artifactRefs: [],
    });
  } finally {
    parentAgain.close();
    child.close();
  }

  return {
    parentRunId: input.target.runId,
    childRunId,
    checkpointId: input.target.checkpointId,
    checkpointCommit,
    spec,
  };
}
