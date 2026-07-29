/**
 * `initChain` journals the plan-phase repair trail (WP-542/F-207, ADR-009 D1:
 * "every heal attempt is journaled with its trigger, evidence, and outcome").
 *
 * The plan gate runs host-side, before the chain exists, so its repair loop has
 * nowhere to write while it runs — the trail is frozen into the workflow input
 * and journaled at init. These tests drive the REAL activity against a real
 * `ChainJournal` on disk and then read the entries back, because the failure
 * mode this guards against is the F-198 one: a call site that exists and is
 * even asserted on, while the callee writes nothing anyone can read.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChainActivities } from "../../src/chain/activities.js";
import { ChainJournal } from "../../src/chain/store.js";
import { chainJournalPath } from "../../src/runner/paths.js";
import type { Plan, PlanAttemptRecord } from "../../src/types.js";

const PLAN: Plan = {
  id: "plan-1",
  goal: "Ship a chained task",
  createdAt: "2026-07-28T00:00:00.000Z",
  nodes: [
    {
      id: "N-1",
      goal: "first",
      acceptanceCriteria: [{ id: "AC-1", description: "a" }],
      dependsOn: [],
      budgetUsd: 1,
    },
  ],
};

const TRAIL: PlanAttemptRecord[] = [
  {
    attempt: 1,
    phase: "gate",
    kind: "gate-revise",
    verdictKind: "REVISE",
    machineGaps: ["mandated goal literal `summary.json` appears in no node goal"],
    costUsd: 0.1,
    reason: "N-1 omits the lint step",
  },
  {
    attempt: 2,
    phase: "gate",
    kind: "PROCEED",
    verdictKind: "PROCEED",
    machineGaps: [],
    costUsd: 0.1,
    reason: "covers AC-1",
  },
];

describe("initChain plan_verdict journaling (WP-542, ADR-009 D1)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chikory-plan-attempt-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function entries(chainId: string) {
    const journal = new ChainJournal(chainJournalPath(dir, chainId));
    try {
      return journal.entries("plan_verdict").map((entry) => entry.payload as PlanAttemptRecord);
    } finally {
      journal.close();
    }
  }

  it("writes one readable entry per attempt, in order, ending in the PROCEED", async () => {
    const activities = createChainActivities({ dataDir: dir });

    await activities.initChain({ chainId: "chain-1", plan: PLAN, planAttempts: TRAIL });

    const written = entries("chain-1");
    expect(written).toHaveLength(2);
    expect(written.map((a) => a.attempt)).toEqual([1, 2]);
    expect(written[0]?.verdictKind).toBe("REVISE");
    // The evidence survives the round trip — a trail with no gaps is not a trail.
    expect(written[0]?.machineGaps).toEqual([
      "mandated goal literal `summary.json` appears in no node goal",
    ]);
    expect(written[1]?.kind).toBe("PROCEED");
  });

  it("is idempotent — a workflow replay must not double the trail", async () => {
    const activities = createChainActivities({ dataDir: dir });

    await activities.initChain({ chainId: "chain-2", plan: PLAN, planAttempts: TRAIL });
    await activities.initChain({ chainId: "chain-2", plan: PLAN, planAttempts: TRAIL });

    expect(entries("chain-2")).toHaveLength(2);
  });

  it("writes nothing when no trail is supplied (direct chainLoop callers)", async () => {
    const activities = createChainActivities({ dataDir: dir });

    await activities.initChain({ chainId: "chain-3", plan: PLAN });

    expect(entries("chain-3")).toEqual([]);
  });
});
