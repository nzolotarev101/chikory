/**
 * F-208 — an answered escalation park must never be a dead end.
 *
 * The live defect (dogfood-120, `chain-0723ac0b-…`): node `N-1` escalated, the
 * human rejected it, the replan budget spent its one retry, `N-1-r1` escalated
 * and was rejected too — and the chain then sat in `AWAITING_PLAN_APPROVAL`
 * with no terminal entry, no in-flight node, and no command that could move it.
 */
import { describe, expect, it } from "vitest";

import {
  ANSWERED_ESCALATION_REASON,
  ORPHANED_CHAIN_REASON,
  decideChainOrphanRepair,
  failedActiveNodeIds,
  resolveAnsweredEscalationPark,
  ABANDONED_NODE_REASON,
} from "../../src/chain/escalation-park.js";

describe("resolveAnsweredEscalationPark (workflow side)", () => {
  it("seals the park FAILED and resumable, naming the failed nodes", () => {
    expect(
      resolveAnsweredEscalationPark({
        status: "AWAITING_PLAN_APPROVAL",
        failedNodeIds: ["N-1-r1"],
      }),
    ).toEqual({
      action: "seal",
      status: "FAILED",
      resumable: true,
      reason: `${ANSWERED_ESCALATION_REASON}: N-1-r1`,
    });
  });

  it("seals a park with no failed node as NOT resumable — there is nothing to heal", () => {
    const resolution = resolveAnsweredEscalationPark({
      status: "AWAITING_PLAN_APPROVAL",
      failedNodeIds: [],
    });
    expect(resolution).toEqual({
      action: "seal",
      status: "FAILED",
      resumable: false,
      reason: ANSWERED_ESCALATION_REASON,
    });
  });

  it.each(["RUNNING", "SUCCESS", "FAILED", "SUSPENDED", "PLANNING", "CANCELLED"] as const)(
    "leaves %s alone — only the rule-1 park is resolved here",
    (status) => {
      expect(
        resolveAnsweredEscalationPark({ status, failedNodeIds: ["N-1"] }).action,
      ).toBe("none");
    },
  );
});

describe("decideChainOrphanRepair (CLI side)", () => {
  const orphan = {
    status: "RUNNING" as const,
    hasInflightNode: false,
    workflow: "gone" as const,
    failedNodeIds: ["N-1-r1"],
  };

  it("repairs the exact dogfood-120 state into a resumable FAILED seal", () => {
    expect(decideChainOrphanRepair(orphan)).toEqual({
      action: "seal",
      status: "FAILED",
      resumable: true,
      reason: `${ORPHANED_CHAIN_REASON}: N-1-r1`,
    });
  });

  it("repairs a chain left in the park status itself", () => {
    expect(
      decideChainOrphanRepair({ ...orphan, status: "AWAITING_PLAN_APPROVAL" }).action,
    ).toBe("seal");
  });

  it.each(["SUCCESS", "FAILED"] as const)("never rewrites a sealed %s chain", (status) => {
    const decision = decideChainOrphanRepair({ ...orphan, status });
    expect(decision).toEqual({ action: "none", reason: `chain already sealed ${status}` });
  });

  it("declines while a node is in flight — that node is the signal target", () => {
    const decision = decideChainOrphanRepair({
      ...orphan,
      hasInflightNode: true,
      inflightNodeWorkflow: "live",
    });
    expect(decision.action).toBe("none");
    expect(decision.reason).toContain("chikory chain approve");
  });

  // F-240 (dogfood-122, chain-ebecd792): the host process was killed mid-node.
  // N-3 had a child run id and no sealed outcome, so `hasInflightNode` alone
  // declined the repair under EVERY chain-workflow liveness — the chain was
  // stuck RUNNING with no command able to seal it.
  it("seals a chain whose in-flight node's own workflow is gone too", () => {
    expect(
      decideChainOrphanRepair({
        ...orphan,
        hasInflightNode: true,
        inflightNodeWorkflow: "gone",
        failedNodeIds: ["N-3"],
      }),
    ).toEqual({
      action: "seal",
      status: "FAILED",
      resumable: true,
      reason: `${ABANDONED_NODE_REASON}: N-3`,
    });
  });

  it("declines when the in-flight node's workflow cannot be reached", () => {
    for (const inflightNodeWorkflow of ["unknown", undefined] as const) {
      const decision = decideChainOrphanRepair({
        ...orphan,
        hasInflightNode: true,
        ...(inflightNodeWorkflow !== undefined ? { inflightNodeWorkflow } : {}),
      });
      expect(decision.action).toBe("none");
      expect(decision.reason).toContain("in-flight node");
    }
  });

  it("still declines an abandoned node while the chain workflow is live", () => {
    // Both guards must hold: an abandoned node does not license sealing a chain
    // whose own execution is still running.
    const decision = decideChainOrphanRepair({
      ...orphan,
      hasInflightNode: true,
      inflightNodeWorkflow: "gone",
      workflow: "live",
    });
    expect(decision).toEqual({ action: "none", reason: "the chain workflow is still running" });
  });

  it("declines while the chain workflow is still running", () => {
    const decision = decideChainOrphanRepair({ ...orphan, workflow: "live" });
    expect(decision).toEqual({ action: "none", reason: "the chain workflow is still running" });
  });

  it("declines when Temporal is unreachable — unknown is not orphaned", () => {
    // Fail-closed: a chain whose worker we merely cannot see must not be sealed
    // out from under a live execution.
    const decision = decideChainOrphanRepair({ ...orphan, workflow: "unknown" });
    expect(decision.action).toBe("none");
    expect(decision.reason).toContain("cannot reach Temporal");
  });

  it("repairs an orphan with no failed node as NOT resumable", () => {
    expect(decideChainOrphanRepair({ ...orphan, failedNodeIds: [] })).toEqual({
      action: "seal",
      status: "FAILED",
      resumable: false,
      reason: ORPHANED_CHAIN_REASON,
    });
  });
});

describe("failedActiveNodeIds", () => {
  it("counts only FAILED outcomes of nodes still in the plan", () => {
    expect(
      failedActiveNodeIds({
        nodeIds: ["N-1-r1", "N-2", "N-3"],
        outcomeStatusById: {
          // `N-1` was spliced out by the replan — its outcome must not count.
          "N-1": "FAILED",
          "N-1-r1": "FAILED",
          "N-2": "SUCCESS",
        },
      }),
    ).toEqual(["N-1-r1"]);
  });

  it("returns [] when nothing failed", () => {
    expect(
      failedActiveNodeIds({
        nodeIds: ["N-1"],
        outcomeStatusById: { "N-1": "SUCCESS" },
      }),
    ).toEqual([]);
  });
});
