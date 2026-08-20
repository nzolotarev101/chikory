/**
 * WP-132 — verdict gating in the runner: every verdict path exercised
 * through the REAL judgeStep activity (evidence collection, JD-4 overrides,
 * deterministic verdict) against a fake openai-compat wire serving scripted
 * `JudgeForm`s. ROLLBACK restores git state, HALT seals a resumable FAILED,
 * ESCALATE parks the run for `chikory approve`.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  scanDiffForLayeringViolations,
  workspaceDir,
  type RemediationPayload,
  type RunHandle,
  type RunStatusReport,
  type TaskSpec,
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
  type ScriptedConfig,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const ARCHITECTURE_SCAN_HEADER = "## EVIDENCE — deterministic architecture scan (added diff lines)";

describe.skipIf(address === null)("verdict gating (WP-132)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, scripted: Partial<ScriptedConfig> = {}) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-gating-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"), scripted);
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

  function verdictKinds(dataDir: string, runId: string): string[] {
    const journal = new Journal(journalPath(dataDir, runId));
    try {
      // Per-step judge sequence only — the seal-time completion review rides
      // its own `source: "completion-review"` verdict entry.
      return journal
        .entries("verdict")
        .map((e) => e.payload as VerdictPayload)
        .filter((p) => p.source !== "completion-review")
        .map((p) => p.verdict.kind);
    } finally {
      journal.close();
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function judgeUserContent(requestBody: string): string {
    const parsed: unknown = JSON.parse(requestBody);
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
      throw new Error("fake judge request body did not include messages");
    }
    const userMessage = parsed.messages.find(
      (message): message is { role: string; content: string } =>
        isRecord(message) &&
        message.role === "user" &&
        typeof message.content === "string",
    );
    if (userMessage === undefined) {
      throw new Error("fake judge request body did not include a user message");
    }
    return userMessage.content;
  }

  function architectureSection(userContent: string): string {
    const start = userContent.indexOf(ARCHITECTURE_SCAN_HEADER);
    expect(start).toBeGreaterThanOrEqual(0);
    const sectionStart = start + ARCHITECTURE_SCAN_HEADER.length;
    const nextSection = userContent.indexOf("\n## ", sectionStart);
    return userContent.slice(sectionStart, nextSection === -1 ? undefined : nextSection).trim();
  }

  async function run(
    wire: FakeJudgeWire,
    specOverrides: Partial<TaskSpec> & { cadence?: number },
    scripted: Partial<ScriptedConfig> = {},
  ) {
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire, scripted);
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 10, cadence: 1, ...specOverrides });
    const handle = await runner.start(spec);
    return { dataDir, handle };
  }

  test("ROLLBACK with no PROCEED yet restores the run base; loop continues to SUCCESS", async () => {
    const wire = await startFakeJudgeWire([
      // pass 1: destructive rubric fail → ROLLBACK to <runId>@base.
      // WP-607: the lever must be a destructive item the MODEL still settles.
      // `no_secrets_introduced` is now in DETERMINISTIC_RUBRIC_IDS, so the scan
      // (clean here) overrides the scripted ✗ and no ROLLBACK would ever open.
      judgeForm({ criteria: { "AC-1": false }, rubricFails: ["no_unrelated_deletions"] }),
      // pass 2: clean, criteria confirmed → PROCEED → SUCCESS.
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    const { dataDir, handle } = await run(wire, {});
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ROLLBACK", "PROCEED"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const rollback = (journal.entries("verdict")[0]!.payload as VerdictPayload).verdict;
      expect(rollback.rollbackTo).toBe(`${handle.runId}@base`);
      expect(journal.entries("step")).toHaveLength(2);
    } finally {
      journal.close();
    }

    // The restore really reverted the workspace: the scripted adapter's
    // attempt counter was wiped with the rest of step 1's work, so 2 executed
    // steps end at attempt "1".
    const count = await readFile(
      join(workspaceDir(dataDir, handle.runId), "scripted-count.txt"),
      "utf8",
    );
    expect(count).toBe("1");
  });

  test("ROLLBACK restores the last PROCEED-ed checkpoint", async () => {
    const wire = await startFakeJudgeWire([
      // pass 1: healthy work-in-progress → PROCEED (becomes lastGood).
      judgeForm({ criteria: { "AC-1": false } }),
      // pass 2: scope breach → ROLLBACK to the pass-1 checkpoint.
      judgeForm({ criteria: { "AC-1": false }, rubricFails: ["scope_matches_instruction"] }),
      // pass 3: confirmed → SUCCESS.
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    const { dataDir, handle } = await run(wire, {});
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["PROCEED", "ROLLBACK", "PROCEED"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const rollback = (journal.entries("verdict")[1]!.payload as VerdictPayload).verdict;
      // Target = the checkpoint covering judge pass 1 (the only lastGood).
      expect(rollback.rollbackTo).toBe(report.checkpoints[0]!.id);
      expect(journal.entries("step")).toHaveLength(3);
    } finally {
      journal.close();
    }

    // Step 2's work was reverted to the checkpoint-1 state (counter = 1),
    // then step 3 ran as attempt 2 — three executed steps end at "2".
    const count = await readFile(
      join(workspaceDir(dataDir, handle.runId), "scripted-count.txt"),
      "utf8",
    );
    expect(count).toBe("2");
  });

  test("HALT (criterion stuck 3 consecutive verdicts) heals once (WP-519), then seals a RESUMABLE FAILED (WP-520)", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
    const { dataDir, handle } = await run(wire, {});
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("judge HALT");
    expect(report.failure?.reason).toContain("AC-1");
    expect(report.failure?.reason).toContain("remediation exhausted");
    // ADR-009 D3: the first HALT grants ONE bounded remediation attempt
    // (journaled) before the second HALT seals — never a silent dead end.
    expect(verdictKinds(dataDir, handle.runId)).toEqual([
      "PROCEED",
      "PROCEED",
      "HALT",
      "HALT",
    ]);
    // The covering checkpoint was written before the seal — resumable state.
    expect(report.checkpoints).toHaveLength(4);
    // WP-646: the FAILED seal names the lastGood checkpoint (checkpoint 1), not the failing remediation attempt.
    expect(report.failure?.lastCheckpoint).toBe(report.checkpoints[1]!.id);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      expect(journal.entries("remediation")).toHaveLength(1);
      // WP-520: the seal is marked resumable — `chikory resume` re-enters it.
      const terminal = journal.entries("terminal")[0]!.payload as { resumable?: boolean };
      expect(terminal.resumable).toBe(true);
    } finally {
      journal.close();
    }
  });

  test("ESCALATE pauses for approval; approve resumes the loop", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["diff touches CI config"] }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    const { dataDir, handle } = await run(wire, {});

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );
    await handle.approve({ approved: true, reason: "CI change is intended" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE", "PROCEED"]);
  });

  test("F-154: approve on an out-of-rubric ESCALATE with all criteria passing force-seals SUCCESS", async () => {
    // The completion milestone: every acceptance criterion passes, but the judge
    // raises an advisory concern OUTSIDE the rubric → Rule 4 ESCALATE. Resuming
    // into RUNNING re-judges an empty diff, which re-raises the SAME concern —
    // the F-154 infinite approve loop. The fix seals SUCCESS on approve, so the
    // second (identical) form is NEVER consumed.
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": true }, concerns: ["prefers a different file layout"] }),
      judgeForm({ criteria: { "AC-1": true }, concerns: ["prefers a different file layout"] }),
    ]);
    const { dataDir, handle } = await run(wire, {});

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );
    await handle.approve({ approved: true, reason: "layout is fine" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    // Only the FIRST escalate was judged — the fix sealed on approve instead of
    // re-judging the empty diff into the same concern (no second ESCALATE).
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal")[0]!.payload as { status: string; reason?: string };
      expect(terminal.status).toBe("SUCCESS");
      expect(terminal.reason ?? "").toContain("approved out-of-rubric escalation");
    } finally {
      journal.close();
    }
  });

  test("F-229: UNATTENDED out-of-rubric ESCALATE over an EMPTY diff seals SUCCESS, not FAILED", async () => {
    // dogfood-121 `N-3` replayed. Every acceptance criterion passed, every
    // rubric item passed, the step produced a zero-byte diff, and the judge
    // objected only in free text about evidence an INCREMENTAL diff cannot
    // carry ("the diff is empty, so it provides no evidence the launcher was
    // added" — while the launcher sat committed one checkpoint earlier).
    // Unattended, that sealed FAILED; the chain auto-resumed, re-judged the
    // same empty tree, re-raised the same concern, sealed FAILED again, and
    // exhausted the node's replan budget. The run has CONVERGED — seal it.
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": true }, concerns: ["the diff is empty, so no evidence"] }),
      judgeForm({ criteria: { "AC-1": true }, concerns: ["the diff is empty, so no evidence"] }),
    ]);
    const { dataDir, handle } = await run(
      wire,
      { unattended: { escalation: "seal_resumable_failed" } },
      { emptyDiffSteps: [1] },
    );

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    // The second (identical) form is never consumed — no re-judge of the empty tree.
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal")[0]!.payload as { status: string; reason?: string };
      expect(terminal.status).toBe("SUCCESS");
      expect(terminal.reason ?? "").toContain("converged out-of-rubric escalation");
      // The concern is recorded in the seal, never silently dropped.
      expect(terminal.reason ?? "").toContain("the diff is empty, so no evidence");
    } finally {
      journal.close();
    }
  });

  test("F-271: the step that DELIVERS the last fix seals SUCCESS, empty diff or not", async () => {
    // dogfood-125 replayed, and the case that disproves the older premise that
    // convergence must be read off an empty diff alone. Step 4 delivered a
    // 632-byte fix that turned BOTH acceptance criteria and all six rubric
    // items green — the most converged state a run reaches — and the judge
    // added one free-text line ("no judge-executed full-suite result was
    // provided"). That sealed FAILED. Had the judge written nothing in that
    // field, the identical tree would have sealed SUCCESS: the outcome hung on
    // a prose remark, not on evidence. `allCriteriaPass && allRubricPass` is
    // the load-bearing signal; the diff's size is not.
    const wire = await startFakeJudgeWire([
      judgeForm({
        criteria: { "AC-1": true },
        concerns: ["no judge-executed full-suite result was provided"],
      }),
      // Never consumed: the seal fires on the escalating pass itself.
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    const { dataDir, handle } = await run(wire, {
      unattended: { escalation: "seal_resumable_failed" },
    });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal")[0]!.payload as { status: string; reason?: string };
      expect(terminal.status).toBe("SUCCESS");
      expect(terminal.reason ?? "").toContain("converged out-of-rubric escalation");
      // The concern survives into the seal — sealing SUCCESS never drops it.
      expect(terminal.reason ?? "").toContain("no judge-executed full-suite result was provided");
    } finally {
      journal.close();
    }
  });

  test("F-271: an out-of-rubric ESCALATE with a criterion still UNMET seals FAILED unattended", async () => {
    // The guard the empty-diff condition was standing in for. Here the executor
    // HAS something to answer — AC-1 is not met — so a first advisory concern
    // must not end the run early. Convergence is read from the criteria and the
    // rubric, never from the escalate class alone.
    const wire = await startFakeJudgeWire([
      judgeForm({
        criteria: { "AC-1": false },
        concerns: ["horizon claim is not supported"],
      }),
    ]);
    const { dataDir, handle } = await run(wire, {
      unattended: { escalation: "seal_resumable_failed" },
    });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("unattended judge escalation");
    expect(report.failure?.reason).toContain("horizon claim is not supported");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE"]);
  });

  test("F-229: an ATTENDED out-of-rubric ESCALATE over an empty diff still awaits the operator", async () => {
    // The carve-out replaces only the seal that fires with nobody there to
    // answer. An operator who asked to adjudicate still gets asked, and F-154
    // seals SUCCESS the moment they approve.
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": true }, concerns: ["prefers a different file layout"] }),
    ]);
    const { dataDir, handle } = await run(wire, {}, { emptyDiffSteps: [1] });

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );
    await handle.approve({ approved: true, reason: "layout is fine" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal")[0]!.payload as { reason?: string };
      // F-154's wording, not F-229's — the operator adjudicated.
      expect(terminal.reason ?? "").toContain("approved out-of-rubric escalation");
    } finally {
      journal.close();
    }
  });

  test("ESCALATE + reasoned reject heals into remediation and continues execution (WP-602)", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["unexplained dependency swap"] }),
      judgeForm({ criteria: { "AC-1": true } }),
    ]);
    const { dataDir, handle } = await run(wire, {});

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );
    await handle.approve({ approved: false, reason: "not acceptable: undo dependency swap" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("SUCCESS");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const remediations = journal.entries("remediation");
      expect(remediations).toHaveLength(1);
      expect((remediations[0]!.payload as RemediationPayload).brief).toContain("not acceptable: undo dependency swap");
    } finally {
      journal.close();
    }
  });

  test("ESCALATE + reject with opt-out (maxRejectStrikes 0) seals FAILED naming rejection", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["unexplained dependency swap"] }),
    ]);
    const { handle } = await run(wire, { maxRejectStrikes: 0 });

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );
    await handle.approve({ approved: false, reason: "not acceptable" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toMatch(/reject/i);
  });

  test("unattended ESCALATE seals FAILED on a resumable checkpoint instead of awaiting approval", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["chunk scope is ambiguous"] }),
    ]);
    const { dataDir, handle } = await run(wire, {
      unattended: { escalation: "seal_resumable_failed" },
    });

    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("unattended judge escalation");
    expect(report.failure?.reason).toContain("chunk scope is ambiguous");
    expect(report.checkpoints).toHaveLength(1);
    expect(report.failure?.lastCheckpoint).toBe(report.checkpoints[0]!.id);
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["ESCALATE"]);
  });

  test("JD-4 end-to-end: judge-executed check overrides a lying form; run seals SUCCESS only via PROCEED", async () => {
    // The form claims AC-1 fails, but the judge RUNS the check itself —
    // step 1 wrote step-1.txt, the check exits 0, the override flips it.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
    const { dataDir, handle } = await run(wire, {
      acceptanceCriteria: [
        { id: "AC-1", description: "step file exists", check: "test -f step-1.txt" },
      ],
    });
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(report.currentStep).toBe(1);
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["PROCEED"]);

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const verdict = (journal.entries("verdict")[0]!.payload as VerdictPayload).verdict;
      expect(verdict.form.criterionResults[0]).toMatchObject({ id: "AC-1", pass: true });
      expect(verdict.form.criterionResults[0]!.justification).toContain("exited 0");
      // tests_pass rubric answer is judge-executed too.
      const testsPass = verdict.form.rubricResults.find((r) => r.id === "tests_pass");
      expect(testsPass?.pass).toBe(true);
    } finally {
      journal.close();
    }
  });

  test("architecture scan evidence reaches the live judge prompt", async () => {
    const forbiddenImportDiff = [
      "diff --git a/src/judge/rubric.ts b/src/judge/rubric.ts",
      "+++ b/src/judge/rubric.ts",
      '+import { createRunnerWorker } from "../runner/worker.js";',
    ].join("\n");
    const architectureLabels = scanDiffForLayeringViolations(forbiddenImportDiff);
    expect(architectureLabels).toEqual(["judge→runner"]);

    const violatingWire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    const { dataDir: violatingDataDir, handle: violatingHandle } = await run(violatingWire, {
      maxSteps: 1,
      debug: {
        seedBadDiff: {
          atStep: 0,
          path: "src/judge/rubric.ts",
          content: 'import { createRunnerWorker } from "../runner/worker.js";\n',
        },
      },
    });
    const violatingReport = await awaitTerminal(violatingHandle);

    // WP-607: the label no longer only DECORATES the prompt — a machine-settled
    // architecture failure that survives the bounded repair now blocks the seal.
    // Before WP-607 this same run sealed SUCCESS with the breach on disk.
    expect(violatingReport.status).toBe("FAILED");
    const violatingJournal = new Journal(journalPath(violatingDataDir, violatingHandle.runId));
    try {
      const terminal = violatingJournal.entries("terminal").at(-1)!.payload as { reason?: string };
      expect(terminal.reason).toContain("no_architecture_violations");
    } finally {
      violatingJournal.close();
    }
    // Two passes now: the step judge pass, then the completion review the
    // machine-settled failure triggers before the gate seals FAILED.
    expect(violatingWire.requests).toHaveLength(2);
    expect(architectureSection(judgeUserContent(violatingWire.requests[0]!))).toBe(
      "- judge→runner",
    );

    const cleanDiff = [
      "diff --git a/src/judge/rubric.ts b/src/judge/rubric.ts",
      "+++ b/src/judge/rubric.ts",
      '+import { buildJudgeMessages } from "./prompt.js";',
    ].join("\n");
    const cleanArchitectureLabels = scanDiffForLayeringViolations(cleanDiff);
    expect(cleanArchitectureLabels).toEqual([]);

    const cleanWire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    const { handle: cleanHandle } = await run(cleanWire, { maxSteps: 1 });
    const cleanReport = await awaitTerminal(cleanHandle);

    expect(cleanReport.status).toBe("SUCCESS");
    expect(cleanWire.requests).toHaveLength(1);
    expect(architectureSection(judgeUserContent(cleanWire.requests[0]!))).toBe("(none)");
  });

  // ─── WP-244 deterministic judge-catch seam (dogfood-045 F-46) ──────────────
  // The judge-catch analog of WP-243's park seam: instead of HOPING the
  // executor introduces a regression (non-deterministic — a strong executor
  // one-shots the trap, as in dogfood-045), `spec.debug.seedBadDiff` overwrites
  // a workspace file with known-wrong content right after the chosen step, so
  // the real-time judge MUST catch it via its acceptance `check` (whose exit
  // code overrides the LLM form). These two tests share a spec; the ONLY
  // difference is whether the seam is armed — isolating the seam as the cause
  // of the catch.
  const NO_MARKER_CHECK = "sh -c '! grep -q CORRUPTED-BY-SEAM step-1.txt'";

  test("seedBadDiff DISARMED (control): the AC check passes, run seals SUCCESS", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    const { dataDir, handle } = await run(wire, {
      maxSteps: 2,
      acceptanceCriteria: [
        { id: "AC-1", description: "no CORRUPTED-BY-SEAM marker in step-1.txt", check: NO_MARKER_CHECK },
      ],
    });
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["PROCEED"]);
    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const verdict = (journal.entries("verdict")[0]!.payload as VerdictPayload).verdict;
      expect(verdict.form.criterionResults[0]).toMatchObject({ id: "AC-1", pass: true });
    } finally {
      journal.close();
    }
  });

  test("seedBadDiff ARMED: the seam corrupts step-1.txt, the judge CATCHES it (AC-1 fails), run does NOT seal SUCCESS", async () => {
    // Fake form lies "AC-1 passes" — but the judge-executed check sees the
    // seeded marker and exits 1, overriding the form to a fail. That override
    // is the true-positive catch the product exists to demonstrate, forced
    // deterministically regardless of executor skill.
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": true } })]);
    const { dataDir, handle } = await run(wire, {
      maxSteps: 2,
      acceptanceCriteria: [
        { id: "AC-1", description: "no CORRUPTED-BY-SEAM marker in step-1.txt", check: NO_MARKER_CHECK },
      ],
      debug: { seedBadDiff: { atStep: 0, path: "step-1.txt", content: "CORRUPTED-BY-SEAM\n" } },
    });
    const report = await awaitTerminal(handle);

    // The regression never lands as SUCCESS — it is caught every pass and the
    // run exhausts maxSteps (the scripted executor cannot self-correct; a real
    // executor would fix it from the judge feedback, as dogfood-046 shows).
    expect(report.status).toBe("FAILED");
    // A single non-destructive criterion fail → PROCEED verdict, but allCriteria
    // do NOT pass, so the runner refuses to seal SUCCESS (the catch).
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["PROCEED", "PROCEED"]);

    // The seam activity actually mutated the workspace (proof the diff was injected).
    const seeded = await readFile(join(workspaceDir(dataDir, handle.runId), "step-1.txt"), "utf8");
    expect(seeded).toBe("CORRUPTED-BY-SEAM\n");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const verdict = (journal.entries("verdict")[0]!.payload as VerdictPayload).verdict;
      const ac1 = verdict.form.criterionResults.find((r) => r.id === "AC-1");
      expect(ac1?.pass).toBe(false); // overridden from the form's "true" by the real check
      expect(ac1?.justification).toContain("exited 1"); // judge-executed check caught it
    } finally {
      journal.close();
    }
  });
});
