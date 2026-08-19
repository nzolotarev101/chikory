import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChainActivities } from "../../src/chain/activities.js";
import { advanceChain } from "../../src/chain/advance.js";
import { deriveNodeOutcome } from "../../src/chain/node-spec.js";
import {
  buildStructuredCompactionNote,
  DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS,
} from "../../src/chain/compaction-note.js";
import {
  ChainJournal,
  chainRecordFrom,
} from "../../src/chain/store.js";
import { Journal } from "../../src/journal/journal.js";
import { chainJournalPath, journalPath } from "../../src/runner/paths.js";
import type { ChainRecord, Plan, TaskSpec } from "../../src/types.js";

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

describe("chain activities: inconclusive check survival (AC-1 / WP-615 / WP-636 / WP-637)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-chain-activities-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists inconclusive check from child run journal to chain journal node_sealed entry and agrees across live fold and offline restore", async () => {
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

      // 5. Build live chain record exactly as chain-loop.ts folds it
      let liveRecord: ChainRecord = {
        planId: TEST_PLAN.id,
        plan: TEST_PLAN,
        nodeRuns: {},
        nodeOutcomes: {},
        nodeHandoffs: {},
        status: "RUNNING",
      };

      liveRecord = advanceChain(
        {
          ...liveRecord,
          nodeRuns: { ...liveRecord.nodeRuns, "node-inconclusive": runInconclusiveId },
        },
        "node-inconclusive",
        resultInconclusive.outcome,
      );

      liveRecord = advanceChain(
        {
          ...liveRecord,
          nodeRuns: { ...liveRecord.nodeRuns, "node-clean": runCleanId },
        },
        "node-clean",
        resultClean.outcome,
      );

      // Invariant: Live folded record and disk-restored record must agree
      expect(liveRecord.nodeOutcomes).toEqual(record!.nodeOutcomes);

      // 6. Drive buildStructuredCompactionNote from both live and restored records
      const liveInconclusiveNote = buildStructuredCompactionNote({
        node: TEST_PLAN.nodes[0]!,
        outcome: liveRecord.nodeOutcomes["node-inconclusive"]!,
      });
      const restoredInconclusiveNote = buildStructuredCompactionNote({
        node: TEST_PLAN.nodes[0]!,
        outcome: record!.nodeOutcomes["node-inconclusive"]!,
      });

      expect(liveInconclusiveNote).toContain("pre_existing_suite_green");
      expect(restoredInconclusiveNote).toContain("pre_existing_suite_green");
      expect(liveInconclusiveNote).toBe(restoredInconclusiveNote);

      // Clean node note: byte-exact match against standard five lines
      const liveCleanNote = buildStructuredCompactionNote({
        node: TEST_PLAN.nodes[1]!,
        outcome: liveRecord.nodeOutcomes["node-clean"]!,
      });
      const restoredCleanNote = buildStructuredCompactionNote({
        node: TEST_PLAN.nodes[1]!,
        outcome: record!.nodeOutcomes["node-clean"]!,
      });

      const expectedCleanNote = [
        "node: node-clean",
        "goal: Second node that is clean",
        "outcome: SUCCESS",
        "verdict: PROCEED",
        "changed_paths: (none recorded)",
      ].join("\n");

      expect(liveCleanNote).toBe(expectedCleanNote);
      expect(restoredCleanNote).toBe(expectedCleanNote);
      expect(liveCleanNote).not.toContain("inconclusive");
    } finally {
      chainJournal.close();
    }
  });

  it("preserves inconclusive marker under cap with unbounded changed paths and verifies journal durability", async () => {
    const runId = "run-overflow-child";
    const chainId = "chain-test-overflow";

    const j = new Journal(journalPath(dataDir, runId));
    try {
      j.createRun(runId, DUMMY_SPEC);
      j.append({
        kind: "terminal",
        payload: {
          status: "SUCCESS",
          inconclusiveCheck: "integration_check_timeout",
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      j.sealRun("SUCCESS");
    } finally {
      j.close();
    }

    const activities = createChainActivities({ dataDir });
    await activities.initChain({ chainId, plan: TEST_PLAN });

    const result = await activities.readNodeResult({ childRunId: runId });
    expect(result.inconclusiveCheck).toBe("integration_check_timeout");

    const hugePaths = Array.from({ length: 400 }, (_, i) => `src/deep/nested/path/to/module_${i}/index.ts`);
    const handoff = {
      nodeId: "node-inconclusive",
      runId,
      repos: [
        {
          repoUrl: "/repo",
          sourceCommit: "c1",
          baseCommit: "c0",
          headCommit: "c1",
          changedPaths: hugePaths,
          bundleRef: { id: "b1", kind: "repo_snapshot" as const, bytes: 100, summary: "snapshot" },
        },
      ],
    };

    await activities.recordNodeStarted({ chainId, nodeId: "node-inconclusive", childRunId: runId });
    await activities.recordNodeSealed({
      chainId,
      nodeId: "node-inconclusive",
      outcome: result.outcome,
      handoff,
      ...(result.inconclusiveCheck !== undefined ? { inconclusiveCheck: result.inconclusiveCheck } : {}),
    });

    const chainJournal = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const record = chainRecordFrom(chainJournal);
      expect(record).toBeDefined();
      expect(record!.nodeOutcomes["node-inconclusive"]?.inconclusiveCheck).toBe("integration_check_timeout");

      const note = buildStructuredCompactionNote({
        node: TEST_PLAN.nodes[0]!,
        outcome: record!.nodeOutcomes["node-inconclusive"]!,
        handoff: record!.nodeHandoffs?.["node-inconclusive"],
      });

      expect(note.length).toBeLessThanOrEqual(DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS);
      expect(note).toContain("inconclusive_check: integration_check_timeout");
      expect(note.endsWith("...")).toBe(true);
    } finally {
      chainJournal.close();
    }
  });

  // F-399 (dogfood-157 review): the WP-521 seeded-fail drill overrides the child's
  // outcome with a forced FAILED before folding it. `recordNodeSealed` persists the
  // marker top-level regardless, so a bare literal there left the LIVE fold knowing
  // less than `chainRecordFrom` rebuilds — the WP-636 invariant with one branch open.
  it("agrees across live fold and offline restore on the WP-521 seeded-fail branch", async () => {
    const runId = "run-seeded-child";
    const chainId = "chain-test-seeded";

    const j = new Journal(journalPath(dataDir, runId));
    try {
      j.createRun(runId, DUMMY_SPEC);
      j.append({
        kind: "terminal",
        payload: { status: "SUCCESS", reason: "sealed", inconclusiveCheck: "suite_killed_at_cap" },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      j.sealRun("SUCCESS");
    } finally {
      j.close();
    }

    const activities = createChainActivities({ dataDir });
    await activities.initChain({ chainId, plan: TEST_PLAN });
    const result = await activities.readNodeResult({ childRunId: runId });

    // The exact outcome chain-loop.ts folds when `isSeededFailNode` fires.
    const seededOutcome = deriveNodeOutcome("FAILED", "HALT", result.inconclusiveCheck);
    await activities.recordNodeStarted({ chainId, nodeId: "node-inconclusive", childRunId: runId });
    await activities.recordNodeSealed({
      chainId,
      nodeId: "node-inconclusive",
      outcome: seededOutcome,
      ...(result.inconclusiveCheck !== undefined
        ? { inconclusiveCheck: result.inconclusiveCheck }
        : {}),
    });

    const empty: ChainRecord = {
      planId: TEST_PLAN.id,
      plan: TEST_PLAN,
      nodeRuns: {},
      nodeOutcomes: {},
      nodeHandoffs: {},
      status: "RUNNING",
    };
    const live = advanceChain(empty, "node-inconclusive", seededOutcome);

    const chainJournal = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const record = chainRecordFrom(chainJournal);
      expect(record).toBeDefined();
      expect(live.nodeOutcomes["node-inconclusive"]).toEqual(
        record!.nodeOutcomes["node-inconclusive"],
      );
      // Still a forced FAILED — the marker rides along, it does not rewrite the seal.
      expect(live.nodeOutcomes["node-inconclusive"]?.status).toBe("FAILED");
      expect(live.nodeOutcomes["node-inconclusive"]?.verdict).toBe("HALT");
      expect(live.nodeOutcomes["node-inconclusive"]?.inconclusiveCheck).toBe(
        "suite_killed_at_cap",
      );
    } finally {
      chainJournal.close();
    }
  });
});
