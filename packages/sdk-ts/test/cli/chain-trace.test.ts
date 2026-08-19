import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderChainReadTrace } from "../../src/chain/read-trace.js";
import {
  ChainJournal,
  chainRecordFrom,
  type NodeReplannedPayload,
} from "../../src/chain/store.js";
import { cmdChainTrace } from "../../src/cli/chain.js";
import { main } from "../../src/cli/main.js";
import { chainJournalPath } from "../../src/runner/paths.js";
import type { Plan } from "../../src/types.js";

const CHAIN_ID = "chain-trace-cli";
const PLAN: Plan = {
  id: "plan-trace-cli",
  goal: "Show a sealed chain from the CLI.",
  createdAt: "2026-07-19T00:00:00.000Z",
  nodes: [
    {
      id: "node-A",
      goal: "Render the chain trace.",
      acceptanceCriteria: [],
      dependsOn: [],
      budgetUsd: 1,
    },
  ],
};

describe("chikory chain trace", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-chain-trace-cli-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("renders a sealed chain journal to stdout", async () => {
    const journal = new ChainJournal(chainJournalPath(dataDir, CHAIN_ID));
    try {
      journal.createChain(CHAIN_ID, PLAN);
      journal.append("plan", PLAN);
      journal.append("node_started", { nodeId: "node-A", childRunId: "run-node-A" });
      journal.append("node_sealed", {
        nodeId: "node-A",
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
      });
      journal.append("terminal", { status: "SUCCESS" });
      journal.setStatus("SUCCESS", true);
    } finally {
      journal.close();
    }

    const out: string[] = [];
    const err: string[] = [];
    const code = await main(["chain", "trace", CHAIN_ID, "--data-dir", dataDir], {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("chain read trace · plan-trace-cli · SUCCESS · sealed 1/1");
    expect(out[0]).toContain("topology:\nnode-A <- (root)");
    expect(out[0]).toContain(
      "node status:\nnode-A · SUCCESS · verdict PROCEED · run run-node-A",
    );
  });

  it("renders a replanned node's elevated attempt count in the recovery summary", () => {
    const revisedPlan: Plan = {
      ...PLAN,
      id: "plan-trace-cli-r1",
      nodes: PLAN.nodes.map((node) => ({ ...node, id: "node-A-r1" })),
    };
    const replan: NodeReplannedPayload = {
      failedNodeId: "node-A",
      reason: "The first incarnation failed its focused trace check.",
      revisedPlan,
    };
    const journal = new ChainJournal(chainJournalPath(dataDir, CHAIN_ID));
    let expectedTrace: string;
    try {
      journal.createChain(CHAIN_ID, PLAN);
      journal.append("plan", PLAN);
      journal.append("node_started", { nodeId: "node-A", childRunId: "run-node-A" });
      journal.append("node_sealed", {
        nodeId: "node-A",
        outcome: { status: "FAILED", verdict: "HALT" },
      });
      journal.append("node_replanned", replan);
      journal.updatePlan(revisedPlan);
      journal.append("node_started", {
        nodeId: "node-A-r1",
        childRunId: "run-node-A-r1",
      });
      journal.append("node_sealed", {
        nodeId: "node-A-r1",
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
      });
      journal.append("terminal", { status: "SUCCESS" });
      journal.setStatus("SUCCESS", true);

      const record = chainRecordFrom(journal);
      if (record === undefined) throw new Error("expected a sealed synthetic chain record");
      expectedTrace = renderChainReadTrace(record, journal.entries());
    } finally {
      journal.close();
    }

    const out: string[] = [];
    const err: string[] = [];
    const code = cmdChainTrace(
      { chainId: CHAIN_ID, dataDir, json: false },
      {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      },
    );

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual([expectedTrace]);

    const recoverySummary = out[0]
      ?.split("recovery summary:\n", 2)[1]
      ?.split("\ndesign summary:", 1)[0];
    expect(recoverySummary).toBeDefined();
    expect(recoverySummary).not.toBe("");
    expect(recoverySummary).toContain("node-A-r1 · SUCCESS · attempts 2");
  });

  it("returns non-zero with a clear error for an unknown chain id", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(["chain", "trace", "missing-chain", "--data-dir", dataDir], {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([
      `chikory: unknown chain id 'missing-chain' (no journal under ${dataDir}/chains)`,
    ]);
  });

  it("renders the inconclusive check name on the affected node's line and leaves clean node silent", () => {
    const twoNodePlan: Plan = {
      id: "plan-two-nodes",
      goal: "Run two nodes where one has an inconclusive check.",
      createdAt: "2026-07-19T00:00:00.000Z",
      nodes: [
        {
          id: "node-inconclusive",
          goal: "First node that finished with inconclusive check.",
          acceptanceCriteria: [{ id: "AC-1", description: "First" }],
          dependsOn: [],
          budgetUsd: 1,
        },
        {
          id: "node-clean",
          goal: "Second node that finished clean.",
          acceptanceCriteria: [{ id: "AC-2", description: "Second" }],
          dependsOn: ["node-inconclusive"],
          budgetUsd: 1,
        },
      ],
    };

    const journal = new ChainJournal(chainJournalPath(dataDir, "chain-inconclusive-trace"));
    try {
      journal.createChain("chain-inconclusive-trace", twoNodePlan);
      journal.append("plan", twoNodePlan);
      journal.append("node_started", {
        nodeId: "node-inconclusive",
        childRunId: "run-inconclusive",
      });
      journal.append("node_sealed", {
        nodeId: "node-inconclusive",
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
        inconclusiveCheck: "pre_existing_suite_green",
      });
      journal.append("node_started", {
        nodeId: "node-clean",
        childRunId: "run-clean",
      });
      journal.append("node_sealed", {
        nodeId: "node-clean",
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
      });
      journal.append("terminal", { status: "SUCCESS" });
      journal.setStatus("SUCCESS", true);
    } finally {
      journal.close();
    }

    const out: string[] = [];
    const err: string[] = [];
    const code = cmdChainTrace(
      { chainId: "chain-inconclusive-trace", dataDir, json: false },
      {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      },
    );

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);

    const rendered = out[0]!;
    expect(rendered).toContain("pre_existing_suite_green");

    // The inconclusive node line must name the check
    const lines = rendered.split("\n");
    const inconclusiveLine = lines.find((l) => l.startsWith("node-inconclusive ·"));
    expect(inconclusiveLine).toBeDefined();
    expect(inconclusiveLine).toContain("pre_existing_suite_green");
    expect(inconclusiveLine).toContain("SUCCESS");

    // The clean node line must be silent about inconclusive checks
    const cleanLine = lines.find((l) => l.startsWith("node-clean ·"));
    expect(cleanLine).toBeDefined();
    expect(cleanLine).toBe("node-clean · SUCCESS · verdict PROCEED · run run-clean");
    expect(cleanLine).not.toContain("inconclusive");
  });
});
