import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, inject, test } from "vitest";

import { cmdBranch, cmdResume } from "../../src/cli/commands.js";
import { parseBranchTarget } from "../../src/cli/branch-target.js";
import { createRunnerActivities } from "../../src/runner/activities.js";
import { forkRunAtCheckpoint } from "../../src/runner/branch.js";
import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  workspaceDir,
  type ArtifactRef,
  type Checkpoint,
  type ContextBundle,
  type StepRecord,
} from "../../src/index.js";
import {
  initSourceRepo,
  makeSpec,
  scriptedRegistry,
  TERMINAL_STATUSES,
  waitFor,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const execFileAsync = promisify(execFile);

const ref: ArtifactRef = {
  id: "artifact",
  kind: "diff",
  bytes: 1,
  summary: "artifact",
};

function context(): ContextBundle {
  return {
    goal: "branch test",
    acceptanceCriteria: [{ id: "AC-1", description: "test" }],
    planItem: "branch test",
    notes: {},
    recentSteps: [],
    injections: [],
    memoryRefs: [],
  };
}

function stepRecord(step: number): StepRecord {
  return {
    status: "SUCCESS",
    diffRef: ref,
    summary: `step ${step}`,
    toolCalls: 1,
    tokens: { input: 10, output: 5 },
    costUsd: 0.01,
    costEstimated: false,
    durationMs: 1,
    transcriptRef: { ...ref, kind: "transcript" },
  };
}

describe("branch fork runtime", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("forkRunAtCheckpoint seeds the child journal through the fork checkpoint and worktrees the checkpoint commit", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-branch-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const parentRunId = "run-parent";
    const childRunId = "run-child";
    const spec = makeSpec({ repoUrl, maxSteps: 4 });
    const activities = createRunnerActivities({ dataDir, adapters: scriptedRegistry });
    const prepared = await activities.prepareRun({ runId: parentRunId, spec });
    expect(prepared.status).toBe("SUCCESS");

    const parentJournal = new Journal(journalPath(dataDir, parentRunId));
    try {
      parentJournal.append({
        kind: "step",
        payload: { stepIndex: 0, instruction: "one", planItem: "one", record: stepRecord(0) },
        costDeltaUsd: 0.01,
        tokens: { input: 10, output: 5 },
        artifactRefs: [ref],
      });
    } finally {
      parentJournal.close();
    }
    await writeFile(join(workspaceDir(dataDir, parentRunId), "fork.txt"), "checkpoint\n");
    const forkCheckpoint = await activities.writeCheckpoint({
      runId: parentRunId,
      stepIndex: 0,
      context: context(),
      budgetSpentUsd: 0.01,
      lastGood: true,
    });

    const laterJournal = new Journal(journalPath(dataDir, parentRunId));
    try {
      laterJournal.append({
        kind: "step",
        payload: { stepIndex: 1, instruction: "two", planItem: "two", record: stepRecord(1) },
        costDeltaUsd: 0.01,
        tokens: { input: 10, output: 5 },
        artifactRefs: [ref],
      });
    } finally {
      laterJournal.close();
    }
    await writeFile(join(workspaceDir(dataDir, parentRunId), "fork.txt"), "later\n");
    await activities.writeCheckpoint({
      runId: parentRunId,
      stepIndex: 1,
      context: context(),
      budgetSpentUsd: 0.02,
      lastGood: false,
    });

    const fork = await forkRunAtCheckpoint({
      dataDir,
      target: parseBranchTarget(forkCheckpoint.id),
      childRunId,
    });

    expect(fork.childRunId).toBe(childRunId);
    expect(await readFile(join(workspaceDir(dataDir, childRunId), "fork.txt"), "utf8")).toBe(
      "checkpoint\n",
    );
    const { stdout: head } = await execFileAsync("git", [
      "-C",
      workspaceDir(dataDir, childRunId),
      "rev-parse",
      "HEAD",
    ]);
    expect(head.trim()).toBe(Object.values(forkCheckpoint.gitCommits)[0]);

    const child = new Journal(journalPath(dataDir, childRunId));
    try {
      const entries = child.entries();
      expect(entries.map((entry) => entry.kind)).toEqual(["step", "checkpoint", "control_event"]);
      expect((entries[0]!.payload as { stepIndex: number }).stepIndex).toBe(0);
      expect(entries.some((entry) => JSON.stringify(entry.payload).includes("stepIndex\":1"))).toBe(
        false,
      );
      expect(entries[2]!.payload).toMatchObject({
        event: "branch_fork",
        parentRunId,
        forkCheckpointId: forkCheckpoint.id,
      });
    } finally {
      child.close();
    }
  });
});

