import { describe, expect, test } from "vitest";

import { hasDependencyCycle } from "../../src/chain/validation.js";
import type { Plan } from "../../src/types.js";

function buildPlan(nodes: Array<[string, string[]]>): Plan {
  return {
    id: "plan-1",
    goal: "g",
    createdAt: "2026-06-13T00:00:00.000Z",
    nodes: nodes.map(([id, dependsOn]) => ({
      id,
      dependsOn,
      goal: "g",
      acceptanceCriteria: [{ id: "AC-1", description: "x" }],
      budgetUsd: 5,
    })),
  };
}

describe("hasDependencyCycle (WP-219)", () => {
  test("acyclic linear", () => {
    const plan = buildPlan([
      ["N-1", []],
      ["N-2", ["N-1"]],
      ["N-3", ["N-1", "N-2"]],
    ]);

    expect(hasDependencyCycle(plan)).toBe(false);
  });

  test("two-node cycle", () => {
    const plan = buildPlan([
      ["N-1", ["N-2"]],
      ["N-2", ["N-1"]],
    ]);

    expect(hasDependencyCycle(plan)).toBe(true);
  });

  test("self dependency", () => {
    const plan = buildPlan([["N-1", ["N-1"]]]);

    expect(hasDependencyCycle(plan)).toBe(true);
  });

  test("acyclic diamond", () => {
    const plan = buildPlan([
      ["N-1", []],
      ["N-2", ["N-1"]],
      ["N-3", ["N-1"]],
      ["N-4", ["N-2", "N-3"]],
    ]);

    expect(hasDependencyCycle(plan)).toBe(false);
  });
});
