import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderChainReadTrace } from "../../src/chain/read-trace.js";
import { renderChainResumeSummary } from "../../src/chain/resume-summary.js";
import { ChainJournal, chainRecordFrom } from "../../src/chain/store.js";
import { main } from "../../src/cli/main.js";
import { chainJournalPath } from "../../src/runner/paths.js";
import type { Plan } from "../../src/types.js";

const CHAIN_ID = "chain-trace-resume-cli";
const FAILED_NODE_ID = "node-retry";
const RETRY_NODE_ID = "node-retry-r1";

function plan(nodeId: string, suffix = ""): Plan {
  return {
    id: `plan-chain-trace-resume${suffix}`,
    goal: "Recover a failed chain and expose its resume history.",
    createdAt: "2026-07-20T00:00:00.000Z",
    nodes: [
      {
        id: nodeId,
        goal: "Complete the focused chain trace coverage.",
        acceptanceCriteria: [],
        dependsOn: [],
        budgetUsd: 1,
      },
    ],
  };
}

describe("chikory chain trace resume history", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-chain-trace-resume-cli-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("renders the reopen boundary and recovering retry from a sealed chain store", async () => {
    const initialPlan = plan(FAILED_NODE_ID);
    const retryPlan = plan(RETRY_NODE_ID, "-r1");
    const journal = new ChainJournal(chainJournalPath(dataDir, CHAIN_ID));
    let expectedTrace: string;
    let resumeSummary: string;
    let reopenIdx: number;

    try {
      journal.createChain(CHAIN_ID, initialPlan);
      journal.append("plan", initialPlan);
      journal.append("node_started", {
        nodeId: FAILED_NODE_ID,
        childRunId: "run-node-retry",
      });
      journal.append("node_sealed", {
        nodeId: FAILED_NODE_ID,
        outcome: { status: "FAILED", verdict: "HALT" },
      });
      journal.append("terminal", {
        status: "FAILED",
        reason: "The first incarnation failed its focused trace check.",
        resumable: true,
      });
      journal.setStatus("FAILED", true);

      const reopen = journal.append("control_event", {
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: FAILED_NODE_ID,
      });
      reopenIdx = reopen.idx;
      journal.reopenChain();
      journal.append("node_replanned", {
        failedNodeId: FAILED_NODE_ID,
        reason: "Retry the failed focused trace check.",
        revisedPlan: retryPlan,
      });
      journal.updatePlan(retryPlan);
      journal.append("node_started", {
        nodeId: RETRY_NODE_ID,
        childRunId: "run-node-retry-r1",
      });
      journal.append("node_sealed", {
        nodeId: RETRY_NODE_ID,
        outcome: { status: "SUCCESS", verdict: "PROCEED" },
      });
      journal.append("terminal", { status: "SUCCESS" });
      journal.setStatus("SUCCESS", true);

      const entries = journal.entries();
      const record = chainRecordFrom(journal);
      if (record === undefined) throw new Error("expected a sealed synthetic chain record");
      resumeSummary = renderChainResumeSummary(entries);
      expectedTrace = renderChainReadTrace(record, entries);
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
    expect(out).toEqual([expectedTrace]);
    expect(resumeSummary).not.toBe("");
    expect(resumeSummary).toContain(`reopen boundary 1 · journal idx ${reopenIdx}`);
    expect(resumeSummary).toContain(
      `failed node ${FAILED_NODE_ID} · retry node ${RETRY_NODE_ID} · recovered SUCCESS`,
    );
    expect(out[0]).toContain(`resume summary:\n${resumeSummary}`);
  });
});
