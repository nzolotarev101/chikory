/**
 * WP-202 — Memory Pointer interception in the live loop.
 * A step whose transcript exceeds DEFAULT_MEMORY_POLICY.maxInlineBytes is
 * surfaced into the next step's context as a pointer (memoryRefs); a small
 * transcript is not. Verified via the snapshotted context on the checkpoints.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  artifactsDir,
  type Checkpoint,
  createLocalArtifactStore,
  createRunnerWorker,
  createTemporalRunner,
  type ContextBundle,
  Journal,
  journalPath,
  type RunStatusReport,
} from "../../src/index.js";
import {
  initSourceRepo,
  makeSpec,
  scriptedRegistry,
  TERMINAL_STATUSES,
  waitFor,
  type ScriptedConfig,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("memory pointer interception (WP-202)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function runWith(scriptedConfig: Partial<ScriptedConfig>): Promise<ContextBundle[]> {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-memref-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), scriptedConfig);
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

    // No judge stage exercised (cadence > maxSteps, scripted never claimsComplete):
    // the run reaches maxSteps and seals FAILED. We only assert on context.
    const spec = makeSpec({ repoUrl, maxSteps: 3, judge: { family: "anthropic", cadence: 100 } });
    const handle = await runner.start(spec);
    await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "interception run to reach a terminal status" },
    );

    const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      return await Promise.all(
        journal.entries("checkpoint").map(async (e) => {
          const ref = (e.payload as Checkpoint).contextSnapshotRef;
          return JSON.parse(new TextDecoder().decode(await store.get(ref))) as ContextBundle;
        }),
      );
    } finally {
      journal.close();
    }
  }

  test("a large step transcript is surfaced as a pointer in a later step's context", async () => {
    // 20 KB > DEFAULT_MEMORY_POLICY.maxInlineBytes (16 KB) → pointerized.
    const snapshots = await runWith({ transcriptBytes: 20_000 });
    const carriesTranscript = snapshots.some((ctx) =>
      ctx.memoryRefs.some((r) => r.kind === "transcript"),
    );
    expect(carriesTranscript).toBe(true);
    // First step's context predates any prior output — no pointers yet.
    expect(snapshots[0]?.memoryRefs ?? []).toHaveLength(0);
  });

  test("a small step transcript is left summary-only (no pointer)", async () => {
    const snapshots = await runWith({}); // default transcript ~30 bytes
    const anyRef = snapshots.some((ctx) => ctx.memoryRefs.length > 0);
    expect(anyRef).toBe(false);
  });
});
