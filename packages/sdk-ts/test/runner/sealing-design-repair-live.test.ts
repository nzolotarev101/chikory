/**
 * Live Temporal proof: Bounded repair attempt on sealing design findings (AC-1 & AC-2).
 *
 * Guaranteed properties:
 * 1. REPAIRED: A sealing pass raising `design_serves_overall_goal` produces a SECOND executor
 *    step whose instruction carries the design brief, then seals SUCCESS after two review passes.
 * 2. UNREPAIRED: The same opening, with the re-review still failing, seals FAILED (resumable)
 *    naming the item after EXACTLY two executor steps (never three, never SUCCESS).
 * 3. NEGATIVE: A run that raises nothing takes one step, buys zero review passes and seals SUCCESS.
 * 4. BOUNDED: Zero steps remaining (e.g. maxSteps: 1) prevents the repair step and seals FAILED immediately.
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
  RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
  type RunHandle,
  type RunStatusReport,
  type StepPayload,
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

describe.skipIf(address === null)("sealing design finding bounded repair (AC-1 live proof)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scriptedConfig: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-sealing-repair-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), {
      echoJudgeFeedback: true,
      ...scriptedConfig,
    });
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

  test("REPAIRED: sealing pass with design finding -> 2nd step carries brief -> seals SUCCESS after 2 review passes", async () => {
    const marker = `SEALING_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: fallback handler has incorrect abstraction layer`;

    const wire = await startFakeJudgeWire(
      [
        // Step 1: converges on criteria, but flags design_serves_overall_goal
        {
          criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: false, justification: failJustification },
          ],
          concerns: [],
        },
        // Step 2 (repair step): clean pass
        judgeForm({
          criteria: { "AC-1": true },
        }),
      ],
      {
        reviewForms: [
          // Review 1 (triggers repair step with brief)
          completionReviewForm(),
          // Review 2 (clean re-review after repair)
          completionReviewForm(),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, {
      claimsCompleteSteps: [1, 2],
      echoJudgeFeedback: true,
    });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 6 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    // Terminal outcome must be SUCCESS
    expect(report.status).toBe("SUCCESS");
    // Exactly 2 review passes
    expect(wire.reviewHits).toBe(2);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      // Exactly two executor steps executed
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(2);

      // Step 2 summary must carry the design brief containing the marker and rubric id
      const repairStepSummary = (stepEntries[1]!.payload as StepPayload).record.summary;
      expect(repairStepSummary).toContain(marker);
      expect(repairStepSummary).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
      expect(repairStepSummary).toContain("DESIGN REVIEW BRIEF");

      // Exactly 2 completion reviews journaled
      const reviews = reviewVerdicts(dataDir, handle.runId);
      expect(reviews).toHaveLength(2);

      const terminal = journal.entries("terminal").at(-1)!.payload as { status: string };
      expect(terminal.status).toBe("SUCCESS");
    } finally {
      journal.close();
    }
  }, 180_000);

  test("UNREPAIRED: sealing pass with design finding + failing re-review -> seals FAILED naming item after EXACTLY two steps", async () => {
    const marker = `UNREPAIRED_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: architectural defect persists`;

    const wire = await startFakeJudgeWire(
      [
        // Step 1: converges on criteria, flags design_serves_overall_goal
        {
          criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: false, justification: failJustification },
          ],
          concerns: [],
        },
        // Step 2 (repair step): converges on criteria
        judgeForm({
          criteria: { "AC-1": true },
        }),
      ],
      {
        reviewForms: [
          // Review 1 (upholds finding)
          completionReviewForm({ rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }),
          // Review 2 (re-review still fails -> terminal seal FAILED)
          completionReviewForm({ rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, {
      claimsCompleteSteps: [1, 2],
      echoJudgeFeedback: true,
    });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 6 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    // Must seal FAILED, not SUCCESS (trap A)
    expect(report.status).toBe("FAILED");
    expect(wire.reviewHits).toBe(2);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      // Exactly two executor steps (trap B: never three)
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(2);

      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
        resumable?: boolean;
      };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.reason).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
      expect(terminal.resumable).toBe(true);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("NEGATIVE: run raising nothing takes 1 step, 0 review passes, seals SUCCESS", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, { claimsCompleteSteps: [1] });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    // Trap C: Clean path buys 0 extra review passes and seals SUCCESS in 1 step
    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(0);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(1);
      expect(reviewVerdicts(dataDir, handle.runId)).toHaveLength(0);
      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);

  test("BOUNDED: maxSteps 1 prevents repair attempt and seals FAILED immediately", async () => {
    const marker = `BOUND_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: design flaw on single-step budget`;

    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: false, justification: failJustification },
          ],
          concerns: [],
        },
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, {
      claimsCompleteSteps: [1],
      echoJudgeFeedback: true,
    });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 1 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(wire.reviewHits).toBe(1);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(1);

      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
        resumable?: boolean;
      };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.reason).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
      expect(terminal.resumable).toBe(true);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("MULTI-STEP REPAIRED: 3-step convergence with design finding earns step 4 repair and seals SUCCESS", async () => {
    const marker = `MULTI_STEP_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: multi-step intermediate helper misplaced`;

    const wire = await startFakeJudgeWire(
      [
        // Step 1: AC unmet, clean rubric
        judgeForm({ criteria: { "AC-1": false } }),
        // Step 2: AC unmet, clean rubric
        judgeForm({ criteria: { "AC-1": false } }),
        // Step 3: AC met, flags design finding
        {
          criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: false, justification: failJustification },
          ],
          concerns: [],
        },
        // Step 4 (repair step): clean pass
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm(),
          completionReviewForm(),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, {
      echoJudgeFeedback: true,
    });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 6 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(2);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(4);

      const repairSummary = (stepEntries[3]!.payload as StepPayload).record.summary;
      expect(repairSummary).toContain(marker);
      expect(repairSummary).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);

      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);

  test("CUMULATIVE DESIGN REPAIRED: fresh review finding earns repair step and seals SUCCESS after clean re-review", async () => {
    const wire = await startFakeJudgeWire(
      [
        // Step 1: AC unmet
        judgeForm({ criteria: { "AC-1": false } }),
        // Step 2: AC met, clean per-step rubric
        judgeForm({ criteria: { "AC-1": true } }),
        // Step 3 (repair step): AC met
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          // Review 1: fails cumulative_design_coherent
          completionReviewForm({ rubricFails: ["cumulative_design_coherent"] }),
          // Review 2: clean re-review
          completionReviewForm(),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, {
      echoJudgeFeedback: true,
    });
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 6 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(2);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(3);

      const repairSummary = (stepEntries[2]!.payload as StepPayload).record.summary;
      expect(repairSummary).toContain("cumulative_design_coherent");

      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);
});
