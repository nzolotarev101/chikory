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
import {
  QUERY_STATUS,
  SIGNAL_APPROVE,
  SIGNAL_CANCEL,
  SIGNAL_INJECT,
  SIGNAL_TOP_UP,
  TASK_QUEUE_DEFAULT,
} from "./runner/api.js";
import { DEFAULT_DATA_DIR, journalPath } from "./runner/paths.js";
import type { DurableRunner, RunHandle, RunStatusReport, TaskSpec } from "./types.js";

export interface TemporalRunnerOptions {
  address?: string;
  namespace?: string;
  taskQueue?: string;
  dataDir?: string;
}

export interface TemporalRunner extends DurableRunner {
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

    async resume(runId, runOpts): Promise<RunHandle> {
      // The workflow lives in Temporal; resuming = reattaching a handle
      // (and the caller ensuring a worker is up — WP-141 owns that UX).
      // A budget-halted run additionally needs funds to clear the gate.
      if (runOpts?.addBudgetUsd !== undefined) {
        const client = await getClient();
        await client.workflow
          .getHandle(runId)
          .signal(SIGNAL_TOP_UP, { amountUsd: runOpts.addBudgetUsd });
      }
      return makeHandle(runId);
    },

    async branch(): Promise<RunHandle> {
      throw new Error("branch() is P2 (WP-205)");
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
