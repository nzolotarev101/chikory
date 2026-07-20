import { describe, expect, it } from "vitest";

import {
  MAX_CHAIN_RESUME_SUMMARY_CHARS,
  renderChainResumeSummary,
} from "../../src/chain/resume-summary.js";
import { renderChainReadTrace } from "../../src/chain/read-trace.js";
import type {
  ChainEntry,
  NodeReplannedPayload,
  NodeSealedPayload,
} from "../../src/chain/store.js";
import type { ChainRecord, NodeOutcome, Plan } from "../../src/types.js";

function planWithNode(nodeId: string): Plan {
  return {
    id: `plan-${nodeId}`,
    goal: "Recover a sealed chain.",
    createdAt: "2026-07-20T00:00:00.000Z",
    nodes: [
      {
        id: nodeId,
        goal: "Retry the failed work.",
        acceptanceCriteria: [],
        dependsOn: [],
        budgetUsd: 1,
      },
    ],
  };
}

function chainEntry(idx: number, kind: ChainEntry["kind"], payload: unknown): ChainEntry {
  return { idx, ts: `2026-07-20T00:00:${String(idx).padStart(2, "0")}.000Z`, kind, payload };
}

function replanEntry(idx: number, failedNodeId: string, retryNodeId: string): ChainEntry {
  const payload: NodeReplannedPayload = {
    failedNodeId,
    reason: `${failedNodeId} failed`,
    revisedPlan: planWithNode(retryNodeId),
  };
  return chainEntry(idx, "node_replanned", payload);
}

function sealEntry(
  idx: number,
  nodeId: string,
  status: NodeSealedPayload["outcome"]["status"],
): ChainEntry {
  const payload: NodeSealedPayload = {
    nodeId,
    outcome: { status, verdict: status === "SUCCESS" ? "PROCEED" : "HALT" },
  };
  return chainEntry(idx, "node_sealed", payload);
}

function chainRecord(plan: Plan, nodeOutcomes: Record<string, NodeOutcome>): ChainRecord {
  return {
    planId: plan.id,
    plan,
    planVerdict: {
      kind: "PROCEED",
      rationale: "The recovery plan is sound.",
      uncoveredCriteria: [],
    },
    nodeRuns: {},
    nodeOutcomes,
    status: "SUCCESS",
  };
}

describe("renderChainResumeSummary", () => {
  it("orders reopen boundaries deterministically and names each replacement retry", () => {
    const entries = [
      chainEntry(0, "plan", planWithNode("N-B")),
      sealEntry(1, "N-B", "FAILED"),
      chainEntry(3, "control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: "N-B",
      }),
      replanEntry(4, "N-B", "N-B-r1"),
      sealEntry(5, "N-B-r1", "FAILED"),
      chainEntry(7, "control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: "N-B-r1",
      }),
      replanEntry(8, "N-B-r1", "N-B-r1-r2"),
      sealEntry(9, "N-B-r1-r2", "SUCCESS"),
    ];
    const expected = [
      "reopen boundary 1 · journal idx 3 · failed node N-B · retry node N-B-r1 · sealed FAILED",
      "reopen boundary 2 · journal idx 7 · failed node N-B-r1 · retry node N-B-r1-r2 · recovered SUCCESS",
    ].join("\n");

    expect(renderChainResumeSummary(entries)).toBe(expected);
    expect(renderChainResumeSummary([...entries].reverse())).toBe(expected);
  });

  it("identifies a recovering retry from node_replanned and node_sealed history", () => {
    const entries = [
      chainEntry(0, "plan", planWithNode("N-2")),
      chainEntry(2, "control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: "N-2",
      }),
      replanEntry(3, "N-2", "N-2-r1"),
      sealEntry(4, "N-2-r1", "SUCCESS"),
    ];

    expect(renderChainResumeSummary(entries)).toContain(
      "failed node N-2 · retry node N-2-r1 · recovered SUCCESS",
    );
  });

  it("bounds large histories while preserving deterministic omission details", () => {
    const entries = Array.from({ length: 15 }, (_, index) =>
      chainEntry(index, "control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: `N-${index}-${"x".repeat(300)}`,
      }),
    );
    const first = renderChainResumeSummary(entries);
    const second = renderChainResumeSummary([...entries].reverse());

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(MAX_CHAIN_RESUME_SUMMARY_CHARS);
    expect(first.split("\n")).toHaveLength(13);
    expect(first).toContain("reopen boundary 12");
    expect(first).not.toContain("reopen boundary 13 ·");
    expect(first.endsWith("… 3 more reopen boundary(s)")).toBe(true);
  });

  it("ignores unrelated control events and returns an empty block without a reopen", () => {
    expect(
      renderChainResumeSummary([
        chainEntry(0, "control_event", { event: "resume", source: "failed_seal" }),
      ]),
    ).toBe("");
  });

  it("includes the resume block in the read trace for a reopened chain", () => {
    const initialPlan = planWithNode("N-B");
    const retryPlan = planWithNode("N-B-r1");
    const entries = [
      chainEntry(0, "plan", initialPlan),
      sealEntry(1, "N-B", "FAILED"),
      chainEntry(2, "control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: "N-B",
      }),
      replanEntry(3, "N-B", "N-B-r1"),
      sealEntry(4, "N-B-r1", "SUCCESS"),
    ];
    const expectedSummary = renderChainResumeSummary(entries);

    expect(
      renderChainReadTrace(
        chainRecord(retryPlan, {
          "N-B": { status: "FAILED", verdict: "HALT" },
          "N-B-r1": { status: "SUCCESS", verdict: "PROCEED" },
        }),
        entries,
      ),
    ).toContain(`resume summary:\n${expectedSummary}`);
  });

  it("omits the resume block from the read trace without a reopen boundary", () => {
    const plan = planWithNode("N-A");
    const entries = [chainEntry(0, "plan", plan), sealEntry(1, "N-A", "SUCCESS")];
    const trace = renderChainReadTrace(
      chainRecord(plan, { "N-A": { status: "SUCCESS", verdict: "PROCEED" } }),
      entries,
    );

    expect(renderChainResumeSummary(entries)).toBe("");
    expect(trace).not.toContain("resume summary:");
    expect(trace).not.toContain("reopen boundary");
  });
});
