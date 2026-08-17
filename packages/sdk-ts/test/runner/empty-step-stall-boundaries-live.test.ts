/**
 * Live tests for the three boundary defects the dogfood-150 human review found in
 * WP-632's delivery (F-373, F-374, F-375). Each drives the REAL agent loop — real
 * Temporal dev server, real workflow bundle, real judge pass sequencing, scripted
 * executor, fake judge wire — because every one of them lives in the interaction
 * between the workflow's stall branch and the judge activity's classifier, which no
 * unit test over the pure helper can reach.
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
  STANDING_RUBRIC,
  type JudgeForm,
  type RunStatusReport,
} from "../../src/index.js";
import {
  completionReviewForm,
  initSourceRepo,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

interface StepRow {
  i: number;
  bytes: number;
  summary: string;
}
interface VerdictRow {
  atStep: number;
  source?: string;
  design: { pass: boolean; justification: string } | undefined;
}

function judgeForm(
  acPass: boolean,
  designPass: boolean,
  designJustification: string,
): JudgeForm {
  return {
    criterionResults: [
      { id: "AC-A", pass: acPass, justification: acPass ? "met" : "not yet met" },
    ],
    rubricResults: STANDING_RUBRIC.map((r) => ({
      id: r.id,
      pass: r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL ? designPass : true,
      justification:
        r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL ? designJustification : "confirmed",
    })),
    concerns: [],
  };
}

/**
 * Boot a real runner over the scripted executor + fake judge wire, run it to a
 * terminal status, and hand back the journal rows the assertions read.
 */
async function runLive(opts: {
  emptyDiffSteps: number[];
  forms: JudgeForm[];
  cadence: number;
  maxSteps: number;
  cleanups: Array<() => Promise<void>>;
}): Promise<{
  report: RunStatusReport;
  steps: StepRow[];
  verdicts: VerdictRow[];
  reviewHits: number;
  judgeHits: number;
}> {
  const tmp = await mkdtemp(join(tmpdir(), "chikory-wp632-boundary-"));
  opts.cleanups.push(() => rm(tmp, { recursive: true, force: true }));
  const repoUrl = await initSourceRepo(join(tmp, "src"), {
    emptyDiffSteps: opts.emptyDiffSteps,
    echoJudgeFeedback: true,
  });
  const dataDir = join(tmp, "data");
  const taskQueue = "tq-" + randomUUID();

  const wire = await startFakeJudgeWire(opts.forms, {
    reviewForms: [
      completionReviewForm(),
      completionReviewForm(),
      completionReviewForm(),
      completionReviewForm(),
    ],
  });
  opts.cleanups.push(() => wire.close());

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
  opts.cleanups.push(async () => {
    worker.shutdown();
    await workerDone;
    await runner.close();
  });

  const spec = makeJudgedSpec({
    repoUrl,
    cadence: opts.cadence,
    maxSteps: opts.maxSteps,
    acceptanceCriteria: [{ id: "AC-A", description: "scripted criterion A" }],
  });

  const handle = await runner.start(spec);
  const report = await waitFor<RunStatusReport>(
    async () => {
      const r = await handle.status();
      return TERMINAL_STATUSES.includes(r.status) ? r : undefined;
    },
    { what: "the boundary run to reach a terminal status", timeoutMs: 240_000 },
  );

  const journal = new Journal(journalPath(dataDir, handle.runId));
  try {
    const steps: StepRow[] = journal.entries("step").map((e) => {
      const p = e.payload as {
        stepIndex: number;
        record: { summary: string; diffRef: { bytes: number } };
      };
      return { i: p.stepIndex, bytes: p.record.diffRef.bytes, summary: p.record.summary };
    });
    const verdicts: VerdictRow[] = journal.entries("verdict").map((e) => {
      const p = e.payload as {
        atStep: number;
        source?: string;
        verdict: { form?: JudgeForm };
      };
      return {
        atStep: p.atStep,
        ...(p.source !== undefined ? { source: p.source } : {}),
        design: p.verdict.form?.rubricResults.find(
          (r) => r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
        ),
      };
    });
    return { report, steps, verdicts, reviewHits: wire.reviewHits, judgeHits: wire.hits };
  } finally {
    journal.close();
  }
}

