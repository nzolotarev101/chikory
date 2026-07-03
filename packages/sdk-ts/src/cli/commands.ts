/**
 * `chikory` command implementations (WP-141). Each command works against a
 * live local run: `run`/`resume` host the runner worker in-process (worker.ts
 * contract), `status` falls back to the on-disk journal when no server is
 * reachable, `trace` is journal-only (WP-142). Conventions per cli.md: exit
 * code mirrors SUCCESS/FAILED, `--json` everywhere, errors actionable.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createClaudeCodeAdapter,
  createCodexAdapter,
  createNativeAdapter,
} from "../executors/index.js";
import { Journal, reportFromJournal, runTotals } from "../journal/journal.js";
import type { RouterOptions } from "../router.js";
import { createTemporalRunner } from "../runner.js";
import type { AdapterRegistry } from "../runner/activities.js";
import { journalPath } from "../runner/paths.js";
import { createRunnerWorker } from "../runner/worker.js";
import { parseTaskSpec, TaskSpecValidationError } from "../taskspec.js";
import type { RunHandle, RunStatus, RunStatusReport, TaskSpec } from "../types.js";
import { evaluateSpecStalenessPrecheck } from "./spec-staleness-precheck.js";
import { formatEntryLine, renderStepDetail, renderTrace, traceJson } from "./trace.js";

/** The executor adapters that ship in P1 (ADR-003; WP-112/113; WP-213). */
export const ADAPTERS: AdapterRegistry = {
  "claude-code": (ctx) => createClaudeCodeAdapter({ store: ctx.store, model: ctx.model }),
  codex: (ctx) => createCodexAdapter({ store: ctx.store, model: ctx.model }),
  native: (ctx) => {
    if (!ctx.createCodeRouter || !ctx.modelFamily) {
      throw new Error("native adapter requires createCodeRouter and modelFamily");
    }
    return createNativeAdapter({
      store: ctx.store,
      router: ctx.createCodeRouter(),
      modelFamily: ctx.modelFamily,
    });
  },
};

export const DEFAULT_ADAPTERS: AdapterRegistry = ADAPTERS;

const TERMINAL: ReadonlySet<RunStatus> = new Set(["SUCCESS", "FAILED", "CANCELLED"]);

export interface CliDeps {
  /** Executor registry override (tests run the scripted adapter). */
  adapters?: AdapterRegistry;
  /** Judge router seam (tests route at a fake openai-compat wire). */
  routerOptions?: RouterOptions;
  /** Pre-bundled workflow code (tests bundle once in global setup). */
  workflowBundlePath?: string;
  /** Task queue override (tests isolate runs on per-test queues). */
  taskQueue?: string;
  /** Optional plan.md reader for launch prechecks (tests can inject fixture text). */
  readPlanText?: () => Promise<string>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Status/journal poll cadence for run/resume/--watch. */
  pollIntervalMs?: number;
}

export interface CommonFlags {
  json: boolean;
  dataDir: string;
  address?: string;
}

interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

function io(deps: CliDeps): Io {
  return {
    out: deps.out ?? ((line) => console.log(line)),
    err: deps.err ?? ((line) => console.error(line)),
  };
}

function actionable(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|Failed to connect|14 UNAVAILABLE|Connection refused/i.test(message)) {
    return `${message}\nIs the Temporal dev server up? Start it with: devbox run temporal-dev`;
  }
  return message;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readPlanText(deps: CliDeps): Promise<string | null> {
  try {
    return deps.readPlanText !== undefined ? await deps.readPlanText() : await readFile("plan.md", "utf8");
  } catch {
    return null;
  }
}

function journalReport(dataDir: string, runId: string): RunStatusReport | undefined {
  const path = journalPath(dataDir, runId);
  if (!existsSync(path)) return undefined;
  const journal = new Journal(path);
  try {
    return reportFromJournal(journal);
  } finally {
    journal.close();
  }
}

/**
 * Poll the run until a terminal status, surfacing state transitions (and,
 * with --watch, every new journal entry) as they land. The run itself is
 * durable — ctrl-C only detaches this process; `chikory resume` reattaches.
 */
