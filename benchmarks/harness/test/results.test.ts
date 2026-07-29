import { describe, expect, it } from "vitest";
import type { SuiteSummary, TaskResult } from "../src/results.js";
import { compareSummaries, isTaskVerified, summarize, wilsonScoreInterval } from "../src/results.js";

function mockTaskResult(overrides: Partial<TaskResult> & { taskId: string }): TaskResult {
  return {
    taskId: overrides.taskId,
    source: overrides.source ?? "authored",
    class: overrides.class ?? "brownfield",
    adapter: overrides.adapter ?? "stub",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    run: overrides.run ?? { exitCode: 0, wallClockMs: 100, artifacts: [], notes: [] },
    grading: overrides.grading ?? {
      total: 2,
      satisfied: 2,
      dependencySatisfied: 2,
      grades: [],
    },
    baseVerification: overrides.baseVerification,
  };
}

describe("isTaskVerified", () => {
  it("returns true for greenfield task (no repo pin, baseVerification undefined)", () => {
    const r = mockTaskResult({ taskId: "greenfield-001" });
    expect(isTaskVerified(r)).toBe(true);
  });

  it("returns true when baseVerification is green", () => {
    const r = mockTaskResult({
      taskId: "brownfield-001",
      baseVerification: { green: true, reason: "all good", testsPassed: 10, testsFailed: 0 },
    });
    expect(isTaskVerified(r)).toBe(true);
  });

  it("returns false when baseVerification is not green (red base)", () => {
    const r = mockTaskResult({
      taskId: "brownfield-002",
      baseVerification: { green: false, reason: "tests failed", testsPassed: 5, testsFailed: 2 },
    });
    expect(isTaskVerified(r)).toBe(false);
  });

  it("returns false when baseVerification is not green (missing command)", () => {
    const r = mockTaskResult({
      taskId: "brownfield-003",
      baseVerification: {
        green: false,
        reason: "No base verification command declared",
        testsPassed: 0,
        testsFailed: 0,
      },
    });
    expect(isTaskVerified(r)).toBe(false);
  });
});

