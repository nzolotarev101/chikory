import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, Connection } from "@temporalio/client";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  ChainJournal,
  chainJournalPath,
  chainRecordFrom,
  createRunnerWorker,
  type ChainNodeTemplate,
  type Plan,
} from "../../src/index.js";
import { initSourceRepo, judgeForm, scriptedRegistry, startFakeJudgeWire } from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

// A linear 3-node chain; the MIDDLE node is seeded to fail its first incarnation.
function healPlan(): Plan {
  return {
    id: "plan-heal-live",
    goal: "prove chain heal-by-default recovers a failed middle node",
    createdAt: "2026-07-15T00:00:00.000Z",
    nodes: [
      { id: "N-1", goal: "first", acceptanceCriteria: [{ id: "AC-1", description: "one" }], dependsOn: [], budgetUsd: 5 },
      { id: "N-2", goal: "second", acceptanceCriteria: [{ id: "AC-1", description: "two" }], dependsOn: ["N-1"], budgetUsd: 5 },
      { id: "N-3", goal: "third", acceptanceCriteria: [{ id: "AC-1", description: "three" }], dependsOn: ["N-2"], budgetUsd: 5 },
    ],
  };
}

function template(repoUrl: string, seedFailNodeId?: string): ChainNodeTemplate {
  return {
    repos: [{ url: repoUrl, writable: true }],
    executor: { adapter: "scripted", family: "anthropic" },
    judge: { family: "openai-compat", cadence: 1 },
    routing: {
      stages: {
        plan: { provider: "anthropic", model: "planner" },
        code: { provider: "anthropic", model: "executor" },
        review: { provider: "anthropic", model: "review" },
        judge: { provider: "openai-compat", model: "fake-judge" },
      },
    },
    maxSteps: 1,
    ...(seedFailNodeId !== undefined ? { seedFailNodeId } : {}),
  };
}

describe.skipIf(address === null)("live chain heal-by-default (WP-521)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function harness() {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-chain-heal-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    // Every node/step judges PROCEED; the FAILURE comes from the seam, not the
    // judge (the last form repeats for all node passes; the chain-completion
    // review is auto-answered all-pass).
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
      // NO replanRemaining override — the self-contained heal-by-default path fires.
    });
    const workerDone = worker.run();
    const connection = await Connection.connect({ address: address! });
    const client = new Client({ connection });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await connection.close();
    });
    return { dataDir, taskQueue, repoUrl, client };
  }

  test("a seeded mid-chain node failure self-recovers via the default evidence-enriched replan", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness();
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      // maxReplans omitted at this layer → explicit 1 mirrors startChain's default.
      args: [{ plan: healPlan(), template: template(repoUrl, "N-2"), maxReplans: 1 }],
      workflowExecutionTimeout: "3 minutes",
    });

    expect(status).toBe("SUCCESS");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const replanned = chain.entries("node_replanned");
      expect(replanned).toHaveLength(1);
      // The replan carries the failed node's evidence brief (WP-521 (b)).
      expect(replanned[0]!.payload).toMatchObject({ failedNodeId: "N-2" });
      expect((replanned[0]!.payload as { brief?: string }).brief).toContain("REPLAN BRIEF");

      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("SUCCESS");
      expect(record.plan.id).toBe("plan-heal-live-r1");
      // The failed node is sealed FAILED and its evidence-carrying retry SUCCEEDs;
      // the sealed predecessor's verdict is UNCHANGED.
      expect(record.nodeOutcomes["N-1"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
      expect(record.nodeOutcomes["N-2"]!.status).toBe("FAILED");
      expect(record.nodeOutcomes["N-2-r1"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
      expect(record.nodeOutcomes["N-3"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
    } finally {
      chain.close();
    }
  }, 180_000);

  test("with the replan opt-out (maxReplans 0) the same seeded failure seals the chain FAILED", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness();
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: healPlan(), template: template(repoUrl, "N-2"), maxReplans: 0 }],
      workflowExecutionTimeout: "3 minutes",
    });

    expect(status).toBe("FAILED");
    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      expect(chain.entries("node_replanned")).toHaveLength(0);
      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("FAILED");
      expect(record.nodeOutcomes["N-2"]!.status).toBe("FAILED");
      expect(record.nodeOutcomes["N-2-r1"]).toBeUndefined();
    } finally {
      chain.close();
    }
  }, 180_000);
});
