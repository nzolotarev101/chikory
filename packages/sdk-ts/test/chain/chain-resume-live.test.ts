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
  createTemporalRunner,
  type ChainNodeTemplate,
  type Plan,
} from "../../src/index.js";
import { initSourceRepo, judgeForm, scriptedRegistry, startFakeJudgeWire } from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

// A linear 3-node chain; the MIDDLE node is seeded to fail its first incarnation.
function healPlan(): Plan {
  return {
    id: "plan-resume-live",
    goal: "prove chain resume recovers a sealed-FAILED chain",
    createdAt: "2026-07-19T00:00:00.000Z",
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

describe.skipIf(address === null)("live chain resume for sealed-FAILED chains (WP-521(c))", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function harness() {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-chain-resume-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
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

  test("a sealed-FAILED chain resumes: the failed node retries and the chain recovers to SUCCESS", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness();
    const chainId = `chain-${randomUUID()}`;

    // 1. Seal the chain FAILED: seeded N-2 fails, replan opt-out (maxReplans 0) → no auto-heal.
    const first = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: healPlan(), template: template(repoUrl, "N-2"), maxReplans: 0 }],
      workflowExecutionTimeout: "3 minutes",
    });
    expect(first).toBe("FAILED");

    {
      const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
      try {
        // A node-failure FAILED is RESUMABLE (not a dead/malformed seal), and no
        // retry has happened yet.
        const terminal = chain.entries("terminal").at(-1)!.payload as {
          status: string;
          resumable?: boolean;
        };
        expect(terminal).toMatchObject({ status: "FAILED", resumable: true });
        expect(chain.entries("node_replanned")).toHaveLength(0);
        expect(chain.entries("control_event")).toHaveLength(0);
      } finally {
        chain.close();
      }
    }

    // 2. Resume: re-enter the chain over its own id; the failed node retries.
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(() => runner.close());
    await runner.resumeChain(chainId);
    const resumedStatus = await client.workflow.getHandle(chainId).result();
    expect(resumedStatus).toBe("SUCCESS");

    // 3. The chain journal proves the chain-scope kill→resume KPI.
    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      // The reopen boundary was journaled once, naming the failed node.
      const reopens = chain.entries("control_event");
      expect(reopens).toHaveLength(1);
      expect(reopens[0]!.payload).toMatchObject({
        event: "resume",
        source: "chain_failed_seal",
        failedNodeId: "N-2",
      });
      // The resume granted the failed node one fresh heal attempt.
      expect(chain.entries("node_replanned")).toHaveLength(1);

      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("SUCCESS");
      // Predecessor verdict UNCHANGED; the original stays FAILED; the retry recovered.
      expect(record.nodeOutcomes["N-1"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
      expect(record.nodeOutcomes["N-2"]!.status).toBe("FAILED");
      expect(record.nodeOutcomes["N-2-r1"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
      expect(record.nodeOutcomes["N-3"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
    } finally {
      chain.close();
    }
  }, 180_000);

  test("a dead (malformed-plan) FAILED chain refuses resume with the way forward", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness();
    const chainId = `chain-${randomUUID()}`;
    // A node depending on a non-existent node can never become ready → the chain
    // seals a DEAD FAILED (unsatisfiable dependency), which is NOT resumable.
    const deadPlan: Plan = {
      id: "plan-dead",
      goal: "unsatisfiable dependency",
      createdAt: "2026-07-19T00:00:00.000Z",
      nodes: [
        {
          id: "N-1",
          goal: "blocked",
          acceptanceCriteria: [{ id: "AC-1", description: "one" }],
          dependsOn: ["ghost"],
          budgetUsd: 5,
        },
      ],
    };

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: deadPlan, template: template(repoUrl), maxReplans: 1 }],
      workflowExecutionTimeout: "3 minutes",
    });
    expect(status).toBe("FAILED");

    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(() => runner.close());
    await expect(runner.resumeChain(chainId)).rejects.toThrow(/not resumable/);
  }, 180_000);
});
