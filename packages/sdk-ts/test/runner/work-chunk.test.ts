import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  decideWorkChunk,
  Journal,
  journalPath,
  type RunStatusReport,
  type StepPayload,
} from "../../src/index.js";
import type { BoundedWorkUnitPolicy } from "../../src/types.js";
import {
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
  type ScriptedConfig,
} from "./helpers.js";
import { workspaceDir } from "../../src/runner/paths.js";

describe("decideWorkChunk", () => {
  const policy: BoundedWorkUnitPolicy = {
    minDurableSteps: 3,
    workChunks: [
      { name: "first", directive: "Implement the parser only." },
      { name: "second", directive: "Wire the parser into the CLI only." },
      { name: "third", directive: "Add the focused regression test only." },
    ],
  };

  test("first step selects the first chunk", () => {
    expect(decideWorkChunk({ consumedChunks: 0 }, policy)).toEqual({
      action: "use_chunk",
      chunk: policy.workChunks![0],
    });
  });

  test("mid-list selects the next unconsumed chunk", () => {
    expect(decideWorkChunk({ consumedChunks: 1 }, policy)).toEqual({
      action: "use_chunk",
      chunk: policy.workChunks![1],
    });
  });

  test("all consumed allows completion to proceed", () => {
    expect(decideWorkChunk({ consumedChunks: 3 }, policy)).toEqual({
      action: "all_chunks_consumed",
    });
    expect(decideWorkChunk({ consumedChunks: 99 }, policy)).toEqual({
      action: "all_chunks_consumed",
    });
  });

  test("empty or absent chunk list never chunks and preserves WP-269 default behavior", () => {
    expect(decideWorkChunk({ consumedChunks: 0 })).toEqual({ action: "no_chunks" });
    expect(decideWorkChunk({ consumedChunks: 0 }, { minDurableSteps: 3 })).toEqual({
      action: "no_chunks",
    });
    expect(
      decideWorkChunk({ consumedChunks: 0 }, { minDurableSteps: 3, workChunks: [] }),
    ).toEqual({ action: "no_chunks" });
  });

  test("normalizes out-of-range state and does not mutate inputs", () => {
    const original = {
      minDurableSteps: policy.minDurableSteps,
      workChunks: policy.workChunks!.map((chunk) => ({ ...chunk })),
    };

    expect(decideWorkChunk({ consumedChunks: -10 }, policy)).toEqual({
      action: "use_chunk",
      chunk: policy.workChunks![0],
    });
    expect(decideWorkChunk({ consumedChunks: Number.NaN }, policy)).toEqual({
      action: "use_chunk",
      chunk: policy.workChunks![0],
    });
    expect(decideWorkChunk({ consumedChunks: 1.9 }, policy)).toEqual({
      action: "use_chunk",
      chunk: policy.workChunks![1],
    });
    expect(decideWorkChunk({ consumedChunks: Number.POSITIVE_INFINITY }, policy)).toEqual({
      action: "use_chunk",
      chunk: policy.workChunks![0],
    });
    expect(policy).toEqual(original);
  });
});

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("work-chunk live Temporal proof", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(opts: {
    judgeWireUrl: string;
    scriptedConfig: Partial<ScriptedConfig>;
  }) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-work-chunk-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), opts.scriptedConfig);
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": opts.judgeWireUrl } },
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });
    return { repoUrl, dataDir, runner };
  }

  async function awaitTerminal(
    handle: { status(): Promise<RunStatusReport> },
  ): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const report = await handle.status();
        return TERMINAL_STATUSES.includes(report.status) ? report : undefined;
      },
      { what: "work-chunk run to reach a terminal status" },
    );
  }

  test("hands one distinct ordered chunk to each forced durable step, while no chunk list stays on WP-269", async () => {
    const fullGoal =
      "Complete the scripted product surface in three dependency-ordered increments.";
    const chunks = [
      { name: "parser", directive: "Implement only the parser increment." },
      { name: "cli", directive: "Wire only the CLI increment." },
      { name: "test", directive: "Add only the regression-test increment." },
    ];

    expect(decideWorkChunk({ consumedChunks: 0 }, { minDurableSteps: 3, workChunks: chunks }))
      .toEqual({ action: "use_chunk", chunk: chunks[0] });

    const chunkedWire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => chunkedWire.close());
    const chunked = await setup({
      judgeWireUrl: chunkedWire.url,
      scriptedConfig: { claimsCompleteSteps: [1, 2, 3], echoJudgeFeedback: true },
    });
    const chunkedSpec = makeJudgedSpec({
      repoUrl: chunked.repoUrl,
      goal: fullGoal,
      maxSteps: 5,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
    });

    const chunkedHandle = await chunked.runner.start(chunkedSpec);
    const chunkedReport = await awaitTerminal(chunkedHandle);

    expect(chunkedReport.status).toBe("SUCCESS");
    expect(chunkedReport.currentStep).toBeGreaterThanOrEqual(chunks.length);
    expect(chunkedReport.checkpoints.length).toBeGreaterThanOrEqual(chunks.length);
    expect(chunkedReport.lastVerdict).toEqual({ kind: "PROCEED", atStep: chunks.length - 1 });
    expect(chunkedWire.hits).toBe(chunks.length);

    const directives = chunks.map((chunk) => chunk.directive);
    const chunkedJournal = new Journal(journalPath(chunked.dataDir, chunkedHandle.runId));
    try {
      const steps = chunkedJournal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(steps).toHaveLength(chunks.length);
      expect(steps.map((step) => step.instruction)).toEqual(directives);
      expect(steps.map((step) => step.planItem)).toEqual(directives);
      expect(new Set(steps.map((step) => step.instruction)).size).toBe(chunks.length);
      expect(steps.every((step) => step.instruction !== fullGoal)).toBe(true);
      expect(steps.every((step) => step.record.diffRef.bytes > 0)).toBe(true);
      expect(new Set(steps.map((step) => step.record.diffRef.summary)).size).toBe(
        chunks.length,
      );
      expect(chunkedJournal.entries("checkpoint").length).toBeGreaterThanOrEqual(chunks.length);
      expect((chunkedJournal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
    } finally {
      chunkedJournal.close();
    }

    const chunkedWorkspace = workspaceDir(chunked.dataDir, chunkedHandle.runId);
    await expect(readFile(join(chunkedWorkspace, "step-1.txt"), "utf8")).resolves.toBe(
      chunks[0]!.directive,
    );
    await expect(readFile(join(chunkedWorkspace, "step-2.txt"), "utf8")).resolves.toBe(
      chunks[1]!.directive,
    );
    await expect(readFile(join(chunkedWorkspace, "step-3.txt"), "utf8")).resolves.toBe(
      chunks[2]!.directive,
    );

    const noChunkDirective = "Complete exactly the next numbered part before claiming done.";
    const noChunkWire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => noChunkWire.close());
    const noChunk = await setup({
      judgeWireUrl: noChunkWire.url,
      scriptedConfig: { claimsCompleteSteps: [1, 2, 3], echoJudgeFeedback: true },
    });
    const noChunkSpec = makeJudgedSpec({
      repoUrl: noChunk.repoUrl,
      goal: fullGoal,
      maxSteps: 5,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, directive: noChunkDirective },
    });

    const noChunkHandle = await noChunk.runner.start(noChunkSpec);
    const noChunkReport = await awaitTerminal(noChunkHandle);

    expect(noChunkReport.status).toBe("SUCCESS");
    expect(noChunkReport.checkpoints).toHaveLength(chunks.length);
    expect(noChunkReport.lastVerdict).toEqual({ kind: "PROCEED", atStep: chunks.length - 1 });
    expect(noChunkWire.hits).toBe(chunks.length);

    const noChunkJournal = new Journal(journalPath(noChunk.dataDir, noChunkHandle.runId));
    try {
      const steps = noChunkJournal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(steps).toHaveLength(chunks.length);
      expect(steps.map((step) => step.instruction)).toEqual([fullGoal, fullGoal, fullGoal]);
      expect(steps[1]!.record.summary).toContain(noChunkDirective);
      expect(steps[2]!.record.summary).toContain(noChunkDirective);
      expect((noChunkJournal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
    } finally {
      noChunkJournal.close();
    }
  });

  test("retries the same chunk after ROLLBACK instead of skipping ahead", async () => {
    const chunks = [
      { name: "parser", directive: "Implement only the parser increment." },
      { name: "cli", directive: "Wire only the CLI increment." },
    ];

    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, rubricFails: ["no_secrets_introduced"] }),
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    cleanups.push(() => wire.close());
    const run = await setup({
      judgeWireUrl: wire.url,
      scriptedConfig: { claimsCompleteSteps: [1, 2], echoJudgeFeedback: true },
    });
    const spec = makeJudgedSpec({
      repoUrl: run.repoUrl,
      goal: "Complete the scripted surface without skipping rolled-back chunks.",
      maxSteps: 5,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
    });

    const handle = await run.runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.hits).toBe(3);
    expect(report.lastVerdict).toEqual({ kind: "PROCEED", atStep: 2 });

    const journal = new Journal(journalPath(run.dataDir, handle.runId));
    try {
      const steps = journal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(steps.map((step) => step.instruction)).toEqual([
        chunks[0]!.directive,
        chunks[0]!.directive,
        chunks[1]!.directive,
      ]);
      expect(journal.entries("checkpoint")).toHaveLength(3);
      expect((journal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
    } finally {
      journal.close();
    }
  });

  test("advances chunked durable steps even when the executor does not claim completion", async () => {
    const chunks = [
      { name: "parser", directive: "Implement only the parser increment." },
      { name: "cli", directive: "Wire only the CLI increment." },
    ];

    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const run = await setup({
      judgeWireUrl: wire.url,
      scriptedConfig: {},
    });
    const spec = makeJudgedSpec({
      repoUrl: run.repoUrl,
      goal: "Complete the scripted surface one bounded chunk at a time.",
      maxSteps: 4,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
    });

    const handle = await run.runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(report.checkpoints).toHaveLength(chunks.length);
    expect(report.lastVerdict).toEqual({ kind: "PROCEED", atStep: chunks.length - 1 });
    expect(wire.hits).toBe(chunks.length);

    const journal = new Journal(journalPath(run.dataDir, handle.runId));
    try {
      const steps = journal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(steps.map((step) => step.instruction)).toEqual(
        chunks.map((chunk) => chunk.directive),
      );
      expect(steps.every((step) => step.record.claimsComplete !== true)).toBe(true);
      expect(journal.entries("checkpoint")).toHaveLength(chunks.length);
      expect((journal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
    } finally {
      journal.close();
    }
  });
});
