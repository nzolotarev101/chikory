/**
 * Family-diversity enforcement (WP-133, invariant #2). Unit-tests the pure
 * check, then drives the real judgeStep activity directly (no Temporal) to
 * prove the runner refuses a same-family judge and that the opt-in path
 * warns loudly and journals the warning on every pass.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enforceFamilyDiversity,
  FamilyDiversityError,
  STANDING_RUBRIC,
} from "../../src/judge/index.js";
import { Journal } from "../../src/journal/journal.js";
import { createRunnerActivities, type JudgePayload } from "../../src/runner/activities.js";
import { journalPath, workspaceDir } from "../../src/runner/paths.js";
import type { JudgeForm, TaskSpec } from "../../src/types.js";

const execFileAsync = promisify(execFile);

describe("enforceFamilyDiversity (unit)", () => {
  it("different families pass silently", () => {
    const result = enforceFamilyDiversity({
      executorFamily: "anthropic",
      judgeFamily: "gemini",
      judgeProvider: "gemini",
    });
    expect(result.warnings).toEqual([]);
  });

  it("same family without opt-in throws naming invariant #2 and the override", () => {
    expect(() =>
      enforceFamilyDiversity({
        executorFamily: "anthropic",
        judgeFamily: "anthropic",
        judgeProvider: "anthropic",
      }),
    ).toThrowError(FamilyDiversityError);
    expect(() =>
      enforceFamilyDiversity({
        executorFamily: "anthropic",
        judgeFamily: "anthropic",
        judgeProvider: "anthropic",
      }),
    ).toThrowError(/invariant #2.*allow_same_family/s);
  });

  it("paper-only diversity (judge stage routed back at the executor's provider) throws", () => {
    expect(() =>
      enforceFamilyDiversity({
        executorFamily: "openai",
        judgeFamily: "gemini",
        judgeProvider: "openai",
      }),
    ).toThrowError(/routed judge provider 'openai'/);
  });

  it("opt-in returns a loud warning instead of throwing", () => {
    const result = enforceFamilyDiversity({
      executorFamily: "gemini",
      judgeFamily: "gemini",
      judgeProvider: "gemini",
      allowSameFamily: true,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("WARNING");
    expect(result.warnings[0]).toContain("invariant #2");
  });
});

// ─── judgeStep boundary (direct activity invocation, no Temporal) ───────────

const allPassForm: JudgeForm = {
  criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
  rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "clean" })),
  concerns: [],
};

async function startFormServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(allPassForm) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function sameFamilySpec(allowSameFamily: boolean): TaskSpec {
  const compat = { provider: "openai-compat" as const, model: "fake-judge" };
  return {
    name: "family-test",
    goal: "exercise family enforcement",
    repos: [{ url: "unused", writable: true }],
    acceptanceCriteria: [{ id: "AC-1", description: "anything" }],
    budgetUsd: 1,
    maxSteps: 2,
    executor: { adapter: "scripted", family: "openai-compat" },
    judge: { family: "openai-compat", cadence: 1, ...(allowSameFamily ? { allowSameFamily } : {}) },
    routing: { stages: { plan: compat, code: compat, review: compat, judge: compat } },
  };
}

describe("judgeStep enforces family diversity (WP-133)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(runId: string, spec: TaskSpec) {
    const dataDir = await mkdtemp(join(tmpdir(), "chikory-family-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));

    const ws = workspaceDir(dataDir, runId);
    await mkdir(ws, { recursive: true });
    await execFileAsync("git", ["init", "-q", ws]);
    await execFileAsync("git", ["-C", ws, "config", "user.email", "test@chikory.dev"]);
    await execFileAsync("git", ["-C", ws, "config", "user.name", "chikory-test"]);
    await execFileAsync("git", ["-C", ws, "commit", "-q", "--allow-empty", "-m", "base"]);
    const { stdout } = await execFileAsync("git", ["-C", ws, "rev-parse", "HEAD"]);

    const journal = new Journal(journalPath(dataDir, runId));
    try {
      journal.createRun(runId, spec);
    } finally {
      journal.close();
    }
    return { dataDir, sinceCommit: stdout.trim() };
  }

  it("same-family spec without opt-in: the judge pass refuses to run", async () => {
    const spec = sameFamilySpec(false);
    const { dataDir, sinceCommit } = await setup("run-family-refuse", spec);
    const activities = createRunnerActivities({ dataDir, adapters: {} });

    await expect(
      activities.judgeStep({
        runId: "run-family-refuse",
        judgeIndex: 0,
        atStep: 0,
        criteria: spec.acceptanceCriteria,
        sinceCommit,
      }),
    ).rejects.toThrowError(FamilyDiversityError);
  });

  it("opt-in runs the pass but warns loudly AND journals the warning", async () => {
    const wire = await startFormServer();
    cleanups.push(() => wire.close());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const spec = sameFamilySpec(true);
    const { dataDir, sinceCommit } = await setup("run-family-optin", spec);
    const activities = createRunnerActivities({
      dataDir,
      adapters: {},
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });

    const verdict = await activities.judgeStep({
      runId: "run-family-optin",
      judgeIndex: 0,
      atStep: 0,
      criteria: spec.acceptanceCriteria,
      sinceCommit,
    });

    expect(verdict.kind).toBe("PROCEED");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invariant #2"));

    const journal = new Journal(journalPath(dataDir, "run-family-optin"));
    try {
      const payload = journal.entries("judge")[0]!.payload as JudgePayload;
      expect(payload.warnings).toHaveLength(1);
      expect(payload.warnings![0]).toContain("WARNING");
    } finally {
      journal.close();
    }
  });
});
