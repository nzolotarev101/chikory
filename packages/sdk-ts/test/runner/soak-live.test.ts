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

import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  decideSoakDelay,
  Journal,
  journalPath,
  recordRunStepSpan,
  resolveRunRootContext,
  runTotals,
  SPAN_CHECKPOINT,
  SPAN_RUN,
  SPAN_RUN_STEP,
  SPAN_SOAK,
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
const SHORT_SOAK_MS = 500;
const FRESH_WORKER_SOAK_MS = 800;
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);

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

  async function startWorker(opts: {
    dataDir: string;
    taskQueue: string;
    judgeWireUrl: string;
  }) {
    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue: opts.taskQueue,
      dataDir: opts.dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": opts.judgeWireUrl } },
    });
    const done = worker.run();
    return {
      async shutdown() {
        worker.shutdown();
        await done;
      },
    };
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

  test("opt-in short soak emits live durable-loop spans under the run root", async () => {
    exporter.reset();
    expect(createRunnerWorker).toBeTypeOf("function");
    expect(recordRunStepSpan).toBeTypeOf("function");
    expect(resolveRunRootContext).toBeTypeOf("function");
    expect(
      decideSoakDelay(
        { completedReentries: 0, totalSleptMs: 0 },
        { sleepMs: SHORT_SOAK_MS, maxReentries: 1 },
      ),
    ).toEqual({ sleepMs: SHORT_SOAK_MS });

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
      soak: { sleepMs: SHORT_SOAK_MS, maxReentries: 1, maxTotalSleepMs: SHORT_SOAK_MS },
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

    await hostSleep(100);
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
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(350);
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
          details: {
            sleepMs: SHORT_SOAK_MS,
            completedReentries: 1,
            totalSleptMs: SHORT_SOAK_MS,
          },
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

    const spans = exporter.getFinishedSpans();
    const rootContext = resolveRunRootContext(handle.runId);
    const runSpan = spans.find(
      (span) => span.name === SPAN_RUN && span.attributes.lifecycle === "end",
    );
    expect(runSpan).toBeDefined();
    expect(runSpan!.attributes).toMatchObject({
      "run.id": handle.runId,
      lifecycle: "end",
      status: "SUCCESS",
    });
    expect(runSpan!.spanContext().traceId).toBe(rootContext.traceId);
    expect(runSpan!.spanContext().spanId).toBe(rootContext.spanId);
    expect(runSpan!.parentSpanContext).toBeUndefined();
    const durableSpans = spans.filter((span) =>
      [SPAN_RUN_STEP, SPAN_CHECKPOINT, SPAN_SOAK].includes(span.name),
    );
    expect(durableSpans.filter((span) => span.name === SPAN_RUN_STEP)).toHaveLength(2);
    expect(durableSpans.filter((span) => span.name === SPAN_CHECKPOINT)).toHaveLength(2);
    expect(durableSpans.filter((span) => span.name === SPAN_SOAK).length).toBeGreaterThanOrEqual(1);
    for (const span of durableSpans) {
      expect(span.attributes["run.id"]).toBe(handle.runId);
      expect(span.spanContext().traceId).toBe(rootContext.traceId);
      expect(span.parentSpanContext?.spanId).toBe(rootContext.spanId);
    }
  });

  test("post-park spans survive re-entry on a fresh worker under the same derived root", async () => {
    exporter.reset();
    expect(createRunnerWorker).toBeTypeOf("function");
    expect(resolveRunRootContext).toBeTypeOf("function");

    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const tmp = await mkdtemp(join(tmpdir(), "chikory-soak-fresh-worker-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), {
      costPerStep: 0.01,
      claimsCompleteSteps: [1, 2],
      echoJudgeFeedback: true,
    });
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(() => runner.close());

    const chunks = [
      { name: "parser", directive: "Implement only the parser chunk before the soak." },
      { name: "cli", directive: "Implement only the CLI chunk after the soak." },
    ];
    const spec = makeJudgedSpec({
      repoUrl,
      goal: "Complete the soak-paced product surface across a worker restart.",
      maxSteps: 4,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
      unattended: { escalation: "seal_resumable_failed" },
      soak: {
        sleepMs: FRESH_WORKER_SOAK_MS,
        maxReentries: 1,
        maxTotalSleepMs: FRESH_WORKER_SOAK_MS,
      },
    });

    const firstWorker = await startWorker({ dataDir, taskQueue, judgeWireUrl: wire.url });
    const handle = await runner.start(spec);
    const parked = await awaitStatus(
      handle,
      (report) => report.status === "SUSPENDED" && report.currentStep === 1,
      "soak SUSPENDED before fresh worker re-entry",
    );
    expect(parked.spentUsd).toBeCloseTo(0.01, 10);

    await firstWorker.shutdown();
    const secondWorker = await startWorker({ dataDir, taskQueue, judgeWireUrl: wire.url });
    cleanups.push(() => secondWorker.shutdown());

    const finished = await awaitStatus(
      handle,
      (report) => TERMINAL_STATUSES.includes(report.status),
      "terminal after fresh worker soak re-entry",
    );
    expect(finished.status).toBe("SUCCESS");
    expect(finished.currentStep).toBe(chunks.length);
    expect(wire.hits).toBe(chunks.length);

    const rootContext = resolveRunRootContext(handle.runId);
    const spans = exporter.getFinishedSpans();
    const postParkStep = spans.find(
      (span) => span.name === SPAN_RUN_STEP && span.attributes["step.index"] === 1,
    );
    const postParkCheckpoint = spans.find(
      (span) => span.name === SPAN_CHECKPOINT && span.attributes.step === 1,
    );
    const soakReentry = spans.find((span) => span.name === SPAN_SOAK);
    for (const span of [soakReentry, postParkStep, postParkCheckpoint]) {
      expect(span).toBeDefined();
      expect(span!.attributes["run.id"]).toBe(handle.runId);
      expect(span!.spanContext().traceId).toBe(rootContext.traceId);
      expect(span!.parentSpanContext?.spanId).toBe(rootContext.spanId);
    }
  });

  test("post-park spans keep the pre-park run-root trace after clearing in-memory span state", async () => {
    exporter.reset();
    expect(createRunnerWorker).toBeTypeOf("function");
    expect(resolveRunRootContext).toBeTypeOf("function");

    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, runner } = await setup({ judgeWireUrl: wire.url });
    const chunks = [
      { name: "parser", directive: "Implement only the parser chunk before the park." },
      { name: "cli", directive: "Implement only the CLI chunk after the park." },
    ];
    const spec = makeJudgedSpec({
      repoUrl,
      goal: "Complete the soak-paced product surface after in-memory span state is cleared.",
      maxSteps: 4,
      cadence: 10,
      boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
      unattended: { escalation: "seal_resumable_failed" },
      soak: { sleepMs: SHORT_SOAK_MS, maxReentries: 1, maxTotalSleepMs: SHORT_SOAK_MS },
    });

    const handle = await runner.start(spec);
    const parked = await awaitStatus(
      handle,
      (report) => report.status === "SUSPENDED" && report.currentStep === 1,
      "soak SUSPENDED before clearing in-memory span state",
    );
    expect(parked.spentUsd).toBeCloseTo(0.01, 10);

    const rootContext = resolveRunRootContext(handle.runId);
    const preParkSpans = exporter.getFinishedSpans();
    const preParkRunRoot = preParkSpans.find(
      (span) => span.name === SPAN_RUN && span.attributes.lifecycle === "start",
    );
    expect(preParkRunRoot).toBeDefined();
    expect(preParkRunRoot!.attributes["run.id"]).toBe(handle.runId);
    expect(preParkRunRoot!.spanContext().traceId).toBe(rootContext.traceId);
    expect(preParkRunRoot!.spanContext().spanId).toBe(rootContext.spanId);
    expect(preParkRunRoot!.parentSpanContext).toBeUndefined();
    const preParkRunRootTraceId = preParkRunRoot!.spanContext().traceId;

    exporter.reset();

    const finished = await awaitStatus(
      handle,
      (report) => TERMINAL_STATUSES.includes(report.status),
      "unattended SUCCESS after in-memory span state is cleared across the park",
    );
    expect(finished.status).toBe("SUCCESS");
    expect(finished.currentStep).toBe(chunks.length);
    expect(finished.lastVerdict).toEqual({ kind: "PROCEED", atStep: chunks.length - 1 });
    expect(wire.hits).toBe(chunks.length);

    const postParkSpans = exporter.getFinishedSpans();
    const postParkRunRoots = postParkSpans.filter((span) => span.name === SPAN_RUN);
    expect(postParkRunRoots).toHaveLength(1);
    expect(postParkRunRoots[0]!.attributes).toMatchObject({
      "run.id": handle.runId,
      lifecycle: "end",
      status: "SUCCESS",
    });
    expect(postParkRunRoots[0]!.spanContext().traceId).toBe(preParkRunRootTraceId);
    expect(postParkRunRoots[0]!.spanContext().spanId).toBe(rootContext.spanId);
    expect(postParkRunRoots[0]!.parentSpanContext).toBeUndefined();

    const soakReentries = postParkSpans.filter((span) => span.name === SPAN_SOAK);
    expect(soakReentries.length).toBeGreaterThanOrEqual(1);
    const postParkDurableSpans = postParkSpans.filter((span) =>
      [SPAN_RUN_STEP, SPAN_CHECKPOINT, SPAN_SOAK].includes(span.name),
    );
    expect(
      postParkDurableSpans.some(
        (span) => span.name === SPAN_RUN_STEP && span.attributes["step.index"] === 1,
      ),
    ).toBe(true);
    expect(
      postParkDurableSpans.some(
        (span) => span.name === SPAN_CHECKPOINT && span.attributes.step === 1,
      ),
    ).toBe(true);
    for (const span of postParkDurableSpans) {
      expect(span.attributes["run.id"]).toBe(handle.runId);
      expect(span.spanContext().traceId).toBe(preParkRunRootTraceId);
      expect(span.parentSpanContext?.spanId).toBe(rootContext.spanId);
    }
  });

  test("no-soak byte-equivalent path finishes without Temporal timer telemetry", async () => {
    exporter.reset();
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
