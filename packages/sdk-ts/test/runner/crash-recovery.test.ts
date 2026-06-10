/**
 * WP-123 — crash recovery (MVP exit-gate #2, DX-3, FA-2).
 *
 * Start a run on a worker subprocess → wait until ≥2 steps are journaled →
 * `kill -9` the worker → start a fresh worker → the run completes, and the
 * journal holds exactly one entry per step with cost total equal to the sum
 * of unique steps: journaled steps were NOT re-executed (no duplicate LLM
 * spend). Replay comes from Temporal history; the SQLite journal write is
 * idempotent by workflow-assigned stepIndex.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createTemporalRunner,
  Journal,
  journalPath,
  type StepPayload,
} from "../../src/index.js";
import { initSourceRepo, makeSpec, TERMINAL_STATUSES, waitFor } from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

const WORKER_MAIN = fileURLToPath(new URL("./fixtures/worker-main.ts", import.meta.url));

function spawnWorker(env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", WORKER_MAIN], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let ready = false;
    child.stdout!.on("data", (chunk: Buffer) => {
      if (!ready && chunk.toString().includes("WORKER_READY")) {
        ready = true;
        resolve(child);
      }
    });
    child.on("exit", (code, signal) => {
      if (!ready) reject(new Error(`worker exited before ready (code=${code} sig=${signal})`));
    });
    child.on("error", reject);
  });
}

describe.skipIf(address === null)("crash recovery (WP-123)", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("kill -9 mid-run → fresh worker → run completes; journaled steps never re-executed (no duplicate spend)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-crash-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    // Slow steps so SIGKILL reliably lands mid-activity.
    const repoUrl = await initSourceRepo(join(tmp, "src"), { delayMs: 800 });
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const workerEnv = {
      CHIKORY_TEST_ADDRESS: address!,
      CHIKORY_TEST_TASK_QUEUE: taskQueue,
      CHIKORY_TEST_DATA_DIR: dataDir,
      CHIKORY_TEST_WF_BUNDLE: bundlePath!,
    };

    const firstWorker = await spawnWorker(workerEnv);
    cleanups.push(() => {
      firstWorker.kill("SIGKILL");
    });

    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(() => runner.close());

    const spec = makeSpec({ repoUrl, maxSteps: 4, judge: { family: "gemini", cadence: 2 } });
    const handle = await runner.start(spec);
    const dbPath = journalPath(dataDir, handle.runId);

    // Let the run make real progress (≥2 journaled steps), then murder the worker.
    await waitFor(
      async () => {
        if (!existsSync(dbPath)) return undefined;
        const journal = new Journal(dbPath);
        try {
          return journal.entries("step").length >= 2 ? true : undefined;
        } finally {
          journal.close();
        }
      },
      { intervalMs: 100, what: "2 steps journaled before kill" },
    );
    firstWorker.kill("SIGKILL");

    const secondWorker = await spawnWorker(workerEnv);
    cleanups.push(() => {
      secondWorker.kill("SIGKILL");
    });

    // Run completes on the fresh worker (stub judge → FAILED at maxSteps —
    // a deterministic, explicit terminal).
    const report = await waitFor(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { timeoutMs: 90_000, what: "run to complete after worker restart" },
    );
    expect(report.status).toBe("FAILED");
    expect(report.currentStep).toBe(4);
    expect(report.checkpoints).toHaveLength(4);

    const journal = new Journal(dbPath);
    try {
      // Exactly one journal entry per step — no re-execution of journaled steps.
      const steps = journal.entries("step");
      expect(steps).toHaveLength(4);
      const indices = steps.map((e) => (e.payload as StepPayload).stepIndex);
      expect(new Set(indices).size).toBe(4);
      expect([...indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);

      // Cost conservation (journal-format.md §4): total == Σ unique steps.
      // Any duplicate spend would show up here as > 4 × $0.01.
      expect(journal.totalCostUsd()).toBeCloseTo(4 * 0.01, 10);

      // Checkpoints also deduped; terminal seal present exactly once.
      expect(journal.entries("checkpoint")).toHaveLength(4);
      expect(journal.entries("terminal")).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
});
