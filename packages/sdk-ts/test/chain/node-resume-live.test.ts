/**
 * F-214 live proof — a chain node whose child sealed a RESUMABLE FAILED is
 * re-entered, not rewritten.
 *
 * Against real Temporal, because the claim is about workflow identity: the
 * chain must re-execute the SAME child workflow id so `restoreWorkflowState`
 * reopens the seal, keeps the checkpoint, and carries the failure evidence
 * forward (WP-520). A decision-only test cannot tell that apart from a replan
 * that happens to succeed.
 *
 * The run also exercises F-209 end to end: the node only seals resumable
 * because the template's `unattended.escalation` reaches the child spec at all.
 * Before WP-544 that field was dropped, and the node would have parked
 * `AWAITING_APPROVAL` forever — which is exactly how dogfood-120 got into
 * F-208.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, Connection } from "@temporalio/client";
import { afterEach, describe, expect, inject, test } from "vitest";

import {
  ChainJournal,
  Journal,
  chainJournalPath,
  chainRecordFrom,
  childRunId,
  createTemporalRunner,
  journalPath,
  type ChainNodeTemplate,
  type Plan,
} from "../../src/index.js";
import { initSourceRepo, judgeForm, scriptedRegistry, startFakeJudgeWire } from "../runner/helpers.js";
import { createRunnerWorker } from "../../src/index.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

function onePlan(): Plan {
  return {
    id: "plan-node-resume-live",
    goal: "re-enter a resumable node instead of rewriting it",
    createdAt: "2026-07-29T00:00:00.000Z",
    nodes: [
      {
        id: "N-1",
        goal: "work that escalates once, then completes",
        acceptanceCriteria: [{ id: "AC-1", description: "the work is done" }],
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
    maxSteps: 2,
    // F-209: forwarded to the child spec — without it the node parks for a human.
    unattended: { escalation: "seal_resumable_failed" },
  };
}

describe.skipIf(address === null)("live chain node resume (F-214)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function harness() {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-node-resume-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const wire = await startFakeJudgeWire([
      // Pass 1: an out-of-rubric concern → rule-4 ESCALATE → unattended seals
      // a RESUMABLE FAILED (the shape dogfood-120's nodes kept reaching).
      judgeForm({ criteria: { "AC-1": false }, concerns: ["needs a second look"] }),
      // Pass 2, after the chain re-enters the SAME run: done.
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

  /** One journal, sealed twice, reopened in between — not a fresh run. */
  function assertOneRunContinued(dataDir: string, chainId: string) {
    const runJournal = new Journal(journalPath(dataDir, childRunId(chainId, "N-1")));
    try {
      const terminals = runJournal
        .entries("terminal")
        .map((e) => e.payload as { status: string; resumable?: boolean });
      expect(terminals.map((t) => t.status)).toEqual(["FAILED", "SUCCESS"]);
      expect(terminals[0]!.resumable).toBe(true);
      expect(
        runJournal.entries("control_event").map((e) => e.payload as { event: string; source?: string }),
      ).toContainEqual(expect.objectContaining({ event: "resume", source: "failed_seal" }));
      // Both incarnations' steps are in one journal — the work carried over
      // rather than starting from an empty workspace.
      expect(runJournal.entries("step").length).toBeGreaterThan(1);
    } finally {
      runJournal.close();
    }
  }

  test("re-enters the resumable child run and never replans the node", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness();
    const chainId = `chain-${randomUUID()}`;
    const status = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: onePlan(), template: template(repoUrl), maxReplans: 1 }],
      workflowExecutionTimeout: "2 minutes",
    });

    expect(status).toBe("SUCCESS");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      const resumed = chain.entries("node_resumed");
      expect(resumed).toHaveLength(1);
      expect(resumed[0]!.payload).toMatchObject({ nodeId: "N-1", attempt: 1 });
      // The whole point: the node was NOT rewritten, so the plan is untouched.
      expect(chain.entries("node_replanned")).toEqual([]);
      const record = chainRecordFrom(chain)!;
      expect(record.plan.id).toBe("plan-node-resume-live");
      expect(Object.keys(record.nodeOutcomes)).toEqual(["N-1"]);
      expect(record.nodeOutcomes["N-1"]).toEqual({ status: "SUCCESS", verdict: "PROCEED" });
    } finally {
      chain.close();
    }

    assertOneRunContinued(dataDir, chainId);
  }, 150_000);

  test("the OPERATOR resume re-enters the child too, instead of rewriting the node", async () => {
    const { dataDir, taskQueue, repoUrl, client } = await harness();
    const chainId = `chain-${randomUUID()}`;

    // `maxReplans: 0` turns the in-loop heal off entirely, so the chain seals
    // FAILED with a child that is nonetheless resumable — the exact shape
    // dogfood-120's `chain-0723ac0b` sat in when its operator reached for
    // `chikory chain resume`.
    const first = await client.workflow.execute("chainLoop", {
      workflowId: chainId,
      taskQueue,
      args: [{ plan: onePlan(), template: template(repoUrl), maxReplans: 0 }],
      workflowExecutionTimeout: "2 minutes",
    });
    expect(first).toBe("FAILED");

    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(() => runner.close());
    await runner.resumeChain(chainId);
    expect(await client.workflow.getHandle(chainId).result()).toBe("SUCCESS");

    const chain = new ChainJournal(chainJournalPath(dataDir, chainId));
    try {
      expect(chain.entries("node_resumed")).toHaveLength(1);
      // The operator asked to continue, not to start over.
      expect(chain.entries("node_replanned")).toEqual([]);
      expect(chainRecordFrom(chain)!.plan.id).toBe("plan-node-resume-live");
    } finally {
      chain.close();
    }

    assertOneRunContinued(dataDir, chainId);
  }, 150_000);
});
