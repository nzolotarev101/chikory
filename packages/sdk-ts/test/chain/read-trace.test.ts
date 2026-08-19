import { describe, expect, it } from "vitest";

import { MAX_CHAIN_READ_TRACE_CHARS, renderChainReadTrace } from "../../src/chain/read-trace.js";
import type { ChainEntry, ChainCompletionReviewPayload } from "../../src/chain/store.js";
import type { ChainRecord, NodeOutcome, Plan, PlanNode } from "../../src/types.js";

function createPlanNode(id: string, dependsOn: string[] = []): PlanNode {
  return {
    id,
    goal: `Goal for ${id}`,
    acceptanceCriteria: [{ id: `AC-${id}`, description: `Criteria for ${id}` }],
    dependsOn,
    budgetUsd: 1,
  };
}

function createChainRecord(
  nodes: PlanNode[],
  nodeOutcomes: Record<string, NodeOutcome> = {},
  nodeRuns: Record<string, string> = {},
  status: ChainRecord["status"] = "RUNNING",
): ChainRecord {
  const plan: Plan = {
    id: "plan-read-trace-test",
    goal: "Test rendering of chain read trace",
    createdAt: "2026-07-20T00:00:00.000Z",
    nodes,
  };
  return {
    planId: plan.id,
    plan,
    planVerdict: {
      kind: "PROCEED",
      rationale: "Plan looks good",
      uncoveredCriteria: [],
    },
    nodeRuns,
    nodeOutcomes,
    status,
  };
}

function createChainEntry(
  idx: number,
  kind: ChainEntry["kind"],
  payload: unknown,
): ChainEntry {
  return {
    idx,
    ts: `2026-07-20T00:00:${String(idx).padStart(2, "0")}.000Z`,
    kind,
    payload,
  };
}

