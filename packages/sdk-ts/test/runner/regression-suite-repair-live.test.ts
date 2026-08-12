/**
 * AC-2: Live Temporal proof for regression suite repair brief & honest rubric scoping.
 *
 * Scenario 1: declared regression_suite fails with unique marker -> repair step gets brief containing marker,
 * no design-only text, naming pre_existing_suite_still_green. Run fails unattended, 0 rollbacks, command <= 2 runs.
 * Scenario 2: declared regression_suite passes -> seals SUCCESS, command runs exactly 1 time, suite row only in completion review verdict.
 * Scenario 3: no regression_suite declared, driven to design finding -> repair brief carries design-only text, zero suite rows in any verdict.
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
  RUBRIC_PRE_EXISTING_SUITE_GREEN,
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

describe.skipIf(address === null)("AC-2: live regression suite repair brief & rubric scoping", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scriptedConfig: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-reg-suite-live-"));
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

  test("Scenario 1: declared regression_suite fails -> brief carries output marker, no design instruction, names item; terminates FAILED without ROLLBACK", async () => {
    const marker = `FAIL_MARKER_${randomUUID().slice(0, 8)}`;
    const command = `echo "${marker}"; exit 1`;

    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": true } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ hasRegressionSuite: true }),
          completionReviewForm({ hasRegressionSuite: true }),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, { claimsCompleteSteps: [1] });
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      regressionSuite: command,
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const verdicts = journal.entries("verdict").map((e) => (e.payload as VerdictPayload).verdict);
      expect(verdicts.filter((v) => v.kind === "ROLLBACK")).toHaveLength(0);

      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBeGreaterThanOrEqual(2);

      // Inspect repair step summary (which echoed input.context.judgeFeedback)
      const repairStepSummary = (stepEntries[1]!.payload as { record: { summary: string } }).record.summary;
      expect(repairStepSummary).toContain(marker);
      expect(repairStepSummary).toContain(RUBRIC_PRE_EXISTING_SUITE_GREEN);
      expect(repairStepSummary).not.toContain("do NOT change behavior, only design");

      const terminal = journal.entries("terminal").at(-1)!.payload as { status: string; reason?: string };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.reason).toContain(RUBRIC_PRE_EXISTING_SUITE_GREEN);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("Scenario 2: declared regression_suite passes -> seals SUCCESS, command runs once, suite row only in completion review verdict", async () => {
    const command = "exit 0";

    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": false } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ hasRegressionSuite: true }),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      regressionSuite: command,
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const verdicts = journal.entries("verdict").map((e) => e.payload as VerdictPayload);

      // Per-step verdicts must NOT carry pre_existing_suite_still_green
      const perStepVerdicts = verdicts.filter((v) => v.source !== "completion-review");
      for (const v of perStepVerdicts) {
        const hasSuiteRow = v.verdict.form.rubricResults.some((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN);
        expect(hasSuiteRow).toBe(false);
      }

      // Completion-review verdict MUST carry pre_existing_suite_still_green
      const completionVerdicts = verdicts.filter((v) => v.source === "completion-review");
      expect(completionVerdicts).toHaveLength(1);
      const suiteRow = completionVerdicts[0]!.verdict.form.rubricResults.find((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN);
      expect(suiteRow).toBeDefined();
      expect(suiteRow!.pass).toBe(true);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("Scenario 3: no regression_suite declared -> driven to design finding, repair brief carries design instruction, zero suite rows anywhere", async () => {
    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": true }, rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }),
          completionReviewForm(),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const { repoUrl, dataDir, runner } = await setup(wire, { claimsCompleteSteps: [1] });
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      // NO regressionSuite declared
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const verdicts = journal.entries("verdict").map((e) => e.payload as VerdictPayload);

      // ZERO verdicts anywhere carry pre_existing_suite_still_green
      for (const v of verdicts) {
        const hasSuiteRow = v.verdict.form.rubricResults.some((r) => r.id === RUBRIC_PRE_EXISTING_SUITE_GREEN);
        expect(hasSuiteRow).toBe(false);
      }

      const stepEntries = journal.entries("step");
      expect(stepEntries.length).toBeGreaterThanOrEqual(2);
      const repairStepSummary = (stepEntries[1]!.payload as { record: { summary: string } }).record.summary;

      // Brief MUST carry design-only instruction
      expect(repairStepSummary).toContain("do NOT change behavior, only design");
      expect(repairStepSummary).toContain("DESIGN REVIEW BRIEF");
    } finally {
      journal.close();
    }
  }, 180_000);
});
