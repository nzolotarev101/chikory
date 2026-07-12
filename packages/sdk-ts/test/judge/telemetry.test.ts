/**
 * Judge telemetry (WP-134, JD-7): runTotals aggregates from the journal
 * (verdict history, judge cost as % of run cost — the `chikory trace`
 * footer data), every judge pass emits a `chikory.judge.pass` span, and a
 * `judge.maxCostShare` breach warns loudly and is flagged on the span.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STANDING_RUBRIC } from "../../src/judge/index.js";
import { Journal, runTotals } from "../../src/journal/journal.js";
import { SPAN_JUDGE_PASS } from "../../src/otel.js";
import { createRunnerActivities } from "../../src/runner/activities.js";
import { journalPath, workspaceDir } from "../../src/runner/paths.js";
import type { JudgeForm, TaskSpec } from "../../src/types.js";

const execFileAsync = promisify(execFile);

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);

describe("runTotals (journal-format.md §2 totals)", () => {
  it("aggregates steps, judge passes, verdict mix, cost split, and tokens", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-totals-"));
    const journal = new Journal(join(tmp, "journal.db"));
    try {
      const verdict = (kind: string) => ({ judgeIndex: 0, atStep: 0, verdict: { kind } });
      journal.append({
        kind: "step",
        payload: {
          stepIndex: 0,
          limitResponse: {
            steps: [
              { action: "limit-independent-work" },
              { action: "park-until-reset", retryAfterMs: 5000 },
            ],
          },
        },
        costDeltaUsd: 0.01,
        tokens: { input: 100, output: 50 },
        artifactRefs: [],
      });
      journal.append({
        kind: "step",
        payload: { stepIndex: 1 },
        costDeltaUsd: 0.01,
        tokens: { input: 100, output: 50 },
        artifactRefs: [],
      });
      journal.append({
        kind: "judge",
        payload: { judgeIndex: 0 },
        costDeltaUsd: 0.005,
        tokens: { input: 200, output: 20 },
        artifactRefs: [],
      });
      journal.append({ kind: "verdict", payload: verdict("ROLLBACK"), costDeltaUsd: 0, artifactRefs: [] });
      journal.append({ kind: "verdict", payload: verdict("ESCALATE"), costDeltaUsd: 0, artifactRefs: [] });
      journal.append({ kind: "verdict", payload: verdict("PROCEED"), costDeltaUsd: 0, artifactRefs: [] });
      journal.append({
        kind: "limit_signal",
        payload: {
          limitSignalIndex: 0,
          atStep: 2,
          stage: "code",
          signal: { source: "injected" },
          chosenResponse: { action: "limit-independent-work" },
          limitResponse: {
            steps: [{ action: "park-until-reset", retryAfterMs: 5000 }],
          },
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      journal.append({
        kind: "limit_signal",
        payload: {
          limitSignalIndex: 1,
          atStep: 3,
          stage: "code",
          signal: { source: "injected" },
          chosenResponse: { action: "park-until-reset", retryAfterMs: 2000 },
          limitResponse: {
            steps: [{ action: "park-until-reset", retryAfterMs: 2000 }],
          },
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });
      journal.append({
        kind: "control_event",
        payload: {
          controlEventIndex: 0,
          event: "resume",
          atStep: 3,
          source: "limit",
          details: { sleepMs: 2000 },
        },
        costDeltaUsd: 0,
        artifactRefs: [],
      });

      const totals = runTotals(journal);
      expect(totals.steps).toBe(2);
      expect(totals.judgePasses).toBe(1);
      expect(totals.rollbacks).toBe(1);
      expect(totals.escalations).toBe(1);
      expect(totals.costUsd).toBeCloseTo(0.025, 10);
      expect(totals.judgeCostUsd).toBeCloseTo(0.005, 10);
      expect(totals.judgeCostShare).toBeCloseTo(0.2, 10);
      expect(totals.tokens).toEqual({ input: 400, output: 120 });
      expect(totals.limitSignals).toBe(2);
      expect(totals.limitSleptMs).toBe(2000);
      expect(totals.limitSleepConservedMs).toBe(5000);
    } finally {
      journal.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("reports zero share on a journal with no spend", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-totals-"));
    const journal = new Journal(join(tmp, "journal.db"));
    try {
      expect(runTotals(journal).judgeCostShare).toBe(0);
    } finally {
      journal.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ─── chikory.judge.pass span from a real judge pass (fake wire) ─────────────

const allPassForm: JudgeForm = {
  criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
  rubricResults: STANDING_RUBRIC.map((r) => ({ id: r.id, pass: true, justification: "clean" })),
  concerns: [],
};

describe("judge pass telemetry (WP-134)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  it("emits chikory.judge.pass with verdict/cost/evidence attrs; maxCostShare breach warns + flags", async () => {
    exporter.reset();
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
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const runId = "run-telemetry";
    const dataDir = await mkdtemp(join(tmpdir(), "chikory-telemetry-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const ws = workspaceDir(dataDir, runId);
    await mkdir(ws, { recursive: true });
    await execFileAsync("git", ["init", "-q", ws]);
    await execFileAsync("git", ["-C", ws, "config", "user.email", "test@chikory.dev"]);
    await execFileAsync("git", ["-C", ws, "config", "user.name", "chikory-test"]);
    await execFileAsync("git", ["-C", ws, "commit", "-q", "--allow-empty", "-m", "base"]);
    const { stdout: sha } = await execFileAsync("git", ["-C", ws, "rev-parse", "HEAD"]);
    await writeFile(join(ws, "work.txt"), "step output\n");

    const compat = { provider: "openai-compat" as const, model: "fake-judge" };
    const spec: TaskSpec = {
      name: "telemetry-test",
      goal: "exercise judge telemetry",
      repos: [{ url: "unused", writable: true }],
      acceptanceCriteria: [{ id: "AC-1", description: "anything" }],
      budgetUsd: 100,
      maxSteps: 2,
      executor: { adapter: "scripted", family: "anthropic" },
      // With no step spend in this journal, judge share is 1.0 > 0.5 → breach.
      judge: { family: "openai-compat", cadence: 1, maxCostShare: 0.5 },
      routing: { stages: { plan: compat, code: compat, review: compat, judge: compat } },
    };
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      journal.createRun(runId, spec);
    } finally {
      journal.close();
    }

    const activities = createRunnerActivities({
      dataDir,
      adapters: {},
      routerOptions: {
        baseUrls: { "openai-compat": `http://127.0.0.1:${port}` },
        // Price the fake model so judge spend (and the share breach) is real.
        pricing: { "fake-judge": { inputPerMTok: 1000, outputPerMTok: 1000 } },
      },
    });
    const verdict = await activities.judgeStep({
      runId,
      judgeIndex: 0,
      atStep: 0,
      criteria: spec.acceptanceCriteria,
      sinceCommit: sha.trim(),
    });
    expect(verdict.kind).toBe("PROCEED");
    expect(verdict.costUsd).toBeGreaterThan(0);

    const spans = exporter.getFinishedSpans().filter((s) => s.name === SPAN_JUDGE_PASS);
    expect(spans).toHaveLength(1);
    const attrs = spans[0]!.attributes;
    expect(attrs["run.id"]).toBe(runId);
    expect(attrs["verdict"]).toBe("PROCEED");
    expect(attrs["criteria.passed"]).toBe(1);
    expect(attrs["criteria.failed"]).toBe(0);
    expect(attrs["rubric.failed"]).toBe(0);
    expect(attrs["judge.provider"]).toBe("openai-compat");
    expect(attrs["cost.usd"]).toBeGreaterThan(0);
    expect(attrs["cost.share"]).toBe(1);
    expect(attrs["cost.share.max"]).toBe(0.5);
    expect(attrs["cost.share.breached"]).toBe(true);
    expect(attrs["evidence.bytes"]).toBeGreaterThan(0);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("maxCostShare"));
  });
});
