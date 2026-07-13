/**
 * Run-completion holistic review, live Temporal proof: at the SUCCESS seal
 * moment the runner takes ONE extra judge pass over the CUMULATIVE diff
 * (run base → final state) with the completion rubric — journaled with
 * `source: "completion-review"`. A design finding grants ONE bounded fix
 * step (re-reviewed after); still failing seals SUCCESS with the findings
 * recorded, never parking a run whose criteria all pass. A first-verdict
 * seal skips the review entirely (the sealing pass already judged the
 * cumulative diff).
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  RUBRIC_CUMULATIVE_DESIGN_COHERENT,
  type RunHandle,
  type RunStatusReport,
  type VerdictPayload,
} from "../../src/index.js";
import {
  completionReviewForm,
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
  type FakeJudgeWire,
  type ScriptedConfig,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const CUMULATIVE_HEADER = "## EVIDENCE — CUMULATIVE workspace diff";

describe.skipIf(address === null)("run-completion holistic review", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scriptedConfig: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-completion-review-"));
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
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
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

  async function awaitTerminal(handle: RunHandle): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const report = await handle.status();
        return TERMINAL_STATUSES.includes(report.status) ? report : undefined;
      },
      { what: "run to reach a terminal status" },
    );
  }

  function reviewVerdicts(dataDir: string, runId: string): VerdictPayload[] {
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      return journal
        .entries("verdict")
        .map((entry) => entry.payload as VerdictPayload)
        .filter((payload) => payload.source === "completion-review");
    } finally {
      journal.close();
    }
  }

  test("multi-verdict SUCCESS takes exactly one cumulative review; the request carries the cumulative heading", async () => {
    // cadence 1, AC unmet on pass 1, met on pass 2 → the sealing verdict's
    // diff base is a later checkpoint → the review fires.
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);
    const reviews = reviewVerdicts(dataDir, handle.runId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.verdict.form.rubricResults.map((r) => r.id)).toContain(
      RUBRIC_CUMULATIVE_DESIGN_COHERENT,
    );
    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(CUMULATIVE_HEADER);
  }, 120_000);

  test("first-verdict seal skips the review — the sealing pass already judged the cumulative diff", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire, { claimsCompleteSteps: [1] });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(0);
    expect(reviewVerdicts(dataDir, handle.runId)).toHaveLength(0);
  }, 120_000);

  test("design finding grants ONE fix step, re-reviews, and still seals SUCCESS when the finding persists", async () => {
    // Both reviews fail the cumulative item: review 1 → design-fix step
    // (carrying the brief) → re-judge → review 2 fails → seal SUCCESS with
    // the findings recorded (never FAILED/parked: every criterion passes).
    // AC unmet on pass 1 so the seal moment is NOT a first-verdict seal
    // (which would skip the review by design).
    const wire = await startFakeJudgeWire(
      [judgeForm({ criteria: { "AC-1": false } }), judgeForm({ criteria: { "AC-1": true } })],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [RUBRIC_CUMULATIVE_DESIGN_COHERENT] }),
          completionReviewForm({ rubricFails: [RUBRIC_CUMULATIVE_DESIGN_COHERENT] }),
        ],
      },
    );
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire, { echoJudgeFeedback: true });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 6 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(2);
    const reviews = reviewVerdicts(dataDir, handle.runId);
    expect(reviews).toHaveLength(2);

    // The design-fix step ran against the review brief (the scripted adapter
    // echoes judge feedback into its summary).
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const summaries = journal
        .entries("step")
        .map((entry) => (entry.payload as { record: { summary: string } }).record.summary);
      expect(summaries.some((summary) => summary.includes("DESIGN REVIEW BRIEF"))).toBe(true);
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
      };
      expect(terminal.status).toBe("SUCCESS");
      expect(terminal.reason).toContain(RUBRIC_CUMULATIVE_DESIGN_COHERENT);
    } finally {
      journal.close();
    }
  }, 120_000);
});
