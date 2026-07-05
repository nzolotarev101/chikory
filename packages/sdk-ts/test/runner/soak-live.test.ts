/**
 * Durable soak re-entry over the real Temporal runner.
 *
 * This proves the opt-in soak policy parks the workflow on a Temporal timer
 * between durable steps, then re-enters without duplicating completed work.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  decideSoakDelay,
  Journal,
  journalPath,
  runTotals,
  type JournalEntry,
  type RunRow,
  type RunStatusReport,
  type StepPayload,
} from "../../src/index.js";
import { renderTrace } from "../../src/cli/trace.js";
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

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

const hostSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(address === null)("durable soak re-entry", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(opts: {
    judgeWireUrl: string;
    scriptedConfig?: Partial<ScriptedConfig>;
  }) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-soak-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), {
      costPerStep: 0.01,
      claimsCompleteSteps: [1, 2],
      echoJudgeFeedback: true,
      ...opts.scriptedConfig,
    });
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

  async function awaitStatus(
    handle: { status(): Promise<RunStatusReport> },
    want: (r: RunStatusReport) => boolean,
    what: string,
    observed: RunStatusReport["status"][] = [],
  ): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const report = await handle.status();
        observed.push(report.status);
        return want(report) ? report : undefined;
      },
      { intervalMs: 25, what },
    );
  }

  function traceFor(dataDir: string, runId: string): string {
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      const run = journal.getRun();
      if (run === undefined) throw new Error(`missing run row for ${runId}`);
      return renderTrace(run as RunRow, journal.entries() as JournalEntry[], runTotals(journal));
    } finally {
      journal.close();
    }
  }

  function totalsSubLine(trace: string): string {
    const line = trace.split("\n").find((candidate) => candidate.includes("injections "));
    if (line === undefined) throw new Error(`missing totals sub-line in trace:\n${trace}`);
    return line;
  }

  test("opt-in compressed soak durably suspends between multi-chunk steps and renders telemetry", async () => {
    expect(
      decideSoakDelay(
        { completedReentries: 0, totalSleptMs: 0 },
        { sleepMs: 1_200, maxReentries: 1 },
      ),
    ).toEqual({ sleepMs: 1_200 });

    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup({ judgeWireUrl: wire.url });
    const chunks = [
      { name: "parser", directive: "Implement only the parser chunk." },
      { name: "cli", directive: "Wire only the CLI chunk." },
    ];
    const spec = makeJudgedSpec({
      repoUrl,
      goal: "Complete the soak-paced product surface in ordered chunks.",
      maxSteps: 4,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
      unattended: { escalation: "seal_resumable_failed" },
      soak: { sleepMs: 1_200, maxReentries: 1, maxTotalSleepMs: 1_200 },
    });

    const startedAt = Date.now();
    const handle = await runner.start(spec);
    const dbPath = journalPath(dataDir, handle.runId);
    const observedStatuses: RunStatusReport["status"][] = [];

    const parked = await awaitStatus(
      handle,
      (report) => report.status === "SUSPENDED" && report.currentStep === 1,
      "soak SUSPENDED after the first durable step",
      observedStatuses,
    );
    expect(parked.spentUsd).toBeCloseTo(0.01, 10);

    await hostSleep(350);
    expect(existsSync(dbPath)).toBe(true);
    const duringSoak = new Journal(dbPath);
    try {
      const steps = duringSoak.entries("step");
      expect(steps).toHaveLength(1);
      expect((steps[0]!.payload as StepPayload).stepIndex).toBe(0);
      expect(duringSoak.entries("control_event")).toHaveLength(0);
    } finally {
      duringSoak.close();
    }

    const finished = await awaitStatus(
      handle,
      (report) => TERMINAL_STATUSES.includes(report.status),
      "terminal after soak re-entry",
      observedStatuses,
    );
    expect(finished.status).toBe("SUCCESS");
    expect(finished.currentStep).toBe(2);
    expect(finished.lastVerdict).toEqual({ kind: "PROCEED", atStep: chunks.length - 1 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(950);
    expect(observedStatuses).toContain("SUSPENDED");
    expect(observedStatuses).not.toContain("AWAITING_APPROVAL");
    expect(wire.hits).toBe(chunks.length);

    const journal = new Journal(dbPath);
    try {
      const steps = journal.entries("step");
      expect(steps.map((entry) => (entry.payload as StepPayload).stepIndex)).toEqual([0, 1]);
      expect(steps.map((entry) => (entry.payload as StepPayload).instruction)).toEqual(
        chunks.map((chunk) => chunk.directive),
      );
      const controlEvents = journal.entries("control_event").map((entry) => entry.payload as {
        event: string;
        source: string;
        atStep: number;
        details?: Record<string, number>;
      });
      expect(controlEvents).toMatchObject([
        {
          event: "resume",
          source: "soak",
          atStep: 1,
          details: { sleepMs: 1_200, completedReentries: 1, totalSleptMs: 1_200 },
        },
      ]);
      expect(journal.totalCostUsd()).toBeCloseTo(0.02, 10);
      expect((journal.entries("terminal")[0]!.payload as { status: string }).status).toBe(
        "SUCCESS",
      );
    } finally {
      journal.close();
    }

    const rendered = traceFor(dataDir, handle.runId);
    expect(rendered).toContain(`${handle.runId} · SUCCESS · 2 steps`);
    expect(rendered).toContain("re-entries 1 · soak-slept 1s");
    expect(rendered).toContain("feedback frequency 1/1 steps");
    expect(rendered).not.toContain("AWAITING_APPROVAL");
  });

  test("no-soak byte-equivalent path finishes without Temporal timer telemetry", async () => {
    expect(decideSoakDelay({ completedReentries: 0, totalSleptMs: 0 })).toBeNull();

    const chunks = [
      { name: "parser", directive: "Implement only the parser chunk." },
      { name: "cli", directive: "Wire only the CLI chunk." },
    ];
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const noSoak = await setup({ judgeWireUrl: wire.url });
    const spec = makeJudgedSpec({
      repoUrl: noSoak.repoUrl,
      goal: "Complete the no-soak product surface in ordered chunks.",
      maxSteps: 4,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
      unattended: { escalation: "seal_resumable_failed" },
    });

    const handle = await noSoak.runner.start(spec);
    const observedStatuses: RunStatusReport["status"][] = [];
    const finished = await awaitStatus(
      handle,
      (report) => TERMINAL_STATUSES.includes(report.status),
      "terminal without soak timer",
      observedStatuses,
    );

    expect(finished.status).toBe("SUCCESS");
    expect(finished.currentStep).toBe(chunks.length);
    expect(finished.lastVerdict).toEqual({ kind: "PROCEED", atStep: chunks.length - 1 });
    expect(observedStatuses).not.toContain("SUSPENDED");
    expect(observedStatuses).not.toContain("AWAITING_APPROVAL");
    // F-115: the no-timer guarantee is proven STRUCTURALLY — no SUSPENDED status
    // (above) and zero soak `control_event` entries (below). A wall-clock upper
    // bound (`Date.now() - startedAt < 1000`) false-fails on a slow/loaded host
    // (observed 1898ms) while proving nothing the structural asserts don't.
    expect(wire.hits).toBe(chunks.length);

    const journal = new Journal(journalPath(noSoak.dataDir, handle.runId));
    try {
      expect(journal.entries("control_event")).toHaveLength(0);
      expect(journal.entries("step").map((entry) => (entry.payload as StepPayload).instruction))
        .toEqual(chunks.map((chunk) => chunk.directive));
    } finally {
      journal.close();
    }

    const rendered = traceFor(noSoak.dataDir, handle.runId);
    expect(rendered).toContain(`${handle.runId} · SUCCESS · 2 steps`);
    expect(rendered).not.toContain("re-entries");
    expect(rendered).not.toContain("soak-slept");
    expect(totalsSubLine(rendered)).toBe(
      "        injections 0 · checkpoints 2 · pacing events 2 · peak window 0% (compact 0 · park 0) · feedback frequency 1/1 steps",
    );
  });
});
