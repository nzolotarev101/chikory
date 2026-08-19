import { describe, expect, it } from "vitest";

import { evaluateBaselinePrecheck } from "../../src/util/precheck.js";

describe("evaluateBaselinePrecheck", () => {
  it("returns unsatisfied verdict when no results are provided", () => {
    const result = evaluateBaselinePrecheck([]);

    expect(result).toEqual({
      satisfied: false,
      passedIds: [],
      failedIds: [],
      summary: "no acceptance checks to precheck",
    });
  });

  it("returns satisfied verdict when all acceptance checks pass", () => {
    const results = [
      { id: "check-1", exitCode: 0 },
      { id: "check-2", exitCode: 0 },
    ];

    const result = evaluateBaselinePrecheck(results);

    expect(result).toEqual({
      satisfied: true,
      passedIds: ["check-1", "check-2"],
      failedIds: [],
      summary:
        "baseline already satisfies all 2 acceptance checks — the goal may already be done",
    });
  });

  it("returns unsatisfied verdict when all acceptance checks fail", () => {
    const results = [
      { id: "check-1", exitCode: 1 },
      { id: "check-2", exitCode: 127 },
    ];

    const result = evaluateBaselinePrecheck(results);

    expect(result).toEqual({
      satisfied: false,
      passedIds: [],
      failedIds: ["check-1", "check-2"],
      summary: "0/2 acceptance checks already pass; 2 still failing",
    });
  });

  it("returns unsatisfied verdict with correctly partitioned IDs when results are mixed", () => {
    const results = [
      { id: "check-1", exitCode: 0 },
      { id: "check-2", exitCode: 1 },
      { id: "check-3", exitCode: 0 },
      { id: "check-4", exitCode: 2 },
    ];

    const result = evaluateBaselinePrecheck(results);

    expect(result).toEqual({
      satisfied: false,
      passedIds: ["check-1", "check-3"],
      failedIds: ["check-2", "check-4"],
      summary: "2/4 acceptance checks already pass; 2 still failing",
    });
  });
});
