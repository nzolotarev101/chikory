/**
 * WP-203 S2 — compaction digest wiring at the checkpoint boundary.
 * Asserts that once the recall tier crosses the trigger, the runner folds the
 * older summaries via a REAL router call (fake openai-compat wire), stores the
 * digest behind a Memory Pointer, journals a `compaction` `CompactionResult`,
 * and carries the digest pointer into a later step's context.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  artifactsDir,
  type Checkpoint,
  type CompactionResult,
  createLocalArtifactStore,
  createRunnerWorker,
  createTemporalRunner,
  type ContextBundle,
  describeCompactionPressure,
  Journal,
  journalPath,
  pressureFoldGapWarning,
  type RunStatusReport,
} from "../../src/index.js";
import {
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("compaction digest wiring (WP-203 S2)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("folds older summaries into a journaled digest pointer once the trigger is crossed", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-compaction-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    // Judge never PROCEEDs, so the run runs to maxSteps — long enough
    // (> DEFAULT_COMPACTION_POLICY.triggerAfterSteps = 8) to trigger compaction.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })], {
      digestContent: "FOLDED DIGEST: earlier steps set up the scripted scaffold.",
    });
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
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

    // cadence high so the judge effectively never fires on cadence; the run
    // reaches maxSteps and seals FAILED. review stage → the same fake wire so
    // the digest call is served prose.
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 100,
      maxSteps: 11,
      routing: {
        stages: {
          plan: { provider: "anthropic", model: "claude-fable-5" },
          code: { provider: "anthropic", model: "claude-fable-5" },
          review: { provider: "openai-compat", model: "fake-review" },
          judge: { provider: "openai-compat", model: "fake-judge" },
        },
      },
    });

    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "compaction run to reach a terminal status" },
    );
    expect(report.status).toBe("FAILED"); // maxSteps without a PROCEED

    // The real digest router call ran at least once.
    expect(wire.digestHits).toBeGreaterThan(0);

    const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const compactions = journal.entries("compaction");
      expect(compactions.length).toBeGreaterThan(0);

      // Every compaction entry carries a digest pointer and real token counts.
      for (const e of compactions) {
        const payload = e.payload as CompactionResult;
        expect(payload.digestRef).toBeDefined();
        expect(payload.tokensBefore).toBeGreaterThan(0);
        expect(payload.tokensAfter).toBeGreaterThan(0);
        expect(e.artifactRefs.map((r) => r.id)).toContain(payload.digestRef!.id);
      }

      // The digest artifact is recoverable and holds the folded prose.
      const digestRef = (compactions[0]!.payload as CompactionResult).digestRef!;
      const digest = new TextDecoder().decode(await store.get(digestRef));
      expect(digest).toContain("FOLDED DIGEST");

      // Behavioral payoff: a later step's snapshotted context carries the
      // digest pointer in memoryRefs (older history recoverable, not lost).
      const snapshots = await Promise.all(
        journal.entries("checkpoint").map(async (e) => {
          const ref = (e.payload as Checkpoint).contextSnapshotRef;
          return JSON.parse(new TextDecoder().decode(await store.get(ref))) as ContextBundle;
        }),
      );
      const carriesDigest = snapshots.some((ctx) =>
        ctx.memoryRefs.some((r) => r.kind === "context_snapshot" && r.summary.startsWith("digest of")),
      );
      expect(carriesDigest).toBe(true);

      // Cost guard held: never more digests than steps past the trigger.
      expect(wire.digestHits).toBeLessThanOrEqual(journal.entries("step").length);

      // The count-cadence fold is tagged `count`, not `pacing`.
      for (const e of compactions) {
        expect((e.payload as { trigger?: string }).trigger).toBe("count");
      }
    } finally {
      journal.close();
    }
  });

  // WP-207 act half / WP-203 S2: the live pacing decision DRIVES compactContext.
  test("context-window pressure folds before the count trigger (pacing-driven compactContext cadence)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-pressure-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })], {
      digestContent: "FOLDED DIGEST: pressure-triggered fold of the older summaries.",
    });
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
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

    // maxSteps 7 < DEFAULT_COMPACTION_POLICY.triggerAfterSteps (8): the COUNT
    // cadence can never fire here. The small `debug.contextWindowTokens` window
    // puts the resident context in the COMPACT band while each next summary
    // still fits (so it does not PARK). Pressure cadence (effective trigger =
    // keepLastN = 5) folds once the recall tier passes 5, before count cadence.
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 7,
      maxSteps: 7,
      pacing: { mode: "auto" },
      debug: { contextWindowTokens: 40 },
      routing: {
        stages: {
          plan: { provider: "anthropic", model: "claude-fable-5" },
          code: { provider: "anthropic", model: "claude-fable-5" },
          review: { provider: "openai-compat", model: "fake-review" },
          judge: { provider: "openai-compat", model: "fake-judge" },
        },
      },
    });

    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "pressure-compaction run to reach a terminal status" },
    );
    expect(report.status).toBe("SUCCESS");

    expect(wire.digestHits).toBeGreaterThan(0);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const entries = journal.entries();
      const steps = journal.entries("step");
      // The count cadence (>8 summaries) was never reachable in 7 steps.
      expect(steps.length).toBeGreaterThanOrEqual(6);
      expect(steps.length).toBeLessThanOrEqual(7);

      const compactions = journal.entries("compaction");
      expect(compactions.length).toBeGreaterThan(0);
      expect(
        compactions.some((e) => (e.payload as { trigger?: string }).trigger === "pacing"),
      ).toBe(true);
      const firstPacingCompactionStep = (
        compactions.find((e) => (e.payload as { trigger?: string }).trigger === "pacing")!
          .payload as { stepIndex?: number }
      ).stepIndex;
      expect(firstPacingCompactionStep).toBeTypeOf("number");

      // Every fold here was driven by the pacing pressure signal, not the count.
      for (const e of compactions) {
        const payload = e.payload as CompactionResult & { trigger?: string; foldedCount?: number };
        expect(payload.trigger).toBe("pacing");
        expect(payload.stepIndex).toBeTypeOf("number");
        expect(payload.foldedCount).toBeGreaterThan(0);
        expect(payload.digestRef).toBeDefined();
      }

      // Pacing decisions confirm the run was genuinely under window pressure.
      const pacingActions = journal
        .entries("pacing")
        .map((e) => (e.payload as { action: string }).action);
      expect(pacingActions).toContain("compact");
      expect(pacingActions).not.toContain("park");

      const pressure = describeCompactionPressure(entries);
      expect(pressure.pacingFolds).toBeGreaterThanOrEqual(1);
      expect(pressure.firstPacingFoldStep).toBe(firstPacingCompactionStep);
      expect(pressureFoldGapWarning(pressure)).toBeNull();
    } finally {
      journal.close();
    }
  });
});
