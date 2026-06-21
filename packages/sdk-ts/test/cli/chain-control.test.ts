/**
 * WP-241 (F-42) — chain-level visibility of a parked child run. Unit-tests the
 * pure journal readers `inflightNode` + `childParkedState` (the seam the chain
 * `--watch` stream and `chikory chain approve|resume` both build on) over real
 * on-disk journal fixtures. No Temporal: the durable approve/resume round-trip
 * is exercised live by the dogfood-044 campaign (real integration over a mocked
 * wire, per the project's test discipline).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { childParkedState, inflightNode } from "../../src/cli/chain.js";
import { Journal } from "../../src/journal/journal.js";
import { journalPath } from "../../src/runner/paths.js";
import type { ChainRecord, JournalEntryKind } from "../../src/types.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "chikory-chain-control-"));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** Build a per-run child journal at journalPath(dataDir, runId) with entries. */
function childJournal(runId: string, entries: Array<{ kind: JournalEntryKind; payload: unknown }>): void {
  const journal = new Journal(journalPath(dataDir, runId));
  try {
    for (const e of entries) {
      journal.append({ kind: e.kind, payload: e.payload, costDeltaUsd: 0, artifactRefs: [] });
    }
  } finally {
    journal.close();
  }
}

function recordWith(
  nodeRuns: Record<string, string>,
  nodeOutcomes: ChainRecord["nodeOutcomes"] = {},
): ChainRecord {
  return {
    planId: "plan-x",
    plan: { id: "plan-x", goal: "g", createdAt: "t", nodes: [] },
    nodeRuns,
    nodeOutcomes,
    status: "RUNNING",
  };
}

describe("inflightNode", () => {
  it("returns the node that started but has not sealed", () => {
    const record = recordWith(
      { "node-a": "chain-1-node-node-a", "node-b": "chain-1-node-node-b" },
      { "node-a": { status: "SUCCESS", verdict: "PROCEED" } },
    );
    expect(inflightNode(record)).toEqual({ nodeId: "node-b", childRunId: "chain-1-node-node-b" });
  });

  it("returns undefined when every started node has sealed", () => {
    const record = recordWith(
      { "node-a": "chain-1-node-node-a" },
      { "node-a": { status: "SUCCESS", verdict: "PROCEED" } },
    );
    expect(inflightNode(record)).toBeUndefined();
  });

  it("returns undefined for a chain with no dispatched node", () => {
    expect(inflightNode(recordWith({}))).toBeUndefined();
  });
});

describe("childParkedState", () => {
  const runId = "chain-1-node-node-b";

  it("reports AWAITING_APPROVAL with the escalate reason for an ESCALATE verdict", () => {
    childJournal(runId, [
      { kind: "step", payload: { stepIndex: 0 } },
      {
        kind: "verdict",
        payload: {
          source: "runner",
          verdict: { kind: "ESCALATE", rationale: "stuck", escalateReason: "executor FAILED 3 consecutive steps" },
        },
      },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toEqual({
      nodeId: "node-b",
      childRunId: runId,
      kind: "AWAITING_APPROVAL",
      reason: "executor FAILED 3 consecutive steps",
    });
  });

  it("reports SUSPENDED with the budget figures for a budget halt", () => {
    childJournal(runId, [
      { kind: "budget_event", payload: { event: "halt", details: { spentUsd: 0.7, budgetUsd: 0.5 } } },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toEqual({
      nodeId: "node-b",
      childRunId: runId,
      kind: "SUSPENDED",
      reason: "budget cap ($0.70 / $0.50)",
    });
  });

  it("WP-243: reports an injected debug halt as SUSPENDED with the seam reason", () => {
    childJournal(runId, [
      { kind: "budget_event", payload: { event: "halt", cause: "debug", details: { injected: 1, atStep: 0 } } },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toEqual({
      nodeId: "node-b",
      childRunId: runId,
      kind: "SUSPENDED",
      reason: "debug park-injection (WP-243)",
    });
  });

  it("WP-243: clears the injected debug park once a top-up lands", () => {
    childJournal(runId, [
      { kind: "budget_event", payload: { event: "halt", cause: "debug", details: { injected: 1 } } },
      { kind: "budget_event", payload: { event: "top_up", details: { budgetUsd: 5 } } },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toBeUndefined();
  });

  it("clears the park once the escalation is resolved by a later verdict", () => {
    childJournal(runId, [
      { kind: "verdict", payload: { verdict: { kind: "ESCALATE", escalateReason: "stuck" } } },
      { kind: "verdict", payload: { verdict: { kind: "PROCEED", rationale: "ok now" } } },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toBeUndefined();
  });

  it("clears the park once a budget top-up lands", () => {
    childJournal(runId, [
      { kind: "budget_event", payload: { event: "halt", details: { spentUsd: 0.7, budgetUsd: 0.5 } } },
      { kind: "budget_event", payload: { event: "top_up", details: { budgetUsd: 1.5 } } },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toBeUndefined();
  });

  it("is not parked once the child seals (terminal entry)", () => {
    childJournal(runId, [
      { kind: "verdict", payload: { verdict: { kind: "ESCALATE", escalateReason: "stuck" } } },
      { kind: "terminal", payload: { status: "SUCCESS" } },
    ]);
    expect(childParkedState(dataDir, "node-b", runId)).toBeUndefined();
  });

  it("returns undefined when the child has no journal yet", () => {
    expect(childParkedState(dataDir, "node-b", "chain-1-node-missing")).toBeUndefined();
  });
});
