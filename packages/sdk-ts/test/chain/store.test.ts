import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChainJournal, chainJournalPath, chainRecordFrom } from "../../src/index.js";
import type { NodeOutcome, Plan, PlanVerdict } from "../../src/types.js";

const plan: Plan = {
  id: "plan-1",
  goal: "Ship a chained task",
  createdAt: "2026-06-20T00:00:00.000Z",
  nodes: [
    { id: "N-1", goal: "first", acceptanceCriteria: [{ id: "AC-1", description: "a" }], dependsOn: [], budgetUsd: 1 },
    { id: "N-2", goal: "second", acceptanceCriteria: [{ id: "AC-2", description: "b" }], dependsOn: ["N-1"], budgetUsd: 1 },
  ],
};

const success: NodeOutcome = { status: "SUCCESS", verdict: "PROCEED" };

describe("ChainJournal (WP-219 D4)", () => {
  let dir: string;
  let journal: ChainJournal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-chain-store-"));
    journal = new ChainJournal(chainJournalPath(dir, "chain-1"));
  });
  afterEach(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("createChain is idempotent and stores the plan + RUNNING status", () => {
    journal.createChain("chain-1", plan);
    journal.createChain("chain-1", { ...plan, goal: "MUTATED" });
    const chain = journal.getChain();
    expect(chain).toBeDefined();
    expect((JSON.parse(chain!.plan_json) as Plan).goal).toBe("Ship a chained task");
    expect(chain!.status).toBe("RUNNING");
  });

  it("append assigns a strictly monotonic idx and round-trips payloads", () => {
    const a = journal.append("node_started", { nodeId: "N-1", childRunId: "r1" });
    const b = journal.append("node_sealed", { nodeId: "N-1", outcome: success });
    expect(a.idx).toBe(0);
    expect(b.idx).toBe(1);
    expect(journal.entries("node_started")[0]!.payload).toEqual({ nodeId: "N-1", childRunId: "r1" });
  });

  it("appendOnce keyed by nodeId never double-journals a node event", () => {
    const first = journal.appendOnce(
      "node_sealed",
      { field: "nodeId", value: "N-1" },
      { nodeId: "N-1", outcome: success },
    );
    const second = journal.appendOnce(
      "node_sealed",
      { field: "nodeId", value: "N-1" },
      { nodeId: "N-1", outcome: { status: "FAILED", verdict: "HALT" } },
    );
    expect(first.existed).toBe(false);
    expect(second.existed).toBe(true);
    expect(second.entry.idx).toBe(first.entry.idx);
    expect(journal.entries("node_sealed")).toHaveLength(1);
    // The first write wins — no overwrite.
    expect((second.entry.payload as { outcome: NodeOutcome }).outcome).toEqual(success);
  });
});

describe("chainRecordFrom", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-chain-rec-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns undefined for an uninitialized chain", () => {
    const journal = new ChainJournal(chainJournalPath(dir, "chain-x"));
    try {
      expect(chainRecordFrom(journal)).toBeUndefined();
    } finally {
      journal.close();
    }
  });

  it("reconstructs the ChainRecord from node_started/node_sealed/plan_verdict", () => {
    const journal = new ChainJournal(chainJournalPath(dir, "chain-1"));
    try {
      journal.createChain("chain-1", plan);
      journal.append("plan", plan);
      journal.append("node_started", { nodeId: "N-1", childRunId: "chain-1::N-1" });
      journal.append("node_sealed", { nodeId: "N-1", outcome: success });
      const verdict: PlanVerdict = { kind: "PROCEED", rationale: "sound", uncoveredCriteria: [] };
      journal.append("plan_verdict", verdict);

      const record = chainRecordFrom(journal);
      expect(record).toBeDefined();
      expect(record!.planId).toBe("plan-1");
      expect(record!.plan.nodes).toHaveLength(2);
      expect(record!.nodeRuns).toEqual({ "N-1": "chain-1::N-1" });
      expect(record!.nodeOutcomes).toEqual({ "N-1": success });
      expect(record!.planVerdict).toEqual(verdict);
      expect(record!.status).toBe("RUNNING");
    } finally {
      journal.close();
    }
  });
});
