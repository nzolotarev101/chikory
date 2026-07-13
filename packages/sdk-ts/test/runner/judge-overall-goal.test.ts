/**
 * Chain big-picture plumbing at the judge boundary: a journaled spec whose
 * `chainLink` carries `planGoal`/`planOutline` puts the OVERALL GOAL section
 * (with the sibling outline) into the judge's wire request; a spec without it
 * sends no section. Drives the real judgeStep activity directly (no Temporal),
 * faking the transport, not the LLM.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { STANDING_RUBRIC } from "../../src/judge/index.js";
import { Journal } from "../../src/journal/journal.js";
import { createRunnerActivities } from "../../src/runner/activities.js";
import { journalPath, workspaceDir } from "../../src/runner/paths.js";
import type { ChainLink, JudgeForm, TaskSpec } from "../../src/types.js";

const execFileAsync = promisify(execFile);

const allPassForm: JudgeForm = {
  criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
  rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "clean" })),
  concerns: [],
};

interface CapturingWire {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

async function startCapturingFormServer(): Promise<CapturingWire> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      requests.push(body);
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
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function nodeSpec(chainLink?: ChainLink): TaskSpec {
  const compat = { provider: "openai-compat" as const, model: "fake-judge" };
  const executor = { provider: "anthropic" as const, model: "fake-executor" };
  return {
    name: "overall-goal-test",
    goal: "implement node N-2",
    repos: [{ url: "unused", writable: true }],
    acceptanceCriteria: [{ id: "AC-1", description: "anything" }],
    budgetUsd: 1,
    maxSteps: 2,
    executor: { adapter: "scripted", family: "anthropic" },
    judge: { family: "openai-compat", cadence: 1 },
    routing: { stages: { plan: executor, code: executor, review: executor, judge: compat } },
    ...(chainLink !== undefined ? { chainLink } : {}),
  };
}

describe("judgeStep carries the chain plan's big picture into the judge prompt", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(runId: string, spec: TaskSpec) {
    const dataDir = await mkdtemp(join(tmpdir(), "chikory-overall-goal-"));
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

  it("chainLink.planGoal + planOutline render as the OVERALL GOAL section", async () => {
    const wire = await startCapturingFormServer();
    cleanups.push(() => wire.close());
    const spec = nodeSpec({
      planId: "plan-1",
      nodeId: "N-2",
      planGoal: "Build the whole importer end to end",
      planOutline: ["N-1: parse input", "N-2: write output"],
    });
    const { dataDir, sinceCommit } = await setup("run-overall-goal", spec);
    const activities = createRunnerActivities({
      dataDir,
      adapters: {},
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });

    const verdict = await activities.judgeStep({
      runId: "run-overall-goal",
      judgeIndex: 0,
      atStep: 0,
      criteria: spec.acceptanceCriteria,
      sinceCommit,
    });

    expect(verdict.kind).toBe("PROCEED");
    const sent = wire.requests[0]!;
    expect(sent).toContain("## OVERALL GOAL (big picture)");
    expect(sent).toContain("Build the whole importer end to end");
    expect(sent).toContain("Plan outline (sibling nodes):");
    expect(sent).toContain("- N-1: parse input");
  });

  it("a spec without chainLink.planGoal sends no OVERALL GOAL section", async () => {
    const wire = await startCapturingFormServer();
    cleanups.push(() => wire.close());
    const spec = nodeSpec({ planId: "plan-1", nodeId: "N-2" });
    const { dataDir, sinceCommit } = await setup("run-no-overall-goal", spec);
    const activities = createRunnerActivities({
      dataDir,
      adapters: {},
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
    });

    await activities.judgeStep({
      runId: "run-no-overall-goal",
      judgeIndex: 0,
      atStep: 0,
      criteria: spec.acceptanceCriteria,
      sinceCommit,
    });

    expect(wire.requests[0]!).not.toContain("## OVERALL GOAL (big picture)");
  });
});