export async function followRun(
  handle: RunHandle,
  flags: CommonFlags,
  opts: { watch: boolean; deps: CliDeps; io: Io },
): Promise<RunStatusReport> {
  const interval = opts.deps.pollIntervalMs ?? 1000;
  const path = journalPath(flags.dataDir, handle.runId);
  let nextEntryIdx = 0;

  function drainJournal(): void {
    if (!existsSync(path)) return;
    const journal = new Journal(path);
    try {
      for (const entry of journal.entries()) {
        if (entry.idx < nextEntryIdx) continue;
        nextEntryIdx = entry.idx + 1;
        if (opts.watch) opts.io.out(formatEntryLine(entry));
        if (entry.kind === "budget_event") {
          const payload = entry.payload as {
            event: string;
            details: { spentUsd: number; budgetUsd: number };
          };
          if (payload.event === "halt") {
            opts.io.out(
              `run is SUSPENDED at the budget cap ($${payload.details.spentUsd.toFixed(2)} of ` +
                `$${payload.details.budgetUsd.toFixed(2)}) — top up with: chikory resume ` +
                `${handle.runId} --add-budget <usd>`,
            );
          }
        } else if (entry.kind === "verdict") {
          const payload = entry.payload as {
            verdict: { kind: string; escalateReason?: string };
          };
          if (payload.verdict.kind === "ESCALATE") {
            const reason = payload.verdict.escalateReason;
            if (typeof reason === "string" && reason.length > 0) {
              opts.io.out(`judge escalated: ${reason}`);
            }
            opts.io.out(
              `run is AWAITING_APPROVAL — answer with: chikory approve ${handle.runId} ` +
                `[--reject "<reason>"]`,
            );
          }
        }
      }
    } finally {
      journal.close();
    }
  }

  for (;;) {
    drainJournal();
    const report = await handle.status();
    if (TERMINAL.has(report.status)) {
      drainJournal();
      return report;
    }
    await sleep(interval);
  }
}

function finishRun(
  runId: string,
  report: RunStatusReport,
  flags: CommonFlags,
  { out }: Io,
): number {
  if (flags.json) {
    out(JSON.stringify({ runId, ...report }));
  } else {
    out(
      `run ${runId} · ${report.status} · ${report.currentStep} steps · ` +
        `$${report.spentUsd.toFixed(2)} / $${report.budgetUsd.toFixed(2)}`,
    );
    if (report.failure) out(`failure: ${report.failure.reason}`);
    out(`forensics: chikory trace ${runId}`);
  }
  return report.status === "SUCCESS" ? 0 : 1;
}

/** Host a worker + follow one run to its terminal status (run/resume core). */
async function hostAndFollow(
  flags: CommonFlags,
  watch: boolean,
  deps: CliDeps,
  ioPair: Io,
  attach: (runner: ReturnType<typeof createTemporalRunner>) => Promise<RunHandle>,
): Promise<number> {
  const worker = await createRunnerWorker({
    adapters: deps.adapters ?? DEFAULT_ADAPTERS,
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue: deps.taskQueue,
    routerOptions: deps.routerOptions,
    workflowBundlePath: deps.workflowBundlePath,
  });
  const workerDone = worker.run();
  const runner = createTemporalRunner({
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue: deps.taskQueue,
  });
  try {
    const handle = await attach(runner);
    if (!flags.json) {
      ioPair.out(`run-id: ${handle.runId}`);
      ioPair.out(`(ctrl-c detaches the local worker; continue with: chikory resume ${handle.runId})`);
    }
    const report = await followRun(handle, flags, { watch, deps, io: ioPair });
    return finishRun(handle.runId, report, flags, ioPair);
  } finally {
    worker.shutdown();
    await workerDone.catch(() => {});
    await runner.close();
  }
}

