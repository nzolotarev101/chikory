import { describe, expect, it } from "vitest";

import { renderChainRecoverySummary } from "../../src/chain/chain-recovery-summary.js";
import type { ChainEntry, NodeReplannedPayload } from "../../src/chain/store.js";
import type { NodeOutcome, Plan } from "../../src/types.js";

function planWithNode(nodeId: string): Plan {
  return {
    id: `plan-${nodeId}`,
    goal: "Render chain recovery facts.",
    createdAt: "2026-07-15T00:00:00.000Z",
    nodes: [
      {
        id: "node-A",
        goal: "Add the node summary.",
        acceptanceCriteria: [],
        dependsOn: [],
        budgetUsd: 1,
      },
      {
        id: nodeId,
        goal: "Add the chain summary.",
        acceptanceCriteria: [],
        dependsOn: ["node-A"],
        budgetUsd: 1,
      },
    ],
  };
}

function chainEntry(idx: number, kind: ChainEntry["kind"], payload: unknown): ChainEntry {
  return { idx, ts: `2026-07-15T00:00:0${idx}.000Z`, kind, payload };
}

describe("renderChainRecoverySummary", () => {
  it("renders sealed outcomes deterministically in plan order", () => {
    const plan = planWithNode("node-B");
    const outcomes: Record<string, NodeOutcome> = {
      "node-B": { status: "FAILED", verdict: "HALT" },
      "node-A": { status: "SUCCESS", verdict: "PROCEED" },
    };
    const expected = [
      "node-A · SUCCESS · attempts 1 · last failure: none recorded",
      "node-B · FAILED · attempts 1 · last failure: none recorded",
    ].join("\n");

    expect(renderChainRecoverySummary(plan, outcomes, [])).toBe(expected);
    expect(renderChainRecoverySummary(plan, outcomes, [])).toBe(expected);
  });

  it("folds replans into the replacement node and keeps the latest reason by journal order", () => {
    const initialPlan = planWithNode("node-B");
    const firstRetryPlan = planWithNode("node-B-r1");
    const secondRetryPlan = planWithNode("node-B-r2");
    const firstReplan: NodeReplannedPayload = {
      failedNodeId: "node-B",
      reason: "first failure",
      revisedPlan: firstRetryPlan,
    };
    const secondReplan: NodeReplannedPayload = {
      failedNodeId: "node-B-r1",
      reason: "AC-2 failed\n on the second incarnation",
      revisedPlan: secondRetryPlan,
    };
    const entries = [
      chainEntry(4, "node_replanned", secondReplan),
      chainEntry(0, "plan", initialPlan),
      chainEntry(2, "node_replanned", firstReplan),
    ];
    const outcomes: Record<string, NodeOutcome> = {
      "node-B-r1": { status: "FAILED", verdict: "HALT" },
      "node-A": { status: "SUCCESS", verdict: "PROCEED" },
      "node-B": { status: "FAILED", verdict: "HALT" },
      "node-B-r2": { status: "SUCCESS", verdict: "PROCEED" },
    };
    const expected = [
      "node-A · SUCCESS · attempts 1 · last failure: none recorded",
      "node-B-r2 · SUCCESS · attempts 3 · last failure: AC-2 failed on the second incarnation",
    ].join("\n");

    expect(renderChainRecoverySummary(secondRetryPlan, outcomes, entries)).toBe(expected);
    expect(renderChainRecoverySummary(secondRetryPlan, outcomes, [...entries].reverse())).toBe(
      expected,
    );
  });

  it("omits plan nodes that have not sealed", () => {
    const plan = planWithNode("node-B");
    const outcomes = {
      "node-A": { status: "SUCCESS", verdict: "PROCEED" },
    } satisfies Record<string, NodeOutcome>;

    expect(renderChainRecoverySummary(plan, outcomes, [])).toBe(
      "node-A · SUCCESS · attempts 1 · last failure: none recorded",
    );
  });
});
