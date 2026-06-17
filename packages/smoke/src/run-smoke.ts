// WP-004 smoke: run a hello-world workflow against a local Temporal dev server.
// Invoked via `devbox run smoke` (scripts/smoke.sh boots the server first).
import { fileURLToPath } from "node:url";

import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker, DefaultLogger, Runtime } from "@temporalio/worker";

import * as activities from "./activities.js";

const TASK_QUEUE = "chikory-smoke";
const ADDRESS = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";

async function main(): Promise<void> {
  try {
    Runtime.install({ logger: new DefaultLogger("WARN") });
  } catch {
    // Already installed
  }
  const workerConnection = await NativeConnection.connect({ address: ADDRESS });
  const worker = await Worker.create({
    connection: workerConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities,
  });

  const clientConnection = await Connection.connect({ address: ADDRESS });
  const client = new Client({ connection: clientConnection });

  const result = await worker.runUntil(
    client.workflow.execute("helloWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId: `smoke-${Date.now()}`,
      args: ["Chikory"],
    }),
  );

  await clientConnection.close();
  await workerConnection.close();

  if (result !== "Hello, Chikory!") {
    throw new Error(`SMOKE FAILED: unexpected workflow result: ${JSON.stringify(result)}`);
  }
  console.log(`SMOKE OK: workflow returned ${JSON.stringify(result)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
