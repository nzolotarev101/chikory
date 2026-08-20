/**
 * WP-645 / WP-646 (F-423, F-424) — Crash Delivery Protection & Last-Good Preservation:
 *
 * 1. A step whose executor crashed without producing an answer is recognised as an infrastructure
 *    failure and must not overwrite or corrupt work already delivered in the run.
 * 2. A FAILED run hands back its lastGood state and says which checkpoint that is in its terminal entry.
 * 3. A FAILED run whose last step delivered real work under a PROCEED verdict keeps that work.
 * 4. A crashed step mid-run does not corrupt the workspace for subsequent healing/retry steps.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, it } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  workspaceDir,
} from "../../src/index.js";
import type { AdapterRegistry, ArtifactStore, ExecutorAdapter, StepRecord } from "../../src/index.js";
import {
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("crash delivery protection & lastGood preservation (WP-645/WP-646)", () => {
  const cleanups: Array<() => Promise<unknown> | unknown> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  const GOOD_FILE = "delivered.txt";
  const HALF_FILE = "half-written.txt";
  const RECOVERED_FILE = "recovered.txt";

  function customCrashingRegistry(crashAtAttempt: number | null): AdapterRegistry {
    let attempt = 0;
    const adapter = (ctx: { store: ArtifactStore }): ExecutorAdapter => ({
      name: "crashy-custom",
      modelFamily: "anthropic",
      async runStep(input): Promise<StepRecord> {
        attempt += 1;
        const crashing = attempt === crashAtAttempt;
        if (crashing) {
          // Simulate partial writes and file deletion prior to crash
          if (existsSync(join(input.workspaceDir, GOOD_FILE))) {
            await unlink(join(input.workspaceDir, GOOD_FILE));
          }
          await writeFile(join(input.workspaceDir, HALF_FILE), "corrupted partial edit\n");
        } else if (attempt === 3) {
          await writeFile(join(input.workspaceDir, RECOVERED_FILE), "recovered edit\n");
        } else {
          await writeFile(join(input.workspaceDir, GOOD_FILE), `delivered attempt ${attempt}\n`);
        }

        const diffRef = await ctx.store.put(crashing ? "corrupted diff" : `diff ${attempt}`, {
          kind: "diff",
          summary: `diff ${attempt}`,
        });
        const transcriptRef = await ctx.store.put(
          crashing ? "Error: Process crashed with SIGSEGV (0 output tokens)" : `transcript ${attempt}`,
          { kind: "transcript", summary: `transcript ${attempt}` },
        );

        const base = {
          diffRef,
          transcriptRef,
          toolCalls: crashing ? 0 : 1,
          tokens: crashing ? { input: 4000, output: 0 } : { input: 100, output: 50 },
          costUsd: 0,
          costEstimated: false,
          durationMs: 10,
        };

        return crashing
          ? {
              ...base,
              status: "FAILED",
              summary: "",
              failure: { reason: "unhandled SIGSEGV in executor harness", retriable: true },
            }
          : { ...base, status: "SUCCESS", summary: `attempt ${attempt} ok` };
      },
    });
    return { "crashy-custom": adapter };
  }

  function findFileInWorkspace(root: string, name: string): boolean {
    for (const sub of ["", "chikory", "src", "repo", "repo-0"]) {
      if (existsSync(join(root, sub, name))) return true;
    }
    return false;
  }

  it(
    "Scenario A: a step crash mid-run after a delivered step restores the workspace to lastGood tree and seals FAILED with lastCheckpoint = lastGood",
    async () => {
      const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
      cleanups.push(() => wire.close());

      const tmp = await mkdtemp(join(tmpdir(), "crash-prot-a-"));
      cleanups.push(() => rm(tmp, { recursive: true, force: true }));
      const repoUrl = await initSourceRepo(join(tmp, "src"), {});
      const dataDir = join(tmp, "data");
      const taskQueue = `tq-${randomUUID()}`;

      const worker = await createRunnerWorker({
        adapters: customCrashingRegistry(2),
        address: address!,
        taskQueue,
        dataDir,
        workflowBundlePath: bundlePath!,
        routerOptions: { baseUrls: { "openai-compat": wire.url } },
      });
      const workerDone = worker.run();
      const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
      cleanups.push(async () => {
        worker.shutdown();
        await workerDone;
        await runner.close();
      });

      const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 2, budgetUsd: 20 });
      const handle = await runner.start({
        ...spec,
        executor: { adapter: "crashy-custom", family: "anthropic" },
      });
      const report = await waitFor(
        async () => {
          const r = await handle.status();
          return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
        },
        { timeoutMs: 240_000, what: "run to reach terminal status" },
      );

      const journal = new Journal(journalPath(dataDir, handle.runId));
      try {
        const ws = workspaceDir(dataDir, handle.runId);
        const terminals = journal
          .entries("terminal")
          .map((e) => e.payload as { status: string; reason?: string; lastCheckpoint?: string });
        const goodCheckpoints = journal
          .entries("checkpoint")
          .map((e) => e.payload as { id: string; lastGood: boolean })
          .filter((c) => c.lastGood)
          .map((c) => c.id);

        expect(report.status).toBe("FAILED");
        expect(findFileInWorkspace(ws, GOOD_FILE)).toBe(true);
        expect(findFileInWorkspace(ws, HALF_FILE)).toBe(false);

        const lastTerminal = terminals.at(-1)!;
        expect(goodCheckpoints.length).toBeGreaterThan(0);
        expect(goodCheckpoints.includes(lastTerminal.lastCheckpoint ?? "")).toBe(true);
      } finally {
        journal.close();
      }
    },
    300_000,
  );

  it(
    "Scenario B: a run exhausting maxSteps with a delivered final step preserves its delivery and names lastGood checkpoint",
    async () => {
      const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
      cleanups.push(() => wire.close());

      const tmp = await mkdtemp(join(tmpdir(), "crash-prot-b-"));
      cleanups.push(() => rm(tmp, { recursive: true, force: true }));
      const repoUrl = await initSourceRepo(join(tmp, "src"), {});
      const dataDir = join(tmp, "data");
      const taskQueue = `tq-${randomUUID()}`;

      const worker = await createRunnerWorker({
        adapters: customCrashingRegistry(null), // no crash
        address: address!,
        taskQueue,
        dataDir,
        workflowBundlePath: bundlePath!,
        routerOptions: { baseUrls: { "openai-compat": wire.url } },
      });
      const workerDone = worker.run();
      const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
      cleanups.push(async () => {
        worker.shutdown();
        await workerDone;
        await runner.close();
      });

      const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 2, budgetUsd: 20 });
      const handle = await runner.start({
        ...spec,
        executor: { adapter: "crashy-custom", family: "anthropic" },
      });
      const report = await waitFor(
        async () => {
          const r = await handle.status();
          return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
        },
        { timeoutMs: 240_000, what: "run to reach terminal status" },
      );

      const journal = new Journal(journalPath(dataDir, handle.runId));
      try {
        const ws = workspaceDir(dataDir, handle.runId);
        expect(report.status).toBe("FAILED");
        expect(findFileInWorkspace(ws, GOOD_FILE)).toBe(true);

        const terminals = journal
          .entries("terminal")
          .map((e) => e.payload as { status: string; reason?: string; lastCheckpoint?: string });
        const lastTerminal = terminals.at(-1)!;
        const lastCheckpointEntry = journal.entries("checkpoint").at(-1)!.payload as { id: string };
        expect(lastTerminal.lastCheckpoint).toBe(lastCheckpointEntry.id);
      } finally {
        journal.close();
      }
    },
    300_000,
  );

  it(
    "Scenario C: a crash on step 2 does not corrupt the tree for step 3 to succeed",
    async () => {
      // Step 1: AC-1 false
      // Step 2: crash
      // Step 3: AC-1 true -> SUCCESS
      const wire = await startFakeJudgeWire([
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ]);
      cleanups.push(() => wire.close());

      const tmp = await mkdtemp(join(tmpdir(), "crash-prot-c-"));
      cleanups.push(() => rm(tmp, { recursive: true, force: true }));
      const repoUrl = await initSourceRepo(join(tmp, "src"), {});
      const dataDir = join(tmp, "data");
      const taskQueue = `tq-${randomUUID()}`;

      const worker = await createRunnerWorker({
        adapters: customCrashingRegistry(2),
        address: address!,
        taskQueue,
        dataDir,
        workflowBundlePath: bundlePath!,
        routerOptions: { baseUrls: { "openai-compat": wire.url } },
      });
      const workerDone = worker.run();
      const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
      cleanups.push(async () => {
        worker.shutdown();
        await workerDone;
        await runner.close();
      });

      const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4, budgetUsd: 20 });
      const handle = await runner.start({
        ...spec,
        executor: { adapter: "crashy-custom", family: "anthropic" },
      });
      const report = await waitFor(
        async () => {
          const r = await handle.status();
          return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
        },
        { timeoutMs: 240_000, what: "run to reach terminal status" },
      );

      const journal = new Journal(journalPath(dataDir, handle.runId));
      try {
        const ws = workspaceDir(dataDir, handle.runId);
        expect(report.status).toBe("SUCCESS");
        // GOOD_FILE from step 1 was restored after step 2 crash, and RECOVERED_FILE was written on step 3
        expect(findFileInWorkspace(ws, GOOD_FILE)).toBe(true);
        expect(findFileInWorkspace(ws, RECOVERED_FILE)).toBe(true);
        expect(findFileInWorkspace(ws, HALF_FILE)).toBe(false);
      } finally {
        journal.close();
      }
    },
    300_000,
  );
});
