import { describe, expect, it } from "vitest";

import { buildPlan, type BuildPlanOptions } from "../../src/planner/assemble.js";
import type { PlanInput, PlanNode } from "../../src/types.js";

const nodes: PlanNode[] = [
  {
    id: "N-1",
    goal: "Implement deterministic plan assembly",
    acceptanceCriteria: [{ id: "AC-1", description: "Valid replies produce plans" }],
    dependsOn: [],
    budgetUsd: 2,
  },
  {
    id: "N-2",
    goal: "Verify structural validation",
    acceptanceCriteria: [{ id: "AC-2", description: "Invalid structures are rejected" }],
    dependsOn: ["N-1"],
    budgetUsd: 1,
  },
];

const input: PlanInput = {
  goal: "Ship the pure goal planner halves",
  acceptanceCriteria: [
    { id: "AC-1", description: "Valid replies produce plans" },
    { id: "AC-2", description: "Invalid structures are rejected" },
  ],
  budgetUsd: 3,
  family: "anthropic",
};

const opts: BuildPlanOptions = {
  id: "plan-219",
  createdAt: "2026-06-15T12:00:00.000Z",
};

describe("buildPlan (WP-219 S2, ADR-005 D1)", () => {
  it("assembles a plan from the validated reply and injected fields", () => {
    const plan = buildPlan({ nodes }, input, opts);

    expect(plan.id).toBe(opts.id);
    expect(plan.createdAt).toBe(opts.createdAt);
    expect(plan.goal).toBe(input.goal);
    expect(plan.nodes).toHaveLength(nodes.length);
    expect(plan.nodes.map((node) => node.id)).toEqual(["N-1", "N-2"]);
  });

  it("rejects an empty node list", () => {
    expect(() => buildPlan({ nodes: [] }, input, opts)).toThrow("no nodes");
  });

  it("rejects duplicate node ids", () => {
    const duplicateNodes: PlanNode[] = [nodes[0]!, { ...nodes[1]!, id: "N-1" }];

    expect(() => buildPlan({ nodes: duplicateNodes }, input, opts)).toThrow("N-1");
  });

  it("rejects dependencies on unknown node ids", () => {
    const danglingNodes: PlanNode[] = [
      nodes[0]!,
      { ...nodes[1]!, dependsOn: ["N-missing"] },
    ];

    expect(() => buildPlan({ nodes: danglingNodes }, input, opts)).toThrow(
      "plan node N-2 depends on unknown node N-missing",
    );
  });

  it("does not mutate the input reply", () => {
    const reply = { nodes: [...nodes] };
    const originalLength = reply.nodes.length;

    buildPlan(reply, input, opts);

    expect(reply.nodes).toHaveLength(originalLength);
    expect(reply.nodes.map((node) => node.id)).toEqual(["N-1", "N-2"]);
  });
});
