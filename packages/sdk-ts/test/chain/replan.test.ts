import { describe, expect, it } from "vitest";

import { decideReplan } from "../../src/index.js";
import type { ChainRecord, NodeOutcome, Plan } from "../../src/types.js";

const success: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };
const failed: NodeOutcome = { status: "FAILED", verdict: "HALT" };

function plan(): Plan {
  return {
    id: "plan-replan",
    goal: "recover a failed chain",
    createdAt: "2026-07-03T00:00:00.000Z",
    nodes: [
      { id: "N-1", goal: "first", acceptanceCriteria: [], dependsOn: [], budgetUsd: 1 },
      { id: "N-2", goal: "second", acceptanceCriteria: [], dependsOn: ["N-1"], budgetUsd: 1 },
      { id: "N-3", goal: "third", acceptanceCriteria: [], dependsOn: ["N-2"], budgetUsd: 1 },
    ],
  };
}

function record(nodeOutcomes: Record<string, NodeOutcome>): ChainRecord {
  return {
    planId: "plan-replan",
    plan: plan(),
    nodeRuns: {},
    nodeOutcomes,
    status: "FAILED",
  };
}

describe("decideReplan", () => {
  it("replans the first failed node while under budget", () => {
    const decision = decideReplan(record({ "N-1": failed }), "N-1", 1);

    expect(decision).toMatchObject({
      action: "REPLAN",
      failedNodeId: "N-1",
      remainingNodeIds: ["N-2", "N-3"],
      replansUsed: 1,
      maxReplans: 1,
    });
  });

  it("halts once the replan budget is exhausted", () => {
    const decision = decideReplan(record({ "N-1": failed, "N-2": failed }), "N-2", 1);

    expect(decision.action).toBe("HALT");
    expect(decision.reason).toContain("replan budget exhausted");
    expect(decision.replansUsed).toBe(2);
  });

  it("halts the first failed node when the bounded budget is zero", () => {
    const decision = decideReplan(record({ "N-1": failed }), "N-1", 0);

    expect(decision).toMatchObject({
      action: "HALT",
      failedNodeId: "N-1",
      remainingNodeIds: ["N-2", "N-3"],
      replansUsed: 1,
      maxReplans: 0,
    });
    expect(decision.reason).toContain("replan budget exhausted");
  });

  it.each([
    { maxReplans: -1, expectedBudget: 0 },
    { maxReplans: Number.NaN, expectedBudget: 0 },
    { maxReplans: 1.9, expectedBudget: 1 },
  ])(
    "normalizes bounded budget input $maxReplans to $expectedBudget",
    ({ maxReplans, expectedBudget }) => {
      const decision = decideReplan(record({ "N-1": failed }), "N-1", maxReplans);

      expect(decision.maxReplans).toBe(expectedBudget);
      expect(decision.replansUsed).toBe(1);
      expect(decision.action).toBe(expectedBudget >= 1 ? "REPLAN" : "HALT");
    },
  );

  it("halts with no failed-node decision when the requested node is not failed", () => {
    const decision = decideReplan(record({ "N-1": success }), "N-1", 1);

    expect(decision).toMatchObject({
      action: "HALT",
      remainingNodeIds: ["N-2", "N-3"],
      replansUsed: 0,
      maxReplans: 1,
    });
    expect(decision).not.toHaveProperty("failedNodeId");
  });
});
