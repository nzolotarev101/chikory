import { describe, expect, it } from "vitest";

import {
  evaluateBaselinePrecheck,
  type BaselinePrecheckResult,
  type PrecheckCheckResult,
} from "../../src/cli/precheck.js";

describe("evaluateBaselinePrecheck", () => {
  it("marks the baseline satisfied when all checks pass", () => {
    const results: PrecheckCheckResult[] = [
      { id: "AC-1", exitCode: 0 },
      { id: "AC-2", exitCode: 0 },
    ];

    const verdict: BaselinePrecheckResult = evaluateBaselinePrecheck(results);

    expect(verdict.satisfied).toBe(true);
    expect(verdict.passedIds).toEqual(["AC-1", "AC-2"]);
    expect(verdict.failedIds).toEqual([]);
    expect(verdict.summary).toContain("all 2 acceptance checks");
  });

  it("keeps failing checks in failedIds when some checks fail", () => {
    const results: PrecheckCheckResult[] = [
      { id: "AC-1", exitCode: 0 },
      { id: "AC-2", exitCode: 1 },
    ];

    const verdict = evaluateBaselinePrecheck(results);

    expect(verdict.satisfied).toBe(false);
    expect(verdict.passedIds).toEqual(["AC-1"]);
    expect(verdict.failedIds).toEqual(["AC-2"]);
    expect(verdict.summary).toContain("1/2");
  });

  it("marks the baseline unsatisfied when all checks fail", () => {
    const results: PrecheckCheckResult[] = [
      { id: "AC-1", exitCode: 1 },
      { id: "AC-2", exitCode: 2 },
    ];

    const verdict = evaluateBaselinePrecheck(results);

    expect(verdict.satisfied).toBe(false);
    expect(verdict.passedIds).toEqual([]);
    expect(verdict.failedIds).toEqual(["AC-1", "AC-2"]);
  });

  it("does not treat an empty check list as satisfied", () => {
    const results: PrecheckCheckResult[] = [];

    const verdict = evaluateBaselinePrecheck(results);

    expect(verdict.satisfied).toBe(false);
    expect(verdict.passedIds).toEqual([]);
    expect(verdict.failedIds).toEqual([]);
    expect(verdict.summary).toBe("no acceptance checks to precheck");
  });

  it("does not mutate the input array or its elements", () => {
    const first: PrecheckCheckResult = { id: "AC-1", exitCode: 0 };
    const results: PrecheckCheckResult[] = [first, { id: "AC-2", exitCode: 1 }];
    const originalLength = results.length;
    const originalFirst = { ...first };

    evaluateBaselinePrecheck(results);

    expect(results).toHaveLength(originalLength);
    expect(results[0]).toBe(first);
    expect(first).toEqual(originalFirst);
  });
});
