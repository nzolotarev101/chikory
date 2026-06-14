import { describe, expect, it } from "vitest";

import { planCoverageGaps } from "../../src/planner/coverage.js";
import type { AcceptanceCriterion, Plan } from "../../src/index.js";

const ac = (id: string): AcceptanceCriterion => ({ id, description: `${id} desc` });

function planWith(nodeCriteria: string[][]): Plan {
  return {
    id: "plan-1",
    goal: "decomposed goal",
    createdAt: "2026-06-14T00:00:00.000Z",
    nodes: nodeCriteria.map((ids, i) => ({
      id: `N-${i + 1}`,
      goal: `node ${i + 1}`,
      acceptanceCriteria: ids.map(ac),
      dependsOn: [],
      budgetUsd: 1,
    })),
  };
}

describe("planCoverageGaps (WP-219 S2/S2b)", () => {
  it("returns no gaps when every goal criterion is covered by some node", () => {
    const plan = planWith([["AC-1"], ["AC-2", "AC-3"]]);
    expect(planCoverageGaps(plan, [ac("AC-1"), ac("AC-2"), ac("AC-3")])).toEqual([]);
  });

  it("returns the ids of uncovered goal criteria, in goal order", () => {
    const plan = planWith([["AC-1"], ["AC-3"]]);
    expect(planCoverageGaps(plan, [ac("AC-1"), ac("AC-2"), ac("AC-3"), ac("AC-4")])).toEqual([
      "AC-2",
      "AC-4",
    ]);
  });

  it("treats an empty plan as covering nothing", () => {
    const plan = planWith([]);
    expect(planCoverageGaps(plan, [ac("AC-1"), ac("AC-2")])).toEqual(["AC-1", "AC-2"]);
  });

  it("returns no gaps for an empty goal-criteria list", () => {
    const plan = planWith([["AC-1"]]);
    expect(planCoverageGaps(plan, [])).toEqual([]);
  });

  it("ignores extra node criteria that are not goal criteria", () => {
    const plan = planWith([["AC-1", "EXTRA-9"]]);
    expect(planCoverageGaps(plan, [ac("AC-1")])).toEqual([]);
  });
});
