import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Client, Connection } from "@temporalio/client";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  ChainJournal,
  chainJournalPath,
  chainRecordFrom,
  createChainActivities,
  createMemoryArtifactStore,
  createRunnerActivities,
  createRunnerWorker,
  Journal,
  journalPath,
  type AdapterRegistry,
  type ChainNodeTemplate,
  type Plan,
  workspaceDir,
} from "../../src/index.js";
import { initSourceRepo, judgeForm, makeSpec, startFakeJudgeWire } from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const execFileAsync = promisify(execFile);

const registry: AdapterRegistry = {
  "fan-in-scripted": ({ store }) => ({
    name: "fan-in-scripted",
    modelFamily: "anthropic",
    async runStep(input) {
      const item = input.context.planItem;
      if (item === "write left") await writeFile(join(input.workspaceDir, "left.txt"), "left");
      else if (item === "write right") await writeFile(join(input.workspaceDir, "right.txt"), "right");
      else {
        const left = await readFile(join(input.workspaceDir, "left.txt"), "utf8");
        const right = await readFile(join(input.workspaceDir, "right.txt"), "utf8");
        await writeFile(join(input.workspaceDir, "combined.txt"), `${left}+${right}`);
      }
      const [diffRef, transcriptRef] = await Promise.all([
        store.put(`diff for ${item}`, { kind: "diff", summary: "fan-in diff" }),
        store.put(`transcript for ${item}`, { kind: "transcript", summary: "fan-in transcript" }),
      ]);
      return {
        status: "SUCCESS",
        summary: "fan-in fixture complete",
        diffRef,
        transcriptRef,
        toolCalls: 1,
        tokens: { input: 10, output: 5 },
        costUsd: 0.01,
        costEstimated: false,
        durationMs: 1,
        claimsComplete: true,
      };
    },
  }),
};

function fanInPlan(): Plan {
  const criterion = [{ id: "AC-1", description: "fixture delivered" }];
  return {
    id: "plan-fan-in",
    goal: "combine two independent artifacts",
    createdAt: "2026-06-20T00:00:00.000Z",
    nodes: [
      { id: "N-1", goal: "write left", acceptanceCriteria: criterion, dependsOn: [], writeSet: ["left.txt"], budgetUsd: 5 },
      { id: "N-2", goal: "write right", acceptanceCriteria: criterion, dependsOn: [], writeSet: ["right.txt"], budgetUsd: 5 },
      { id: "N-3", goal: "combine left and right", acceptanceCriteria: criterion, dependsOn: ["N-1", "N-2"], writeSet: ["combined.txt"], budgetUsd: 5 },
    ],
  };
}

