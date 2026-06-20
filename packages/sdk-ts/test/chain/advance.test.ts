import { describe, expect, it } from "vitest";

import { advanceChain, deriveChainStatus } from "../../src/index.js";
import type { ChainRecord, NodeOutcome } from "../../src/types.js";

const successOutcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };

function chainRecord(
  nodeOutcomes: Record<string, NodeOutcome>,
  status: ChainRecord["status"] = "RUNNING",
): ChainRecord {
  return {
    planId: "plan-219",
    plan: {
      id: "plan-219",
      goal: "Ship a chained task",
      createdAt: "2026-06-19T00:00:00.000Z",
      nodes: [
        {
          id: "N-1",
          goal: "Complete the first slice",
          acceptanceCriteria: [{ id: "AC-1", description: "First slice complete" }],
          dependsOn: [],
          budgetUsd: 1,
        },
        {
          id: "N-2",
          goal: "Complete the second slice",
          acceptanceCriteria: [{ id: "AC-2", description: "Second slice complete" }],
          dependsOn: ["N-1"],
          budgetUsd: 1,
        },
        {
          id: "N-3",
          goal: "Complete the third slice",
          acceptanceCriteria: [{ id: "AC-3", description: "Third slice complete" }],
          dependsOn: ["N-2"],
          budgetUsd: 1,
        },
      ],
    },
    planVerdict: {
      kind: "PROCEED",
      rationale: "The plan is sound.",
      uncoveredCriteria: [],
    },
    nodeRuns: {},
    nodeOutcomes,
    status,
  };
}

describe("chain advance (WP-219 S3, ADR-005 D3/D4)", () => {
  it("derives RUNNING when some plan nodes are not complete", () => {
    expect(deriveChainStatus(chainRecord({ "N-1": successOutcome }))).toBe("RUNNING");
  });

  it("derives SUCCESS when every plan node has a SUCCESS outcome", () => {
    const record = chainRecord({
      "N-1": successOutcome,
      "N-2": successOutcome,
      "N-3": successOutcome,
    });

    expect(deriveChainStatus(record)).toBe("SUCCESS");
  });

  it("derives FAILED when any node outcome failed", () => {
    const record = chainRecord({
      "N-1": successOutcome,
      "N-2": { status: "FAILED", verdict: "HALT" },
      "N-3": successOutcome,
    });

    expect(deriveChainStatus(record)).toBe("FAILED");
  });

  it("derives AWAITING_PLAN_APPROVAL when ESCALATE appears alongside failure", () => {
    const record = chainRecord({
      "N-1": { status: "FAILED", verdict: "HALT" },
      "N-2": { status: "FAILED", verdict: "ESCALATE" },
    });

    expect(deriveChainStatus(record)).toBe("AWAITING_PLAN_APPROVAL");
  });

  it("folds an outcome and recomputes status", () => {
    const record = chainRecord({
      "N-1": successOutcome,
      "N-2": successOutcome,
    });
    const advanced = advanceChain(record, "N-3", successOutcome);

    expect(advanced.nodeOutcomes["N-3"]).toEqual(successOutcome);
    expect(advanced.status).toBe(deriveChainStatus(advanced));
    expect(advanced.status).toBe("SUCCESS");
  });

  it("does not mutate the input record", () => {
    const record = chainRecord({ "N-1": successOutcome }, "RUNNING");
    const originalOutcomeKeys = Object.keys(record.nodeOutcomes);
    const originalStatus = record.status;

    const advanced = advanceChain(record, "N-2", successOutcome);

    expect(advanced).not.toBe(record);
    expect(Object.keys(record.nodeOutcomes)).toEqual(originalOutcomeKeys);
    expect(record.status).toBe(originalStatus);
    expect(record.nodeOutcomes["N-2"]).toBeUndefined();
  });
});
