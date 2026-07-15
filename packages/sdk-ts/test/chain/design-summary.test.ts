import { describe, expect, it } from "vitest";

import {
  MAX_NODE_DESIGN_REASON_CHARS,
  summarizeNodeDesign,
} from "../../src/chain/design-summary.js";
import { renderChainDesignSummary } from "../../src/chain/chain-design-summary.js";
import { renderChainTrace } from "../../src/chain/trace.js";
import type { ChainRecord, NodeOutcome, Plan } from "../../src/types.js";

describe("summarizeNodeDesign", () => {
  it("renders the same node id, status, and reason deterministically", () => {
    const outcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };

    expect(summarizeNodeDesign("node-A", outcome, "Adds the pure summary primitive.")).toBe(
      "node-A · SUCCESS · Adds the pure summary primitive.",
    );
  });

  it("collapses newlines and other whitespace into a single line", () => {
    const outcome: NodeOutcome = { status: "FAILED", verdict: "HALT" };
    const summary = summarizeNodeDesign(
      "node-A",
      outcome,
      "First line.\r\nSecond line.\n\tThird line.",
    );

    expect(summary).toBe("node-A · FAILED · First line. Second line. Third line.");
    expect(summary).not.toMatch(/[\r\n]/);
  });

  it("caps a long normalized reason with an ellipsis", () => {
    const outcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };
    const reason = "x".repeat(MAX_NODE_DESIGN_REASON_CHARS + 20);
    const summary = summarizeNodeDesign("node-A", outcome, reason);
    const expectedReason = `${"x".repeat(MAX_NODE_DESIGN_REASON_CHARS - 1)}…`;

    expect(summary).toBe(`node-A · SUCCESS · ${expectedReason}`);
    expect(expectedReason).toHaveLength(MAX_NODE_DESIGN_REASON_CHARS);
  });
});

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
    expect(renderChainDesignSummary(plan, outcomes)).toBe(expected);
  });

  it("adds sealed node designs to the chain trace without changing legacy empty output", () => {
    const plan: Plan = {
      id: "plan-trace-design-summary",
      goal: "Display node design summaries in chain traces.",
      createdAt: "2026-07-14T00:00:00.000Z",
      nodes: [
        {
          id: "node-A",
          goal: "Wire the summary into the trace.",
          acceptanceCriteria: [],
          dependsOn: [],
          budgetUsd: 1,
        },
      ],
    };
    const baseRecord: ChainRecord = {
      planId: plan.id,
      plan,
      planVerdict: {
        kind: "PROCEED",
        rationale: "The plan is sound.",
        uncoveredCriteria: [],
      },
      nodeRuns: {},
      nodeOutcomes: {},
      status: "RUNNING",
    };
    const legacyOutput = [
      "chain plan-trace-design-summary · RUNNING · 1 nodes · 0/1 succeeded",
      "goal: Display node design summaries in chain traces.",
      "─".repeat(60),
      "node-A · depends-on — · run — · · pending",
      "totals: nodes 1 · succeeded 0 · failed 0 · pending 1",
    ].join("\n");

    expect(renderChainTrace(baseRecord, [])).toBe(legacyOutput);

    const outcome: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };
    const expectedNodeSummary = summarizeNodeDesign("node-A", outcome, plan.nodes[0]!.goal);
    const expectedDesignSummary = renderChainDesignSummary(plan, { "node-A": outcome });
    const integratedOutput = renderChainTrace(
      {
        ...baseRecord,
        nodeOutcomes: { "node-A": outcome },
      },
      [],
    );

    expect(expectedDesignSummary).toBe(expectedNodeSummary);
    expect(integratedOutput).toContain(`design summary:\n${expectedDesignSummary}`);
  });
});