export async function cmdRun(
  args: { file: string; watch: boolean } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  let yamlText: string;
  try {
    yamlText = await readFile(args.file, "utf8");
  } catch {
    ioPair.err(`chikory: cannot read task spec '${args.file}'`);
    return 1;
  }
  let spec: TaskSpec;
  try {
    spec = parseTaskSpec(yamlText);
  } catch (err) {
    if (err instanceof TaskSpecValidationError) {
      ioPair.err(`chikory: ${err.message}`);
      return 1;
    }
    throw err;
  }
  const planText = await readPlanText(deps);
  if (planText !== null) {
    // WP-260: extract the staleness target from the parsed goal, not the raw
    // yamlText (whose comment preamble name-drops many WPs → wrong target).
    const precheck = evaluateSpecStalenessPrecheck(spec.goal, planText);
    if (precheck.warning !== null) {
      ioPair.err(precheck.warning);
    }
  }
  // WP-244 dogfood/test-only judge-catch seam, armed host-side so the
  // committed spec stays clean and the seam never sits on the happy path (the
  // WP-243 `CHIKORY_PARK_*` convention). `CHIKORY_SEED_BAD_DIFF_PATH` +
  // `_CONTENT` (+ optional `_AT_STEP`, default 0) overwrite a workspace file
  // with known-wrong content right after that step, so the judge MUST catch the
  // regression via its acceptance `check` (dogfood-045 F-46).
  const badDiffPath = process.env["CHIKORY_SEED_BAD_DIFF_PATH"];
  if (badDiffPath !== undefined && badDiffPath.length > 0) {
    spec = {
      ...spec,
      debug: {
        ...spec.debug,
        seedBadDiff: {
          atStep: Number(process.env["CHIKORY_SEED_BAD_DIFF_AT_STEP"] ?? 0),
          path: badDiffPath,
          content: process.env["CHIKORY_SEED_BAD_DIFF_CONTENT"] ?? "",
        },
      },
    };
  }
  // WP-207 dogfood/test-only context-window seam, armed host-side (same
  // convention). `CHIKORY_CONTEXT_WINDOW_TOKENS=N` shrinks the window the pacing
  // decision reasons against, so a short run deterministically crosses the
  // `compact`/`park` threshold and drives pressure-triggered compaction (WP-203
  // S2) — the actionable proof of the 602%-window signal dogfood-052 surfaced.
  const contextWindowTokens = process.env["CHIKORY_CONTEXT_WINDOW_TOKENS"];
  if (contextWindowTokens !== undefined && contextWindowTokens.length > 0) {
    spec = {
      ...spec,
      debug: { ...spec.debug, contextWindowTokens: Number(contextWindowTokens) },
    };
  }
  try {
    return await hostAndFollow(args, args.watch, deps, ioPair, (runner) => runner.start(spec));
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

export async function cmdResume(
  args: { runId: string; addBudgetUsd?: number; watch: boolean } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  try {
    return await hostAndFollow(args, args.watch, deps, ioPair, (runner) =>
      runner.resume(
        args.runId,
        args.addBudgetUsd !== undefined ? { addBudgetUsd: args.addBudgetUsd } : undefined,
      ),
    );
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

function renderReport(runId: string, report: RunStatusReport): string {
  const lines: string[] = [];
  lines.push(`run ${runId}`);
  lines.push(`  status       ${report.status}`);
  lines.push(`  step         ${report.currentStep}`);
  lines.push(`  spend        $${report.spentUsd.toFixed(2)} / $${report.budgetUsd.toFixed(2)}`);
  if (report.lastVerdict) {
    lines.push(
      `  last verdict ${report.lastVerdict.kind} @ step ${report.lastVerdict.atStep + 1}`,
    );
  }
  const last = report.checkpoints[report.checkpoints.length - 1];
  lines.push(
    `  checkpoints  ${report.checkpoints.length}` +
      (last ? ` (last: ${last.id}, lastGood: ${last.lastGood})` : ""),
  );
  if (report.failure) {
    lines.push(`  failure      ${report.failure.reason}`);
    if (report.failure.lastCheckpoint) {
      lines.push(`  resume from  ${report.failure.lastCheckpoint}`);
    }
  }
  return lines.join("\n");
}

export async function cmdStatus(
  args: { runId?: string } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  if (args.runId !== undefined) {
    // Journal first: a sealed run is final — no point waiting on a workflow
    // query that needs a live worker to answer (and works fully offline).
    const sealed = journalReport(args.dataDir, args.runId);
    if (sealed && TERMINAL.has(sealed.status)) {
      ioPair.out(
        args.json
          ? JSON.stringify({ runId: args.runId, ...sealed })
          : renderReport(args.runId, sealed),
      );
      return sealed.status === "FAILED" ? 1 : 0;
    }
    const runner = createTemporalRunner({ address: args.address, dataDir: args.dataDir });
    try {
      const handle = await runner.get(args.runId);
      const report = await handle.status();
      ioPair.out(
        args.json ? JSON.stringify({ runId: args.runId, ...report }) : renderReport(args.runId, report),
      );
      return report.status === "FAILED" ? 1 : 0;
    } catch (err) {
      ioPair.err(`chikory: no status for run '${args.runId}': ${actionable(err)}`);
      return 1;
    } finally {
      await runner.close();
    }
  }

  // No arg = list every local run, straight from the on-disk journals.
  const runsDir = join(args.dataDir, "runs");
  if (!existsSync(runsDir)) {
    ioPair.out(args.json ? "[]" : `no runs under ${runsDir}`);
    return 0;
  }
  const rows: Array<{ runId: string } & RunStatusReport> = [];
  for (const id of (await readdir(runsDir)).sort()) {
    const path = journalPath(args.dataDir, id);
    if (!existsSync(path)) continue;
    const journal = new Journal(path);
    try {
      const report = reportFromJournal(journal);
      if (report) rows.push({ runId: id, ...report });
    } finally {
      journal.close();
    }
  }
  if (args.json) {
    ioPair.out(JSON.stringify(rows));
  } else if (rows.length === 0) {
    ioPair.out(`no runs under ${runsDir}`);
  } else {
    ioPair.out(`${"RUN-ID".padEnd(44)} ${"STATUS".padEnd(10)} ${"STEP".padStart(4)}  SPEND/BUDGET`);
    for (const row of rows) {
      ioPair.out(
        `${row.runId.padEnd(44)} ${row.status.padEnd(10)} ${String(row.currentStep).padStart(4)}  ` +
          `$${row.spentUsd.toFixed(2)}/$${row.budgetUsd.toFixed(2)}`,
      );
    }
  }
  return 0;
}

export async function cmdApprove(
  args: { runId: string; reject?: string } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  const runner = createTemporalRunner({ address: args.address, dataDir: args.dataDir });
  try {
    const handle = await runner.get(args.runId);
    const approved = args.reject === undefined;
    await handle.approve({ approved, ...(args.reject !== undefined ? { reason: args.reject } : {}) });
    if (args.json) {
      ioPair.out(JSON.stringify({ runId: args.runId, approved, reason: args.reject ?? null }));
    } else {
      ioPair.out(`${approved ? "approval" : "rejection"} delivered to ${args.runId}`);
      ioPair.out(`if no worker is attached, continue with: chikory resume ${args.runId}`);
    }
    return 0;
  } catch (err) {
    ioPair.err(`chikory: approve failed: ${actionable(err)}`);
    return 1;
  } finally {
    await runner.close();
  }
}

export async function cmdCancel(
  args: { runId: string } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  const runner = createTemporalRunner({ address: args.address, dataDir: args.dataDir });
  try {
    const handle = await runner.get(args.runId);
    await handle.cancel();
    if (args.json) {
      ioPair.out(JSON.stringify({ runId: args.runId, cancelRequested: true }));
    } else {
      ioPair.out(`cancel requested — ${args.runId} stops at the next step boundary`);
      ioPair.out(`if no worker is attached, the stop lands on: chikory resume ${args.runId}`);
    }
    return 0;
  } catch (err) {
    ioPair.err(`chikory: cancel failed: ${actionable(err)}`);
    return 1;
  } finally {
    await runner.close();
  }
}

export async function cmdInject(
  args: { runId: string; guidance: string } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  if (args.guidance.length === 0) {
    ioPair.err(`chikory: missing guidance text (see chikory --help)`);
    return 1;
  }
  const runner = createTemporalRunner({ address: args.address, dataDir: args.dataDir });
  try {
    const handle = await runner.get(args.runId);
    await handle.inject(args.guidance);
    if (args.json) {
      ioPair.out(JSON.stringify({ runId: args.runId, injected: true, guidance: args.guidance }));
    } else {
      ioPair.out(`guidance delivered to ${args.runId}`);
      ioPair.out(`it will be applied at the next step boundary`);
    }
    return 0;
  } catch (err) {
    ioPair.err(`chikory: inject failed: ${actionable(err)}`);
    return 1;
  } finally {
    await runner.close();
  }
}

export async function cmdTrace(
  args: { runId: string; step?: number } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  const path = journalPath(args.dataDir, args.runId);
  if (!existsSync(path)) {
    ioPair.err(
      `chikory: no journal for run '${args.runId}' under ${args.dataDir}/runs ` +
        `(list runs: chikory status)`,
    );
    return 1;
  }
  const journal = new Journal(path);
  try {
    const run = journal.getRun();
    if (!run) {
      ioPair.err(`chikory: journal for '${args.runId}' has no run row`);
      return 1;
    }
    const entries = journal.entries();
    const totals = runTotals(journal);
    if (args.json) {
      ioPair.out(JSON.stringify(traceJson(run, entries, totals)));
    } else if (args.step !== undefined) {
      ioPair.out(renderStepDetail(entries, args.step));
    } else {
      ioPair.out(renderTrace(run, entries, totals));
    }
    return 0;
  } finally {
    journal.close();
  }
}
