import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cmdResume, resumeProviderEnvGaps } from "../../src/cli/commands.js";
import { Journal } from "../../src/journal/journal.js";
import { journalPath } from "../../src/runner/paths.js";
import { makeSpec } from "../runner/helpers.js";

// F-99 (dogfood-082): `chikory resume` from a shell that never exported the
// run's routed provider env (e.g. OPENAI_COMPAT_BASE_URL for the judge proxy)
// started activities that looped SILENTLY in Temporal's retry policy for ~30
// minutes. The precondition validates the env against the spec persisted in
// the run's journal BEFORE a worker is hosted, and fails loud naming the vars.

const RUN_ID = "run-f99-test";
const ENV_OK = { ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "k" };

function seedRun(dataDir: string): void {
  const journal = new Journal(journalPath(dataDir, RUN_ID));
  try {
    journal.createRun(RUN_ID, makeSpec({ repoUrl: "file:///tmp/nowhere" }));
  } finally {
    journal.close();
  }
}

describe("resumeProviderEnvGaps (F-99)", () => {
  let dataDir: string;

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("names every routed provider whose env var is absent", () => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-f99-"));
    seedRun(dataDir);
    // makeSpec routes anthropic (plan/code/review) + gemini (judge).
    expect(resumeProviderEnvGaps(dataDir, RUN_ID, {})).toEqual(
      expect.arrayContaining([
        { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
        { provider: "gemini", envVar: "GEMINI_API_KEY" },
      ]),
    );
    expect(resumeProviderEnvGaps(dataDir, RUN_ID, { ANTHROPIC_API_KEY: "k" })).toEqual([
      { provider: "gemini", envVar: "GEMINI_API_KEY" },
    ]);
  });

  it("passes when every routed provider is configured", () => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-f99-"));
    seedRun(dataDir);
    expect(resumeProviderEnvGaps(dataDir, RUN_ID, ENV_OK)).toEqual([]);
  });

  it("fails open when the run has no journal (never blocks a legitimate resume)", () => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-f99-"));
    expect(resumeProviderEnvGaps(dataDir, "run-does-not-exist", ENV_OK)).toEqual([]);
  });
});

describe("cmdResume F-99 precondition", () => {
  let dataDir: string;

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("refuses fast with an actionable message instead of hosting a worker", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "chikory-f99-"));
    seedRun(dataDir);
    const errLines: string[] = [];
    const code = await cmdResume(
      { runId: RUN_ID, watch: false, json: false, dataDir },
      { env: { ANTHROPIC_API_KEY: "k" }, err: (line) => errLines.push(line), out: () => {} },
    );
    expect(code).toBe(1);
    const stderr = errLines.join("\n");
    expect(stderr).toContain("F-99");
    expect(stderr).toContain("GEMINI_API_KEY");
    expect(stderr).not.toContain("ANTHROPIC_API_KEY");
  });
});
