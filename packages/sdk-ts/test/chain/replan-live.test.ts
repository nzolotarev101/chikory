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
  createChainActivities,
  createRunnerWorker,
  decideReplan,
  type ChainNodeTemplate,
  type Plan,
  type ReplanDecision,
} from "../../src/index.js";
import { initSourceRepo, judgeForm, scriptedRegistry, startFakeJudgeWire } from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

function failingPlan(): Plan {
  return {
    id: "plan-replan-live",
    goal: "recover from a failed first node",
    createdAt: "2026-07-03T00:00:00.000Z",
    nodes: [
      { id: "N-1", goal: "fail once", acceptanceCriteria: [{ id: "AC-1", description: "first" }], dependsOn: [], budgetUsd: 5 },
      { id: "N-2", goal: "dependent work", acceptanceCriteria: [{ id: "AC-1", description: "second" }], dependsOn: ["N-1"], budgetUsd: 5 },
    ],
  };
}

function revisedPlan(): Plan {
  return {
    id: "plan-replan-live-r1",
    goal: "recover from a failed first node",
    createdAt: "2026-07-03T00:00:00.000Z",
    nodes: [
      { id: "N-1R", goal: "replanned recovery work", acceptanceCriteria: [{ id: "AC-1", description: "recovered" }], dependsOn: [], budgetUsd: 5 },
    ],
  };
}

function template(repoUrl: string): ChainNodeTemplate {
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
  };
}

describe.skipIf(address === null)("live chain replan (WP-219 D3)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function harness() {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-chain-replan-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const baseChainActivities = createChainActivities({ dataDir });
    const replanDecisions: ReplanDecision[] = [];
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false } }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
      chainActivitiesOverride: {
        async replanRemaining(input) {
          replanDecisions.push(input.decision);
          const decision = decideReplan(
            {
              planId: input.plan.id,
              plan: input.plan,
              nodeRuns: { [input.failedNodeId]: "sealed-run" },
              nodeOutcomes: { [input.failedNodeId]: { status: "FAILED", verdict: "HALT" } },
              status: "FAILED",
            },
            input.failedNodeId,
            input.decision.maxReplans,
          );
          if (decision.action !== "REPLAN") return { status: "HALT", reason: decision.reason };
          return { status: "SUCCESS", plan: revisedPlan() };
        },
        recordNodeReplanned: baseChainActivities.recordNodeReplanned,
      },
    });
    const workerDone = worker.run();
    const connection = await Connection.connect({ address: address! });
    const client = new Client({ connection });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await connection.close();
    });

    return { dataDir, taskQueue, repoUrl, client, replanDecisions };
  }

  test("journals node_replanned and reaches SUCCESS after a failed node replans", async () => {
    const { dataDir, taskQueue, repoUrl, client, replanDecisions } = await harness();
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: failingPlan(), template: template(repoUrl), maxReplans: 1 }],
      workflowExecutionTimeout: "2 minutes",
    });

    expect(status).toBe("SUCCESS");
    expect(replanDecisions).toHaveLength(1);
    expect(replanDecisions[0]).toMatchObject({
      action: "REPLAN",
      failedNodeId: "N-1",
      remainingNodeIds: ["N-2"],
      replansUsed: 1,
      maxReplans: 1,
    });
    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const replanned = chain.entries("node_replanned");
      expect(replanned).toHaveLength(1);
      expect(replanned[0]!.payload).toMatchObject({ failedNodeId: "N-1" });
      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("SUCCESS");
      expect(record.plan.id).toBe("plan-replan-live-r1");
      expect(Object.keys(record.nodeOutcomes).sort()).toEqual(["N-1", "N-1R"]);
      expect(record.nodeOutcomes["N-1"]!.status).toBe("FAILED");
      expect(record.nodeOutcomes["N-1R"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
    } finally {
      chain.close();
    }
  }, 150_000);

  test("with zero replan budget the same failing chain seals FAILED", async () => {
    const { dataDir, taskQueue, repoUrl, client, replanDecisions } = await harness();
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: failingPlan(), template: template(repoUrl), maxReplans: 0 }],
      workflowExecutionTimeout: "2 minutes",
    });

    expect(status).toBe("FAILED");
    expect(replanDecisions).toHaveLength(0);
    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      expect(chain.entries("node_replanned")).toHaveLength(0);
      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("FAILED");
      expect(Object.keys(record.nodeOutcomes)).toEqual(["N-1"]);
      expect(record.nodeOutcomes["N-1"]!.status).toBe("FAILED");
    } finally {
      chain.close();
    }
  }, 150_000);
});
