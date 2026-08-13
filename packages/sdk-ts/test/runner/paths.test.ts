import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATA_DIR,
  artifactsDir,
  chainDir,
  chainJournalPath,
  endpointLedgerPath,
  journalPath,
  runDir,
  sharedArtifactsDir,
  workspaceDir,
} from "../../src/runner/paths.js";

describe("runner paths", () => {
  const dummyDataDir = "my-data-dir";
  const dummyRunId = "run-123";
  const dummyChainId = "chain-456";

  it("exports DEFAULT_DATA_DIR as .chikory", () => {
    expect(DEFAULT_DATA_DIR).toBe(".chikory");
  });

  it("computes runDir correctly", () => {
    expect(runDir(dummyDataDir, dummyRunId)).toBe("my-data-dir/runs/run-123");
  });

  it("computes journalPath correctly", () => {
    expect(journalPath(dummyDataDir, dummyRunId)).toBe("my-data-dir/runs/run-123/journal.db");
  });

  it("computes artifactsDir correctly", () => {
    expect(artifactsDir(dummyDataDir, dummyRunId)).toBe("my-data-dir/runs/run-123/artifacts");
  });

  it("computes sharedArtifactsDir correctly", () => {
    expect(sharedArtifactsDir(dummyDataDir)).toBe("my-data-dir/artifacts");
  });

  it("computes workspaceDir correctly", () => {
    expect(workspaceDir(dummyDataDir, dummyRunId)).toBe("my-data-dir/runs/run-123/workspace");
  });

  it("computes chainDir correctly", () => {
    expect(chainDir(dummyDataDir, dummyChainId)).toBe("my-data-dir/chains/chain-456");
  });

  it("computes chainJournalPath correctly", () => {
    expect(chainJournalPath(dummyDataDir, dummyChainId)).toBe(
      "my-data-dir/chains/chain-456/chain.db",
    );
  });

  it("computes endpointLedgerPath correctly", () => {
    expect(endpointLedgerPath(dummyDataDir)).toBe("my-data-dir/ledger/endpoints.db");
  });
});
