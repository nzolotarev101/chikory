/**
 * Live runner tests verifying accumulation and deduplication of standing rubric findings (WP-630):
 * - Multiple distinct justifications on the same rubric id both survive to completion review.
 * - An identical justification repeated on the same rubric id across passes collapses to one finding.
 * - Whole-delivery settlement clears all accumulated justifications for that rubric id.
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
  RUBRIC_TESTS_PASS,
  STANDING_RUBRIC,
  type JudgeForm,
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

const DESIGN_RUBRIC_ID = RUBRIC_DESIGN_SERVES_OVERALL_GOAL;
const REVIEW_MARKER = "## REVIEW SCOPE — run-completion architecture review";
const CONCERNS_HEADER =
  "### Out-of-rubric concerns to adjudicate against the cumulative diff:";

function designFailForm(justification: string, criteriaPass = false): JudgeForm {
  return {
    criterionResults: [
      { id: "AC-1", pass: criteriaPass, justification: criteriaPass ? "scripted judge: confirmed" : "scripted judge: not met yet" },
    ],
    rubricResults: STANDING_RUBRIC.map((r) =>
      r.id === DESIGN_RUBRIC_ID
        ? { id: r.id, pass: false, justification }
        : { id: r.id, pass: true, justification: "scripted judge: confirmed" },
    ),
    concerns: [],
  };
}

describe.skipIf(address === null)("standing rubric findings accumulation and dedup (WP-630)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scriptedConfig: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-standing-overwrite-"));
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

  test("identical justification repeated on the same rubric id collapses to ONE finding (dedup discipline)", async () => {
    const objection = `OBJECTION-REPEATED-${randomUUID().slice(0, 8)}: leaky encapsulation in transaction manager`;

    // Pass 1: fails design_serves_overall_goal with objection
    // Pass 2: fails design_serves_overall_goal with the EXACT SAME objection
    // Pass 3: clean pass (AC-1 passes) -> triggers completion review
    const wire = await startFakeJudgeWire(
      [
        designFailForm(objection, false),
        designFailForm(objection, false),
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

    const reviewRequest = wire.requests.find((r) => r.includes(REVIEW_MARKER));
    expect(reviewRequest, "no completion review pass fired").toBeDefined();
    expect(reviewRequest!).toContain(CONCERNS_HEADER);
    expect(reviewRequest!).toContain(objection);

    const jsonLines = reviewRequest!.split("\\n");
    const matchedLines = jsonLines.filter((l) => l.includes(objection));
    expect(
      matchedLines.length,
      "an identical justification repeated across passes must collapse to exactly one finding line",
    ).toBe(1);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const reviews = reviewVerdicts(dataDir, handle.runId);
      expect(reviews).toHaveLength(1);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("two distinct objections on the same rubric id both survive as separate findings", async () => {
    const objectionAlpha = `OBJECTION-ALPHA-${randomUUID().slice(0, 8)}: missing bounded queue capacity`;
    const objectionBeta = `OBJECTION-BETA-${randomUUID().slice(0, 8)}: unhandled stream backpressure`;

    // Pass 1: fails design_serves_overall_goal with objectionAlpha
    // Pass 2: fails design_serves_overall_goal with objectionBeta
    // Pass 3: clean pass
    const wire = await startFakeJudgeWire(
      [
        designFailForm(objectionAlpha, false),
        designFailForm(objectionBeta, false),
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

    const reviewRequest = wire.requests.find((r) => r.includes(REVIEW_MARKER));
    expect(reviewRequest, "no completion review pass fired").toBeDefined();
    expect(reviewRequest!).toContain(CONCERNS_HEADER);
    expect(reviewRequest!).toContain(objectionAlpha);
    expect(reviewRequest!).toContain(objectionBeta);

    const jsonLines = reviewRequest!.split("\\n");
    const alphaLines = jsonLines.filter((l) => l.includes(objectionAlpha));
    const betaLines = jsonLines.filter((l) => l.includes(objectionBeta));
    expect(alphaLines.length, "pass 1 objection must appear on exactly one line").toBe(1);
    expect(betaLines.length, "pass 2 objection must appear on exactly one line").toBe(1);
    expect(alphaLines[0], "both objections must appear on separate lines").not.toBe(betaLines[0]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const reviews = reviewVerdicts(dataDir, handle.runId);
      expect(reviews).toHaveLength(1);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("settlement clears EVERY accumulated justification for the id, not just the latest", async () => {
    // `tests_pass` is the one rubric id `isRubricItemSettledAgainstWholeDelivery` settles, and
    // its justification is machine-derived from WHICH checks failed — so a run whose failing
    // check set changes between passes accumulates two DISTINCT findings under one id:
    //   pass 1 (step-2.txt, step-3.txt missing) -> "2/2 judge-executed checks failed: AC-A, AC-B"
    //   pass 2 (step-3.txt still missing)       -> "1/2 judge-executed checks failed: AC-B"
    //   pass 3 (both present)                   -> settles -> the WHOLE id is cleared
    // Trap D: clearing only the most recent justification would leave pass 1's text standing.
    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-A": false, "AC-B": false } }),
        judgeForm({ criteria: { "AC-A": true, "AC-B": false } }),
        judgeForm({ criteria: { "AC-A": true, "AC-B": true } }),
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
        { id: "AC-A", description: "step 2 file exists", check: "test -f step-2.txt" },
        { id: "AC-B", description: "step 3 file exists", check: "test -f step-3.txt" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      // Non-vacuity: the id really did accumulate TWO distinct justifications before settling.
      const stepJustifications = journal
        .entries("verdict")
        .map((entry) => entry.payload as VerdictPayload)
        .filter((payload) => payload.source !== "completion-review")
        .map(
          (payload) =>
            payload.verdict.form.rubricResults.find((r) => r.id === RUBRIC_TESTS_PASS)
              ?.justification ?? "",
        )
        .filter((j) => j.includes("judge-executed checks failed"));
      expect(
        new Set(stepJustifications).size,
        "the run must have produced two DIFFERENT tests_pass failure justifications — " +
          "otherwise this test proves nothing about multi-entry clearing",
      ).toBe(2);
    } finally {
      journal.close();
    }

    const reviewRequest = wire.requests.find((r) => r.includes(REVIEW_MARKER));
    expect(reviewRequest, "no completion review pass fired").toBeDefined();
    expect(
      reviewRequest!,
      "a settled rubric id must be cleared ENTIRELY — no accumulated justification for it " +
        "may reach the completion review",
    ).not.toContain("judge-executed checks failed");
    expect(reviewRequest!).not.toContain(RUBRIC_TESTS_PASS);
    expect(
      reviewRequest!,
      "with every finding cleared the review carries no out-of-rubric concerns section at all",
    ).not.toContain(CONCERNS_HEADER);
  }, 180_000);

  test("accumulating fewer findings than the bound keeps every one of them intact and emits NO elision notice", async () => {
    const findingAlpha = `FEW-ALPHA-${randomUUID().slice(0, 8)}: small design issue`;
    const findingBeta = `FEW-BETA-${randomUUID().slice(0, 8)}: another small design issue`;

    // Pass 1: fails design_serves_overall_goal with findingAlpha
    // Pass 2: fails design_serves_overall_goal with findingBeta
    // Pass 3: clean pass (AC-1 passes) -> triggers completion review
    const wire = await startFakeJudgeWire(
      [
        designFailForm(findingAlpha, false),
        designFailForm(findingBeta, false),
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
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((r) => r.includes(REVIEW_MARKER));
    expect(reviewRequest, "no completion review pass fired").toBeDefined();
    expect(reviewRequest!).toContain(CONCERNS_HEADER);
    expect(reviewRequest!).toContain(findingAlpha);
    expect(reviewRequest!).toContain(findingBeta);
    expect(reviewRequest!).not.toContain("omitted");
  }, 180_000);

  test("settlement clears every accumulated justification for the settled id while preserving model-judged findings", async () => {
    const modelFinding = `PRESERVED-DESIGN-${randomUUID().slice(0, 8)}: unhandled edge case in query parsing`;

    // Pass 1: tests_pass fails (step-2.txt missing), design_serves_overall_goal fails
    // Pass 2: tests_pass fails differently (step-3.txt missing), clean design
    // Pass 3: tests_pass passes (settles), clean pass -> triggers completion review
    const wire = await startFakeJudgeWire(
      [
        {
          criterionResults: [
            { id: "AC-A", pass: false, justification: "not met" },
            { id: "AC-B", pass: false, justification: "not met" },
          ],
          rubricResults: STANDING_RUBRIC.map((r) =>
            r.id === DESIGN_RUBRIC_ID
              ? { id: r.id, pass: false, justification: modelFinding }
              : { id: r.id, pass: true, justification: "ok" },
          ),
          concerns: [],
        },
        {
          criterionResults: [
            { id: "AC-A", pass: true, justification: "ok" },
            { id: "AC-B", pass: false, justification: "not met" },
          ],
          rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
          concerns: [],
        },
        {
          criterionResults: [
            { id: "AC-A", pass: true, justification: "ok" },
            { id: "AC-B", pass: true, justification: "ok" },
          ],
          rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
          concerns: [],
        },
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
        { id: "AC-A", description: "step 2 file exists", check: "test -f step-2.txt" },
        { id: "AC-B", description: "step 3 file exists", check: "test -f step-3.txt" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((r) => r.includes(REVIEW_MARKER));
    expect(reviewRequest, "no completion review pass fired").toBeDefined();
    expect(reviewRequest!).toContain(CONCERNS_HEADER);
    expect(reviewRequest!).toContain(modelFinding);
    expect(reviewRequest!).not.toContain("judge-executed checks failed");
    expect(reviewRequest!).not.toContain(RUBRIC_TESTS_PASS);
  }, 180_000);

  test("AC-1 live proof: 7-pass run accumulating 6 large distinct findings bounds concerns section <= 3072 chars, keeps oldest and newest intact with elision notice", async () => {
    const makeFinding = (n: number) =>
      `OBJ-${n}-HEAD: ${"y".repeat(900)} :OBJ-${n}-TAIL`;

    // 7 passes: passes 1..6 fail criteria in rotating contiguous blocks of 2 + fail design with ~950 chars; pass 7 is clean
    const wireForms: JudgeForm[] = [
      // Pass 1: AC-A false, AC-B true, AC-C true
      {
        criterionResults: [
          { id: "AC-A", pass: false, justification: "not met" },
          { id: "AC-B", pass: true, justification: "ok" },
          { id: "AC-C", pass: true, justification: "ok" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) =>
          r.id === DESIGN_RUBRIC_ID
            ? { id: r.id, pass: false, justification: makeFinding(1) }
            : { id: r.id, pass: true, justification: "ok" },
        ),
        concerns: [],
      },
      // Pass 2: AC-A false, AC-B true, AC-C true
      {
        criterionResults: [
          { id: "AC-A", pass: false, justification: "not met" },
          { id: "AC-B", pass: true, justification: "ok" },
          { id: "AC-C", pass: true, justification: "ok" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) =>
          r.id === DESIGN_RUBRIC_ID
            ? { id: r.id, pass: false, justification: makeFinding(2) }
            : { id: r.id, pass: true, justification: "ok" },
        ),
        concerns: [],
      },
      // Pass 3: AC-A true, AC-B false, AC-C true
      {
        criterionResults: [
          { id: "AC-A", pass: true, justification: "ok" },
          { id: "AC-B", pass: false, justification: "not met" },
          { id: "AC-C", pass: true, justification: "ok" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) =>
          r.id === DESIGN_RUBRIC_ID
            ? { id: r.id, pass: false, justification: makeFinding(3) }
            : { id: r.id, pass: true, justification: "ok" },
        ),
        concerns: [],
      },
      // Pass 4: AC-A true, AC-B false, AC-C true
      {
        criterionResults: [
          { id: "AC-A", pass: true, justification: "ok" },
          { id: "AC-B", pass: false, justification: "not met" },
          { id: "AC-C", pass: true, justification: "ok" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) =>
          r.id === DESIGN_RUBRIC_ID
            ? { id: r.id, pass: false, justification: makeFinding(4) }
            : { id: r.id, pass: true, justification: "ok" },
        ),
        concerns: [],
      },
      // Pass 5: AC-A true, AC-B true, AC-C false
      {
        criterionResults: [
          { id: "AC-A", pass: true, justification: "ok" },
          { id: "AC-B", pass: true, justification: "ok" },
          { id: "AC-C", pass: false, justification: "not met" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) =>
          r.id === DESIGN_RUBRIC_ID
            ? { id: r.id, pass: false, justification: makeFinding(5) }
            : { id: r.id, pass: true, justification: "ok" },
        ),
        concerns: [],
      },
      // Pass 6: AC-A true, AC-B true, AC-C false
      {
        criterionResults: [
          { id: "AC-A", pass: true, justification: "ok" },
          { id: "AC-B", pass: true, justification: "ok" },
          { id: "AC-C", pass: false, justification: "not met" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) =>
          r.id === DESIGN_RUBRIC_ID
            ? { id: r.id, pass: false, justification: makeFinding(6) }
            : { id: r.id, pass: true, justification: "ok" },
        ),
        concerns: [],
      },
      // Pass 7: All criteria pass
      {
        criterionResults: [
          { id: "AC-A", pass: true, justification: "ok" },
          { id: "AC-B", pass: true, justification: "ok" },
          { id: "AC-C", pass: true, justification: "ok" },
        ],
        rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "ok" })),
        concerns: [],
      },
    ];

    const wire = await startFakeJudgeWire(wireForms, {
      reviewForms: [completionReviewForm()],
    });
    cleanups.push(() => wire.close());

    const { repoUrl, runner } = await setup(wire);
    const spec = makeJudgedSpec({
      repoUrl,
      cadence: 1,
      maxSteps: 8,
      acceptanceCriteria: [
        { id: "AC-A", description: "criterion A" },
        { id: "AC-B", description: "criterion B" },
        { id: "AC-C", description: "criterion C" },
      ],
    });

    const handle = await runner.start(spec);
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(1);

    const reviewRequest = wire.requests.find((r) => r.includes(REVIEW_MARKER));
    expect(reviewRequest, "no completion review pass fired").toBeDefined();

    // Extract out-of-rubric concerns section
    const concernsIdx = reviewRequest!.indexOf(CONCERNS_HEADER);
    expect(concernsIdx).not.toBe(-1);
    const nextHeadingIdx = reviewRequest!.indexOf("\\n\\n##", concernsIdx);
    const sectionRaw = nextHeadingIdx !== -1
      ? reviewRequest!.slice(concernsIdx, nextHeadingIdx)
      : reviewRequest!.slice(concernsIdx);

    // Unescape JSON newlines to measure rendered characters
    const section = sectionRaw.replace(/\\n/g, "\n");
    expect(section.length).toBeLessThanOrEqual(3072);

    // Both ends of OLDEST finding intact
    expect(section).toContain("OBJ-1-HEAD");
    expect(section).toContain("OBJ-1-TAIL");

    // Both ends of NEWEST finding intact
    expect(section).toContain("OBJ-6-HEAD");
    expect(section).toContain("OBJ-6-TAIL");

    // Explicit elision notice with count left out
    expect(section).toMatch(/… \[\d+ findings? omitted\]/);
  }, 180_000);
});
