import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChainActivities } from "../../src/chain/activities.js";
import {
  ChainJournal,
  chainRecordFrom,
} from "../../src/chain/store.js";
import { Journal } from "../../src/journal/journal.js";
import { chainJournalPath, journalPath } from "../../src/runner/paths.js";
import type { Plan, TaskSpec } from "../../src/types.js";

const DUMMY_SPEC: TaskSpec = {
  name: "test-spec",
  goal: "Test task goal",
  budgetUsd: 1,
} as unknown as TaskSpec;

const TEST_PLAN: Plan = {
  id: "plan-inconclusive-test",
  goal: "Carry inconclusive checks across chain activities.",
  createdAt: "2026-07-19T00:00:00.000Z",
  nodes: [
    {
      id: "node-inconclusive",
      goal: "First node with inconclusive check",
      acceptanceCriteria: [{ id: "AC-1", description: "First" }],
      dependsOn: [],
      budgetUsd: 1,
    },
    {
      id: "node-clean",
      goal: "Second node that is clean",
      acceptanceCriteria: [{ id: "AC-2", description: "Second" }],
      dependsOn: ["node-inconclusive"],
      budgetUsd: 1,
    },
  ],
};

describe("chain activities: inconclusive check survival (AC-1 / WP-615)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-chain-activities-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists inconclusive check from child run journal to chain journal node_sealed entry", async () => {
    const runInconclusiveId = "run-inconclusive-child";
    const runCleanId = "run-clean-child";
    const chainId = "chain-test-inconclusive";

    // 1. Seed two REAL child run journals on disk
    // Inconclusive child run:
    const jInconclusive = new Journal(journalPath(dataDir, runInconclusiveId));
    try {
      jInconclusive.createRun(runInconclusiveId, DUMMY_SPEC);
      jInconclusive.append({
        kind: "terminal",
        payload: {
          status: "SUCCESS",
          inconclusiveCheck: "pre_existing_suite_green",
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      jInconclusive.sealRun("SUCCESS");
    } finally {
      jInconclusive.close();
    }

    // Clean child run:
    const jClean = new Journal(journalPath(dataDir, runCleanId));
    try {
      jClean.createRun(runCleanId, DUMMY_SPEC);
      jClean.append({
        kind: "terminal",
        payload: {
          status: "SUCCESS",
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      jClean.sealRun("SUCCESS");
    } finally {
      jClean.close();
    }

    // 2. Drive the real chain activities
    const activities = createChainActivities({ dataDir });
    await activities.initChain({ chainId, plan: TEST_PLAN });

    const resultInconclusive = await activities.readNodeResult({
      childRunId: runInconclusiveId,
    });
    const resultClean = await activities.readNodeResult({
      childRunId: runCleanId,
    });

    expect(resultInconclusive.outcome.status).toBe("SUCCESS");
    expect(resultInconclusive.outcome.verdict).toBe("PROCEED");
    expect(resultInconclusive.inconclusiveCheck).toBe("pre_existing_suite_green");

    expect(resultClean.outcome.status).toBe("SUCCESS");
    expect(resultClean.outcome.verdict).toBe("PROCEED");
    expect(resultClean.inconclusiveCheck).toBeUndefined();

    await activities.recordNodeStarted({
      chainId,
      nodeId: "node-inconclusive",
      childRunId: runInconclusiveId,
    });
    await activities.recordNodeSealed({
      chainId,
      nodeId: "node-inconclusive",
      outcome: resultInconclusive.outcome,
      ...(resultInconclusive.inconclusiveCheck !== undefined
        ? { inconclusiveCheck: resultInconclusive.inconclusiveCheck }
        : {}),
    });

    await activities.recordNodeStarted({
      chainId,
      nodeId: "node-clean",
      childRunId: runCleanId,
    });
    await activities.recordNodeSealed({
      chainId,
      nodeId: "node-clean",
      outcome: resultClean.outcome,
      ...(resultClean.inconclusiveCheck !== undefined
        ? { inconclusiveCheck: resultClean.inconclusiveCheck }
        : {}),
    });

    // 3. Re-open the chain journal from disk and assert on the persisted node_sealed entries
    const chainJournal = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const nodeSealedEntries = chainJournal.entries("node_sealed");
      expect(nodeSealedEntries).toHaveLength(2);

      const inconclusiveEntry = nodeSealedEntries.find(
        (e) => (e.payload as { nodeId: string }).nodeId === "node-inconclusive",
      );
      expect(inconclusiveEntry).toBeDefined();
      const incPayload = inconclusiveEntry!.payload as Record<string, unknown>;
      // Assert that the marker's value is present at the top level of the node_sealed payload
      expect(incPayload.inconclusiveCheck).toBe("pre_existing_suite_green");
      expect((incPayload.outcome as Record<string, unknown>).inconclusiveCheck).toBeUndefined();
      expect((incPayload.outcome as Record<string, unknown>).status).toBe("SUCCESS");

      const cleanEntry = nodeSealedEntries.find(
        (e) => (e.payload as { nodeId: string }).nodeId === "node-clean",
      );
      expect(cleanEntry).toBeDefined();
      const cleanPayload = cleanEntry!.payload as Record<string, unknown>;
      expect(cleanPayload.inconclusiveCheck).toBeUndefined();
      expect(
        (cleanPayload.outcome as Record<string, unknown>).inconclusiveCheck,
      ).toBeUndefined();
      expect((cleanPayload.outcome as Record<string, unknown>).status).toBe("SUCCESS");

      // 4. Assert offline reconstruction from ChainJournal
      const record = chainRecordFrom(chainJournal);
      expect(record).toBeDefined();
      expect(record!.nodeOutcomes["node-inconclusive"]).toEqual({
        status: "SUCCESS",
        verdict: "PROCEED",
        inconclusiveCheck: "pre_existing_suite_green",
      });
      expect(record!.nodeOutcomes["node-clean"]).toEqual({
        status: "SUCCESS",
        verdict: "PROCEED",
      });
      expect(
        record!.nodeOutcomes["node-clean"]?.inconclusiveCheck,
      ).toBeUndefined();
    } finally {
      chainJournal.close();
    }
  });
});