describe.skipIf(address === null)("artifact-backed fan-in handoff", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("materializes both parents after their workspaces are removed", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-fan-in-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const chainId = `chain-${randomUUID()}`;
    const baseChainActivities = createChainActivities({ dataDir });
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());

    const worker = await createRunnerWorker({
      adapters: registry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
      chainActivitiesOverride: {
        async recordNodeSealed(input) {
          await baseChainActivities.recordNodeSealed(input);
          if (input.nodeId === "N-1" || input.nodeId === "N-2") {
            await rm(workspaceDir(dataDir, input.outcome.status === "SUCCESS" ? `${chainId}-node-${input.nodeId}` : "unused"), {
              recursive: true,
              force: true,
            });
          }
        },
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

    const template: ChainNodeTemplate = {
      repos: [{ url: repoUrl, writable: true }],
      executor: { adapter: "fan-in-scripted", family: "anthropic" },
      judge: { family: "openai-compat", cadence: 1 },
      routing: {
        stages: {
          plan: { provider: "anthropic", model: "planner" },
          code: { provider: "anthropic", model: "executor" },
          review: { provider: "anthropic", model: "review" },
          judge: { provider: "openai-compat", model: "fake-judge" },
        },
      },
      maxSteps: 2,
    };
    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: fanInPlan(), template }],
      workflowExecutionTimeout: "2 minutes",
    });
    if (status !== "SUCCESS") {
      const failedChain = new ChainJournal(chainJournalPath(dataDir, chainId));
      try {
        throw new Error(`fan-in chain failed: ${JSON.stringify(failedChain.entries())}`);
      } finally {
        failedChain.close();
      }
    }

    const childRunId = `${chainId}-node-N-3`;
    const childWs = workspaceDir(dataDir, childRunId);
    expect(await readFile(join(childWs, "left.txt"), "utf8")).toBe("left");
    expect(await readFile(join(childWs, "right.txt"), "utf8")).toBe("right");
    expect(await readFile(join(childWs, "combined.txt"), "utf8")).toBe("left+right");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const record = chainRecordFrom(chain)!;
      expect(Object.keys(record.nodeHandoffs ?? {}).sort()).toEqual(["N-1", "N-2", "N-3"]);
      expect(record.nodeHandoffs?.["N-1"]?.repos[0]?.bundleRef.kind).toBe("repo_snapshot");
    } finally {
      chain.close();
    }

    const git = async (...args: string[]) =>
      (await execFileAsync("git", ["-C", childWs, ...args])).stdout.trim();
    const childBase = await git("rev-parse", "chikory-base^{commit}");
    const childHead = await git("rev-parse", "HEAD");
    expect(childBase).not.toBe(childHead);
    expect((await git("diff", "--name-only", "chikory-base..HEAD")).split("\n")).toEqual([
      "combined.txt",
    ]);

    const journal = new Journal(journalPath(dataDir, childRunId));
    try {
      const spec = journal.getRun()!.task;
      expect(spec.chainLink?.parentHandoffs?.map((handoff) => handoff.nodeId)).toEqual([
        "N-1",
        "N-2",
      ]);
      expect(spec.goal).toContain("- N-1: write left");
      expect(spec.goal).toContain("- N-2: write right");
    } finally {
      journal.close();
    }
  }, 150_000);

  test("fails closed when two parent bundles have an unresolved Git conflict", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-fan-in-conflict-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    await writeFile(join(repoUrl, "shared.txt"), "base\n");
    await execFileAsync("git", ["-C", repoUrl, "add", "shared.txt"]);
    await execFileAsync("git", ["-C", repoUrl, "commit", "-m", "shared base"]);
    const sourceCommit = (await execFileAsync("git", ["-C", repoUrl, "rev-parse", "HEAD"])).stdout.trim();
    const store = createMemoryArtifactStore();

    async function parent(nodeId: string, runId: string, content: string) {
      const ws = join(tmp, runId);
      await execFileAsync("git", ["clone", repoUrl, ws]);
      await execFileAsync("git", ["-C", ws, "config", "user.name", "chikory"]);
      await execFileAsync("git", ["-C", ws, "config", "user.email", "runner@chikory.local"]);
      await execFileAsync("git", ["-C", ws, "checkout", "-b", `chikory/run-${runId}`]);
      await writeFile(join(ws, "shared.txt"), `${content}\n`);
      await execFileAsync("git", ["-C", ws, "add", "shared.txt"]);
      await execFileAsync("git", ["-C", ws, "commit", "-m", nodeId]);
      const headCommit = (await execFileAsync("git", ["-C", ws, "rev-parse", "HEAD"])).stdout.trim();
      const path = join(tmp, `${runId}.bundle`);
      await execFileAsync("git", ["-C", ws, "bundle", "create", path, `refs/heads/chikory/run-${runId}`]);
      const bundleRef = await store.put(await readFile(path), {
        kind: "repo_snapshot",
        summary: nodeId,
      });
      return {
        nodeId,
        runId,
        repos: [{ repoUrl, sourceCommit, baseCommit: sourceCommit, headCommit, changedPaths: ["shared.txt"], bundleRef }],
      };
    }

    const left = await parent("N-1", "parent-left", "left");
    const right = await parent("N-2", "parent-right", "right");
    const activities = createRunnerActivities({ dataDir: join(tmp, "data"), adapters: {}, handoffStore: store });
    const result = await activities.prepareRun({
      runId: "conflicted-child",
      spec: makeSpec({
        repoUrl,
        chainLink: {
          planId: "plan-conflict",
          nodeId: "N-3",
          chainId: "chain-conflict",
          writeSet: ["combined.txt"],
          parentHandoffs: [left, right],
        },
      }),
    });

    expect(result).toEqual({
      status: "FAILED",
      reason: "artifact fan-in conflict while merging parent N-2",
    });
  });
});
