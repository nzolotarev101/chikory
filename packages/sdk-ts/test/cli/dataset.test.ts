/**
 * WP-306 — `chikory dataset export` CLI: opt-in capture over real on-disk
 * journals through the real `main` dispatch.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { main } from "../../src/cli/main.js";
import { Journal } from "../../src/journal/journal.js";
import { journalPath } from "../../src/runner/paths.js";
import type { TaskSpec } from "../../src/types.js";

function seed(dataDir: string, runId: string, status: "SUCCESS" | "FAILED"): void {
  const journal = new Journal(journalPath(dataDir, runId));
  journal.createRun(runId, { name: runId, goal: "g", budgetUsd: 5 } as unknown as TaskSpec);
  journal.append({
    kind: "step",
    payload: { stepIndex: 1, summary: "did a thing" },
    costDeltaUsd: 0.25,
    artifactRefs: [],
  });
  journal.append({
    kind: "verdict",
    payload: { atStep: 1, verdict: { kind: status === "SUCCESS" ? "PROCEED" : "ROLLBACK" } },
    costDeltaUsd: 0.05,
    artifactRefs: [],
  });
  journal.sealRun(status);
  journal.close();
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out: (l: string) => out.push(l), err: (l: string) => err.push(l), lines: { out, err } };
}

describe("chikory dataset export", () => {
  test("exports records + index and reports per-run rows", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cli-ds-"));
    seed(dataDir, "run-ok", "SUCCESS");
    seed(dataDir, "run-bad", "FAILED");
    const t = io();
    const code = await main(["dataset", "export", "--data-dir", dataDir], t);
    expect(code).toBe(0);
    const outDir = join(dataDir, "dataset");
    expect(existsSync(join(outDir, "run-ok.json"))).toBe(true);
    expect(existsSync(join(outDir, "run-bad.json"))).toBe(true);
    expect(t.lines.out.join("\n")).toContain("exported 2 run(s)");

    const index = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8"));
    expect(index.runs.map((r: { runId: string }) => r.runId).sort()).toEqual(["run-bad", "run-ok"]);
  });

  test("--out overrides the destination; --json emits the summary", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cli-ds-"));
    seed(dataDir, "run-ok", "SUCCESS");
    const outDir = mkdtempSync(join(tmpdir(), "cli-ds-out-"));
    const t = io();
    const code = await main(
      ["dataset", "export", "--data-dir", dataDir, "--out", outDir, "--json"],
      t,
    );
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "run-ok.json"))).toBe(true);
    const summary = JSON.parse(t.lines.out.join(""));
    expect(summary.exported).toHaveLength(1);
  });

  test("unknown subcommand fails actionably", async () => {
    const t = io();
    const code = await main(["dataset", "upload"], t);
    expect(code).toBe(1);
    expect(t.lines.err.join("\n")).toContain("expected: export");
  });
});
