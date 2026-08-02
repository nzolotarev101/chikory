/**
 * F-208 — `chikory chain resume` repairs a chain the workflow abandoned
 * un-sealed, instead of refusing it.
 *
 * These drive the REAL host function against a real `ChainJournal` on disk and
 * read the seal back, because the failure mode being guarded is the F-198 one:
 * a decision that is asserted on while the write nobody reads is wrong or
 * missing. `chikory chain resume` needs three things to re-enter a chain —
 * a terminal entry, `resumable: true`, and a FAILED row status — and all three
 * are checked here through the journal, not through the return value.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChainJournal } from "../../src/chain/store.js";
import { repairOrphanedChainSeal } from "../../src/cli/chain.js";
import { chainJournalPath } from "../../src/runner/paths.js";
import type { ChainRecord, NodeOutcome, Plan } from "../../src/types.js";

const CHAIN_ID = "chain-orphan-1";

/** The dogfood-120 plan shape after one replan: N-1 spliced out for N-1-r1. */
const PLAN: Plan = {
  id: "plan-1-r1",
  goal: "Ship a chained campaign",
  createdAt: "2026-07-29T00:00:00.000Z",
  nodes: [
    { id: "N-1-r1", goal: "first, retried", acceptanceCriteria: [{ id: "AC-1", description: "a" }], dependsOn: [], budgetUsd: 5 },
    { id: "N-2", goal: "second", acceptanceCriteria: [{ id: "AC-1", description: "b" }], dependsOn: ["N-1-r1"], budgetUsd: 5 },
  ],
};

const ESCALATED: NodeOutcome = { status: "FAILED", verdict: "ESCALATE" };

function orphanRecord(overrides: Partial<ChainRecord> = {}): ChainRecord {
  return {
    planId: PLAN.id,
    plan: PLAN,
    // Both attempts dispatched; both sealed → nothing in flight to signal.
    nodeRuns: { "N-1": `${CHAIN_ID}-node-N-1`, "N-1-r1": `${CHAIN_ID}-node-N-1-r1` },
    nodeOutcomes: { "N-1": ESCALATED, "N-1-r1": ESCALATED },
    nodeHandoffs: {},
    status: "RUNNING",
    ...overrides,
  };
}

