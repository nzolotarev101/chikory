/**
 * Live and unit tests for WP-632 / F-369:
 * - An empty-diff step must not vacuously green a model-judged rubric row.
 * - An empty-diff step must not consume a completion-review repair grant.
 * - A run where NO step is empty journals verdicts with the pass's own rubric results.
 * - An empty step whose summary ASKS for approval takes WP-608's classifier path and buys zero judge passes.
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
  reconcileEmptyStepRubric,
  RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
  RUBRIC_TESTS_PASS,
  STANDING_RUBRIC,
  type AdapterRegistry,
  type JudgeForm,
  type RunStatusReport,
} from "../../src/index.js";
import {
  completionReviewForm,
  createScriptedAdapter,
  initSourceRepo,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe("reconcileEmptyStepRubric (pure precedence rule)", () => {
  const specWithCheck = {
    acceptanceCriteria: [{ id: "AC-1", check: "npm test" }],
  };
  const specWithoutCheck = {
    acceptanceCriteria: [{ id: "AC-1", description: "manual test", check: undefined }],
  };

  test("Rule 1: machine-settled row (tests_pass with check) keeps this pass's freshly derived answer", () => {
    const current = [
      { id: RUBRIC_TESTS_PASS, pass: true, justification: "fresh check output" },
      { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "fresh design text" },
    ];
    const prevMap = new Map([
      [RUBRIC_TESTS_PASS, { pass: false, justification: "previous failed test" }],
      [RUBRIC_DESIGN_SERVES_OVERALL_GOAL, { pass: false, justification: "previous design objection" }],
    ]);

    const result = reconcileEmptyStepRubric(current, prevMap, specWithCheck);
    const testsPass = result.find((r) => r.id === RUBRIC_TESTS_PASS)!;
    expect(testsPass.pass).toBe(true);
    expect(testsPass.justification).toBe("fresh check output");

    const design = result.find((r) => r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL)!;
    expect(design.pass).toBe(false);
    expect(design.justification).toBe("previous design objection");
  });

  test("Rule 2: model-judged row without whole delivery settlement carries forward previous answer verbatim", () => {
    const current = [
      { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "vacuous green: no changes" },
      { id: "no_unrelated_deletions", pass: true, justification: "no changes to delete" },
    ];
    const prevMap = new Map([
      [RUBRIC_DESIGN_SERVES_OVERALL_GOAL, { pass: false, justification: "SPECIFIC-DESIGN-FAIL-123" }],
      ["no_unrelated_deletions", { pass: false, justification: "SPECIFIC-DELETION-FAIL-456" }],
    ]);

    const result = reconcileEmptyStepRubric(current, prevMap, specWithCheck);
    const design = result.find((r) => r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL)!;
    expect(design.pass).toBe(false);
    expect(design.justification).toBe("SPECIFIC-DESIGN-FAIL-123");

    const deletions = result.find((r) => r.id === "no_unrelated_deletions")!;
    expect(deletions.pass).toBe(false);
    expect(deletions.justification).toBe("SPECIFIC-DELETION-FAIL-456");
  });

  test("Rule 3: row with no previous answer keeps this pass's own answer unchanged", () => {
    const current = [
      { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: true, justification: "first step design text" },
      { id: "custom_rubric_item", pass: true, justification: "first step custom text" },
    ];
    const prevMap = new Map<string, { pass: boolean; justification: string }>();

    const result = reconcileEmptyStepRubric(current, prevMap, specWithCheck);
    expect(result).toEqual(current);
  });

  test("tests_pass without check is treated as model-judged and carried forward", () => {
    const current = [
      { id: RUBRIC_TESTS_PASS, pass: true, justification: "looks plausible from diff" },
    ];
    const prevMap = new Map([
      [RUBRIC_TESTS_PASS, { pass: false, justification: "broke tests previously" }],
    ]);

    const result = reconcileEmptyStepRubric(current, prevMap, specWithoutCheck);
    const testsPass = result.find((r) => r.id === RUBRIC_TESTS_PASS)!;
    expect(testsPass.pass).toBe(false);
    expect(testsPass.justification).toBe("broke tests previously");
  });
});

describe.skipIf(address === null)("empty step carryover live runner tests (WP-632)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("Candidate 1: a run where NO step is empty journals byte-identical verdicts to today (no carryover)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-wp632-nonempty-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), { emptyDiffSteps: [] });
    const dataDir = join(tmp, "data");
    const taskQueue = "tq-" + randomUUID();

    const PASS1_JUSTIFICATION = "pass 1 design ok";
    const PASS2_JUSTIFICATION = "pass 2 design different distinct note";

    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-A", pass: false, justification: "step 1 criteria wip" }],
          rubricResults: STANDING_RUBRIC.map((r) => ({
            id: r.id,
            pass: true,
            justification: r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL ? PASS1_JUSTIFICATION : "ok",
          })),
          concerns: [],
        },
        {
          criterionResults: [{ id: "AC-A", pass: true, justification: "step 2 criteria met" }],
          rubricResults: STANDING_RUBRIC.map((r) => ({
            id: r.id,
            pass: true,
            justification: r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL ? PASS2_JUSTIFICATION : "ok",
          })),
          concerns: [],
        },
      ],
      { reviewForms: [completionReviewForm()] },
    );
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

    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      acceptanceCriteria: [{ id: "AC-A", description: "scripted criterion A" }],
    });

    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "non-empty run to reach terminal status" },
    );
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    let verdicts: Array<{ atStep: number; form: JudgeForm }>;
    try {
      verdicts = journal
        .entries("verdict")
        .map((e) => e.payload as { atStep: number; verdict: { form: JudgeForm } })
        .map((p) => ({ atStep: p.atStep, form: p.verdict.form }))
        .filter((v) => v.form.criterionResults.length > 0);
    } finally {
      journal.close();
    }

    expect(verdicts).toHaveLength(2);
    const v1 = verdicts.find((v) => v.atStep === 0)!;
    const v2 = verdicts.find((v) => v.atStep === 1)!;
    const d1 = v1.form.rubricResults.find((r) => r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL)!;
    const d2 = v2.form.rubricResults.find((r) => r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL)!;
    expect(d1.justification).toBe(PASS1_JUSTIFICATION);
    expect(d2.justification).toBe(PASS2_JUSTIFICATION);
  });

  test("Candidate 2: an asking empty step takes WP-608's classifier path and buys zero judge passes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-wp632-asking-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), {
      emptyDiffSteps: [2],
    });
    const dataDir = join(tmp, "data");
    const taskQueue = "tq-" + randomUUID();

    // Wire only expects judge forms for step 1 and step 3 (step 2 is asking -> zero judge passes!)
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [{ id: "AC-A", pass: false, justification: "step 1" }],
          rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
          concerns: [],
        },
        {
          criterionResults: [{ id: "AC-A", pass: true, justification: "step 3" }],
          rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
          concerns: [],
        },
      ],
      { reviewForms: [completionReviewForm()] },
    );
    cleanups.push(() => wire.close());

    const customRegistry: AdapterRegistry = {
      scripted: (ctx) => {
        const base = createScriptedAdapter(ctx);
        return {
          ...base,
          async runStep(input) {
            const res = await base.runStep(input);
            if (res.diffRef.bytes === 0) {
              return {
                ...res,
                summary: "Here is the proposal. Would you like me to proceed with these changes?",
              };
            }
            return res;
          },
        };
      },
    };

    const worker = await createRunnerWorker({
      adapters: customRegistry,
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

    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 4,
      acceptanceCriteria: [{ id: "AC-A", description: "scripted criterion A" }],
    });

    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "asking run to reach terminal status" },
    );
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const controlEvents = journal.entries("control_event");
      const questionEvents = controlEvents.filter(
        (e) => (e.payload as { event: string }).event === "question",
      );
      expect(questionEvents.length).toBeGreaterThanOrEqual(1);

      // Only 2 per-step verdicts journaled (step 0 and step 2), because step 1 was asking
      const verdicts = journal
        .entries("verdict")
        .map((e) => e.payload as { atStep: number; verdict: { form: JudgeForm } })
        .filter((p) => p.verdict.form.criterionResults.length > 0);
      expect(verdicts).toHaveLength(2);
      expect(verdicts[0]!.atStep).toBe(0);
      expect(verdicts[1]!.atStep).toBe(2);
    } finally {
      journal.close();
    }
  });

  test("Candidate 3: a stalled repair step does not spend completion review grant and seals SUCCESS upon real repair", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-wp632-stall-repair-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    // Step 2 stalls with 0-byte diff
    const repoUrl = await initSourceRepo(join(tmp, "src"), { emptyDiffSteps: [2] });
    const dataDir = join(tmp, "data");
    const taskQueue = "tq-" + randomUUID();

    function stepForm(designPasses: boolean): JudgeForm {
      return {
        criterionResults: [{ id: "AC-A", pass: true, justification: "confirmed" }],
        rubricResults: STANDING_RUBRIC.map((r) => ({
          id: r.id,
          pass: r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL ? designPasses : true,
          justification:
            r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL && !designPasses
              ? "OBJECTION design not resolved"
              : "confirmed",
        })),
        concerns: [],
      };
    }

    const wire = await startFakeJudgeWire(
      [stepForm(false), stepForm(false), stepForm(true), stepForm(true)],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL] }),
          completionReviewForm(),
        ],
      },
    );
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

    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 5,
      acceptanceCriteria: [{ id: "AC-A", description: "scripted criterion A", check: "true" }],
    });

    const handle = await runner.start(spec);
    const report = await waitFor<RunStatusReport>(
      async () => {
        const r = await handle.status();
        return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
      },
      { what: "stall-then-repair run to reach terminal status" },
    );
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const stepCount = journal.entries("step").length;
      expect(stepCount).toBeGreaterThanOrEqual(3);

      const completionVerdicts = journal
        .entries("verdict")
        .filter((e) => (e.payload as { source?: string }).source === "completion-review");
      expect(completionVerdicts).toHaveLength(2);
    } finally {
      journal.close();
    }
  });
});
