/**
 * WP-124 — budget gate + terminal states (CG-1/CG-2, DX-7; MVP exit-gate #4).
 *
 * 1. Budget breach → clean HALT(BUDGET): journaled budget_event, SUSPENDED
 *    at a resumable checkpoint; `resume --add-budget` tops up and continues.
 * 2. Loop-breaker: executor FAILing 3 consecutive steps → ESCALATE and wait
 *    for human approval — never spin. Approve continues; reject seals an
 *    explicit FAILED terminal.
 * 3. The pure gate math (rolling mean ×1.5) unit-tested directly.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  budgetBreached,
  createRunnerWorker,
  createTemporalRunner,
  estimateNextStepCost,
  estimateNextStepTokens,
  Journal,
  journalPath,
  type RunStatusReport,
  tokenBudgetBreached,
} from "../../src/index.js";
import {
  initSourceRepo,
  makeSpec,
  scriptedRegistry,
  TERMINAL_STATUSES,
  waitFor,
  type ScriptedConfig,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe("budget estimate math (WP-124)", () => {
  test("rolling mean of last 5 × 1.5; empty history estimates 0", () => {
    expect(estimateNextStepCost([])).toBe(0);
    expect(estimateNextStepCost([0.01])).toBeCloseTo(0.015, 10);
    // Only the last 5 of 6 are averaged.
    expect(estimateNextStepCost([100, 0.01, 0.01, 0.01, 0.01, 0.01])).toBeCloseTo(0.015, 10);
  });

  test("breach on remaining <= 0 even when estimate is 0", () => {
    expect(budgetBreached(1, 1, 0)).toBe(true);
    expect(budgetBreached(0, 1, 0)).toBe(false);
    expect(budgetBreached(0.99, 1, 0.015)).toBe(true);
  });

  // WP-218 — the token twin of the USD math (same estimator/predicate shape).
  test("token estimate: rolling mean of last 5 × 1.5; empty history estimates 0", () => {
    expect(estimateNextStepTokens([])).toBe(0);
    expect(estimateNextStepTokens([1000])).toBeCloseTo(1500, 6);
    // Only the last 5 of 6 are averaged.
    expect(estimateNextStepTokens([1e9, 1000, 1000, 1000, 1000, 1000])).toBeCloseTo(1500, 6);
  });

  test("token breach on remaining <= 0 even when estimate is 0", () => {
    expect(tokenBudgetBreached(1000, 1000, 0)).toBe(true);
    expect(tokenBudgetBreached(0, 1000, 0)).toBe(false);
    expect(tokenBudgetBreached(990, 1000, 15)).toBe(true);
  });
});

describe.skipIf(address === null)("budget gate + terminal states (WP-124)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(config: Partial<ScriptedConfig>) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-budget-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), config);
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;
    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
    });
    const workerDone = worker.run();
    const runner = createTemporalRunner({ address: address!, taskQueue, dataDir });
    cleanups.push(async () => {
      worker.shutdown();
      await workerDone;
      await runner.close();
    });
    return { repoUrl, dataDir, runner };
  }

  async function awaitStatus(
    handle: { status(): Promise<RunStatusReport> },
    want: (r: RunStatusReport) => boolean,
    what: string,
  ): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const r = await handle.status();
        return want(r) ? r : undefined;
      },
      { what },
    );
  }

  test("breach → HALT(BUDGET) suspended on a resumable checkpoint; resume --add-budget continues", async () => {
    const { repoUrl, dataDir, runner } = await setup({ costPerStep: 0.01 });
    // $0.025 covers 2 × $0.01 steps; the 3rd is blocked by the estimate.
    const spec = makeSpec({
      repoUrl,
      budgetUsd: 0.025,
      maxSteps: 4,
      judge: { family: "gemini", cadence: 50 },
    });

    const handle = await runner.start(spec);
    const halted = await awaitStatus(
      handle,
      (r) => r.status === "SUSPENDED",
      "budget halt",
    );
    // Halted AFTER checkpointing both paid steps — resumable, nothing lost.
    expect(halted.currentStep).toBe(2);
    expect(halted.spentUsd).toBeCloseTo(0.02, 10);
    expect(halted.checkpoints).toHaveLength(2);

    {
      const journal = new Journal(journalPath(dataDir, handle.runId));
      try {
        const events = journal.entries("budget_event");
        expect(events).toHaveLength(1);
        const payload = events[0]!.payload as { event: string; remainingUsd: number };
        expect(payload.event).toBe("halt");
        expect(payload.remainingUsd).toBeCloseTo(0.005, 10);
        // No terminal: the run is suspended, not dead.
        expect(journal.entries("terminal")).toHaveLength(0);
      } finally {
        journal.close();
      }
    }

    // DX-7: top up and continue to the (explicit) end of the run.
    await runner.resume(handle.runId, { addBudgetUsd: 0.05 });
    const finished = await awaitStatus(
      handle,
      (r) => TERMINAL_STATUSES.includes(r.status),
      "run end after top-up",
    );
    expect(finished.status).toBe("FAILED"); // judge never fires (cadence 50) → maxSteps terminal
    expect(finished.budgetUsd).toBeCloseTo(0.075, 10);
    expect(finished.currentStep).toBe(4);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const kinds = journal.entries("budget_event").map(
        (e) => (e.payload as { event: string }).event,
      );
      expect(kinds).toEqual(["halt", "top_up"]);
      expect(journal.entries("step")).toHaveLength(4);
      expect(journal.entries("terminal")).toHaveLength(1);
    } finally {
      journal.close();
    }
  });

  test("token gate (WP-218): budgetTokens breach → token HALT + resumable FAILED (no USD top-up channel)", async () => {
    // 600 tokens/step; budget 1000 covers step 1 (est 0), blocks step 2
    // (est 600×1.5=900 > remaining 400). USD budget is generous — only the
    // token gate trips, proving CG-2 governance on a $0-metered run.
    const { repoUrl, dataDir, runner } = await setup({ tokensPerStep: 600 });
    const spec = makeSpec({
      repoUrl,
      budgetUsd: 100,
      budgetTokens: 1000,
      maxSteps: 4,
      judge: { family: "gemini", cadence: 50 },
    });

    const handle = await runner.start(spec);
    const finished = await awaitStatus(
      handle,
      (r) => TERMINAL_STATUSES.includes(r.status),
      "token-budget terminal",
    );
    // Sealed FAILED after exactly one paid step — the pre-step gate blocked #2.
    expect(finished.status).toBe("FAILED");
    expect(finished.currentStep).toBe(1);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("step")).toHaveLength(1);
      const events = journal.entries("budget_event");
      expect(events).toHaveLength(1);
      const payload = events[0]!.payload as {
        event: string;
        cause?: string;
        remainingTokens?: number;
        details: Record<string, number>;
      };
      expect(payload.event).toBe("halt");
      expect(payload.cause).toBe("tokens");
      expect(payload.remainingTokens).toBe(400); // 1000 budget − 600 spent
      expect(payload.details.spentTokens).toBe(600);
      expect(payload.details.budgetTokens).toBe(1000);
      // Resumable terminal — the run sealed FAILED, not spun.
      expect(journal.entries("terminal")).toHaveLength(1);
    } finally {
      journal.close();
    }
  });

  test("loop-breaker: 3 consecutive FAILED steps → ESCALATE (never spin); approve continues, reject seals FAILED", async () => {
    const { repoUrl, dataDir, runner } = await setup({ failAll: true });
    const spec = makeSpec({
      repoUrl,
      maxSteps: 20,
      judge: { family: "gemini", cadence: 50 },
    });

    const handle = await runner.start(spec);
    const awaiting = await awaitStatus(
      handle,
      (r) => r.status === "AWAITING_APPROVAL",
      "first escalation",
    );
    // Escalated after exactly MAX_CONSECUTIVE_FAILURES steps — no spinning.
    expect(awaiting.currentStep).toBe(3);

    // Human says push on → failures reset, loop continues, escalates again.
    await handle.approve({ approved: true, reason: "try again" });
    const second = await awaitStatus(
      handle,
      (r) => r.status === "AWAITING_APPROVAL" && r.currentStep === 6,
      "second escalation",
    );
    expect(second.currentStep).toBe(6);

    // Human gives up → explicit FAILED terminal with the escalation reason.
    await handle.approve({ approved: false, reason: "hopeless" });
    const finished = await awaitStatus(
      handle,
      (r) => TERMINAL_STATUSES.includes(r.status),
      "terminal after rejection",
    );
    expect(finished.status).toBe("FAILED");
    expect(finished.failure?.reason).toContain("escalation rejected: hopeless");
    expect(finished.failure?.reason).toContain("3 consecutive steps");
    expect(finished.failure?.lastCheckpoint).toBe(`${handle.runId}@${finished.checkpoints[5]!.journalIdx}`);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      // Exactly 6 attempts ever ran (3 per escalation round) — CG-1 holds.
      expect(journal.entries("step")).toHaveLength(6);
      const verdicts = journal.entries("verdict");
      expect(verdicts).toHaveLength(2);
      for (const v of verdicts) {
        const payload = v.payload as { source: string; verdict: { kind: string } };
        expect(payload.source).toBe("runner");
        expect(payload.verdict.kind).toBe("ESCALATE");
      }
      const terminal = journal.entries("terminal")[0]!.payload as { status: string };
      expect(terminal.status).toBe("FAILED");
    } finally {
      journal.close();
    }
  });
});
