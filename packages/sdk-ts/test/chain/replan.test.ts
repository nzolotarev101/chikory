import { describe, expect, it } from "vitest";

import { decideReplan, nodeLineageRoot, resumeGrantBounds } from "../../src/index.js";
import type { ChainRecord, NodeOutcome, Plan, PlanNode } from "../../src/types.js";

const success: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };
const failed: NodeOutcome = { status: "FAILED", verdict: "HALT" };

function node(id: string, dependsOn: string[] = []): PlanNode {
  return { id, goal: id, acceptanceCriteria: [], dependsOn, budgetUsd: 1 };
}

function plan(nodes: PlanNode[] = [node("N-1"), node("N-2", ["N-1"]), node("N-3", ["N-2"])]): Plan {
  return { id: "plan-replan", goal: "recover a failed chain", createdAt: "2026-07-03T00:00:00.000Z", nodes };
}

function record(nodeOutcomes: Record<string, NodeOutcome>, nodes?: PlanNode[]): ChainRecord {
  return {
    planId: "plan-replan",
    plan: plan(nodes),
    nodeRuns: {},
    nodeOutcomes,
    status: "FAILED",
  };
}

const bounds = (maxPerNode: number, maxChain = 99) => ({ maxPerNode, maxChain });

describe("decideReplan", () => {
  it("replans the first failed node while under budget", () => {
    const decision = decideReplan(record({ "N-1": failed }), "N-1", bounds(1));

    expect(decision).toMatchObject({
      action: "REPLAN",
      failedNodeId: "N-1",
      remainingNodeIds: ["N-2", "N-3"],
      replansUsed: 1,
      maxReplans: 1,
    });
  });

  it("halts once one node lineage has spent its own budget", () => {
    // `N-1` failed, was replanned into `N-1-r1`, and `N-1-r1` failed too.
    const decision = decideReplan(
      record({ "N-1": failed, "N-1-r1": failed }, [node("N-1-r1"), node("N-2", ["N-1-r1"])]),
      "N-1-r1",
      bounds(1),
    );

    expect(decision.action).toBe("HALT");
    expect(decision.reason).toContain("replan budget exhausted for node N-1");
    expect(decision.replansUsed).toBe(2);
  });

  it("halts the first failed node when the bounded budget is zero", () => {
    const decision = decideReplan(record({ "N-1": failed }), "N-1", bounds(0));

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
    { maxPerNode: -1, expectedBudget: 0 },
    { maxPerNode: Number.NaN, expectedBudget: 0 },
    { maxPerNode: 1.9, expectedBudget: 1 },
  ])("normalizes bounded budget input $maxPerNode to $expectedBudget", ({ maxPerNode, expectedBudget }) => {
    const decision = decideReplan(record({ "N-1": failed }), "N-1", bounds(maxPerNode));

    expect(decision.maxReplans).toBe(expectedBudget);
    expect(decision.replansUsed).toBe(1);
    expect(decision.action).toBe(expectedBudget >= 1 ? "REPLAN" : "HALT");
  });

  it("halts with no failed-node decision when the requested node is not failed", () => {
    const decision = decideReplan(record({ "N-1": success }), "N-1", bounds(1));

    expect(decision).toMatchObject({
      action: "HALT",
      remainingNodeIds: ["N-2", "N-3"],
      replansUsed: 0,
      maxReplans: 99,
    });
    expect(decision).not.toHaveProperty("failedNodeId");
  });

  // ── F-213 ────────────────────────────────────────────────────────────────
  //
  // dogfood-120, exactly: `N-1` failed, `N-1-r1` failed, `N-1-r1-r2` SUCCEEDED
  // and replaced them in the plan. Then `N-2` — the next node, its first ever
  // failure — was refused with `replan budget exhausted: 3 failed node(s)
  // exceeds max 1` and the six-node chain died 1/6 done. A lineage that HEALED
  // is not evidence of thrash and must not be charged to the nodes after it.

  it("gives a later node its own budget after an earlier lineage healed", () => {
    const decision = decideReplan(
      record({ "N-1": failed, "N-1-r1": failed, "N-1-r1-r2": success, "N-2": failed }, [
        node("N-1-r1-r2"),
        node("N-2", ["N-1-r1-r2"]),
        node("N-3", ["N-2"]),
      ]),
      "N-2",
      bounds(1),
    );

    expect(decision).toMatchObject({ action: "REPLAN", failedNodeId: "N-2", replansUsed: 1 });
  });

  it("still halts a genuinely thrashing chain on the chain-wide ceiling", () => {
    // Three DISTINCT live nodes failed — that is thrash, not a healed lineage.
    const decision = decideReplan(
      record({ "N-1": failed, "N-2": failed, "N-3": failed }),
      "N-3",
      bounds(1, 2),
    );

    expect(decision.action).toBe("HALT");
    expect(decision.reason).toContain("3 failed node(s) exceeds max 2");
  });

  it("counts a lineage's spliced-out incarnations against that lineage", () => {
    // The per-node budget is the one place the dead incarnations still count:
    // "has THIS node had its chances?" is exactly what they answer.
    const decision = decideReplan(
      record({ "N-1": failed, "N-1-r1": failed }, [node("N-1-r1"), node("N-2", ["N-1-r1"])]),
      "N-1-r1",
      bounds(2),
    );

    expect(decision).toMatchObject({ action: "REPLAN", replansUsed: 2, maxReplans: 2 });
  });
});

describe("nodeLineageRoot", () => {
  it.each([
    ["N-1", "N-1"],
    ["N-1-r1", "N-1"],
    ["N-1-r1-r2", "N-1"],
    ["node-a-r10", "node-a"],
    // A node whose own id ends in a non-retry suffix is left alone.
    ["N-1-rework", "N-1-rework"],
  ])("%s → %s", (nodeId, root) => {
    expect(nodeLineageRoot(nodeId)).toBe(root);
  });
});

describe("resumeGrantBounds", () => {
  it("grants exactly one more attempt however much is already spent", () => {
    const state = record({ "N-1": failed, "N-1-r1": failed }, [
      node("N-1-r1"),
      node("N-2", ["N-1-r1"]),
    ]);

    const decision = decideReplan(state, "N-1-r1", resumeGrantBounds(state, "N-1-r1"));

    expect(decision.action).toBe("REPLAN");
  });
});
