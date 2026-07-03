/**
 * WP-141 — every CLI command against a live local run: real ephemeral
 * Temporal server (global setup), scripted executor, real judge activity
 * over the fake openai-compat wire. Exit codes mirror the run's terminal
 * status; `--json` output is machine-parseable (cli.md conventions).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, inject, test } from "vitest";

import { followRun, type CliDeps } from "../../src/cli/commands.js";
import { main } from "../../src/cli/main.js";
import type { RunStatusReport } from "../../src/index.js";
import { Journal } from "../../src/journal/journal.js";
import { artifactsDir, journalPath } from "../../src/runner/paths.js";
import type { ArtifactRef, ContextBundle, JournalEntry, RunHandle } from "../../src/types.js";
import {
  initSourceRepo,
  judgeForm,
  startFakeJudgeWire,
  scriptedRegistry,
  waitFor,
  type FakeJudgeWire,
  type ScriptedConfig,
} from "../runner/helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

interface Cli {
  out: string[];
  err: string[];
  deps: CliDeps;
}

describe.skipIf(address === null)("chikory CLI (WP-141/142)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  beforeAll(() => {
    // parseTaskSpec §9.3 needs every routed provider configured; the judge
    // traffic itself goes to the fake wire via routerOptions.baseUrls.
    process.env["ANTHROPIC_API_KEY"] ??= "test-key";
    process.env["OPENAI_COMPAT_BASE_URL"] ??= "http://127.0.0.1:9";
  });

  function cli(opts: { taskQueue?: string; wire?: FakeJudgeWire } = {}): Cli {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      deps: {
        adapters: scriptedRegistry,
        workflowBundlePath: bundlePath!,
        taskQueue: opts.taskQueue ?? `cli-tq-${randomUUID()}`,
        ...(opts.wire ? { routerOptions: { baseUrls: { "openai-compat": opts.wire.url } } } : {}),
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        pollIntervalMs: 150,
      },
    };
  }

  function taskYaml(
    repoUrl: string,
    opts: { cadence?: number; budget?: number; maxSteps?: number } = {},
  ): string {
    return [
      "name: cli-test",
      "goal: exercise the CLI against the scripted executor",
      "repos:",
      `  - url: ${repoUrl}`,
      "    writable: true",
      "acceptance_criteria:",
      "  - id: AC-1",
      "    description: scripted steps executed",
      `budget_usd: ${opts.budget ?? 5}`,
      `max_steps: ${opts.maxSteps ?? 4}`,
      "executor:",
      "  adapter: scripted",
      "  family: anthropic",
      "judge:",
      "  family: openai-compat",
      `  cadence: ${opts.cadence ?? 2}`,
      "routing:",
      "  stages:",
      "    plan: { provider: anthropic, model: claude-fable-5 }",
      "    code: { provider: anthropic, model: claude-fable-5 }",
      "    review: { provider: anthropic, model: claude-fable-5 }",
      "    judge: { provider: openai-compat, model: fake-judge }",
    ].join("\n");
  }

  async function setup(
    scripted: Partial<ScriptedConfig> = {},
    specOpts: Parameters<typeof taskYaml>[1] = {},
  ): Promise<{ dataDir: string; specFile: string }> {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-cli-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), scripted);
    const dataDir = join(tmp, "data");
    const specFile = join(tmp, "task.yaml");
    await writeFile(specFile, taskYaml(repoUrl, specOpts));
    return { dataDir, specFile };
  }

  function common(dataDir: string): string[] {
    return ["--data-dir", dataDir, "--address", address!];
  }

  function runIdFrom(out: string[]): string {
    const line = out.find((l) => l.startsWith("run-id: "));
    expect(line, `run-id line in: ${out.join("\n")}`).toBeDefined();
    return line!.slice("run-id: ".length);
  }

  function payloadWithText(entry: JournalEntry): { text: string; atStep: number } {
    const payload = entry.payload;
    expect(payload).toMatchObject({ text: expect.any(String), atStep: expect.any(Number) });
    return payload as { text: string; atStep: number };
  }

  function checkpointPayload(entry: JournalEntry): { stepIndex: number; contextSnapshotRef: ArtifactRef } {
    const payload = entry.payload;
    expect(payload).toMatchObject({
      stepIndex: expect.any(Number),
      contextSnapshotRef: expect.objectContaining({ id: expect.any(String) }),
    });
    return payload as { stepIndex: number; contextSnapshotRef: ArtifactRef };
  }

  async function statusReport(runId: string, dataDir: string): Promise<RunStatusReport> {
    const s = cli();
    await main(["status", runId, "--json", ...common(dataDir)], s.deps);
    expect(s.out[0], s.err.join("\n")).toBeDefined();
    return JSON.parse(s.out[0]!) as RunStatusReport;
  }

  function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex -- matching the ESC (\x1b) byte in ANSI color codes is intentional
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  test("run → SUCCESS (exit 0), then status/trace forensics", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { dataDir, specFile } = await setup();

    const run = cli({ wire });
    const code = await main(["run", specFile, "--watch", ...common(dataDir)], run.deps);
    expect(code, run.err.join("\n")).toBe(0);
    const runId = runIdFrom(run.out);
    expect(run.out.join("\n")).toContain("SUCCESS");
    // --watch streamed journal entries live
    expect(run.out.some((l) => stripAnsi(l).includes("step 1 SUCCESS"))).toBe(true);
    expect(run.out.some((l) => stripAnsi(l).includes("] verdict ✓ PROCEED"))).toBe(true);

    // status <run-id> (worker down — journal fallback path)
    const report = await statusReport(runId, dataDir);
    expect(report.status).toBe("SUCCESS");
    expect(report.spentUsd).toBeGreaterThan(0);
    const human = cli();
    expect(await main(["status", runId, ...common(dataDir)], human.deps)).toBe(0);
    expect(human.out.join("\n")).toContain("status       SUCCESS");

    // status (no arg) lists the run
    const list = cli();
    expect(await main(["status", ...common(dataDir)], list.deps)).toBe(0);
    expect(list.out.join("\n")).toContain(runId);

    // trace: header, verdict, totals (WP-142)
    const trace = cli();
    expect(await main(["trace", runId, ...common(dataDir)], trace.deps)).toBe(0);
    const rendered = trace.out.join("\n");
    expect(rendered).toContain(`run ${runId} · SUCCESS · 2 steps`);
    expect(rendered).toContain("✓ PROCEED (1/1 criteria)");
    expect(rendered).toContain("totals: decisions 2 · judge passes 1");

    // trace --step drill-down
    const detail = cli();
    expect(await main(["trace", runId, "--step", "2", ...common(dataDir)], detail.deps)).toBe(0);
    expect(detail.out.join("\n")).toContain("✓ AC-1");

    // trace --json round-trips the journal
    const raw = cli();
    expect(await main(["trace", runId, "--json", ...common(dataDir)], raw.deps)).toBe(0);
    const json = JSON.parse(raw.out[0]!) as { totals: { steps: number }; run: { runId: string } };
    expect(json.run.runId).toBe(runId);
    expect(json.totals.steps).toBe(2);
  });

  test("loop-breaker escalation → approve --reject seals FAILED (exit 1)", async () => {
    const { dataDir, specFile } = await setup({ failAll: true }, { cadence: 10, maxSteps: 6 });

    const run = cli();
    const runPromise = main(["run", specFile, ...common(dataDir)], run.deps);
    const runId = await waitFor(
      async () => run.out.find((l) => l.startsWith("run-id: "))?.slice("run-id: ".length),
      { what: "run-id printed" },
    );
    await waitFor(
      async () => {
        const report = await statusReport(runId, dataDir);
        return report.status === "AWAITING_APPROVAL" ? report : undefined;
      },
      { what: "AWAITING_APPROVAL" },
    );

    const approve = cli();
    expect(
      await main(["approve", runId, "--reject", "not worth continuing", ...common(dataDir)], approve.deps),
    ).toBe(0); // the approve command itself succeeds; the run seals FAILED
    expect(approve.out.join("\n")).toContain("rejection delivered");

    expect(await runPromise).toBe(1);
    expect(run.out.join("\n")).toContain("AWAITING_APPROVAL — answer with: chikory approve");
    expect(run.out.filter((line) => line.includes("AWAITING_APPROVAL — answer with"))).toHaveLength(1);
    expect(run.out.join("\n")).toContain("FAILED");

    const trace = cli();
    await main(["trace", runId, ...common(dataDir)], trace.deps);
    expect(trace.out.join("\n")).toContain("⚠ ESCALATE (runner)");
  });

  test("budget halt → resume --add-budget continues to SUCCESS", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    cleanups.push(() => wire.close());
    const { dataDir, specFile } = await setup({ costPerStep: 1 }, { budget: 1.4 });

    const run = cli({ wire });
    const runPromise = main(["run", specFile, ...common(dataDir)], run.deps);
    const runId = await waitFor(
      async () => run.out.find((l) => l.startsWith("run-id: "))?.slice("run-id: ".length),
      { what: "run-id printed" },
    );
    await waitFor(
      async () => {
        const report = await statusReport(runId, dataDir);
        return report.status === "SUSPENDED" ? report : undefined;
      },
      { what: "SUSPENDED at budget cap" },
    );

    const resume = cli({ taskQueue: run.deps.taskQueue, wire });
    const resumeCode = await main(
      ["resume", runId, "--add-budget", "10", ...common(dataDir)],
      resume.deps,
    );
    expect(resumeCode, resume.err.join("\n")).toBe(0);
    expect(await runPromise).toBe(0);
    expect(run.out.join("\n")).toContain("SUSPENDED at the budget cap");
    expect(run.out.filter((line) => line.includes("SUSPENDED at the budget cap"))).toHaveLength(1);
    expect(run.out.join("\n")).toContain("SUCCESS");
  });

  test("cancel stops the run at the next step boundary (exit 1, CANCELLED)", async () => {
    const { dataDir, specFile } = await setup(
      { delayMs: 400 },
      { cadence: 50, maxSteps: 50, budget: 100 },
    );

    const run = cli();
    const runPromise = main(["run", specFile, ...common(dataDir)], run.deps);
    const runId = await waitFor(
      async () => run.out.find((l) => l.startsWith("run-id: "))?.slice("run-id: ".length),
      { what: "run-id printed" },
    );

    const cancel = cli();
    expect(await main(["cancel", runId, ...common(dataDir)], cancel.deps)).toBe(0);
    expect(cancel.out.join("\n")).toContain("cancel requested");

    expect(await runPromise).toBe(1);
    expect(run.out.join("\n")).toContain("CANCELLED");
    const report = await statusReport(runId, dataDir);
    expect(report.status).toBe("CANCELLED");
  });

  test("inject delivers operator guidance into a live run journal", async () => {
    const guidance = "WP-212-INJECT-SENTINEL preserve this exact guidance";
    const { dataDir, specFile } = await setup(
      { delayMs: 500 },
      { cadence: 50, maxSteps: 4, budget: 100 },
    );

    const run = cli();
    const runPromise = main(["run", specFile, ...common(dataDir)], run.deps);
    const runId = await waitFor(
      async () => run.out.find((l) => l.startsWith("run-id: "))?.slice("run-id: ".length),
      { what: "run-id printed" },
    );
    const path = journalPath(dataDir, runId);
    await waitFor(
      async () => {
        if (!existsSync(path)) return undefined;
        const journal = new Journal(path);
        try {
          return journal.entries("step").length >= 1 ? true : undefined;
        } finally {
          journal.close();
        }
      },
      { intervalMs: 50, what: "first step journaled before injection" },
    );

    const injectCommand = cli();
    expect(await main(["inject", runId, guidance, ...common(dataDir)], injectCommand.deps)).toBe(0);
    expect(injectCommand.out.join("\n")).toContain(`guidance delivered to ${runId}`);

    expect(await runPromise).toBe(1);
    const journal = new Journal(path);
    try {
      const injections = journal.entries("injection");
      expect(injections).toHaveLength(1);
      const injection = payloadWithText(injections[0]!);
      expect(injection.text).toBe(guidance);
      expect(injections[0]!.payload).toMatchObject({
        source: "human",
        text: guidance,
      });
      const checkpoint = journal
        .entries("checkpoint")
        .map(checkpointPayload)
        .find((entry) => entry.stepIndex === injection.atStep);
      expect(checkpoint, `checkpoint for injected step ${injection.atStep}`).toBeDefined();
      const snapshotPath = join(artifactsDir(dataDir, runId), checkpoint!.contextSnapshotRef.id);
      const context = JSON.parse(await readFile(snapshotPath, "utf8")) as ContextBundle;
      expect(context.injections).toContain(guidance);
    } finally {
      journal.close();
    }
  });

  test("actionable errors: bad spec, unknown command, missing run", async () => {
    const bad = cli();
    const tmp = await mkdtemp(join(tmpdir(), "chikory-cli-bad-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const badFile = join(tmp, "bad.yaml");
    await writeFile(badFile, "name: x\n"); // missing everything else
    expect(await main(["run", badFile, ...common(tmp)], bad.deps)).toBe(1);
    expect(bad.err.join("\n")).toContain("Invalid task spec");

    const missing = cli();
    expect(await main(["run", join(tmp, "nope.yaml"), ...common(tmp)], missing.deps)).toBe(1);
    expect(missing.err.join("\n")).toContain("cannot read task spec");

    const unknown = cli();
    expect(await main(["frobnicate"], unknown.deps)).toBe(1);
    expect(unknown.err.join("\n")).toContain("unknown command");

    const noRun = cli();
    expect(await main(["trace", "run-nope", "--data-dir", tmp], noRun.deps)).toBe(1);
    expect(noRun.err.join("\n")).toContain("no journal for run");

    const noInjectRun = cli();
    expect(await main(["inject"], noInjectRun.deps)).toBe(1);
    expect(noInjectRun.err.join("\n")).toContain("missing run-id");

    const noSuspendRun = cli();
    expect(await main(["suspend"], noSuspendRun.deps)).toBe(1);
    expect(noSuspendRun.err.join("\n")).toContain("missing run-id");

    const noGuidance = cli();
    expect(await main(["inject", "run-nope"], noGuidance.deps)).toBe(1);
    expect(noGuidance.err.join("\n")).toContain("missing guidance text");

    const emptyGuidance = cli();
    expect(await main(["inject", "run-nope", ""], emptyGuidance.deps)).toBe(1);
    expect(emptyGuidance.err.join("\n")).toContain("missing guidance text");

    const help = cli();
    expect(await main(["--help"], help.deps)).toBe(0);
    for (const cmd of ["run", "resume", "status", "approve", "inject", "suspend", "cancel", "trace"]) {
      expect(help.out.join("\n")).toContain(cmd);
    }
  });

  test("final drain renders a transition appended during terminal status()", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-cli-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const runId = "run-fake-drain";
    const path = journalPath(tmp, runId);
    
    // Create an empty journal so Journal initialization succeeds
    const journal = new Journal(path);
    journal.close();

    const fakeHandle: RunHandle = {
      runId,
      async status() {
        const j = new Journal(path);
        try {
          j.append({
            kind: "verdict",
            payload: { verdict: { kind: "ESCALATE" } },
            costDeltaUsd: 0,
            artifactRefs: [],
          });
        } finally {
          j.close();
        }
        return {
          status: "FAILED",
          currentStep: 3,
          spentUsd: 0.03,
          budgetUsd: 5,
          checkpoints: [],
        };
      },
      approve: async () => {},
      inject: async () => {},
      suspend: async () => {},
      cancel: async () => {},
    };

    const output: string[] = [];
    const ioPair = {
      out: (line: string) => output.push(line),
      err: () => {},
    };

    const report = await followRun(
      fakeHandle,
      { json: false, dataDir: tmp },
      { watch: false, deps: { pollIntervalMs: 1 }, io: ioPair },
    );

    expect(report.status).toBe("FAILED");
    const awaitingApprovalLines = output.filter((line) =>
      line.includes("AWAITING_APPROVAL — answer with: chikory approve"),
    );
    expect(awaitingApprovalLines).toHaveLength(1);
  });

  test("watch surfaces the judge escalate reason before the AWAITING_APPROVAL line", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-cli-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const runId = "run-fake-escalate-reason";
    const path = journalPath(tmp, runId);

    const journal = new Journal(path);
    journal.close();

    const fakeHandle: RunHandle = {
      runId,
      async status(): Promise<RunStatusReport> {
        const j = new Journal(path);
        try {
          j.append({
            kind: "verdict",
            payload: {
              verdict: {
                kind: "ESCALATE",
                escalateReason: "diff missing the required changes",
              },
            },
            costDeltaUsd: 0,
            artifactRefs: [],
          });
        } finally {
          j.close();
        }
        return {
          status: "FAILED",
          currentStep: 3,
          spentUsd: 0.03,
          budgetUsd: 5,
          checkpoints: [],
        };
      },
      approve: async () => {},
      inject: async () => {},
      suspend: async () => {},
      cancel: async () => {},
    };

    const output: string[] = [];
    const ioPair = {
      out: (line: string) => output.push(line),
      err: () => {},
    };

    const report = await followRun(
      fakeHandle,
      { json: false, dataDir: tmp },
      { watch: true, deps: { pollIntervalMs: 1 }, io: ioPair },
    );

    expect(report.status).toBe("FAILED");
    const reasonLine = "judge escalated: diff missing the required changes";
    expect(output).toContain(reasonLine);
    expect(output.filter((line) => line === reasonLine)).toHaveLength(1);
    const reasonIndex = output.indexOf(reasonLine);
    const awaitingApprovalIndex = output.findIndex((line) =>
      line.includes("AWAITING_APPROVAL — answer with: chikory approve"),
    );
    expect(awaitingApprovalIndex).toBeGreaterThan(reasonIndex);
  });
});