describe.skipIf(address === null)("WP-632 stall-path boundaries (F-373/F-374/F-375)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("the Temporal substrate is present — these tests must never pass vacuously", () => {
    expect(address, "temporalAddress was not provided").not.toBeNull();
    expect(bundlePath, "workflowBundlePath was not provided").not.toBeNull();
  });

  test(
    "F-373: a 0-byte step with a STANDING finding but a CLEAN sealing rubric goes to the completion review, not the stall branch",
    async () => {
      const OBJECTION = "OBJECTION-ALPHA the helper leaks its budget across call sites";
      // Pass 1 raises a model-judged objection (it becomes a standing finding that
      // survives intervening clean passes, WP-630). Pass 2 is clean against a REAL
      // diff, so the empty step's carried-forward answer at pass 3 is a PASS: the
      // sealing rubric is clean while a standing finding is still open — the exact
      // shape whose brief named nothing.
      const { steps, verdicts, reviewHits } = await runLive({
        emptyDiffSteps: [3],
        cadence: 1,
        maxSteps: 5,
        forms: [
          judgeForm(false, false, OBJECTION),
          judgeForm(false, true, "confirmed"),
          judgeForm(true, true, "confirmed"),
          judgeForm(true, true, "confirmed"),
        ],
        cleanups,
      });

      const empty = steps.find((s) => s.i === 2);
      expect(empty?.bytes, "step 3 was supposed to report a zero-byte diff").toBe(0);

      // The premise this test rests on: the empty step's SEALING rubric really is clean
      // (pass 2's PASS carried forward), so the only open finding is the standing one.
      const sealing = verdicts.find((v) => v.source === undefined && v.atStep === 2);
      expect(sealing?.design?.pass, "the empty step's sealing rubric was not clean — " +
        "this test would then be exercising the ordinary carried-failure path instead").toBe(true);

      const briefed = steps.filter((s) => s.summary.includes("DESIGN REVIEW BRIEF"));
      expect(
        briefed,
        "a DESIGN REVIEW BRIEF was handed to the executor with NO finding in it. " +
          "`buildCompletionReviewBrief` over zero failing rubric rows emits the header and " +
          "the closing line and nothing between them, and it claims a completion review " +
          "found design findings when no review ran. There is nothing here to repair from.",
      ).toEqual([]);

      expect(
        reviewHits,
        "the standing finding was never adjudicated: bypassing the completion review skips " +
          "the pass WP-619 built to answer escalation_concerns_adjudicated, so the finding " +
          "survives to the seal unanswered",
      ).toBeGreaterThanOrEqual(1);

      // The stall branch adds a step that delivers nothing; the completion-review path
      // seals off the empty step itself.
      expect(
        steps.length,
        "the run spent an extra step (and its judge pass) on the contentless brief",
      ).toBe(3);
    },
    240_000,
  );

  test(
    "F-374: repeated 0-byte stalls are bounded by MAX_COMPLETION_REVIEWS, not by maxSteps",
    async () => {
      const OBJECTION = "OBJECTION-BETA the reconciliation is applied at the wrong layer";
      // The sealing rubric carries a FAILING row on every pass, so every 0-byte step
      // re-enters the stall branch. Without a cap the branch re-fires until maxSteps.
      const { steps } = await runLive({
        emptyDiffSteps: [3, 4, 5, 6, 7],
        cadence: 1,
        maxSteps: 8,
        forms: [
          judgeForm(false, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
          judgeForm(true, false, OBJECTION),
        ],
        cleanups,
      });

      const stalls = steps.filter((s) => s.bytes === 0);
      expect(
        stalls.length,
        "a stalling executor re-entered the stall branch on every step up to maxSteps, " +
          "buying a judge pass each time. WP-632 exempts a stall from spending a " +
          "completion-review grant; it does not make the repair budget unbounded.",
      ).toBeLessThanOrEqual(3);
      expect(
        steps.length,
        "the run should stop granting stall repairs long before it exhausts maxSteps (8)",
      ).toBeLessThan(8);
    },
    240_000,
  );

  test(
    "F-375: at cadence 2 a pass that judged a REAL diff keeps its own answer even though the LAST step stalled",
    async () => {
      const STALE = "STALE-OBJECTION raised at pass 1 against steps 1-2";
      const FRESH = "FRESH-ASSESSMENT of the real step-3 diff: the objection is resolved";
      // Steps 1-3 deliver real diffs; only step 4 stalls. The empty step fires an
      // off-cadence milestone pass whose evidence still spans step 3's REAL diff.
      const { steps, verdicts } = await runLive({
        emptyDiffSteps: [4],
        cadence: 2,
        maxSteps: 6,
        forms: [
          judgeForm(false, false, STALE),
          judgeForm(true, true, FRESH),
          judgeForm(true, true, FRESH),
          judgeForm(true, true, FRESH),
        ],
        cleanups,
      });

      expect(steps.find((s) => s.i === 2)?.bytes, "step 3 must deliver a REAL diff").toBe(24);
      expect(steps.find((s) => s.i === 3)?.bytes, "step 4 must stall at 0 bytes").toBe(0);

      const milestone = verdicts.find((v) => v.source === undefined && v.atStep === 3);
      expect(milestone, "no judge verdict was journaled for the stalled step").toBeDefined();
      expect(
        milestone!.design,
        "the milestone verdict carries no design row at all",
      ).toBeDefined();
      expect(
        milestone!.design!.justification,
        "the judge READ step 3's real diff at this pass (repoDiffBasesSinceLastVerdict spans " +
          "every step since the last verdict) and answered it fresh. Classifying the pass as " +
          "empty from the LAST step's byte count alone discarded that answer and reinstated an " +
          "objection the judge had just examined and cleared — the goal's trap C, one altitude up.",
      ).toBe(FRESH);
      expect(milestone!.design!.pass).toBe(true);
    },
    240_000,
  );
});
