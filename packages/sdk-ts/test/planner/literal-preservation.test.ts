import { describe, expect, it } from "vitest";

import { extractGoalLiterals, planLiteralGaps } from "../../src/planner/literal-preservation.js";
import type { Plan } from "../../src/types.js";

function planWith(goal: string, nodeGoals: string[]): Plan {
  return {
    id: "plan-literals",
    goal,
    nodes: nodeGoals.map((nodeGoal, i) => ({
      id: `N-${i + 1}`,
      goal: nodeGoal,
      acceptanceCriteria: [],
      dependsOn: [],
      budgetUsd: 1,
    })),
    createdAt: "2026-06-30T00:00:00.000Z",
  };
}

describe("extractGoalLiterals", () => {
  it("deduplicates backtick literals in first-seen order", () => {
    expect(
      extractGoalLiterals("Preserve `parseWpStatus`, then `Plan`, then `parseWpStatus` again."),
    ).toEqual(["parseWpStatus", "Plan"]);
  });

  it("returns an empty list when the goal has no backtick literal", () => {
    expect(extractGoalLiterals("Ship the planner verifier without pinned literals.")).toEqual([]);
  });
});

describe("planLiteralGaps", () => {
  it("returns no gaps when all mandated literals are preserved by node goals", () => {
    const plan = planWith(
      "Preserve `parseWpStatus` and `assessSpecStaleness` in the decomposition.",
      [
        "Implement parseWpStatus from the plan table.",
        "Use assessSpecStaleness to report stale targets.",
      ],
    );

    expect(planLiteralGaps(plan)).toEqual([]);
  });

  it("returns a dropped mandated literal in goal order", () => {
    const plan = planWith("The node must keep `assessSpecStaleness` verbatim.", [
      "Implement stale-target detection without naming the required function.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["assessSpecStaleness"]);
  });

  it("enforces the dogfood-066 discriminator: WP-25 is not preserved by a WP-255-only node goal", () => {
    const plan = planWith("Keep `WP-25` grep-pinned for the exact-token check.", [
      "Implement the WP-255 cleanup only.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["WP-25"]);
  });

  it("requires exact token boundaries around mandated literals", () => {
    const plan = planWith("Keep `WP-25`, `F-49`, and `grep-pinned` intact.", [
      "Mention XWP-25, WP-25a, WP-25_extra, F-490, and grep-pinned-extra only.",
    ]);

    expect(planLiteralGaps(plan)).toEqual(["WP-25", "F-49", "grep-pinned"]);
  });

  it("does not mutate the plan or its nodes", () => {
    const plan = planWith("Preserve `parseWpStatus` in one node.", [
      "Implement parseWpStatus exactly.",
    ]);
    const before = JSON.stringify(plan);

    expect(planLiteralGaps(plan)).toEqual([]);
    expect(JSON.stringify(plan)).toBe(before);
  });
});