describe("repairOrphanedChainSeal (F-208)", () => {
  let dir: string;
  const out: string[] = [];
  const ioPair = { out: (line: string) => out.push(line), err: (line: string) => out.push(line) };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-orphan-"));
    out.length = 0;
    // A journal in exactly the shape the abandoned workflow left behind: a
    // chain row, node history, and NO terminal entry.
    const journal = new ChainJournal(chainJournalPath(dir, CHAIN_ID));
    try {
      journal.createChain(CHAIN_ID, PLAN, { repos: [] });
    } finally {
      journal.close();
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function sealed() {
    const journal = new ChainJournal(chainJournalPath(dir, CHAIN_ID));
    try {
      return {
        status: journal.getChain()?.status,
        terminals: journal.entries("terminal").map((e) => e.payload as Record<string, unknown>),
      };
    } finally {
      journal.close();
    }
  }

  const flags = () => ({ json: false, dataDir: dir });

  it("seals the orphan FAILED and resumable so `chain resume` can re-enter it", async () => {
    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      orphanRecord(),
      flags(),
      { workflowLiveness: async () => "gone" },
      ioPair,
    );

    expect(decision.action).toBe("seal");
    const state = sealed();
    // The three things `runner.resumeChain` reads before it will re-start.
    expect(state.status).toBe("FAILED");
    expect(state.terminals).toHaveLength(1);
    expect(state.terminals[0]).toMatchObject({ status: "FAILED", resumable: true });
    // The reason names the ACTIVE failed node, not the spliced-out N-1.
    expect(state.terminals[0]!["reason"]).toContain("N-1-r1");
    expect(state.terminals[0]!["reason"]).not.toContain("N-1,");
    expect(out.join("\n")).toContain("orphaned un-sealed");
  });

  it("writes NOTHING while the chain workflow is still live", async () => {
    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      orphanRecord(),
      flags(),
      { workflowLiveness: async () => "live" },
      ioPair,
    );

    expect(decision.action).toBe("none");
    expect(sealed()).toEqual({ status: "RUNNING", terminals: [] });
    expect(out).toEqual([]);
  });

  it("writes NOTHING when Temporal is unreachable — a chain we cannot see is not an orphan", async () => {
    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      orphanRecord(),
      flags(),
      { workflowLiveness: async () => "unknown" },
      ioPair,
    );

    expect(decision.action).toBe("none");
    expect(sealed()).toEqual({ status: "RUNNING", terminals: [] });
  });

  /** Liveness that answers per workflow id: the chain vs. its dispatched node. */
  const liveness =
    (chain: "live" | "gone" | "unknown", node: "live" | "gone" | "unknown") =>
    async (workflowId: string) =>
      workflowId === CHAIN_ID ? chain : node;

  it("writes NOTHING while a dispatched node is still in flight (WP-241 approve owns it)", async () => {
    const record = orphanRecord({
      nodeRuns: { "N-1-r1": `${CHAIN_ID}-node-N-1-r1` },
      nodeOutcomes: {},
    });

    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      record,
      flags(),
      { workflowLiveness: liveness("gone", "live") },
      ioPair,
    );

    expect(decision.action).toBe("none");
    expect(sealed().terminals).toEqual([]);
  });

  it("writes NOTHING when the in-flight node's own workflow cannot be reached", async () => {
    const record = orphanRecord({
      nodeRuns: { "N-1-r1": `${CHAIN_ID}-node-N-1-r1` },
      nodeOutcomes: {},
    });

    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      record,
      flags(),
      { workflowLiveness: liveness("gone", "unknown") },
      ioPair,
    );

    expect(decision.action).toBe("none");
    expect(sealed().terminals).toEqual([]);
  });

  // F-240 (dogfood-122, chain-ebecd792): the host process died mid-node. N-3
  // had a child run id and no sealed outcome, so the in-flight guard declined
  // forever and the chain stayed RUNNING with nothing able to seal it.
  it("seals a node abandoned with its host, and the chain, resumably", async () => {
    const record = orphanRecord({
      nodeRuns: { "N-1-r1": `${CHAIN_ID}-node-N-1-r1` },
      nodeOutcomes: {},
    });

    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      record,
      flags(),
      { workflowLiveness: liveness("gone", "gone") },
      ioPair,
    );

    expect(decision).toMatchObject({ action: "seal", status: "FAILED", resumable: true });
    const state = sealed();
    expect(state.status).toBe("FAILED");
    expect(state.terminals[0]).toMatchObject({ status: "FAILED", resumable: true });
    expect(state.terminals[0]!["reason"]).toContain("N-1-r1");

    // The abandoned node must be sealed FAILED in the journal too — otherwise
    // the record a resume re-reads still shows it in flight and declines again.
    const journal = new ChainJournal(chainJournalPath(dir, CHAIN_ID));
    try {
      const seals = journal.entries("node_sealed").map((e) => e.payload as Record<string, unknown>);
      expect(seals).toEqual([
        { nodeId: "N-1-r1", outcome: { status: "FAILED", verdict: "HALT" } },
      ]);
    } finally {
      journal.close();
    }
    expect(out.join("\n")).toContain("abandoned mid-flight");
  });

  it("is not a second write on an already-sealed chain", async () => {
    const deps = { workflowLiveness: async () => "gone" as const };
    await repairOrphanedChainSeal(CHAIN_ID, orphanRecord(), flags(), deps, ioPair);
    // The record a caller re-reads after the first repair carries the new status.
    const second = await repairOrphanedChainSeal(
      CHAIN_ID,
      orphanRecord({ status: "FAILED" }),
      flags(),
      deps,
      ioPair,
    );

    expect(second).toEqual({ action: "none", reason: "chain already sealed FAILED" });
    expect(sealed().terminals).toHaveLength(1);
  });

  it("seals NOT resumable when no active node failed — there is nothing to heal", async () => {
    // Only the spliced-out N-1 ever ran and failed; no ACTIVE node is failed.
    const record = orphanRecord({
      nodeRuns: { "N-1": `${CHAIN_ID}-node-N-1` },
      nodeOutcomes: { "N-1": ESCALATED },
    });

    const decision = await repairOrphanedChainSeal(
      CHAIN_ID,
      record,
      flags(),
      { workflowLiveness: async () => "gone" },
      ioPair,
    );

    expect(decision).toMatchObject({ action: "seal", resumable: false });
    expect(sealed().terminals[0]).not.toHaveProperty("resumable");
  });
});
