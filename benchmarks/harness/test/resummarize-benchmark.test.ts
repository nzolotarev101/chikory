import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("resummarize benchmark", () => {
  it("compares sync vs async reading for loading task results", async () => {
    const resultsDir = mkdtempSync(join(tmpdir(), "resummarize-bench-"));
    const outDir = mkdtempSync(join(tmpdir(), "resummarize-out-"));
    const ledgerFile = join(resultsDir, "discrimination.json");

    writeFileSync(ledgerFile, JSON.stringify({}));

    const NUM_FILES = 500;
    const files: string[] = [];
    for (let i = 0; i < NUM_FILES; i++) {
      const taskId = `task-${i}`;
      const taskResult = {
        taskId,
        source: `${taskId}.yaml`,
        class: "brownfield",
        adapter: "chikory",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:01:00.000Z",
        run: { exitCode: 0, wallClockMs: 100, artifacts: [], notes: ["some notes to increase size".repeat(10)] },
        grading: { grades: [{ requirementId: "R1", satisfied: true, detail: "ok" }], total: 1, satisfied: 1, dependencySatisfied: 1 },
      };
      const filePath = join(resultsDir, `${taskId}-result.json`);
      writeFileSync(filePath, JSON.stringify(taskResult, null, 2));
      files.push(filePath);
    }

    // Measure Sync
    const syncDurations: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const res = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
      syncDurations.push(performance.now() - start);
      expect(res.length).toBe(NUM_FILES);
    }

    // Measure Async Promise.all
    const asyncDurations: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const res = await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, "utf8"))));
      asyncDurations.push(performance.now() - start);
      expect(res.length).toBe(NUM_FILES);
    }

    const syncAvg = syncDurations.reduce((a, b) => a + b, 0) / syncDurations.length;
    const asyncAvg = asyncDurations.reduce((a, b) => a + b, 0) / asyncDurations.length;

    console.log(`[Direct comparison] 500 files:`);
    console.log(`  Sync readFileSync + JSON.parse avg: ${syncAvg.toFixed(2)} ms`);
    console.log(`  Async readFile + JSON.parse avg: ${asyncAvg.toFixed(2)} ms`);

    rmSync(resultsDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
});