describe.skipIf(address === null)("branch live proof (WP-205)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("cmdBranch forks a checkpointed run; child resumes from the fork and parent stays intact", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-branch-live-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `branch-tq-${randomUUID()}`;
    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    const spec = makeSpec({ repoUrl, maxSteps: 3, judge: { family: "gemini", cadence: 10 } });
    const parent = await runner.start(spec);
    const parentReport = await waitFor(
      async () => {
        const report = await parent.status();
        return TERMINAL_STATUSES.includes(report.status) ? report : undefined;
      },
      { what: "parent terminal" },
    );
    expect(parentReport.checkpoints).toHaveLength(3);
    const forkCheckpoint = parentReport.checkpoints[0]!;
    const parentJournalBefore = new Journal(journalPath(dataDir, parent.runId));
    const parentEntryCount = parentJournalBefore.entries().length;
    parentJournalBefore.close();
    worker.shutdown();
    await workerDone;
    await runner.close();

    const out: string[] = [];
    const err: string[] = [];
    const branchCode = await cmdBranch(
      {
        target: forkCheckpoint.id,
        json: true,
        dataDir,
        address: address!,
      },
      { taskQueue, out: (line) => out.push(line), err: (line) => err.push(line) },
    );
    expect(branchCode, err.join("\n")).toBe(0);
    const branchPayload = JSON.parse(out[0]!) as { childRunId: string };
    const childRunId = branchPayload.childRunId;
    expect(await readFile(join(workspaceDir(dataDir, childRunId), "step-1.txt"), "utf8")).toBe(
      spec.goal,
    );
    await expect(readFile(join(workspaceDir(dataDir, childRunId), "step-2.txt"), "utf8")).rejects.toThrow();

    const resumeOut: string[] = [];
    const resumeErr: string[] = [];
    const resumeCode = await cmdResume(
      {
        runId: childRunId,
        watch: false,
        json: false,
        dataDir,
        address: address!,
      },
      {
        adapters: scriptedRegistry,
        workflowBundlePath: bundlePath!,
        taskQueue,
        out: (line) => resumeOut.push(line),
        err: (line) => resumeErr.push(line),
        pollIntervalMs: 150,
      },
    );
    expect(resumeCode).toBe(1);
    expect(resumeOut.join("\n")).toContain(childRunId);
    expect(resumeOut.join("\n")).toContain("FAILED");

    const child = new Journal(journalPath(dataDir, childRunId));
    try {
      const entries = child.entries();
      expect(entries.some((entry) => entry.kind === "control_event" && JSON.stringify(entry.payload).includes("branch_fork"))).toBe(true);
      expect(
        child
          .entries("step")
          .map((entry) => (entry.payload as { stepIndex: number }).stepIndex),
      ).toEqual([0, 1, 2]);
      expect(child.entries("checkpoint")[0]!.payload as Checkpoint).toMatchObject({
        id: forkCheckpoint.id,
      });
    } finally {
      child.close();
    }

    const parentJournalAfter = new Journal(journalPath(dataDir, parent.runId));
    try {
      expect(parentJournalAfter.entries()).toHaveLength(parentEntryCount);
    } finally {
      parentJournalAfter.close();
    }
    expect(await readFile(join(workspaceDir(dataDir, parent.runId), "step-3.txt"), "utf8")).toBe(
      spec.goal,
    );
  });
});
