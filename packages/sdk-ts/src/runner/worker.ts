/**
 * Runner worker factory (WP-121). A worker hosts the agent-loop workflow +
 * runner activities for one task queue. `chikory run`/`resume` (WP-141)
 * start one in-process; tests run them standalone (and kill -9 them —
 * WP-123).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import {
  createRunnerActivities,
  type AdapterRegistry,
  type RunnerActivities,
} from "./activities.js";
import { TASK_QUEUE_DEFAULT } from "./api.js";
import { DEFAULT_DATA_DIR } from "./paths.js";

export interface RunnerWorkerOptions {
  adapters: AdapterRegistry;
  address?: string;
  namespace?: string;
  taskQueue?: string;
  dataDir?: string;
  /** Pre-bundled workflow code (tests bundle once in global setup). */
  workflowBundlePath?: string;
  /** Test seam: swap individual activities (e.g. a deciding judge). */
  activitiesOverride?: Partial<RunnerActivities>;
}

export interface RunnerWorker {
  worker: Worker;
  /** Runs until shutdown; closes the connection on exit. */
  run(): Promise<void>;
  shutdown(): void;
}

/**
 * The workflow bundle entry. From dist this resolves to the compiled .js;
 * under vitest/tsx it falls back to the .ts source (Temporal's bundler
 * compiles TypeScript).
 */
export function resolveWorkflowsPath(): string {
  const js = fileURLToPath(new URL("../workflow/agent-loop.js", import.meta.url));
  if (existsSync(js)) return js;
  const ts = fileURLToPath(new URL("../workflow/agent-loop.ts", import.meta.url));
  if (existsSync(ts)) return ts;
  throw new Error("cannot locate workflow code (agent-loop.js/.ts)");
}

export async function createRunnerWorker(opts: RunnerWorkerOptions): Promise<RunnerWorker> {
  const connection = await NativeConnection.connect({
    address: opts.address ?? process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233",
  });
  const activities = {
    ...createRunnerActivities({
      dataDir: opts.dataDir ?? DEFAULT_DATA_DIR,
      adapters: opts.adapters,
    }),
    ...opts.activitiesOverride,
  };
  const worker = await Worker.create({
    connection,
    namespace: opts.namespace,
    taskQueue: opts.taskQueue ?? TASK_QUEUE_DEFAULT,
    ...(opts.workflowBundlePath
      ? { workflowBundle: { codePath: opts.workflowBundlePath } }
      : { workflowsPath: resolveWorkflowsPath() }),
    activities,
  });
  return {
    worker,
    run: () => worker.run().finally(() => connection.close()),
    shutdown: () => worker.shutdown(),
  };
}
