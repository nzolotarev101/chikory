import { describe, expect, it } from "vitest";

import { renderChainTrace } from "../../src/index.js";
import { renderChainRecoverySummary } from "../../src/chain/chain-recovery-summary.js";
import { summarizeNodeRecovery } from "../../src/chain/recovery-summary.js";
import type {
  ChainEntry,
  ChainRecord,
  NodeOutcome,
  NodeReplannedPayload,
} from "../../src/index.js";

const successOutcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };
const failedOutcome: NodeOutcome = { status: "FAILED", verdict: "HALT" };

function chainRecord(
  nodeOutcomes: Record<string, NodeOutcome>,
  nodeRuns: Record<string, string> = {},
  status: ChainRecord["status"] = "RUNNING",
): ChainRecord {
  return {
    planId: "plan-219",
    plan: {
      id: "plan-219",
      goal: "Ship a chain trace renderer",
      createdAt: "2026-06-20T00:00:00.000Z",
      nodes: [
        {
          id: "N-1",
          goal: "Build the first slice",
          acceptanceCriteria: [{ id: "AC-1", description: "First slice complete" }],
          dependsOn: [],
          budgetUsd: 1,
        },
        {
          id: "N-2",
          goal: "Build the second slice",
          acceptanceCriteria: [{ id: "AC-2", description: "Second slice complete" }],
          dependsOn: ["N-1"],
          budgetUsd: 1,
        },
        {
          id: "N-3",
          goal: "Build the third slice",
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
    nodeRuns,
    nodeOutcomes,
    status,
  };
}

function terminalEntry(payload: unknown): ChainEntry {
  return {
    idx: 0,
    ts: "2026-06-20T00:00:00.000Z",
    kind: "terminal",
    payload,
  };
}

function chainEntry(idx: number, kind: ChainEntry["kind"], payload: unknown): ChainEntry {
  return {
    idx,
    ts: `2026-06-20T00:00:0${idx}.000Z`,
    kind,
    payload,
  };
}

describe("renderChainTrace (WP-219 S6)", () => {
  it("renders a header with chain identity, status, node count, and succeeded count", () => {
    const record = chainRecord({ "N-1": successOutcome }, { "N-1": "chain-1::N-1" });
    const firstLine = renderChainTrace(record, []).split("\n")[0];

    expect(firstLine).toContain("chain plan-219");
    expect(firstLine).toContain("RUNNING");
    expect(firstLine).toContain("3 nodes");
    expect(firstLine).toContain("1/3 succeeded");
  });

  it("renders node rows in plan order with deps, run ids, and pending cells", () => {
    const record = chainRecord({ "N-1": successOutcome }, { "N-1": "chain-1::N-1" });
    const output = renderChainTrace(record, []);
    const n1 = output.indexOf("N-1 ·");
    const n2 = output.indexOf("N-2 ·");
    const n3 = output.indexOf("N-3 ·");

    expect(n1).toBeGreaterThan(-1);
    expect(n2).toBeGreaterThan(n1);
    expect(n3).toBeGreaterThan(n2);
    expect(output).toContain("N-1 · depends-on — · run chain-1::N-1 · ✓ SUCCESS (PROCEED)");
    expect(output).toContain("N-2 · depends-on N-1 · run — · · pending");
  });

  it("renders failed node outcomes", () => {
    const record = chainRecord({ "N-2": failedOutcome });

    expect(renderChainTrace(record, [])).toContain("N-2 · depends-on N-1 · run — · ⛔ FAILED (HALT)");
  });

  it("renders totals for succeeded, failed, and pending nodes", () => {
    const record = chainRecord({
      "N-1": successOutcome,
      "N-2": failedOutcome,
    });

    expect(renderChainTrace(record, [])).toContain(
      "totals: nodes 3 · succeeded 1 · failed 1 · pending 1",
    );
  });

  it("appends a terminal failure reason only when the chain journal has one", () => {
    const record = chainRecord({ "N-1": successOutcome });
    const withReason = renderChainTrace(record, [
      terminalEntry({ status: "FAILED", reason: "chain stuck" }),
    ]);
    const withoutTerminal = renderChainTrace(record, []);

    expect(withReason.endsWith("failed: chain stuck")).toBe(true);
    expect(withoutTerminal).not.toContain("failed:");
  });

  it("appends recovery summaries for replanned nodes through both shared recovery renderers", () => {
    const initialRecord = chainRecord({
      "N-1": successOutcome,
      "N-2": failedOutcome,
    });
    const revisedPlan = {
      ...initialRecord.plan,
      nodes: initialRecord.plan.nodes.map((node) => {
        if (node.id === "N-2") return { ...node, id: "N-2-r1" };
        if (node.id === "N-3") return { ...node, dependsOn: ["N-2-r1"] };
        return node;
      }),
    };
    const replan: NodeReplannedPayload = {
      failedNodeId: "N-2",
      reason: "AC-2 failed on the first incarnation",
      revisedPlan,
    };
    const entries = [
      chainEntry(0, "plan", initialRecord.plan),
      chainEntry(1, "node_replanned", replan),
    ];
    const recoveredRecord: ChainRecord = {
      ...initialRecord,
      plan: revisedPlan,
      nodeOutcomes: {
        ...initialRecord.nodeOutcomes,
        "N-2-r1": successOutcome,
      },
    };
    const expectedRecoverySummary = [
      summarizeNodeRecovery("N-1", successOutcome, 1, "none recorded"),
      summarizeNodeRecovery(
        "N-2-r1",
        successOutcome,
        2,
        "AC-2 failed on the first incarnation",
      ),
    ].join("\n");

    expect(
      renderChainRecoverySummary(revisedPlan, recoveredRecord.nodeOutcomes, entries),
    ).toBe(expectedRecoverySummary);
    expect(renderChainTrace(recoveredRecord, entries)).toContain(
      `recovery summary:\n${expectedRecoverySummary}`,
    );
  });

  it("keeps the trace byte-identical when the chain has no replans", () => {
    const record = chainRecord({ "N-1": successOutcome }, { "N-1": "chain-1::N-1" });
    const legacyOutput = [
      "chain plan-219 · RUNNING · 3 nodes · 1/3 succeeded",
      "goal: Ship a chain trace renderer",
      "─".repeat(60),
      "N-1 · depends-on — · run chain-1::N-1 · ✓ SUCCESS (PROCEED)",
      "N-2 · depends-on N-1 · run — · · pending",
      "N-3 · depends-on N-2 · run — · · pending",
      "totals: nodes 3 · succeeded 1 · failed 0 · pending 2",
      "design summary:",
      "N-1 · SUCCESS · Build the first slice",
    ].join("\n");

    expect(renderChainTrace(record, [])).toBe(legacyOutput);
  });
});
