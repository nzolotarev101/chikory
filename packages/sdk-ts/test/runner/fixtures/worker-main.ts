/**
 * Standalone runner worker for the crash-recovery test (WP-123). Runs as a
 * real OS process (`node --import tsx`) so the test can `kill -9` it
 * mid-run and prove the workflow resumes on a fresh worker with zero
 * duplicate spend. Prints WORKER_READY once polling.
 */
import { createRunnerWorker } from "../../../src/index.js";
import { scriptedRegistry } from "../helpers.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

const worker = await createRunnerWorker({
  adapters: scriptedRegistry,
  address: env("CHIKORY_TEST_ADDRESS"),
  taskQueue: env("CHIKORY_TEST_TASK_QUEUE"),
  dataDir: env("CHIKORY_TEST_DATA_DIR"),
  workflowBundlePath: env("CHIKORY_TEST_WF_BUNDLE"),
});

console.log("WORKER_READY");
await worker.run();
