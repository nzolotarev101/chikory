/**
 * WP-206 — operator HITL suspend/resume over the real Temporal durable layer.
 *
 * The operator can park a healthy RUNNING run at a durable step boundary,
 * spend zero compute while parked, then resume without re-executing any
 * already-journaled step.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import { cmdSuspend } from "../../src/cli/commands.js";
import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  type RunStatusReport,
  type StepPayload,
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(address === null)("operator suspend/resume (WP-206)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup() {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-suspend-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), { delayMs: 250, costPerStep: 0.01 });
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
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
  ): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const r = await handle.status();
        return want(r) ? r : undefined;
      },
      { intervalMs: 50, what },
    );
  }

  test("cmdSuspend parks after a journaled step; resume continues with zero duplicate steps or spend", async () => {
    const { repoUrl, dataDir, runner } = await setup();
    const spec = makeSpec({
      repoUrl,
      budgetUsd: 100,
      maxSteps: 5,
      judge: { family: "gemini", cadence: 50 },
    });

    const handle = await runner.start(spec);
    const dbPath = journalPath(dataDir, handle.runId);
    await waitFor(
      async () => {
        if (!existsSync(dbPath)) return undefined;
        const journal = new Journal(dbPath);
        try {
          return journal.entries("step").length >= 1 ? true : undefined;
        } finally {
          journal.close();
        }
      },
      { intervalMs: 50, what: "at least one journaled step before suspend" },
    );

    const out: string[] = [];
    const err: string[] = [];
    expect(
      await cmdSuspend(
        {
          runId: handle.runId,
          json: false,
          dataDir,
          address: address!,
        },
        {
          out: (line) => out.push(line),
          err: (line) => err.push(line),
        },
      ),
      err.join("\n"),
    ).toBe(0);
    expect(out.join("\n")).toContain(`suspend requested — ${handle.runId}`);

    const parked = await awaitStatus(
      handle,
      (r) => r.status === "SUSPENDED" && r.currentStep >= 1,
      "operator SUSPENDED",
    );
    const parkedStep = parked.currentStep;
    const parkedSpend = parked.spentUsd;

    await sleep(750);
    const stillParked = await handle.status();
    expect(stillParked.status).toBe("SUSPENDED");
    expect(stillParked.currentStep).toBe(parkedStep);
    expect(stillParked.spentUsd).toBeCloseTo(parkedSpend, 10);

    await runner.resume(handle.runId);
    const finished = await awaitStatus(
      handle,
      (r) => TERMINAL_STATUSES.includes(r.status),
      "terminal after operator resume",
    );
    expect(finished.status).toBe("FAILED");
    expect(finished.currentStep).toBe(5);

    const journal = new Journal(dbPath);
    try {
      const controlEvents = journal.entries("control_event").map((e) => e.payload as {
        event: string;
        source: string;
        atStep: number;
      });
      expect(controlEvents).toMatchObject([
        { event: "suspend", source: "operator", atStep: parkedStep },
        { event: "resume", source: "operator", atStep: parkedStep },
      ]);

      const steps = journal.entries("step");
      expect(steps).toHaveLength(5);
      const indices = steps.map((e) => (e.payload as StepPayload).stepIndex);
      expect(indices).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(indices).size).toBe(indices.length);
      expect(journal.totalCostUsd()).toBeCloseTo(5 * 0.01, 10);
      expect(journal.entries("terminal")).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
});
