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
  resolveMemoryRecallRequest,
  type RunStatusReport,
  type TaskSpec,
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

interface RunWithResult {
  report: RunStatusReport;
  snapshots: ContextBundle[];
  rawSnapshots: string[];
  memoryCounters?: { recalls?: number; evicted?: number };
}

describe.skipIf(address === null)("memory pointer interception (WP-202)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function runWith(
    scriptedConfig: Partial<ScriptedConfig>,
    specOverrides: Partial<TaskSpec> = {},
    opts: { judgeWireUrl?: string; judged?: boolean } = {},
  ): Promise<RunWithResult> {
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
      ...(opts.judgeWireUrl === undefined
        ? {}
        : { routerOptions: { baseUrls: { "openai-compat": opts.judgeWireUrl } } }),
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
    const spec = opts.judged
      ? makeJudgedSpec({
          repoUrl,
          maxSteps: 3,
          ...specOverrides,
        })
      : makeSpec({
          repoUrl,
          maxSteps: 3,
          judge: { family: "anthropic", cadence: 100 },
          ...specOverrides,
        });
    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "interception run to reach a terminal status" },
    );

    const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const rawSnapshots = await Promise.all(
        journal.entries("checkpoint").map(async (e) => {
          const ref = (e.payload as Checkpoint).contextSnapshotRef;
          return new TextDecoder().decode(await store.get(ref));
        }),
      );
      const snapshots = rawSnapshots.map((snapshot) => JSON.parse(snapshot) as ContextBundle);
      const terminal = journal.entries("terminal")[0]?.payload as
        | { memoryCounters?: { recalls?: number; evicted?: number } }
        | undefined;
      return { report, snapshots, rawSnapshots, memoryCounters: terminal?.memoryCounters };
    } finally {
      journal.close();
    }
  }

  test("a large step transcript is surfaced as a pointer in a later step's context", async () => {
    // 20 KB > DEFAULT_MEMORY_POLICY.maxInlineBytes (16 KB) → pointerized.
    const { snapshots } = await runWith({ transcriptBytes: 20_000 });
    const carriesTranscript = snapshots.some((ctx) =>
      ctx.memoryRefs.some((r) => r.kind === "transcript"),
    );
    expect(carriesTranscript).toBe(true);
    // First step's context predates any prior output — no pointers yet.
    expect(snapshots[0]?.memoryRefs ?? []).toHaveLength(0);
  });

  test("a small step transcript is left summary-only (no pointer)", async () => {
    const { snapshots } = await runWith({}); // default transcript ~30 bytes
    const anyRef = snapshots.some((ctx) => ctx.memoryRefs.length > 0);
    expect(anyRef).toBe(false);
  });

  test("a live recall request carries the requested excerpt into the next context", async () => {
    expect(resolveMemoryRecallRequest("no marker", [])).toBeNull();

    const { snapshots } = await runWith({
      transcriptBytes: 20_000,
      recallFirstMemoryRefSteps: [2],
    });

    expect(snapshots[1]?.memoryRefs.some((r) => r.kind === "transcript")).toBe(true);
    const recalled = snapshots[2]?.notes["memory.recall"] ?? "";
    expect(recalled).toContain("[memory transcript");
    expect(recalled).toContain("TTTTTTTTTT");
  });

  test("unattended memory eviction keeps live recall working while bounding carried refs", async () => {
    expect(resolveMemoryRecallRequest("no marker", [])).toBeNull();

    const { snapshots, memoryCounters } = await runWith(
      {
        transcriptBytes: 20_000,
        recallFirstMemoryRefSteps: [7],
      },
      {
        maxSteps: 8,
        unattended: { escalation: "seal_resumable_failed" },
      },
    );

    const nonDigestRefCounts = snapshots.map(
      (ctx) => ctx.memoryRefs.filter((ref) => ref.kind !== "context_snapshot").length,
    );
    expect(Math.max(...nonDigestRefCounts)).toBeLessThanOrEqual(6);
    expect(snapshots.some((ctx) => ctx.memoryRefs.length === 6)).toBe(true);

    const recalled = snapshots[7]?.notes["memory.recall"] ?? "";
    expect(recalled).toContain("[memory transcript");
    expect(recalled).toContain("TTTTTTTTTT");
    expect(memoryCounters?.recalls).toBe(1);
    expect(memoryCounters?.evicted).toBeGreaterThan(0);
  });

  test("live multi-chunk unattended recall succeeds without operator approval while carried refs stay bounded", async () => {
    expect(resolveMemoryRecallRequest("no marker", [])).toBeNull();

    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const chunks = Array.from({ length: 8 }, (_, index) => ({
      name: `chunk-${index + 1}`,
      directive: `Complete memory recall chunk ${index + 1}.`,
    }));

    const { report, snapshots, memoryCounters } = await runWith(
      {
        transcriptBytes: 20_000,
        recallFirstMemoryRefSteps: [7],
      },
      {
        goal: "Complete the memory recall proof across bounded chunks.",
        maxSteps: 10,
        judge: { family: "openai-compat", cadence: 10 },
        unattended: { escalation: "seal_resumable_failed" },
        boundedWorkUnit: { minDurableSteps: chunks.length, workChunks: chunks },
      },
      { judgeWireUrl: wire.url, judged: true },
    );

    expect(report.status).toBe("SUCCESS");
    expect(report.status).not.toBe("AWAITING_APPROVAL");
    expect(report.checkpoints).toHaveLength(chunks.length);
    expect(wire.hits).toBe(chunks.length);

    const carriedCounts = snapshots.map(
      (ctx) => ctx.memoryRefs.filter((ref) => ref.kind !== "context_snapshot").length,
    );
    expect(Math.max(...carriedCounts)).toBeLessThanOrEqual(6);
    expect(snapshots[6]?.memoryRefs[0]?.kind).toBe("transcript");

    const recalled = snapshots[7]?.notes["memory.recall"] ?? "";
    expect(recalled).toContain("[memory transcript");
    expect(recalled).toContain(snapshots[6]!.memoryRefs[0]!.id.slice(0, 12));
    expect(recalled).toContain("TTTTTTTTTT");
    expect(memoryCounters?.recalls).toBe(1);
    expect(memoryCounters?.evicted).toBeGreaterThan(0);
  });

  test("no-recall and no-unattended-policy context snapshots stay byte-equivalent", async () => {
    const { rawSnapshots } = await runWith({});
    const contextWithRecentSteps = (recentSteps: string[]): ContextBundle => ({
      goal: "exercise the journaled agent loop",
      acceptanceCriteria: [{ id: "AC-1", description: "scripted steps executed" }],
      planItem: "exercise the journaled agent loop",
      notes: {},
      recentSteps,
      injections: [],
      memoryRefs: [],
    });

    expect(rawSnapshots).toEqual([
      JSON.stringify(contextWithRecentSteps([]), null, 2),
      JSON.stringify(contextWithRecentSteps(["scripted attempt 1: ok"]), null, 2),
      JSON.stringify(
        contextWithRecentSteps(["scripted attempt 1: ok", "scripted attempt 2: ok"]),
        null,
        2,
      ),
    ]);
  });
});
