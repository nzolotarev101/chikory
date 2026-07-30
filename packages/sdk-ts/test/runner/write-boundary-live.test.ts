/**
 * F-218 (WP-545) — the declared write boundary reaches a real step's context.
 *
 * The boundary was enforced at exactly one place, the node seal
 * (`activities.ts` `sealChainNode`), and appeared in no prompt. dogfood-120 node
 * `N-2` therefore wrote the evidence the goal demanded to
 * `docs/reports/brownfield-004-evidence.md` while
 * `benchmarks/reports/p3-rung-4/brownfield-004.md` sat unused in its declared
 * set, and lost the whole node at seal — with a judge form that had marked every
 * criterion and all six rubric items PASS.
 *
 * Asserted on the JOURNALED context snapshot of a real run, not on a unit call:
 * the note has to survive the workflow → activity → checkpoint path, and a run
 * with no `chainLink` must be unchanged.
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
  renderStepPrompt,
  type RunStatusReport,
  type TaskSpec,
  WRITE_BOUNDARY_NOTE,
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

/** The real declared writeSet of chain-0723ac0b node `N-2`. */
const N2_WRITE_SET = [
  "benchmarks/reports/p3-rung-4/brownfield-004.md",
  "benchmarks/tasks/brownfield-004.yaml",
];

describe.skipIf(address === null)("write boundary in the live loop (F-218)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function contextSnapshots(specOverrides: Partial<TaskSpec>): Promise<ContextBundle[]> {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-writeboundary-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), {});
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

    const handle = await runner.start(
      makeSpec({
        repoUrl,
        maxSteps: 2,
        judge: { family: "anthropic", cadence: 100 },
        ...specOverrides,
      }),
    );
    await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "write-boundary run to reach a terminal status" },
    );

    const store = createLocalArtifactStore(artifactsDir(dataDir, handle.runId));
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      return await Promise.all(
        journal.entries("checkpoint").map(async (entry) => {
          const ref = (entry.payload as Checkpoint).contextSnapshotRef;
          return JSON.parse(new TextDecoder().decode(await store.get(ref))) as ContextBundle;
        }),
      );
    } finally {
      journal.close();
    }
  }

  test("a chain node's every step carries its declared boundary, and the prompt shows it", async () => {
    const snapshots = await contextSnapshots({
      chainLink: { planId: "plan-f218", nodeId: "N-2", writeSet: N2_WRITE_SET },
    });

    expect(snapshots.length).toBeGreaterThan(0);
    for (const context of snapshots) {
      const boundary = context.notes[WRITE_BOUNDARY_NOTE];
      expect(boundary).toBeDefined();
      // The path the executor should have used is now in front of it.
      expect(boundary).toContain("benchmarks/reports/p3-rung-4/brownfield-004.md");

      const prompt = renderStepPrompt({
        workspaceDir: "/tmp/ws",
        instruction: context.planItem,
        context,
        limits: { maxSeconds: 840 },
      });
      expect(prompt).toContain("## Declared write boundary");
      expect(prompt).toContain("- benchmarks/tasks/brownfield-004.yaml");
    }
  }, 60_000);

  test("a run with no chainLink is unchanged — no boundary is promised", async () => {
    const snapshots = await contextSnapshots({});

    expect(snapshots.length).toBeGreaterThan(0);
    for (const context of snapshots) {
      expect(context.notes[WRITE_BOUNDARY_NOTE]).toBeUndefined();
      expect(Object.keys(context.notes)).toEqual([]);
    }
  }, 60_000);
});
