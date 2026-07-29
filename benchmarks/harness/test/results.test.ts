import { describe, expect, it } from "vitest";
import type { TaskResult } from "../src/results.js";
import { isTaskVerified, summarize } from "../src/results.js";

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
