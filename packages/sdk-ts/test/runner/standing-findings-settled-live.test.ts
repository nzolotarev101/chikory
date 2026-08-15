/**
 * Live runner tests verifying that standing findings re-settled against the whole delivery
 * (e.g. tests_pass backed by check commands) are cleared when a later pass settles them,
 * while model-judged findings and free-text concerns persist to completion review.
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
  RUBRIC_TESTS_PASS,
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

describe.skipIf(address === null)("settling standing findings across whole delivery (WP-629)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scriptedConfig: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-standing-settled-"));
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

  test("re-settled check clears: check fails at step 1 and passes at step 2 -> no standing findings reach review, no adjudication row asked, seals SUCCESS", async () => {
    // Step 1: step-1.txt exists, step-2.txt does NOT exist -> check exits 1 -> tests_pass fails
    // Step 2: step-2.txt exists -> check exits 0 -> tests_pass passes -> clears standing finding
    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
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
      acceptanceCriteria: [
        { id: "AC-1", description: "step 2 file exists", check: "test -f step-2.txt" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    // Completion review request MUST NOT contain escalation_concerns_adjudicated or tests_pass
    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).not.toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
    expect(reviewRequest!).not.toContain("adjudicates the out-of-rubric concerns");
    expect(reviewRequest!).not.toContain(RUBRIC_TESTS_PASS);
    expect(reviewRequest!).toContain(
      "This pass judges ONLY whether the run's cumulative changes form a coherent",
    );

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBe(2);

      const reviews = reviewVerdicts(dataDir, handle.runId);
      expect(reviews).toHaveLength(1);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("interleaved re-settled check + model-judged finding: check clears while model-judged finding stays standing", async () => {
    const marker = `DESIGN_MARKER_${randomUUID().slice(0, 8)}`;
    const designJustification = `${marker}: abstraction leak in module interface`;

    // Pass 1: check fails (step-2.txt missing) + model fails design_serves_overall_goal
    // Pass 2: check passes (step-2.txt exists) + model passes design_serves_overall_goal on incremental diff
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: false, justification: "will be overridden by check run" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: false, justification: designJustification },
          ],
          concerns: [],
        },
        judgeForm({ criteria: { "AC-1": true } }),
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
      acceptanceCriteria: [
        { id: "AC-1", description: "step 2 file exists", check: "test -f step-2.txt" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    // Completion review request MUST contain the design marker and rubric id, but NOT tests_pass
    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(marker);
    expect(reviewRequest!).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
    expect(reviewRequest!).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
    expect(reviewRequest!).not.toContain("tests_pass: 1/1 judge-executed checks failed");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("terminal").at(-1)!.payload).toMatchObject({ status: "SUCCESS" });
    } finally {
      journal.close();
    }
  }, 180_000);

  test("model-judged tests_pass (no check command declared) stays standing across clean passes", async () => {
    const marker = `TESTS_MODEL_MARKER_${randomUUID().slice(0, 8)}`;
    const failJustification = `${marker}: test setup looks incomplete from diff`;

    // Spec has NO check commands, so tests_pass is model-judged on incremental diffs
    // Pass 1: fails tests_pass via model judgment
    // Pass 2: clean pass
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: false, justification: failJustification },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: true, justification: "ok" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [],
        },
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm()],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      acceptanceCriteria: [
        { id: "AC-1", description: "pure model judged criterion" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    // Because no check commands existed, the pass #1 tests_pass finding was model-judged
    // on incremental diff and MUST reach the review as a standing concern
    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(marker);
    expect(reviewRequest!).toContain(RUBRIC_TESTS_PASS);
    expect(reviewRequest!).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
  }, 180_000);

  test("re-settled check with free-text concern: check clears but free-text concern is delivered to review", async () => {
    const concernMarker = `CONCERN_MARKER_${randomUUID().slice(0, 8)}`;
    const concernText = `${concernMarker}: unexpected disk write pattern`;

    // Pass 1: check fails (step-2.txt missing), raises free-text concern with non-destructive fail so pass 1 PROCEEDs
    // Pass 2: check passes (step-2.txt exists), clean pass
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-1", pass: false, justification: "not yet" }],
          rubricResults: [
            { id: "tests_pass", pass: false, justification: "will be overridden" },
            { id: "no_unrelated_deletions", pass: true, justification: "ok" },
            { id: "no_secrets_introduced", pass: true, justification: "ok" },
            { id: "no_architecture_violations", pass: true, justification: "ok" },
            { id: "scope_matches_instruction", pass: false, justification: "minor scope drift" },
            { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "ok" },
          ],
          concerns: [concernText],
        },
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [completionReviewForm()],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      acceptanceCriteria: [
        { id: "AC-1", description: "step 2 file exists", check: "test -f step-2.txt" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((body) =>
      body.includes("run-completion architecture review"),
    );
    expect(reviewRequest).toBeDefined();
    expect(reviewRequest!).toContain(concernMarker);
    expect(reviewRequest!).toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED);
    expect(reviewRequest!).not.toContain("tests_pass: 1/1 judge-executed checks failed");
  }, 180_000);
});