describe("renderChainReadTrace", () => {
  it("renders standard chain header, goal, topology, and node status", () => {
    const nodes = [createPlanNode("N-1"), createPlanNode("N-2", ["N-1"])];
    const outcomes: Record<string, NodeOutcome> = {
      "N-1": { status: "SUCCESS", verdict: "PROCEED" },
    };
    const runs = { "N-1": "run-101" };
    const record = createChainRecord(nodes, outcomes, runs, "RUNNING");

    const trace = renderChainReadTrace(record, []);

    expect(trace).toContain("chain read trace · plan-read-trace-test · RUNNING · sealed 1/2");
    expect(trace).toContain("goal: Test rendering of chain read trace");
    expect(trace).toContain("topology:\nN-1 <- (root)\nN-2 <- N-1");
    expect(trace).toContain(
      "node status:\nN-1 · SUCCESS · verdict PROCEED · run run-101\nN-2 · PENDING · verdict (none) · run (not started)",
    );
    expect(trace).toContain("completion review:\n(not recorded)");
  });

  it("renders inconclusive outcome marker on sealed nodes", () => {
    const nodes = [createPlanNode("N-1")];
    const outcomes: Record<string, NodeOutcome> = {
      "N-1": {
        status: "SUCCESS",
        verdict: "PROCEED",
        inconclusiveCheck: "suite_flaky_check",
      },
    };
    const record = createChainRecord(nodes, outcomes, { "N-1": "run-1" });

    const trace = renderChainReadTrace(record, []);

    expect(trace).toContain(
      "N-1 · SUCCESS · verdict PROCEED · inconclusive: suite_flaky_check · run run-1",
    );
  });

  it("renders design summary and recovery summary when present", () => {
    const initialNodes = [createPlanNode("N-1"), createPlanNode("N-2", ["N-1"])];
    const initialRecord = createChainRecord(initialNodes, {
      "N-1": { status: "SUCCESS", verdict: "PROCEED" },
      "N-2": { status: "FAILED", verdict: "HALT" },
    });

    const revisedNodes = [
      createPlanNode("N-1"),
      createPlanNode("N-2-r1", ["N-1"]),
    ];
    const revisedPlan: Plan = {
      ...initialRecord.plan,
      nodes: revisedNodes,
    };

    const entries: ChainEntry[] = [
      createChainEntry(0, "plan", initialRecord.plan),
      createChainEntry(1, "node_replanned", {
        failedNodeId: "N-2",
        reason: "N-2 failed assertions",
        revisedPlan,
      }),
    ];

    const currentRecord = createChainRecord(
      revisedNodes,
      {
        "N-1": { status: "SUCCESS", verdict: "PROCEED" },
        "N-2-r1": { status: "SUCCESS", verdict: "PROCEED" },
      },
      { "N-1": "run-1", "N-2-r1": "run-2" },
      "SUCCESS",
    );

    const trace = renderChainReadTrace(currentRecord, entries);

    expect(trace).toContain("recovery summary:");
    expect(trace).toContain("N-2-r1 · SUCCESS · attempts 2 · last failure: N-2 failed assertions");
    expect(trace).toContain("design summary:");
    expect(trace).toContain("N-1 · SUCCESS · Goal for N-1");
  });

  it("omits or formats summaries as (none) when empty", () => {
    const nodes = [createPlanNode("N-1")];
    const record = createChainRecord(nodes);

    const trace = renderChainReadTrace(record, []);

    expect(trace).toContain("recovery summary:\n(none)");
    expect(trace).toContain("design summary:\n(none)");
  });

  it("renders completion review findings with passed and failed details", () => {
    const nodes = [createPlanNode("N-1")];
    const record = createChainRecord(nodes, {
      "N-1": { status: "SUCCESS", verdict: "PROCEED" },
    });

    const reviewPayload: ChainCompletionReviewPayload = {
      chainId: record.planId,
      verdict: "HALT",
      rationale: "Architecture mismatch in design",
      reviewedNodeIds: ["N-1"],
      diffBase: "git-commit-abc",
      findings: [
        { id: "F-1", pass: true, justification: "Imports compliant" },
        { id: "F-2", pass: false, justification: "Exposed internal API" },
        { id: "F-3", pass: false, justification: "Missing docs" },
      ],
    };

    const entries = [
      createChainEntry(0, "chain_completion_review", reviewPayload),
    ];

    const trace = renderChainReadTrace(record, entries);

    expect(trace).toContain(
      "HALT · reviewed N-1 · findings 2/3 failed (F-2, F-3) · base git-commit-abc · Architecture mismatch in design",
    );
  });

  it("selects the latest completion review entry if multiple exist", () => {
    const nodes = [createPlanNode("N-1")];
    const record = createChainRecord(nodes, {
      "N-1": { status: "SUCCESS", verdict: "PROCEED" },
    });

    const review1: ChainCompletionReviewPayload = {
      chainId: record.planId,
      verdict: "HALT",
      rationale: "First review rationale",
      reviewedNodeIds: ["N-1"],
      diffBase: "base-1",
      findings: [{ id: "F-1", pass: false, justification: "Issue 1" }],
    };

    const review2: ChainCompletionReviewPayload = {
      chainId: record.planId,
      verdict: "PROCEED",
      rationale: "Second review rationale passed",
      reviewedNodeIds: ["N-1"],
      diffBase: "base-2",
      findings: [{ id: "F-1", pass: true, justification: "Fixed" }],
    };

    const entries = [
      createChainEntry(1, "chain_completion_review", review1),
      createChainEntry(5, "chain_completion_review", review2),
    ];

    const trace = renderChainReadTrace(record, entries);

    expect(trace).toContain("PROCEED · reviewed N-1 · findings 0/1 failed (none) · base base-2 · Second review rationale passed");
    expect(trace).not.toContain("First review rationale");
  });

  it("renders review with empty reviewedNodeIds as (none) and zero failed findings as none", () => {
    const nodes = [createPlanNode("N-1")];
    const record = createChainRecord(nodes);

    const reviewPayload: ChainCompletionReviewPayload = {
      chainId: record.planId,
      verdict: "PROCEED",
      rationale: "All passed smoothly",
      reviewedNodeIds: [],
      diffBase: "base-0",
      findings: [{ id: "F-1", pass: true, justification: "OK" }],
    };

    const entries = [
      createChainEntry(0, "chain_completion_review", reviewPayload),
    ];

    const trace = renderChainReadTrace(record, entries);

    expect(trace).toContain(
      "PROCEED · reviewed (none) · findings 0/1 failed (none) · base base-0 · All passed smoothly",
    );
  });

  it("includes resume summary when control events exist, and omits when not present", () => {
    const nodes = [createPlanNode("N-1")];
    const record = createChainRecord(nodes);

    const entriesNoResume = [createChainEntry(0, "plan", record.plan)];
    const traceWithoutResume = renderChainReadTrace(record, entriesNoResume);
    expect(traceWithoutResume).not.toContain("resume summary:");

    const entriesWithResume = [
      createChainEntry(0, "plan", record.plan),
      createChainEntry(1, "control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: "N-1",
      }),
      createChainEntry(2, "node_replanned", {
        failedNodeId: "N-1",
        reason: "N-1 failed",
        revisedPlan: {
          ...record.plan,
          nodes: [createPlanNode("N-1-r1")],
        },
      }),
      createChainEntry(3, "node_sealed", {
        nodeId: "N-1-r1",
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
      }),
    ];

    const traceWithResume = renderChainReadTrace(record, entriesWithResume);
    expect(traceWithResume).toContain("resume summary:");
    expect(traceWithResume).toContain("reopen boundary 1 · journal idx 1 · failed node N-1 · retry node N-1-r1 · recovered SUCCESS");
  });

  it("bounds topologies and node statuses exceeding MAX_RENDERED_NODES (12)", () => {
    const nodes = Array.from({ length: 15 }, (_, i) =>
      createPlanNode(`N-${i + 1}`, i > 0 ? [`N-${i}`] : []),
    );
    const record = createChainRecord(nodes);

    const trace = renderChainReadTrace(record, []);

    expect(trace).toContain("N-12 <- N-11");
    expect(trace).not.toContain("N-13 <- N-12");
    expect(trace).toContain("… 3 more node(s)");
  });

  it("bounds long lines exceeding MAX_LINE_CHARS (240) and overall trace MAX_CHAIN_READ_TRACE_CHARS (16000)", () => {
    const longGoal = "G".repeat(300);
    const nodes = [createPlanNode("N-1")];
    const record = createChainRecord(nodes);
    record.plan.goal = longGoal;

    const trace = renderChainReadTrace(record, []);

    // line is bounded to 240 chars with trailing ellipsis '…'
    const goalLine = trace.split("\n").find((line) => line.startsWith("goal:"));
    expect(goalLine).toBeDefined();
    expect(goalLine!.length).toBe(240);
    expect(goalLine!.endsWith("…")).toBe(true);

    expect(trace.length).toBeLessThanOrEqual(MAX_CHAIN_READ_TRACE_CHARS);
  });
});
