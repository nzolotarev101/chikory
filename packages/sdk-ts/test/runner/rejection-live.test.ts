import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  type RemediationPayload,
  type RunHandle,
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
  type FakeJudgeWire,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("live operator escalation rejection (WP-602 AC-2)", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop()!;
      await cleanup();
    }
  });

  async function awaitTerminal(handle: RunHandle): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const report = await handle.status();
        return TERMINAL_STATUSES.includes(report.status) ? report : undefined;
      },
      { what: "run to reach a terminal status" },
    );
  }

  async function setup(wire: FakeJudgeWire) {
    cleanups.push(() => wire.close());
    const tmp = await mkdtemp(join(tmpdir(), "chikory-rejection-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

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

    return {
      repoUrl,
      dataDir,
      runner,
    };
  }

  it("heals a reasoned reject, passes verbatim marker to next step, and completes under its own power", async () => {
    const MARKER = "MARKER_VERBATIM_REJECT_CORRECTION_987";
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["needs human review"] }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 4, cadence: 1 });

    const handle = await runner.start(spec);

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );

    await handle.approve({ approved: false, reason: MARKER });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const remediations = journal.entries("remediation");
      expect(remediations.length).toBeGreaterThanOrEqual(1);
      const payload = remediations[0]!.payload as RemediationPayload;
      expect(payload.brief).toContain(MARKER);
    } finally {
      journal.close();
    }
  });

  it("seals FAILED on second reject when budget (maxRejectStrikes=1) is exhausted", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["needs review 1"] }),
      judgeForm({ criteria: { "AC-1": false }, concerns: ["needs review 2"] }),
    ]);

    const { repoUrl, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 4, cadence: 1 });
    spec.maxRejectStrikes = 1;

    const handle = await runner.start(spec);

    // First escalation
    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval 1" },
    );
    await handle.approve({ approved: false, reason: "first rejection reason" });

    // Second escalation
    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval 2" },
    );
    await handle.approve({ approved: false, reason: "second rejection reason" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toMatch(/reject/i);
  });

  it("seals FAILED immediately with no remediation entry when reject has no reason or whitespace", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["needs review"] }),
    ]);

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 4, cadence: 1 });

    const handle = await runner.start(spec);

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );

    await handle.approve({ approved: false, reason: "   \t\n  " });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toMatch(/reject/i);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const remediations = journal.entries("remediation");
      expect(remediations).toHaveLength(0);
    } finally {
      journal.close();
    }
  });
});
