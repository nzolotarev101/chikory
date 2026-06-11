/**
 * WP-122 — checkpointer (git + journal). Every step ends in a git commit on
 * the run-private branch + a checkpoint journal row + a context snapshot
 * artifact; `status()` (the `chikory status` data source, WP-141) lists
 * checkpoints; each write emits a `chikory.checkpoint` span (CONTRACTS §8).
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  artifactsDir,
  createLocalArtifactStore,
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  SPAN_CHECKPOINT,
  workspaceDir,
  type Checkpoint,
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
const execFileAsync = promisify(execFile);

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);

describe.skipIf(address === null)("checkpointer (WP-122)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("git commit per step on run-private branch; checkpoint rows, snapshot artifacts, status listing, span", async () => {
    exporter.reset();
    const tmp = await mkdtemp(join(tmpdir(), "chikory-ckpt-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    // Real judgeStep over a fake wire; the judge never confirms AC-1, so the
    // run ends at maxSteps with PROCEED verdicts marking lastGood checkpoints.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
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

    const spec = makeJudgedSpec({ repoUrl, maxSteps: 4, cadence: 2 });
    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "terminal status" },
    );

    // status() lists every checkpoint — what `chikory status` (WP-141) renders.
    expect(report.checkpoints).toHaveLength(4);

    const ws = workspaceDir(dataDir, handle.runId);
    const { stdout: branch } = await execFileAsync("git", [
      "-C", ws, "rev-parse", "--abbrev-ref", "HEAD",
    ]);
    expect(branch.trim()).toBe(`chikory/run-${handle.runId}`);

    // One commit per step, newest first, on top of the source repo's init.
    const { stdout: log } = await execFileAsync("git", ["-C", ws, "log", "--format=%s"]);
    expect(log.trim().split("\n")).toEqual([
      "chikory: step 3",
      "chikory: step 2",
      "chikory: step 1",
      "chikory: step 0",
      "init",
    ]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    let checkpoints: Checkpoint[];
    try {
      checkpoints = journal.entries("checkpoint").map((e) => {
        // Checkpoint id self-references its own journal row.
        expect((e.payload as Checkpoint).journalIdx).toBe(e.idx);
        return e.payload as Checkpoint;
      });
    } finally {
      journal.close();
    }
    expect(checkpoints).toHaveLength(4);
    for (const cp of checkpoints) {
      expect(cp.id).toBe(`${handle.runId}@${cp.journalIdx}`);
      expect(Object.keys(cp.gitCommits)).toEqual([repoUrl]);
      // Each commit really exists in the workspace.
      const { stdout } = await execFileAsync("git", [
        "-C", ws, "cat-file", "-t", cp.gitCommits[repoUrl]!,
      ]);
      expect(stdout.trim()).toBe("commit");
    }
    // Spend accumulates monotonically into checkpoints (4 × $0.01 steps).
    expect(checkpoints.map((c) => c.budgetSpentUsd)).toEqual([0.01, 0.02, 0.03, 0.04]);
    // cadence=2 → judge covered steps 1 and 3; PROCEED marks those lastGood.
    expect(checkpoints.map((c) => c.lastGood)).toEqual([false, true, false, true]);

    // Context snapshot artifact is retrievable and is the real bundle.
    const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
    const snapshot = JSON.parse(
      new TextDecoder().decode(await store.get(checkpoints[0]!.contextSnapshotRef)),
    ) as { goal: string };
    expect(snapshot.goal).toBe(spec.goal);

    // CONTRACTS §8: checkpoint writes emit chikory.checkpoint spans.
    const spans = exporter.getFinishedSpans().filter((s) => s.name === SPAN_CHECKPOINT);
    expect(spans.length).toBe(4);
    expect(spans[0]!.attributes["git.commit"]).toBeDefined();
    expect(spans[0]!.attributes["journal.idx"]).toBeDefined();
  });
});
