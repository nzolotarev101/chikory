/**
 * WP-121 — journaled agent loop on a real Temporal dev server.
 * Asserts: one journal entry per executor step, judge pass per cadence as
 * its own activity, explicit terminal seal, and deterministic replay of the
 * complete event history.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  type JudgeVerdict,
  type RunnerActivities,
  type RunStatusReport,
  type StepPayload,
} from "../../src/index.js";
import {
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  makeSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
  type ScriptedConfig,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("agent loop (WP-121)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(opts: {
    judgeOverride?: RunnerActivities["judgeStep"];
    judgeWireUrl?: string;
    scriptedConfig?: Partial<ScriptedConfig>;
  }) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-runner-"));
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
      ...(opts.judgeWireUrl
        ? { routerOptions: { baseUrls: { "openai-compat": opts.judgeWireUrl } } }
        : {}),
      ...(opts.judgeOverride ? { activitiesOverride: { judgeStep: opts.judgeOverride } } : {}),
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });
    return { repoUrl, dataDir, taskQueue, runner };
  }

  async function awaitTerminal(
    handle: { status(): Promise<RunStatusReport> },
  ): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const report = await handle.status();
        return TERMINAL_STATUSES.includes(report.status) ? report : undefined;
      },
      { what: "run to reach a terminal status" },
    );
  }

  test("journals one step entry per executor step, judge pass per cadence, terminal seal; replays deterministically", async () => {
    // Real judgeStep over a fake wire: the judge never confirms AC-1, every
    // verdict is a work-in-progress PROCEED → loop ends at maxSteps, FAILED.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup({ judgeWireUrl: wire.url });
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 4, cadence: 2 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("maxSteps");
    expect(report.currentStep).toBe(4);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const steps = journal.entries("step");
      expect(steps).toHaveLength(4);
      expect(steps.map((e) => (e.payload as StepPayload).stepIndex)).toEqual([0, 1, 2, 3]);

      const all = journal.entries();
      const idxs = all.map((e) => e.idx);
      expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
      expect(new Set(idxs).size).toBe(idxs.length);

      // cadence=2 over 4 steps → exactly 2 judge passes, each journaled as a
      // `judge` entry (form + evidence refs) plus a `verdict` entry.
      expect(journal.entries("judge")).toHaveLength(2);
      expect(journal.entries("verdict")).toHaveLength(2);
      expect(wire.hits).toBe(2);

      const terminal = journal.entries("terminal");
      expect(terminal).toHaveLength(1);
      expect((terminal[0]!.payload as { status: string }).status).toBe("FAILED");
      expect(journal.getRun()?.status).toBe("FAILED");

      // 4 steps × $0.01; the fake judge model has no price row → $0.
      expect(journal.totalCostUsd()).toBeCloseTo(0.04, 10);
    } finally {
      journal.close();
    }

    // Deterministic replay (WP-121 acceptance): full history replays clean.
    const connection = await Connection.connect({ address: address! });
    try {
      const client = new Client({ connection });
      const history = await client.workflow.getHandle(handle.runId).fetchHistory();
      await Worker.runReplayHistory({ workflowBundle: { codePath: bundlePath! } }, history);
    } finally {
      await connection.close();
    }
  });

  test("run succeeds when the judge confirms every acceptance criterion", async () => {
    let dataDirRef = "";
    const decidingJudge: RunnerActivities["judgeStep"] = async (input) => {
      const verdict: JudgeVerdict = {
        kind: "PROCEED",
        form: {
          criterionResults: input.criteria.map((c) => ({
            id: c.id,
            pass: true,
            justification: "test judge: confirmed",
          })),
          rubricResults: [],
          concerns: [],
        },
        rationale: "test judge: all criteria met",
        costUsd: 0.001,
        tokens: { input: 10, output: 5 },
        judgeModel: { provider: "gemini", model: "test-judge" },
      };
      const journal = new Journal(journalPath(dataDirRef, input.runId));
      try {
        journal.appendOnce(
          { field: "judgeIndex", value: input.judgeIndex },
          {
            kind: "verdict",
            payload: { judgeIndex: input.judgeIndex, atStep: input.atStep, verdict },
            costDeltaUsd: verdict.costUsd,
            tokens: verdict.tokens,
            artifactRefs: [],
          },
        );
      } finally {
        journal.close();
      }
      return verdict;
    };

    const { repoUrl, dataDir, runner } = await setup({ judgeOverride: decidingJudge });
    dataDirRef = dataDir;
    const spec = makeSpec({ repoUrl, maxSteps: 10, judge: { family: "gemini", cadence: 2 } });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(report.lastVerdict).toEqual({ kind: "PROCEED", atStep: 1 });

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      // Judge confirmed at the cadence boundary (after step 2) — no extra steps.
      expect(journal.entries("step")).toHaveLength(2);
      expect((journal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
      // Cost conservation includes judge spend (JD-7 visibility).
      expect(journal.totalCostUsd()).toBeCloseTo(0.021, 10);
    } finally {
      journal.close();
    }
  });

  test("empty successful diff triggers an off-cadence judge pass and seals SUCCESS", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup({
      judgeWireUrl: wire.url,
      scriptedConfig: { emptyDiffSteps: [1] },
    });
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 3, cadence: 10 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(report.currentStep).toBe(1);
    expect(report.lastVerdict).toEqual({ kind: "PROCEED", atStep: 0 });

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("step")).toHaveLength(1);
      expect(journal.entries("judge")).toHaveLength(1);
      expect(journal.entries("verdict")).toHaveLength(1);
      expect(journal.entries("terminal")).toHaveLength(1);
      expect((journal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
      expect(wire.hits).toBe(1);
    } finally {
      journal.close();
    }
  });

  test("F-11 retired: a productive (non-empty) step that claimsComplete is judged directly — no probe step", async () => {
    // The F-11 cost win, proven end-to-end (WP-221 Slice A trigger + Slice B
    // consumption). Step 1 writes a REAL diff (bytes > 0) AND claims
    // completion. With cadence 10, the empty-diff trigger would NOT fire here
    // (the diff is non-empty) — only `claimsComplete` does. So the productive
    // step is judged at step 1 and the run seals SUCCESS in ONE step. Before
    // Slice B nothing set `claimsComplete`, so the loop took a second
    // empty-diff probe step purely to elicit the off-cadence judge pass — the
    // 5–35 % F-11 tax. This asserts that probe step is gone.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup({
      judgeWireUrl: wire.url,
      scriptedConfig: { claimsCompleteSteps: [1] }, // non-empty diff + completion claim
    });
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 3, cadence: 10 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(report.currentStep).toBe(1); // sealed on the productive step — no probe
    expect(report.lastVerdict).toEqual({ kind: "PROCEED", atStep: 0 });

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const steps = journal.entries("step").map((e) => e.payload as StepPayload);
      expect(steps).toHaveLength(1); // exactly one step, not the old two (probe gone)
      expect(steps[0]!.record.claimsComplete).toBe(true);
      // The judged step carried a real diff — the milestone fired on the claim,
      // not on an empty diff.
      expect(steps[0]!.record.diffRef.bytes).toBeGreaterThan(0);
      expect(journal.entries("judge")).toHaveLength(1);
      expect(journal.entries("terminal")).toHaveLength(1);
      expect(wire.hits).toBe(1);
    } finally {
      journal.close();
    }
  });

  test("incomplete empty-diff verdict keeps RUNNING and feeds rationale into the next step", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup({
      judgeWireUrl: wire.url,
      scriptedConfig: {
        delayMs: 500,
        emptyDiffSteps: [1],
        echoJudgeFeedback: true,
      },
    });
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 2, cadence: 10 });

    const handle = await runner.start(spec);
    const running = await waitFor(
      async () => {
        const report = await handle.status();
        return wire.hits === 1 && report.currentStep === 1 && report.status === "RUNNING" && report.lastVerdict !== undefined
          ? report
          : undefined;
      },
      { what: "run to continue after the completion-milestone verdict" },
    );

    expect(running.status).toBe("RUNNING");
    expect(running.lastVerdict).toEqual({ kind: "PROCEED", atStep: 0 });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("maxSteps");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const steps = journal.entries("step").map((entry) => entry.payload as StepPayload);
      expect(steps).toHaveLength(2);
      expect(steps[1]!.record.summary).toContain(
        "judge feedback: work in progress, no regressions — unmet criteria: AC-1",
      );
      expect(journal.entries("judge")).toHaveLength(1);
      expect(journal.entries("terminal")).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
});
