import { describe, expect, it } from "vitest";

import { renderChainDesignSummary } from "../../src/chain/chain-design-summary.js";
import type { NodeOutcome, Plan } from "../../src/types.js";

describe("renderChainDesignSummary", () => {
  it("renders sealed outcomes in stable plan order regardless of outcome insertion order", () => {
    const plan: Plan = {
      id: "plan-design-summary",
      goal: "Add a per-node design summary to the chain trace.",
      createdAt: "2026-07-14T00:00:00.000Z",
      nodes: [
        {
          id: "node-A",
          goal: "Adds the pure summary primitive.",
          acceptanceCriteria: [],
          dependsOn: [],
          budgetUsd: 1,
        },
        {
          id: "node-B",
          goal: "Folds summaries into a multiline block.",
          acceptanceCriteria: [],
          dependsOn: ["node-A"],
          budgetUsd: 1,
        },
      ],
    };
    const outcomes: Record<string, NodeOutcome> = {
      "node-B": { status: "FAILED", verdict: "HALT" },
      "node-A": { status: "SUCCESS", verdict: "PROCEED" },
    };
    const expected = [
      "node-A · SUCCESS · Adds the pure summary primitive.",
      "node-B · FAILED · Folds summaries into a multiline block.",
    ].join("\n");

    expect(renderChainDesignSummary(plan, outcomes)).toBe(expected);
  });

  it("returns an empty string when the plan has no nodes", () => {
    const plan: Plan = {
      id: "empty-plan",
      goal: "An empty plan.",
      createdAt: "2026-07-14T00:00:00.000Z",
      nodes: [],
    };
    const outcomes: Record<string, NodeOutcome> = {
      "node-A": { status: "SUCCESS", verdict: "PROCEED" },
    };

    expect(renderChainDesignSummary(plan, outcomes)).toBe("");
  });

  it("returns an empty string when no nodes in the plan have outcomes", () => {
    const plan: Plan = {
      id: "plan-no-outcomes",
      goal: "Plan with no outcomes.",
      createdAt: "2026-07-14T00:00:00.000Z",
      nodes: [
        {
          id: "node-A",
          goal: "Goal A",
          acceptanceCriteria: [],
          dependsOn: [],
          budgetUsd: 1,
        },
      ],
    };
    const outcomes: Record<string, NodeOutcome> = {};

    expect(renderChainDesignSummary(plan, outcomes)).toBe("");
  });

  it("only renders summaries for nodes that have outcomes", () => {
    const plan: Plan = {
      id: "plan-partial-outcomes",
      goal: "Plan with partial outcomes.",
      createdAt: "2026-07-14T00:00:00.000Z",
      nodes: [
        {
          id: "node-A",
          goal: "Goal A",
          acceptanceCriteria: [],
          dependsOn: [],
          budgetUsd: 1,
        },
        {
          id: "node-B",
          goal: "Goal B",
          acceptanceCriteria: [],
          dependsOn: ["node-A"],
          budgetUsd: 1,
        },
      ],
    };
    const outcomes: Record<string, NodeOutcome> = {
      "node-A": { status: "SUCCESS", verdict: "PROCEED" },
    };
    const expected = "node-A · SUCCESS · Goal A";

    expect(renderChainDesignSummary(plan, outcomes)).toBe(expected);
  });
});
