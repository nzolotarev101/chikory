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
  renderChainTrace,
  type ChainCompletionReviewPayload,
  type ChainNodeTemplate,
  type JudgeForm,
  type Plan,
} from "../../src/index.js";
import {
  completionReviewForm,
  initSourceRepo,
  judgeForm,
  scriptedRegistry,
  startFakeJudgeWire,
} from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

function linearPlan(): Plan {
  return {
    id: "plan-chain-review-live",
    goal: "give the chain trace a per-node design summary surface",
    createdAt: "2026-07-14T00:00:00.000Z",
    nodes: [
      {
        id: "N-1",
        goal: "add the per-node design summariser",
        acceptanceCriteria: [{ id: "AC-1", description: "first" }],
        dependsOn: [],
        budgetUsd: 5,
      },
      {
        id: "N-2",
        goal: "fold the summaries into the trace, building on N-1",
        acceptanceCriteria: [{ id: "AC-1", description: "second" }],
        dependsOn: ["N-1"],
        budgetUsd: 5,
      },
    ],
  };
}

function singleNodePlan(): Plan {
  return {
    id: "plan-chain-review-live-solo",
    goal: "a one-node chain has no cross-node design",
    createdAt: "2026-07-14T00:00:00.000Z",
    nodes: [
      {
        id: "N-1",
        goal: "the only node",
        acceptanceCriteria: [{ id: "AC-1", description: "only" }],
        dependsOn: [],
        budgetUsd: 5,
      },
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

describe.skipIf(address === null)("live chain-completion aggregate review (WP-311)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function harness(opts: { nodeForms: JudgeForm[]; reviewForms?: JudgeForm[] }) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-chain-review-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const wire = await startFakeJudgeWire(
      opts.nodeForms,
      ...(opts.reviewForms ? [{ reviewForms: opts.reviewForms }] : []),
    );
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

    return { dataDir, taskQueue, repoUrl, client, wire };
  }

  test("a multi-node chain seals SUCCESS with exactly one aggregate review; nodes are not re-judged", async () => {
    const { dataDir, taskQueue, repoUrl, client, wire } = await harness({
      nodeForms: [
        judgeForm({ criteria: { "AC-1": true } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
    });
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: linearPlan(), template: template(repoUrl) }],
      workflowExecutionTimeout: "3 minutes",
    });

    expect(status).toBe("SUCCESS");
    expect(wire.reviewHits).toBeGreaterThanOrEqual(1);

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const reviews = chain.entries("chain_completion_review");
      expect(reviews).toHaveLength(1);
      const payload = reviews[0]!.payload as ChainCompletionReviewPayload;
      expect(payload.chainId).toBe(chainId);
      expect(payload.reviewedNodeIds).toEqual(["N-1", "N-2"]);
      expect(payload.findings.every((finding) => finding.pass)).toBe(true);

      // The chain never re-judges: node outcomes are exactly what each node sealed.
      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("SUCCESS");
      expect(record.nodeOutcomes["N-1"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
      expect(record.nodeOutcomes["N-2"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });

      // The review lands AFTER both nodes and BEFORE the terminal seal.
      const all = chain.entries();
      const reviewIdx = all.findIndex((entry) => entry.kind === "chain_completion_review");
      const terminalIdx = all.findIndex((entry) => entry.kind === "terminal");
      const lastSealIdx = all.map((entry) => entry.kind).lastIndexOf("node_sealed");
      expect(reviewIdx).toBeGreaterThan(lastSealIdx);
      expect(reviewIdx).toBeLessThan(terminalIdx);

      expect(renderChainTrace(record, all)).toContain("review:");
    } finally {
      chain.close();
    }
  }, 200_000);

  test("a single-node chain records no aggregate review", async () => {
    const { dataDir, taskQueue, repoUrl, client, wire } = await harness({
      nodeForms: [judgeForm({ criteria: { "AC-1": true } })],
    });
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: singleNodePlan(), template: template(repoUrl) }],
      workflowExecutionTimeout: "3 minutes",
    });

    expect(status).toBe("SUCCESS");
    expect(wire.reviewHits).toBe(0);
    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      expect(chain.entries("chain_completion_review")).toHaveLength(0);
    } finally {
      chain.close();
    }
  }, 200_000);

  test("a design finding seals SUCCESS-with-findings — the chain is never parked (F-107)", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness({
      nodeForms: [
        judgeForm({ criteria: { "AC-1": true } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      reviewForms: [completionReviewForm({ rubricFails: ["design_serves_overall_goal"] })],
    });
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: linearPlan(), template: template(repoUrl) }],
      workflowExecutionTimeout: "3 minutes",
    });

    expect(status).toBe("SUCCESS");
    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const reviews = chain.entries("chain_completion_review");
      expect(reviews).toHaveLength(1);
      const payload = reviews[0]!.payload as ChainCompletionReviewPayload;
      expect(payload.findings.some((finding) => !finding.pass)).toBe(true);
      // Node outcomes untouched by the finding.
      const record = chainRecordFrom(chain)!;
      expect(record.nodeOutcomes["N-2"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
    } finally {
      chain.close();
    }
  }, 200_000);
});