describe("summarize", () => {
  it("computes headline rates (iSr/dSr) over verified tasks only", () => {
    const verifiedGreen = mockTaskResult({
      taskId: "t-verified-green",
      grading: { total: 2, satisfied: 2, dependencySatisfied: 2, grades: [] },
      baseVerification: { green: true, reason: "ok", testsPassed: 1, testsFailed: 0 },
    });
    const verifiedRed = mockTaskResult({
      taskId: "t-verified-red",
      grading: { total: 2, satisfied: 0, dependencySatisfied: 0, grades: [] },
      baseVerification: { green: false, reason: "failed base", testsPassed: 0, testsFailed: 1 },
    });

    const summary = summarize("test", "adapter", "start", "end", [verifiedGreen, verifiedRed]);

    expect(summary.iSr).toBe(1);
    expect(summary.dSr).toBe(1);
  });

  it("keeps requirementsTotal and requirementsSatisfied counting all requirements across all tasks", () => {
    const t1 = mockTaskResult({
      taskId: "t1",
      grading: { total: 3, satisfied: 3, dependencySatisfied: 3, grades: [] },
      baseVerification: { green: true, reason: "ok", testsPassed: 1, testsFailed: 0 },
    });
    const t2 = mockTaskResult({
      taskId: "t2",
      grading: { total: 2, satisfied: 1, dependencySatisfied: 1, grades: [] },
      baseVerification: { green: false, reason: "failed", testsPassed: 0, testsFailed: 1 },
    });

    const summary = summarize("test", "adapter", "start", "end", [t1, t2]);

    expect(summary.requirementsTotal).toBe(5);
    expect(summary.requirementsSatisfied).toBe(4);
  });

  it("retains all tasks in perTask and tasks count (trap B: no dropping unverified tasks)", () => {
    const t1 = mockTaskResult({
      taskId: "t1",
      baseVerification: { green: true, reason: "ok", testsPassed: 1, testsFailed: 0 },
    });
    const t2 = mockTaskResult({
      taskId: "t2",
      baseVerification: { green: false, reason: "no command", testsPassed: 0, testsFailed: 0 },
    });

    const summary = summarize("test", "adapter", "start", "end", [t1, t2]);

    expect(summary.tasks).toBe(2);
    expect(summary.perTask).toHaveLength(2);
    expect(summary.perTask[0].baseVerified).toBe(true);
    expect(summary.perTask[1].baseVerified).toBe(false);
  });

  it("names unverified tasks and their reasons in unverifiedTasks", () => {
    const t1 = mockTaskResult({
      taskId: "t-green",
      baseVerification: { green: true, reason: "ok", testsPassed: 1, testsFailed: 0 },
    });
    const t2 = mockTaskResult({
      taskId: "t-red",
      baseVerification: { green: false, reason: "base failed: 2 tests broken", testsPassed: 0, testsFailed: 2 },
    });
    const t3 = mockTaskResult({
      taskId: "t-undeclared",
      baseVerification: { green: false, reason: "No base verification command declared", testsPassed: 0, testsFailed: 0 },
    });

    const summary = summarize("test", "adapter", "start", "end", [t1, t2, t3]);

    expect(summary.tasksVerified).toBe(1);
    expect(summary.unverifiedTasks).toEqual([
      { taskId: "t-red", reason: "base failed: 2 tests broken" },
      { taskId: "t-undeclared", reason: "No base verification command declared" },
    ]);
  });

  it("counts greenfield task (no repo pin) as verified", () => {
    const greenfield = mockTaskResult({
      taskId: "greenfield-001",
      grading: { total: 2, satisfied: 2, dependencySatisfied: 2, grades: [] },
      baseVerification: undefined,
    });

    const summary = summarize("test", "adapter", "start", "end", [greenfield]);

    expect(summary.tasksVerified).toBe(1);
    expect(summary.unverifiedTasks).toEqual([]);
    expect(summary.iSr).toBe(1);
    expect(summary.perTask[0].baseVerified).toBe(true);
  });

  it("returns 0 for iSr and dSr if there are no verified tasks", () => {
    const unverified = mockTaskResult({
      taskId: "t-unverified",
      grading: { total: 2, satisfied: 2, dependencySatisfied: 2, grades: [] },
      baseVerification: { green: false, reason: "failed", testsPassed: 0, testsFailed: 1 },
    });

    const summary = summarize("test", "adapter", "start", "end", [unverified]);

    expect(summary.tasksVerified).toBe(0);
    expect(summary.iSr).toBe(0);
    expect(summary.dSr).toBe(0);
  });
});

describe("wilsonScoreInterval", () => {
  it("calculates 95% Wilson confidence intervals for sample proportions", () => {
    const ci = wilsonScoreInterval(15, 20);
    expect(ci.lower).toBeCloseTo(0.5313, 3);
    expect(ci.upper).toBeCloseTo(0.8881, 3);

    const ciZero = wilsonScoreInterval(0, 20);
    expect(ciZero.lower).toBe(0);
    expect(ciZero.upper).toBeGreaterThan(0);

    const ciFull = wilsonScoreInterval(20, 20);
    expect(ciFull.upper).toBe(1);
  });
});

