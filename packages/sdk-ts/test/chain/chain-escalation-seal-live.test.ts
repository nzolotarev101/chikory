/**
 * F-208 live proof — a chain whose node escalation is ANSWERED and whose replan
 * budget is spent must seal, not park forever.
 *
 * This reproduces dogfood-120 (`chain-0723ac0b-…`) end-to-end against a real
 * Temporal server: the judge escalates, a human rejects, the node seals
 * `{status: FAILED, verdict: ESCALATE}`, and `deriveChainStatus` rule 1 parks
 * the chain in `AWAITING_PLAN_APPROVAL`. Before the fix `chainLoop` returned
 * that status and wrote NO terminal entry, so `chikory chain resume` found no
 * sealed state and `chikory chain approve` found no in-flight node to signal —
 * a launch with $0.60 of plan work and two node attempts on disk, un-actionable.
 *
 * The assertions are the operator's recovery surface, not the internals: a
 * FAILED chain status, a terminal entry marked `resumable`, and the failed
 * node's outcome preserved for the retry brief.
 */
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
import { childRunId } from "../../src/chain/node-spec.js";
import { initSourceRepo, judgeForm, scriptedRegistry, startFakeJudgeWire, waitFor } from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

function escalatingPlan(): Plan {
  return {
    id: "plan-escalation-seal",
    goal: "prove an answered escalation seals the chain",
    createdAt: "2026-07-29T00:00:00.000Z",
    nodes: [
      {
        id: "N-1",
        goal: "first",
        acceptanceCriteria: [{ id: "AC-1", description: "one" }],
        dependsOn: [],
        budgetUsd: 5,
      },
      {
        id: "N-2",
        goal: "second",
        acceptanceCriteria: [{ id: "AC-1", description: "two" }],
        dependsOn: ["N-1"],
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

describe.skipIf(address === null)("live chain answered-escalation seal (F-208)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  test("a rejected node escalation with no replan budget seals the chain FAILED and resumable", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-chain-escalate-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    // A failing criterion PLUS an out-of-rubric concern is the ESCALATE shape
    // the dogfood judge produced ("judge raised concerns outside the rubric").
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["stale workspace reuse is unverified"] }),
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
    const runner = createTemporalRunner({ address: address!, dataDir, taskQueue });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
      await connection.close();
    });

    const chainId = `chain-${randomUUID()}`;
    const handle = await client.workflow.start("chainLoop", {
      workflowId: chainId,
      taskQueue,
      // maxReplans 0 — the "budget already spent" end state, without paying for
      // a second node incarnation.
      args: [{ plan: escalatingPlan(), template: template(repoUrl), maxReplans: 0 }],
      workflowExecutionTimeout: "3 minutes",
    });

    // The node parks awaiting a human; reject it, exactly as the operator did.
    const nodeRunId = childRunId(chainId, "N-1");
    const nodeHandle = await runner.get(nodeRunId);
    await waitFor(
      async () => {
        // The child workflow does not exist until the chain dispatches it.
        try {
          return (await nodeHandle.status()).status === "AWAITING_APPROVAL" ? true : undefined;
        } catch {
          return undefined;
        }
      },
      { what: "chain node to await approval", timeoutMs: 120_000 },
    );
    await nodeHandle.approve({ approved: false, reason: "not acceptable" });

    // Pre-fix this returned "AWAITING_PLAN_APPROVAL" — a status a `--watch`
    // follow waits on forever, because nothing further is ever journaled.
    expect(await handle.result()).toBe("FAILED");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const terminals = chain.entries("terminal");
      expect(terminals).toHaveLength(1);
      const payload = terminals[0]!.payload as { status: string; reason?: string; resumable?: boolean };
      expect(payload.status).toBe("FAILED");
      // Resumable is what `chikory chain resume` requires to re-enter (WP-521(c)).
      expect(payload.resumable).toBe(true);
      expect(payload.reason ?? "").toContain("answered node escalation");

      const record = chainRecordFrom(chain)!;
      expect(record.status).toBe("FAILED");
      // The escalation evidence survives — the retry brief is built from it.
      expect(record.nodeOutcomes["N-1"]).toEqual({ status: "FAILED", verdict: "ESCALATE" });
      // The dependent node never dispatched.
      expect(record.nodeOutcomes["N-2"]).toBeUndefined();
    } finally {
      chain.close();
    }
  }, 240_000);
});
