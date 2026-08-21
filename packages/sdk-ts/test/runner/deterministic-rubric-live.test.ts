/**
 * WP-607 live proof — a machine-settled rubric finding blocks the SUCCESS seal.
 *
 * The violation MUST be introduced by a STEP, not seeded into the source repo.
 * The evidence pipeline scans the workspace diff against `chikory-base`, so a
 * violation already present in the base produces no added diff line, no label,
 * and nothing for the gate to fire on. `scriptedRegistry` writes only
 * `step-<n>.txt` at the workspace root, which maps to no layer — hence the local
 * adapter below, which writes a `src/`-pathed file so the REAL scan sees a REAL
 * import edge (dogfood-134 F-318).
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, inject, test } from "vitest";

import {
  createRunnerWorker,
  createTemporalRunner,
  Journal,
  journalPath,
  RUBRIC_CUMULATIVE_DESIGN_COHERENT,
  RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
  type AdapterRegistry,
  type RunHandle,
  type RunStatusReport,
  type VerdictPayload,
} from "../../src/index.js";
import {
  completionReviewForm,
  initSourceRepo,
  judgeForm,
  makeJudgedSpec,
  startFakeJudgeWire,
  TERMINAL_STATUSES,
  waitFor,
  type FakeJudgeWire,
} from "./helpers.js";

const address = inject("temporalAddress");
const bundlePath = inject("workflowBundlePath");

const ARCH = "no_architecture_violations";
/** `src/types.ts` is CORE; `src/judge/` is a higher layer → a forbidden edge. */
const VIOLATING_IMPORT = "./judge/harness.js";
const CLEAN_IMPORT = "./util/deep-equal.js";

/** Writes a `src/`-pathed file each step so the real layering scan has real input. */
function importingRegistry(specifier: string): AdapterRegistry {
  return {
    scripted: (ctx) => ({
      name: "scripted",
      modelFamily: "anthropic" as const,
      async runStep(input) {
        const file = join(input.workspaceDir, "src/types.ts");
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `import type { X } from "${specifier}";\nexport type Y = X;\n`);
        const [diffRef, transcriptRef] = await Promise.all([
          ctx.store.put("adapter diff", { kind: "diff", summary: "adapter diff" }),
          ctx.store.put("adapter transcript", { kind: "transcript", summary: "t" }),
        ]);
        return {
          status: "SUCCESS" as const,
          diffRef,
          transcriptRef,
          claimsComplete: true,
          summary: `added src/types.ts importing ${specifier}`,
          toolCalls: 1,
          tokens: { input: 100, output: 50 },
          costUsd: 0.01,
          costEstimated: false,
          durationMs: 0,
        };
      },
    }),
  };
}

