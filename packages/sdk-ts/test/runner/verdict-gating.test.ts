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
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");
const ARCHITECTURE_SCAN_HEADER = "## EVIDENCE — deterministic architecture scan (added diff lines)";

describe.skipIf(address === null)("verdict gating (WP-132)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-gating-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));
    const repoUrl = await initSourceRepo(join(tmp, "src"));
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
      return journal
        .entries("verdict")
        .map((e) => (e.payload as VerdictPayload).verdict.kind);
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

  async function run(wire: FakeJudgeWire, specOverrides: Partial<TaskSpec> & { cadence?: number }) {
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire);
    const spec = makeJudgedSpec({ repoUrl, maxSteps: 10, cadence: 1, ...specOverrides });
    const handle = await runner.start(spec);
    return { dataDir, handle };
  }

  test("ROLLBACK with no PROCEED yet restores the run base; loop continues to SUCCESS", async () => {
    const wire = await startFakeJudgeWire([
      // pass 1: destructive rubric fail → ROLLBACK to <runId>@base.
      judgeForm({ criteria: { "AC-1": false }, rubricFails: ["no_secrets_introduced"] }),
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

  test("HALT (criterion stuck 3 consecutive verdicts) seals FAILED on a resumable checkpoint", async () => {
    const wire = await startFakeJudgeWire([judgeForm({ criteria: { "AC-1": false } })]);
    const { dataDir, handle } = await run(wire, {});
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("judge HALT");
    expect(report.failure?.reason).toContain("AC-1");
    expect(verdictKinds(dataDir, handle.runId)).toEqual(["PROCEED", "PROCEED", "HALT"]);
    // The covering checkpoint was written before the seal — resumable state.
    expect(report.checkpoints).toHaveLength(3);
    expect(report.failure?.lastCheckpoint).toBe(report.checkpoints[2]!.id);
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

  test("ESCALATE + reject seals FAILED with the judge's reason", async () => {
    const wire = await startFakeJudgeWire([
      judgeForm({ criteria: { "AC-1": false }, concerns: ["unexplained dependency swap"] }),
    ]);
    const { dataDir, handle } = await run(wire, {});

    await waitFor(
      async () => ((await handle.status()).status === "AWAITING_APPROVAL" ? true : undefined),
      { what: "run to await approval" },
    );
    await handle.approve({ approved: false, reason: "not acceptable" });

    const report = await awaitTerminal(handle);
    expect(report.status).toBe("FAILED");
    expect(report.failure?.reason).toContain("judge escalation rejected");
    expect(report.failure?.reason).toContain("unexplained dependency swap");
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
    const { handle: violatingHandle } = await run(violatingWire, {
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

    expect(violatingReport.status).toBe("SUCCESS");
    expect(violatingWire.requests).toHaveLength(1);
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
  const NO_MARKER_CHECK = "! grep -q CORRUPTED-BY-SEAM step-1.txt";

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
