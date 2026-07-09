/**
 * TemporalRunner (WP-121) — the only DurableRunner implementation (ADR-001).
 * Thin client over Temporal: a run is a workflow execution with
 * workflowId = run-id; status/approve/inject/cancel map to query + signals
 * (durable-runner.md Temporal mapping). The journal is the offline fallback
 * for status/list when no worker is up to answer queries.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { Client, Connection } from "@temporalio/client";

import { Journal, reportFromJournal } from "./journal/journal.js";
import { parseBranchTarget } from "./cli/branch-target.js";
import {
  QUERY_STATUS,
  SIGNAL_APPROVE,
  SIGNAL_CANCEL,
  SIGNAL_INJECT,
  SIGNAL_RESUME,
  SIGNAL_SUSPEND,
  SIGNAL_TOP_UP,
  TASK_QUEUE_DEFAULT,
} from "./runner/api.js";
import { forkRunAtCheckpoint } from "./runner/branch.js";
import { DEFAULT_DATA_DIR, journalPath } from "./runner/paths.js";
import type { ChainNodeTemplate } from "./chain/node-spec.js";
import type { DurableRunner, Plan, RunHandle, RunStatusReport, TaskSpec } from "./types.js";

export interface TemporalRunnerOptions {
  address?: string;
  namespace?: string;
  taskQueue?: string;
  dataDir?: string;
}

export interface TemporalRunner extends DurableRunner {
  /**
   * Start a WP-219 chain executor (`chainLoop` workflow, ADR-005 §S3) over an
   * already-decomposed, plan-meta-judge-PROCEED'd `Plan`. workflowId = chain-id
   * (mirrors `start`'s workflowId = run-id). The chain's progress is followed
   * through the `ChainJournal` on disk, not a workflow query.
   */
  startChain(input: { plan: Plan; template: ChainNodeTemplate }): Promise<{ chainId: string }>;
  close(): Promise<void>;
}

