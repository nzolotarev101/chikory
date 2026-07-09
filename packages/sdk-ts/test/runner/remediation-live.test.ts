/**
 * WP-519 + WP-520 (ADR-009 D3/D4) — the self-heal loop LIVE on Temporal:
 *
 * 1. Remediation-before-HALT: a rule-3 stuck criterion no longer dead-ends —
 *    the judge's diagnosis becomes a remediation brief, the workspace rolls
 *    back, ONE bounded retry runs and is re-judged off-cadence; a heal that
 *    works seals SUCCESS.
 * 2. Resumable FAILED: remediation exhausted seals a *resumable* FAILED;
 *    `runner.resume` re-starts the workflow over the same journal, the run
 *    reopens with the failure evidence in context, gets a fresh heal budget,
 *    and can finish the job. Dead seals refuse resume with the way forward.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  reportFromJournal,
  type RunHandle,
  type RunStatusReport,
  type StepPayload,
  type TaskSpec,
  type TemporalRunner,
  type VerdictPayload,
} from "../../src/index.js";
import {
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  scriptedRegistry,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
  type FakeJudgeWire,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

describe.skipIf(address === null)("remediation-before-HALT + resumable FAILED (WP-519/520)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire) {
    cleanups.push(() => wire.close());
    const tmp = await mkdtemp(join(tmpdir(), "chikory-remediation-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    // echoJudgeFeedback: step summaries prove WHAT context each step saw.
    const repoUrl = await initSourceRepo(join(tmp, "src"), { echoJudgeFeedback: true });
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const worker = await createRunnerWorker({
      adapters: scriptedRegistry,
      address: address!,
      taskQueue,
      dataDir,
      workflowBundlePath: bundlePath!,
      routerOptions: { baseUrls: { "openai-compat": wire.url } },
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

  async function awaitTerminal(handle: RunHandle): Promise<RunStatusReport> {
    return waitFor(
      async () => {
        const report = await handle.status();
        return TERMINAL_STATUSES.includes(report.status) ? report : undefined;
      },
      { what: "run to reach a terminal status" },
    );
  }

  async function start(
    wire: FakeJudgeWire,
    specOverrides: Partial<TaskSpec> & { cadence?: number },
  ): Promise<{ dataDir: string; runner: TemporalRunner; handle: RunHandle }> {
    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 10, cadence: 1, ...specOverrides });
    const handle = await runner.start(spec);
    return { dataDir, runner, handle };
  }

  function journalRead<T>(dataDir: string, runId: string, fn: (journal: Journal) => T): T {
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      return fn(journal);
    } finally {
      journal.close();
    }
  }

  test("a heal that works: rule-3 HALT → brief + rollback + ONE retry → re-judged → SUCCESS", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false } }), // pass 1 — PROCEED (1 fail)
      judgeForm({ criteria: { "AC-1": false } }), // pass 2 — PROCEED (2 fails)
      judgeForm({ criteria: { "AC-1": false } }), // pass 3 — HALT (3 consecutive) → remediation
      judgeForm({ criteria: { "AC-1": true } }), // pass 4 — the healed retry, PROCEED → SUCCESS
    ]);
    const { dataDir, handle } = await start(wire, {});
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    journalRead(dataDir, handle.runId, (journal) => {
      const kinds = journal
        .entries("verdict")
        .map((e) => (e.payload as VerdictPayload).verdict.kind);
      expect(kinds).toEqual(["PROCEED", "PROCEED", "HALT", "PROCEED"]);

      // Exactly one journaled heal attempt, carrying trigger + brief +
      // the last-good rollback target (ADR-009 D1: journaled, bounded).
      const remediations = journal.entries("remediation");
      expect(remediations).toHaveLength(1);
      const payload = remediations[0]!.payload as {
        remediationIndex: number;
        atStep: number;
        trigger: string;
        brief: string;
        rollbackTo?: string;
      };
      expect(payload.trigger).toContain("AC-1");
      expect(payload.brief).toContain("REMEDIATION BRIEF");
      expect(payload.rollbackTo).toBe(report.checkpoints[1]!.id); // last PROCEED-covered checkpoint

      // The remediation step actually SAW the brief (echoJudgeFeedback).
      const steps = journal.entries("step").map((e) => e.payload as StepPayload);
      expect(steps).toHaveLength(4);
      expect(steps[3]!.record.summary).toContain("REMEDIATION BRIEF");

      // WP-519 slice (a): the step after an ordinary failing PROCEED pass saw
      // the failing-criterion evidence too — feedback is no longer
      // milestone-only.
      expect(steps[1]!.record.summary).toContain("unmet acceptance criteria");
      expect(steps[1]!.record.summary).toContain("AC-1");
    });
  });

  test("remediation exhausted → resumable FAILED; resume reopens, heals fresh, seals SUCCESS", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false } }), // pass 1 — PROCEED
      judgeForm({ criteria: { "AC-1": false } }), // pass 2 — PROCEED
      judgeForm({ criteria: { "AC-1": false } }), // pass 3 — HALT → remediation attempt 1
      judgeForm({ criteria: { "AC-1": false } }), // pass 4 — still stuck → resumable FAILED
      judgeForm({ criteria: { "AC-1": false } }), // pass 5 — resumed incarnation, HALT again → fresh heal
      judgeForm({ criteria: { "AC-1": true } }), // pass 6 — healed → SUCCESS
    ]);
    const { dataDir, runner, handle } = await start(wire, {});
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("judge HALT");
    expect(report.failure?.reason).toContain("remediation exhausted");
    journalRead(dataDir, handle.runId, (journal) => {
      const terminal = journal.entries("terminal")[0]!.payload as {
        resumable?: boolean;
        remediation?: { attempts: number; brief: string };
      };
      expect(terminal.resumable).toBe(true);
      expect(terminal.remediation?.attempts).toBe(1);
      expect(terminal.remediation?.brief).toContain("REMEDIATION BRIEF");
    });

    // WP-520: `resume` on the resumable seal re-starts the workflow over the
    // same journal — reopened, evidence in context, fresh heal budget.
    const resumed = await runner.resume(handle.runId);
    const resumedReport = await awaitTerminal(resumed);
    expect(resumedReport.status).toBe("SUCCESS");

    journalRead(dataDir, handle.runId, (journal) => {
      // Two incarnations, two seals — FAILED first, SUCCESS last; the reopen
      // control_event marks the boundary between them.
      const terminals = journal.entries("terminal");
      expect(terminals).toHaveLength(2);
      expect((terminals[0]!.payload as { status: string }).status).toBe("FAILED");
      expect((terminals[1]!.payload as { status: string }).status).toBe("SUCCESS");
      const reopens = journal.entries("control_event").filter((entry) => {
        const payload = entry.payload as { event?: string; source?: string };
        return payload.event === "resume" && payload.source === "failed_seal";
      });
      expect(reopens).toHaveLength(1);
      expect(reopens[0]!.idx).toBeGreaterThan(terminals[0]!.idx);
      expect(reopens[0]!.idx).toBeLessThan(terminals[1]!.idx);

      // One heal attempt per incarnation (the resume granted a fresh budget).
      expect(journal.entries("remediation")).toHaveLength(2);

      // The first resumed step re-entered WITH the seal's failure evidence.
      const steps = journal.entries("step").map((e) => e.payload as StepPayload);
      expect(steps).toHaveLength(6);
      expect(steps[4]!.record.summary).toContain("resuming after a resumable FAILED seal");

      // The journal-derived report no longer shows the stale failure.
      expect(reportFromJournal(journal)?.status).toBe("SUCCESS");
      expect(reportFromJournal(journal)?.failure).toBeUndefined();
    });
  });

  test("a dead FAILED refuses resume with the way forward; SUCCESS refuses too", async () => {
    // maxSteps exhaustion is a dead seal: a re-entry would only re-seal
    // (the spec is frozen in the journal), so resume must refuse.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
    const { runner, handle } = await start(wire, { maxSteps: 1 });
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("maxSteps");
    await expect(runner.resume(handle.runId)).rejects.toThrow(/dead FAILED.*not resumable/s);
    await expect(runner.resume(handle.runId)).rejects.toThrow(/chikory branch/);
  });
});