describe("compareSummaries", () => {
  function makeFiveTaskSummary(adapter: string, satisfiedCounts: number[]): SuiteSummary {
    const tasks = ["task-1", "task-2", "task-3", "task-4", "task-5"];
    return {
      suite: "test-suite",
      adapter,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      tasks: 5,
      tasksVerified: 5,
      unverifiedTasks: [],
      requirementsTotal: 20,
      requirementsSatisfied: satisfiedCounts.reduce((a, b) => a + b, 0),
      iSr: satisfiedCounts.reduce((a, b) => a + b, 0) / 20,
      dSr: satisfiedCounts.reduce((a, b) => a + b, 0) / 20,
      perTask: tasks.map((id, idx) => ({
        taskId: id,
        satisfied: satisfiedCounts[idx]!,
        dependencySatisfied: satisfiedCounts[idx]!,
        total: 4,
        exitCode: 0,
        wallClockMs: 1000,
        baseVerified: true,
      })),
    };
  }

  it("compares two synthetic five-task summaries and emits 95% Wilson intervals (AC-1)", () => {
    const sumA = makeFiveTaskSummary("chikory", [4, 4, 3, 4, 3]); // 18/20 satisfied
    const sumB = makeFiveTaskSummary("command", [2, 3, 2, 3, 2]); // 12/20 satisfied

    const res = compareSummaries(sumA, sumB, "/path/summaryA.json", "/path/summaryB.json");

    expect(res.armA.adapter).toBe("chikory");
    expect(res.armA.requirementsSatisfied).toBe(18);
    expect(res.armA.iSrCi.lower).toBeCloseTo(0.6990, 3);
    expect(res.armA.iSrCi.upper).toBeCloseTo(0.9721, 3);

    expect(res.armB.adapter).toBe("command");
    expect(res.armB.requirementsSatisfied).toBe(12);
    expect(res.armB.iSrCi.lower).toBeCloseTo(0.3866, 3);
    expect(res.armB.iSrCi.upper).toBeCloseTo(0.7812, 3);

    expect(res.taskIds).toEqual(["task-1", "task-2", "task-3", "task-4", "task-5"]);
  });

  it("names each arm's raw results DIRECTORY, not just its summary file", () => {
    const res = compareSummaries(
      makeFiveTaskSummary("chikory", [4, 4, 3, 4, 3]),
      makeFiveTaskSummary("command", [2, 3, 2, 3, 2]),
      { refA: "/results/p3-rung-4/chikory/summary.json", refB: "/results/p3-rung-4/raw/summary.json" },
    );

    expect(res.armA.rawResultsDir).toBe("/results/p3-rung-4/chikory");
    expect(res.armB.rawResultsDir).toBe("/results/p3-rung-4/raw");
    for (const arm of res.arms) {
      expect(typeof arm.rawResultsDir).toBe("string");
      expect(arm.rawResultsDir!.length).toBeGreaterThan(0);
    }
  });

  it("omits rawResultsDir when no summary reference was supplied", () => {
    const res = compareSummaries(
      makeFiveTaskSummary("chikory", [4, 4, 4, 4, 4]),
      makeFiveTaskSummary("command", [3, 3, 3, 3, 3]),
    );
    expect(res.armA.rawResultsDir).toBeUndefined();
  });

  it("rejects mismatched arms or non-5 task summaries", () => {
    const sumA = makeFiveTaskSummary("chikory", [4, 4, 4, 4, 4]);
    const sumB = makeFiveTaskSummary("command", [3, 3, 3, 3, 3]);
    sumB.perTask[4]!.taskId = "task-999";

    expect(() => compareSummaries(sumA, sumB)).toThrow("identical five-task sets");

    const sumShort = { ...sumA, tasks: 4 };
    expect(() => compareSummaries(sumShort, sumB)).toThrow("exactly 5 tasks");
  });

  it("rejects non-unique 5-task sets (e.g. duplicate IDs in one arm)", () => {
    const sumA = makeFiveTaskSummary("chikory", [4, 4, 4, 4, 4]);
    const sumDup = makeFiveTaskSummary("command", [3, 3, 3, 3, 3]);
    sumDup.perTask[0]!.taskId = "task-1";
    sumDup.perTask[1]!.taskId = "task-1"; // Duplicate ID

    expect(() => compareSummaries(sumA, sumDup)).toThrow("identical five-task sets");
  });

  it("computes dSr consistently from requirement counts even if summary.dSr differs", () => {
    const sumA = makeFiveTaskSummary("chikory", [2, 2, 2, 2, 2]); // 10/20 dependencySatisfied
    sumA.dSr = 0.8; // Override with inconsistent summary.dSr value

    const sumB = makeFiveTaskSummary("command", [2, 2, 2, 2, 2]);
    const res = compareSummaries(sumA, sumB);

    expect(res.armA.dSr).toBe(0.5); // Recomputed to match 10/20
    expect(res.armA.dSrCi.lower).toBeCloseTo(0.2993, 3);
  });
});
