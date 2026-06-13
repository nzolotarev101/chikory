import { describe, expect, test } from "vitest";

import { readyNodes } from "../../src/chain/sequencing.js";
import type { Plan } from "../../src/types.js";

const plan: Plan = {
  id: "plan-1",
  goal: "g",
  createdAt: "2026-06-13T00:00:00.000Z",
  nodes: [
    {
      id: "N-1",
      goal: "g",
      acceptanceCriteria: [{ id: "AC-1", description: "x" }],
      dependsOn: [],
      budgetUsd: 5,
    },
    {
      id: "N-2",
      goal: "g",
      acceptanceCriteria: [{ id: "AC-1", description: "x" }],
      dependsOn: ["N-1"],
      budgetUsd: 5,
    },
    {
      id: "N-3",
      goal: "g",
      acceptanceCriteria: [{ id: "AC-1", description: "x" }],
      dependsOn: ["N-1", "N-2"],
      budgetUsd: 5,
    },
  ],
};

describe("readyNodes (WP-219)", () => {
  test("returns dependency-free nodes first", () => {
    expect(readyNodes(plan, []).map((n) => n.id)).toEqual(["N-1"]);
  });

  test("returns a node after its single dependency completes", () => {
    expect(readyNodes(plan, ["N-1"]).map((n) => n.id)).toEqual(["N-2"]);
  });

  test("returns a node after all of its dependencies complete", () => {
    expect(readyNodes(plan, ["N-1", "N-2"]).map((n) => n.id)).toEqual([
      "N-3",
    ]);
  });

  test("returns no nodes when the plan is complete", () => {
    expect(
      readyNodes(plan, ["N-1", "N-2", "N-3"]).map((n) => n.id),
    ).toEqual([]);
  });
});
