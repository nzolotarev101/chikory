/**
 * On-disk layout for a run (durable-runner.md): everything for run X lives
 * under `<dataDir>/runs/<run-id>/` — journal, artifacts, workspace.
 */
import { join } from "node:path";

export const DEFAULT_DATA_DIR = ".chikory";

export function runDir(dataDir: string, runId: string): string {
  return join(dataDir, "runs", runId);
}

export function journalPath(dataDir: string, runId: string): string {
  return join(runDir(dataDir, runId), "journal.db");
}

export function artifactsDir(dataDir: string, runId: string): string {
  return join(runDir(dataDir, runId), "artifacts");
}

export function workspaceDir(dataDir: string, runId: string): string {
  return join(runDir(dataDir, runId), "workspace");
}