export function createTemporalRunner(opts: TemporalRunnerOptions = {}): TemporalRunner {
  const address = opts.address ?? process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
  const taskQueue = opts.taskQueue ?? TASK_QUEUE_DEFAULT;
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;

  let clientPromise: Promise<{ client: Client; connection: Connection }> | undefined;
  async function getClient(): Promise<Client> {
    clientPromise ??= Connection.connect({ address }).then((connection) => ({
      client: new Client({ connection, namespace: opts.namespace }),
      connection,
    }));
    return (await clientPromise).client;
  }

  function journalReport(runId: string): RunStatusReport | undefined {
    const path = journalPath(dataDir, runId);
    if (!existsSync(path)) return undefined;
    const journal = new Journal(path);
    try {
      return reportFromJournal(journal);
    } finally {
      journal.close();
    }
  }

  /**
   * WP-520 (ADR-009 D4): the sealed state a resume decision needs — the run
   * row's terminal status plus the LAST terminal entry's resumable flag and
   * reason, and the persisted spec a re-start reuses. Undefined while the run
   * is live (or has no journal yet) — the signal path handles those.
   */
  function sealedRunState(
    runId: string,
  ): { status: "SUCCESS" | "FAILED" | "CANCELLED"; resumable: boolean; reason: string; spec: TaskSpec } | undefined {
    const path = journalPath(dataDir, runId);
    if (!existsSync(path)) return undefined;
    const journal = new Journal(path);
    try {
      const run = journal.getRun();
      if (!run) return undefined;
      if (run.status !== "SUCCESS" && run.status !== "FAILED" && run.status !== "CANCELLED") {
        return undefined;
      }
      const terminals = journal.entries("terminal");
      const payload = terminals[terminals.length - 1]?.payload as
        | { reason?: string; resumable?: boolean }
        | undefined;
      return {
        status: run.status,
        resumable: payload?.resumable === true,
        reason: payload?.reason ?? "unknown",
        spec: run.task,
      };
    } finally {
      journal.close();
    }
  }

  function makeHandle(runId: string): RunHandle {
    return {
      runId,
      async status() {
        try {
          const client = await getClient();
          return await client.workflow.getHandle(runId).query<RunStatusReport>(QUERY_STATUS);
        } catch (err) {
          // No worker/server reachable — fall back to the journal on disk.
          const report = journalReport(runId);
          if (report) return report;
          throw err;
        }
      },
      async approve(decision) {
        const client = await getClient();
        await client.workflow.getHandle(runId).signal(SIGNAL_APPROVE, decision);
      },
      async inject(guidance) {
        const client = await getClient();
        await client.workflow.getHandle(runId).signal(SIGNAL_INJECT, guidance);
      },
      async suspend() {
        const client = await getClient();
        await client.workflow.getHandle(runId).signal(SIGNAL_SUSPEND);
      },
      async cancel() {
        const client = await getClient();
        await client.workflow.getHandle(runId).signal(SIGNAL_CANCEL);
      },
    };
  }

  return {
    async start(spec: TaskSpec): Promise<RunHandle> {
      const client = await getClient();
      const runId = `run-${randomUUID()}`;
      await client.workflow.start("agentLoop", {
        workflowId: runId,
        taskQueue,
        args: [spec],
      });
      return makeHandle(runId);
    },

    async startChain(input): Promise<{ chainId: string }> {
      const client = await getClient();
      const chainId = `chain-${randomUUID()}`;
      await client.workflow.start("chainLoop", {
        workflowId: chainId,
        taskQueue,
        args: [{ plan: input.plan, template: input.template }],
      });
      return { chainId };
    },

    async resume(runId, runOpts): Promise<RunHandle> {
      // WP-520 (ADR-009 D4): a sealed run's resume semantics depend on HOW it
      // sealed. Resumable FAILED → re-start the agentLoop workflow over the
      // same journal (Temporal allows workflowId reuse after completion);
      // restoreWorkflowState reopens the journal and carries the failure
      // evidence into the next step. Dead FAILED / SUCCESS / CANCELLED →
      // refuse with the way forward.
      const sealed = sealedRunState(runId);
      if (sealed !== undefined) {
        if (sealed.status !== "FAILED") {
          throw new Error(`run ${runId} already sealed ${sealed.status} — nothing to resume`);
        }
        if (!sealed.resumable) {
          throw new Error(
            `run ${runId} sealed a dead FAILED (${sealed.reason}) — not resumable; ` +
              `fork a checkpoint instead: chikory branch ${runId}@<journalIdx>`,
          );
        }
        const client = await getClient();
        await client.workflow.start("agentLoop", {
          workflowId: runId,
          taskQueue,
          args: [sealed.spec],
        });
        if (runOpts?.addBudgetUsd !== undefined) {
          await client.workflow
            .getHandle(runId)
            .signal(SIGNAL_TOP_UP, { amountUsd: runOpts.addBudgetUsd });
        }
        return makeHandle(runId);
      }
      // The workflow lives in Temporal; resuming = reattaching a handle
      // (and the caller ensuring a worker is up — WP-141 owns that UX).
      // A budget-halted run additionally needs funds to clear the gate.
      if (runOpts?.addBudgetUsd !== undefined) {
        const client = await getClient();
        await client.workflow
          .getHandle(runId)
          .signal(SIGNAL_TOP_UP, { amountUsd: runOpts.addBudgetUsd });
      } else {
        const client = await getClient();
        await client.workflow.getHandle(runId).signal(SIGNAL_RESUME);
      }
      return makeHandle(runId);
    },

    async branch(from): Promise<RunHandle> {
      const target = parseBranchTarget(from);
      const fork = await forkRunAtCheckpoint({ dataDir, target });
      const client = await getClient();
      await client.workflow.start("agentLoop", {
        workflowId: fork.childRunId,
        taskQueue,
        args: [fork.spec],
      });
      return makeHandle(fork.childRunId);
    },

    async get(runId): Promise<RunHandle> {
      return makeHandle(runId);
    },

    async list(): Promise<RunStatusReport[]> {
      const runsDir = join(dataDir, "runs");
      if (!existsSync(runsDir)) return [];
      const ids = await readdir(runsDir);
      return ids
        .map((id) => journalReport(id))
        .filter((r): r is RunStatusReport => r !== undefined);
    },

    async close(): Promise<void> {
      if (clientPromise) await (await clientPromise).connection.close();
    },
  };
}
