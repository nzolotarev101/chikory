import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cmdStatus } from "../../src/cli/commands.js";
import { Journal } from "../../src/journal/journal.js";
import { journalPath } from "../../src/runner/paths.js";
import { makeSpec } from "../runner/helpers.js";

describe("cmdStatus listing performance benchmark", () => {
  let dataDir: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "chikory-status-bench-"));
  });

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it("measures performance of listing 50 run journals", async () => {
    if (!dataDir) throw new Error("No dataDir");

    const numRuns = 50;
    const spec = makeSpec({ repoUrl: "." });

    // Create 50 run journals
    for (let i = 0; i < numRuns; i++) {
      const runId = `run-${String(i).padStart(4, "0")}`;
      const path = journalPath(dataDir, runId);
      const journal = new Journal(path);
      try {
        journal.createRun(runId, spec);
        journal.append({
          kind: "step",
          payload: {},
          costDeltaUsd: 0.05,
          artifactRefs: [],
        });
        journal.sealRun("SUCCESS");
      } finally {
        journal.close();
      }
    }

    const outputLines: string[] = [];
    const deps = {
      out: (line: string) => outputLines.push(line),
      err: () => {},
    };

    // Measure cmdStatus execution time
    const start = performance.now();
    const code = await cmdStatus({ json: false, dataDir }, deps);
    const duration = performance.now() - start;

    expect(code).toBe(0);
    expect(outputLines.length).toBeGreaterThan(0);

    console.log(`\n⏱️ Baseline cmdStatus listing duration for ${numRuns} runs: ${duration.toFixed(2)}ms`);
  });
});
