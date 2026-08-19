/**
 * Standing judge findings across incremental diff windows (AC-1 & AC-2 live proof):
 * An objection raised at pass #1 (either a failing rubric item or a free-text concern)
 * must outlive its window, survive intervening clean passes, reach the seal-time
 * completion review against the cumulative diff, and determine the terminal outcome.
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
  RUBRIC_ESCALATION_CONCERNS_ADJUDICATED,
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

describe.skipIf(address === null)("standing findings across incremental windows (AC-1 & AC-2)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scriptedConfig: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-standing-findings-"));
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

  // ─── [AC-1] Rubric Objection Family ──────────────────────────────────────────
  test("AC-1 Cleared: rubric objection at pass #1 + 2 clean passes -> marker reaches review, intervening stay PROCEED, seals SUCCESS with 1 review pass", async () => {
    const marker = `RUBRIC_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: specific fallback implementation is flawed`;

    // Pass 1: fails design_serves_overall_goal with unique marker (AC-1 false)
    // Pass 2: clean (AC-1 false)
    // Pass 3: clean (AC-1 true) -> triggers seal
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
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
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm()], // Cleared
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    // Trap A + D: Cleared reaches SUCCESS with exactly ONE review pass
    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    // Trap B: Marker must reach the completion-review request
    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(marker);
    expect(reviewRequest!).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);

    // Trap G: Intervening passes stayed PROCEED and run took exactly 3 steps
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(3);

      const perStepVerdicts = journal
        .entries("verdict")
        .map((e) => e.payload as VerdictPayload)
        .filter((v) => v.source !== "completion-review");
      expect(perStepVerdicts).toHaveLength(3);
      for (const v of perStepVerdicts) {
        expect(v.verdict.kind).toBe("PROCEED");
      }

      const reviews = reviewVerdicts(dataDir, handle.runId);
      expect(reviews).toHaveLength(1);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("AC-1 Upheld: rubric objection at pass #1 + 2 clean passes -> UPHELD seals FAILED naming what was upheld", async () => {
    const marker = `RUBRIC_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: specific fallback implementation is flawed`;

    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
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
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }), // Upheld
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    // Upheld seals FAILED (resumable) naming what was upheld after 1 bounded repair attempt (2 review passes)
    expect(report.status).toBe("FAILED");
    expect(wire.reviewHits).toBe(2);

    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(marker);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
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

  // ─── [AC-2] Concern Family & Non-Regressions ─────────────────────────────────
  test("AC-2 Cleared: concern raised at pass #1 that sealing verdict no longer holds reaches review and clears to SUCCESS", async () => {
    const marker = `CONCERN_MARKER_${randomUUID().slice(0, 8)}`;
    const concernText = `${marker}: suspicious memory allocation pattern`;

    // Pass 1: raises free-text concern with non-destructive rubric fail so pass 1 PROCEEDs (AC-1 false)
    // Pass 2: clean, no concerns (AC-1 false)
    // Pass 3: clean, no concerns (AC-1 true) -> sealing verdict holds NO concerns (trap C boundary)
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: false, justification: "minor scope drift" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [concernText],
        },
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm()], // Cleared
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(marker);
    expect(reviewRequest!).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
    expect(reviewRequest!).toContain("adjudicates the out-of-rubric concerns");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);

  test("AC-2 Upheld: concern raised at pass #1 that sealing verdict no longer holds is upheld -> seals FAILED naming escalation_concerns_adjudicated", async () => {
    const marker = `CONCERN_MARKER_${randomUUID().slice(0, 8)}`;
    const concernText = `${marker}: suspicious memory allocation pattern`;

    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: false, justification: "minor scope drift" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [concernText],
        },
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [RUBRIC_ESCALATION_CONCERNS_ADJUDICATED] }), // Upheld
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(wire.reviewHits).toBe(2);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
        resumable?: boolean;
      };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.reason).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
      expect(terminal.resumable).toBe(true);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("AC-2 Trap E: per-step evidence window is INCREMENTAL, not widened to cumulative", async () => {
    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm()],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");

    // Per-step requests must contain incremental diff header, not cumulative
    const perStepRequests = wire.requests.filter(
      (body) => !body.includes("run-completion architecture review"),
    );
    expect(perStepRequests.length).toBe(3);
    for (const req of perStepRequests) {
      expect(req).toContain("## EVIDENCE — workspace diff since last verdict");
      expect(req).not.toContain("## EVIDENCE — CUMULATIVE workspace diff");
    }

    // Only the completion review request contains cumulative diff header
    const reviewRequests = wire.requests.filter((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequests).toHaveLength(1);
    expect(reviewRequests[0]).toContain("## EVIDENCE — CUMULATIVE workspace diff");
  }, 180_000);

  test("AC-2 Trap F: a run that raised nothing is handed NO adjudication row (F-340 hand-fix intact)", async () => {
    // Clean run with declared regression_suite
    const wire = await startFakeJudgeWire(
      [judgeForm({ criteria: { "AC-1": false } }), judgeForm({ criteria: { "AC-1": true } })],
      {
        reviewForms: [completionReviewForm({ hasRegressionSuite: true })],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      regressionSuite: "sh -c 'exit 0'",
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");

    const reviewRequests = wire.requests.filter((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequests).toHaveLength(1);
    expect(reviewRequests[0]).not.toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
    expect(reviewRequests[0]).not.toContain("adjudicates the out-of-rubric concerns");
    expect(reviewRequests[0]).toContain(
      "This pass judges ONLY whether the run's cumulative changes form a coherent",
    );
  }, 180_000);

  // ─── [WP-548] Live Severity Floor Standing Concerns ──────────────────────────
  test("WP-548 Minor concern: concern with severity 'minor' at pass #1 does NOT accumulate into standingConcerns and is NOT adjudicated at completion review", async () => {
    const marker = `MINOR_CONCERN_${randomUUID().slice(0, 8)}`;
    const minorConcernText = `${marker}: cosmetic whitespace nit in docstring`;

    // Pass 1: raises a MINOR-only concern with the whole rubric passing. AC-1 is still
    // false, so the run continues; rule 4 does not fire because the floor leaves no
    // blocking concern. The rubric is deliberately all-green so the ONLY thing that
    // could put a standing finding to the completion review is the concern itself —
    // a rubric fail here would seed `escalation_concerns_adjudicated` on its own and
    // make the assertion below vacuous (F-383).
    // Pass 2: clean, no concerns (AC-1 true)
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [minorConcernText],
          concernSeverities: ["minor"],
        },
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm({ hasRegressionSuite: true })],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      regressionSuite: "sh -c 'exit 0'",
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    // Minor concern must NOT reach completion review or adjudication rubric
    expect(reviewRequest!).not.toContain(marker);
    expect(reviewRequest!).not.toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);

  test("WP-548 Blocking concern: concern with explicit severity 'blocking' at pass #1 DOES accumulate into standingConcerns and reaches review", async () => {
    const marker = `BLOCKING_CONCERN_${randomUUID().slice(0, 8)}`;
    const blockingConcernText = `${marker}: critical unhandled exception in core loop`;

    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: false, justification: "minor scope drift" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [blockingConcernText],
          concernSeverities: ["blocking"],
        },
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm()],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(marker);
    expect(reviewRequest!).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);

  // F-381: the converged out-of-rubric seal hands the completion review the RAW
  // `verdict.form.concerns`, not the floored list. A form carrying BOTH a blocking
  // and a minor concern still ESCALATEs (on the blocking one), so this path is the
  // one way a minor concern re-enters adjudication after the floor filtered it out
  // of standingConcerns. Both concerns must reach the seal; only the blocking one
  // may reach the review.
  test("WP-548 Mixed severities: the converged out-of-rubric seal puts ONLY the blocking concern to completion review", async () => {
    const blockingMarker = `MIXED_BLOCKING_${randomUUID().slice(0, 8)}`;
    const minorMarker = `MIXED_MINOR_${randomUUID().slice(0, 8)}`;

    const wire = await startFakeJudgeWire(
      [
        {
          // Every criterion and every rubric row passes, so rule 4 fires on the
          // blocking concern alone and the unattended converged seal is reached.
          criterionResults: [{ id: "AC-1", pass: true, justification: "done" }],
          rubricResults: [
            { id: "tests_pass", pass: true, justification: "ok" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [
            `${blockingMarker}: unhandled rejection on the resume path`,
            `${minorMarker}: trailing whitespace in a comment`,
          ],
          concernSeverities: ["blocking", "minor"],
        },
      ],
      {
        reviewForms: [completionReviewForm()],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      unattended: { escalation: "seal_resumable_failed" },
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(blockingMarker);
    expect(reviewRequest!).not.toContain(minorMarker);
    expect(reviewRequest!).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);
});