describe.skipIf(address === null)("WP-607: a machine-settled finding gates the seal", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function setup(wire: FakeJudgeWire, specifier: string) {
    const tmp = await mkdtemp(join(tmpdir(), "chikory-det-rubric-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const repoUrl = await initSourceRepo(join(tmp, "src"), {});
    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const worker = await createRunnerWorker({
      adapters: importingRegistry(specifier),
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

  /**
   * All step forms answer the architecture item ✓ — only the SCAN may fail it.
   *
   * `firstPassWithheld` makes judge pass 1 withhold AC-1 so the run takes a
   * second step. That matters for the review path: `decideCompletionReview`
   * SKIPS the review on a first-verdict seal whose rubric is clean, so a
   * clean-diff scenario that must reach the review cannot seal on pass 1.
   */
  function allPassWire(reviewFails: string[] = [], firstPassWithheld = false): Promise<FakeJudgeWire> {
    return startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": !firstPassWithheld } }),
        judgeForm({ criteria: { "AC-1": true } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: reviewFails }),
          completionReviewForm({ rubricFails: reviewFails }),
        ],
      },
    );
  }

  test("Scenario 1: a step's live architecture violation blocks the SUCCESS seal, opens NO ROLLBACK, keeps the work on disk, and reaches FAILED unattended", async () => {
    const wire = await allPassWire();
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire, VIOLATING_IMPORT);

    const handle = await runner.start(makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 }));
    const report = await awaitTerminal(handle);

    // The model said the item was fine; the scan settles it and the run does NOT seal SUCCESS.
    expect(report.status).toBe("FAILED");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
      };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.reason).toContain(ARCH);

      // Blocking is not rolling back (trap A).
      const verdicts = journal.entries("verdict").map((e) => (e.payload as VerdictPayload).verdict);
      expect(verdicts.filter((v) => v.kind === "ROLLBACK")).toHaveLength(0);

      // Bounded repair: 1 repair attempt granted, then seals FAILED when unresolved.
      expect(journal.entries("step").length).toBe(2);
    } finally {
      journal.close();
    }

    // The work survives — the run's own file is still on disk.
    const workspaceTypes = await readFile(
      join(dataDir, "runs", handle.runId, "workspace", "src", "types.ts"),
      "utf8",
    );
    expect(workspaceTypes).toContain(VIOLATING_IMPORT);
  }, 180_000);

  test("Scenario 2: the identical run with a CLEAN import seals SUCCESS", async () => {
    const wire = await allPassWire();
    cleanups.push(() => wire.close());
    const { repoUrl, runner } = await setup(wire, CLEAN_IMPORT);

    const handle = await runner.start(makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 }));
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
  }, 180_000);

  test("Scenario 3: a clean run whose completion review fails only model design items seals FAILED (resumable) when repair attempt does not resolve the finding", async () => {
    const wire = await allPassWire(
      [RUBRIC_DESIGN_SERVES_OVERALL_GOAL, RUBRIC_CUMULATIVE_DESIGN_COHERENT],
      true,
    );
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire, CLEAN_IMPORT);

    const handle = await runner.start(makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 }));
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
        resumable?: boolean;
      };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.resumable).toBe(true);
      expect(terminal.reason).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
      expect(terminal.reason).toContain(RUBRIC_CUMULATIVE_DESIGN_COHERENT);
    } finally {
      journal.close();
    }
  }, 180_000);

  test("Scenario 4: Scenario A dogfood-163 replay — temporary violation and widened import restored on step 2 seals SUCCESS", async () => {
    let stepCount = 0;
    const wire = await startFakeJudgeWire(
      [
        judgeForm({ criteria: { "AC-1": true } }),
        judgeForm({ criteria: { "AC-1": true } }),
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [] }),
        ],
      },
    );
    cleanups.push(() => wire.close());

    const tmp = await mkdtemp(join(tmpdir(), "chikory-det-rubric-"));
    cleanups.push(() => rm(tmp, { recursive: true, force: true }));

    const repoUrl = await initSourceRepo(join(tmp, "src"), {});
    const srcWorkflow = join(tmp, "src", "src", "workflow");
    await mkdir(srcWorkflow, { recursive: true });
    await writeFile(
      join(srcWorkflow, "agent-loop.ts"),
      'import { advanceStrikeCount } from "../runner/strike-accounting.js";\nexport const loop = 1;\n',
    );
    const srcTypes = join(tmp, "src", "src");
    await writeFile(join(srcTypes, "types.ts"), "export type Clean = string;\n");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("git", ["-C", join(tmp, "src"), "add", "-A"]);
    await execFileAsync("git", ["-C", join(tmp, "src"), "commit", "-m", "seed initial"]);

    const dataDir = join(tmp, "data");
    const taskQueue = `tq-${randomUUID()}`;

    const worker = await createRunnerWorker({
      adapters: {
        scripted: (ctx) => ({
          name: "scripted",
          modelFamily: "anthropic" as const,
          async runStep(input) {
            stepCount += 1;
            if (stepCount === 1) {
              await writeFile(
                join(input.workspaceDir, "src/types.ts"),
                'import type { X } from "./judge/harness.js";\nexport type Clean = X;\n',
              );
              await writeFile(
                join(input.workspaceDir, "src/workflow/agent-loop.ts"),
                'import { advanceStrikeCount, extra } from "../runner/strike-accounting.js";\nexport const loop = 1;\n',
              );
            } else {
              await writeFile(join(input.workspaceDir, "src/types.ts"), "export type Clean = string;\n");
              await writeFile(
                join(input.workspaceDir, "src/workflow/agent-loop.ts"),
                'import { advanceStrikeCount } from "../runner/strike-accounting.js";\nexport const loop = 1;\n',
              );
            }
            const [diffRef, transcriptRef] = await Promise.all([
              ctx.store.put(`step ${stepCount} diff`, { kind: "diff", summary: "diff" }),
              ctx.store.put(`step ${stepCount} transcript`, { kind: "transcript", summary: "t" }),
            ]);
            return {
              status: "SUCCESS" as const,
              diffRef,
              transcriptRef,
              claimsComplete: true,
              summary: `step ${stepCount}`,
              toolCalls: 1,
              tokens: { input: 100, output: 50 },
              costUsd: 0.01,
              costEstimated: false,
              durationMs: 0,
            };
          },
        }),
      },
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

    const handle = await runner.start(makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 4 }));
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("SUCCESS");
  }, 180_000);

  test("Scenario 5: Scenario C — LLM-judged rubric row failing at sealing pass survives all-green completion review and is named in FAILED seal", async () => {
    const wire = await startFakeJudgeWire(
      [
        judgeForm({
          criteria: { "AC-1": true },
          rubricFails: [RUBRIC_DESIGN_SERVES_OVERALL_GOAL],
        }),
      ],
      {
        reviewForms: [
          completionReviewForm({ rubricFails: [] }),
        ],
      },
    );
    cleanups.push(() => wire.close());
    const { repoUrl, dataDir, runner } = await setup(wire, CLEAN_IMPORT);

    const handle = await runner.start(makeJudgedSpec({ repoUrl, cadence: 1, maxSteps: 1 }));
    const report = await awaitTerminal(handle);

    expect(report.status).toBe("FAILED");

    const journal = new Journal(journalPath(dataDir, handle.runId));
    try {
      const terminal = journal.entries("terminal").at(-1)!.payload as {
        status: string;
        reason?: string;
      };
      expect(terminal.status).toBe("FAILED");
      expect(terminal.reason).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
    } finally {
      journal.close();
    }
  }, 180_000);
});
