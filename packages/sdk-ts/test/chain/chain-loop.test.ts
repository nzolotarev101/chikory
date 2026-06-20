/**
 * WP-219 S3-wiring — the chain executor end-to-end (ADR-005 §S3).
 * Boots a worker hosting both workflows (agentLoop + chainLoop) + chain
 * activities, runs a real `chainLoop` over a multi-node `Plan` whose nodes are
 * ordinary judge-gated runs (scripted executor + fake judge wire), and asserts:
 *   - a linear 3-node plan whose nodes all PROCEED → chain SUCCESS, every node
 *     dispatched in dependency order and folded through advanceChain;
 *   - a node that seals FAILED halts the chain (FAILED) and its dependents are
 *     never dispatched (the halt-and-resume semantics, replan deferred).
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Client, Connection } from "@temporalio/client";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  ChainJournal,
  chainJournalPath,
  chainRecordFrom,
  type ChainNodeTemplate,
  createRunnerWorker,
  Journal,
  journalPath,
  type Plan,
  workspaceDir,
} from "../../src/index.js";
import { initSourceRepo, judgeForm, scriptedRegistry, startFakeJudgeWire } from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const execFileAsync = promisify(execFile);

function linearPlan(): Plan {
  return {
    id: "plan-1",
    goal: "Ship three chained slices",
    createdAt: "2026-06-20T00:00:00.000Z",
    nodes: [
      { id: "N-1", goal: "slice one", acceptanceCriteria: [{ id: "AC-1", description: "one" }], dependsOn: [], budgetUsd: 50 },
      { id: "N-2", goal: "slice two", acceptanceCriteria: [{ id: "AC-1", description: "two" }], dependsOn: ["N-1"], budgetUsd: 50 },
      { id: "N-3", goal: "slice three", acceptanceCriteria: [{ id: "AC-1", description: "three" }], dependsOn: ["N-2"], budgetUsd: 50 },
    ],
  };
}

function template(repoUrl: string, overrides: Partial<ChainNodeTemplate> = {}): ChainNodeTemplate {
  return {
    repos: [{ url: repoUrl, writable: true }],
    executor: { adapter: "scripted", family: "anthropic" },
    judge: { family: "openai-compat", cadence: 1 },
    routing: {
      stages: {
        plan: { provider: "anthropic", model: "claude-fable-5" },
        code: { provider: "anthropic", model: "claude-fable-5" },
        review: { provider: "anthropic", model: "claude-fable-5" },
        judge: { provider: "openai-compat", model: "fake-judge" },
      },
    },
    maxSteps: 4,
    ...overrides,
  };
}

describe.skipIf(address === null)("chain executor (WP-219 S3-wiring)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function harness(opts: {
    failingJudge?: boolean;
    repoConfig?: Parameters<typeof initSourceRepo>[1];
  }) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-chain-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), opts.repoConfig);
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": opts.failingJudge ? false : true } }),
    ]);
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

  test("runs a linear 3-node plan to chain SUCCESS, folding every node", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness({});
    const plan = linearPlan();
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan, template: template(repoUrl) }],
      workflowExecutionTimeout: "2 minutes",
    });
    expect(status).toBe("SUCCESS");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("SUCCESS");
      // Every node dispatched and folded as SUCCESS.
      expect(Object.keys(record.nodeOutcomes).sort()).toEqual(["N-1", "N-2", "N-3"]);
      for (const id of ["N-1", "N-2", "N-3"]) {
        expect(record.nodeOutcomes[id]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
        expect(record.nodeRuns[id]).toBe(`${chainId}-node-${id}`);
      }
      expect(chain.entries("node_started")).toHaveLength(3);
      expect(chain.entries("node_sealed")).toHaveLength(3);
      expect(chain.entries("terminal")).toHaveLength(1);
    } finally {
      chain.close();
    }

    // Each node ran as an ordinary judge-gated run sealing SUCCESS.
    for (const id of ["N-1", "N-2", "N-3"]) {
      const runJournal = new Journal(journalPath(dataDir, `${chainId}-node-${id}`));
      try {
        expect(runJournal.getRun()!.status).toBe("SUCCESS");
      } finally {
        runJournal.close();
      }
    }
  }, 150_000);

  test("hands a predecessor's sealed git tree to its dependent node", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness({});
    const fullPlan = linearPlan();
    const plan: Plan = { ...fullPlan, nodes: fullPlan.nodes.slice(0, 2) };
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan, template: template(repoUrl) }],
      workflowExecutionTimeout: "2 minutes",
    });
    expect(status).toBe("SUCCESS");

    const parentRunId = `${chainId}-node-N-1`;
    const childRunId = `${chainId}-node-N-2`;
    const parentWs = workspaceDir(dataDir, parentRunId);
    const childWs = workspaceDir(dataDir, childRunId);

    // The scripted executor's first-node output is committed and physically
    // present in the dependent workspace. Its counter also advances from the
    // inherited state, proving node two did not start from origin HEAD.
    expect(await readFile(join(childWs, "step-1.txt"), "utf8")).toContain("slice one");
    expect(await readFile(join(childWs, "scripted-count.txt"), "utf8")).toBe("2");

    const git = async (dir: string, ...args: string[]) =>
      (await execFileAsync("git", ["-C", dir, ...args])).stdout.trim();
    const parentHead = await git(parentWs, "rev-parse", "HEAD");
    const childBase = await git(childWs, "rev-parse", "chikory-base^{commit}");
    expect(childBase).toBe(parentHead);

    // Node two's judge/harvest delta is only its own work; inherited node-one
    // files sit below chikory-base and therefore do not contaminate the diff.
    const childChanges = (await git(childWs, "diff", "--name-only", "chikory-base..HEAD"))
      .split("\n")
      .filter(Boolean);
    expect(childChanges).toContain("step-2.txt");
    expect(childChanges).not.toContain("step-1.txt");

    const childJournal = new Journal(journalPath(dataDir, childRunId));
    try {
      const childSpec = childJournal.getRun()!.task;
      expect(childSpec.chainLink?.parentRunId).toBe(parentRunId);
      expect(childSpec.goal).toContain("- N-1: slice one");
      expect(childSpec.goal).toContain("ALREADY PRESENT");
    } finally {
      childJournal.close();
    }
  }, 150_000);

  test("halts the chain when a node seals FAILED; dependents never dispatch", async () => {
    // cadence high so the judge never PROCEEDs; maxSteps 1 → N-1 seals FAILED.
    const { dataDir, taskQueue, repoUrl, client } = await harness({ failingJudge: true });
    const plan = linearPlan();
    const chainId = `chain-${randomUUID()}`;

    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan, template: template(repoUrl, { judge: { family: "openai-compat", cadence: 100 }, maxSteps: 1 }) }],
      workflowExecutionTimeout: "2 minutes",
    });
    expect(status).toBe("FAILED");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("FAILED");
      // Only the first node was dispatched and sealed; the chain halted.
      expect(Object.keys(record.nodeOutcomes)).toEqual(["N-1"]);
      expect(record.nodeOutcomes["N-1"]!.status).toBe("FAILED");
      expect(chain.entries("node_started")).toHaveLength(1);
      expect(chain.entries("node_started")[0]!.payload).toMatchObject({ nodeId: "N-1" });
    } finally {
      chain.close();
    }
  }, 150_000);
});
