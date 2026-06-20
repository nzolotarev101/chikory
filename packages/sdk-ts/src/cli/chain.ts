/**
 * `chikory chain <goal.yaml>` (WP-219 S3-wiring, ADR-005 §S3) — the chain
 * executor launch path. The single-run `chikory run` drives one `agentLoop`;
 * this drives a whole decomposed `Plan` as a tree of judge-gated child runs.
 *
 * The flow is host-side planning + durable execution:
 *   1. parse the goal spec (an ordinary `TaskSpec`: its `goal` is the chain
 *      goal, `acceptanceCriteria` the goal-level coverage floor, `executor` /
 *      `judge` / `routing` / `repos` the per-node template);
 *   2. decompose the goal into a `Plan` (`runPlannerPass`, one `plan`-stage
 *      call) and gate it with the different-family plan meta-judge
 *      (`runPlanJudgePass`, ADR-005 D2) — a non-PROCEED verdict stops here
 *      (v1: no auto-replan, the D3 follow-up);
 *   3. start the durable `chainLoop` workflow over the gated plan and follow
 *      the `ChainJournal` to a terminal `ChainStatus`.
 *
 * Decomposition + gating run in the host process (not a workflow): the chain
 * executor is handed an already-frozen plan so its workflow body stays
 * deterministic (the ADR's core decision — the planner is above the chain, the
 * chain is above the run loop). The node runs are the durable part.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { ChainJournal, chainRecordFrom, type ChainEntry } from "../chain/store.js";
import { serializeWriteConflicts } from "../chain/write-set.js";
import type { ChainNodeTemplate } from "../chain/node-spec.js";
import { renderChainTrace } from "../chain/trace.js";
import { FamilyDiversityError } from "../judge/family.js";
import { runPlannerPass } from "../planner/harness.js";
import { runPlanJudgePass } from "../planner/meta-judge-harness.js";
import { createRouter } from "../router.js";
import { createTemporalRunner } from "../runner.js";
import { createRunnerWorker } from "../runner/worker.js";
import { chainJournalPath } from "../runner/paths.js";
import { parseTaskSpec, TaskSpecValidationError } from "../taskspec.js";
import type { ChainRecord, ChainStatus, Plan, PlanVerdict, Router, TaskSpec } from "../types.js";
import { DEFAULT_ADAPTERS, type CliDeps, type CommonFlags } from "./commands.js";

const CHAIN_TERMINAL: ReadonlySet<ChainStatus> = new Set(["SUCCESS", "FAILED"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/**
 * Host-side decompose → gate. Pure of Temporal (just LLM calls), so it is the
 * unit-testable seam: a fake `Router` drives planner + plan-judge replies.
 * Returns the gated plan on PROCEED, or a stop reason (a failed decomposition,
 * a non-PROCEED meta-judge verdict, or a family-diversity config error).
 */
export type PlanGateResult =
  | { ok: true; plan: Plan; verdict: PlanVerdict; costUsd: number }
  | { ok: false; phase: "plan" | "gate"; message: string; verdict?: PlanVerdict; costUsd: number };

export async function planAndGateChain(
  spec: TaskSpec,
  router: Router,
  ids: { newPlanId: () => string; now: () => string },
): Promise<PlanGateResult> {
  const planned = await runPlannerPass({
    router,
    input: {
      goal: spec.goal,
      acceptanceCriteria: spec.acceptanceCriteria,
      budgetUsd: spec.budgetUsd,
      family: spec.executor.family,
    },
    planId: ids.newPlanId(),
    createdAt: ids.now(),
  });
  if (planned.status === "FAILED") {
    return { ok: false, phase: "plan", message: planned.reason, costUsd: planned.costUsd };
  }

  let normalizedPlan: Plan;
  try {
    normalizedPlan = serializeWriteConflicts(planned.plan, { requireWriteSets: true });
  } catch (err) {
    return {
      ok: false,
      phase: "plan",
      message: err instanceof Error ? err.message : String(err),
      costUsd: planned.costUsd,
    };
  }

  let gated;
  try {
    gated = await runPlanJudgePass({
      router,
      plan: normalizedPlan,
      goalCriteria: spec.acceptanceCriteria,
      plannerFamily: spec.executor.family,
      judgeModel: spec.routing.stages.judge,
      ...(spec.judge.allowSameFamily !== undefined
        ? { allowSameFamily: spec.judge.allowSameFamily }
        : {}),
    });
  } catch (err) {
    // FamilyDiversityError is a config error (same-family plan-judge, no opt-in)
    // — fail fast, before any node spends budget (invariant #2, ADR-005 D2).
    if (err instanceof FamilyDiversityError) {
      return { ok: false, phase: "gate", message: err.message, costUsd: planned.costUsd };
    }
    throw err;
  }

  const costUsd = planned.costUsd + gated.costUsd;
  if (gated.verdict.kind !== "PROCEED") {
    return { ok: false, phase: "gate", message: gated.verdict.rationale, verdict: gated.verdict, costUsd };
  }
  return { ok: true, plan: normalizedPlan, verdict: gated.verdict, costUsd };
}

function templateFromSpec(spec: TaskSpec): ChainNodeTemplate {
  const template: ChainNodeTemplate = {
    repos: spec.repos,
    executor: spec.executor,
    judge: spec.judge,
    routing: spec.routing,
  };
  if (spec.budgetTokens !== undefined) template.budgetTokens = spec.budgetTokens;
  if (spec.maxSteps !== undefined) template.maxSteps = spec.maxSteps;
  return template;
}

function formatChainEntryLine(entry: ChainEntry): string {
  switch (entry.kind) {
    case "plan":
      return `[${entry.ts}] plan accepted`;
    case "plan_verdict":
      return `[${entry.ts}] plan verdict ${(entry.payload as PlanVerdict).kind}`;
    case "node_started": {
      const p = entry.payload as { nodeId: string; childRunId: string };
      return `[${entry.ts}] node ${p.nodeId} started → ${p.childRunId}`;
    }
    case "node_sealed": {
      const p = entry.payload as { nodeId: string; outcome: { status: string; verdict: string } };
      return `[${entry.ts}] node ${p.nodeId} sealed ${p.outcome.status} (${p.outcome.verdict})`;
    }
    case "terminal": {
      const p = entry.payload as { status: string; reason?: string };
      return `[${entry.ts}] chain ${p.status}${p.reason ? ` — ${p.reason}` : ""}`;
    }
  }
}

/**
 * Poll the chain journal to a terminal `ChainStatus`. The chain is durable —
 * detaching this process only stops the local worker; the node runs continue
 * and the journal is the offline source of truth. With --watch, surface each
 * new chain entry (node dispatched/sealed, chain sealed) as it lands.
 */
export async function followChain(
  chainId: string,
  flags: CommonFlags,
  opts: { watch: boolean; deps: CliDeps; io: Io },
): Promise<ChainRecord | undefined> {
  const interval = opts.deps.pollIntervalMs ?? 1000;
  const path = chainJournalPath(flags.dataDir, chainId);
  let nextIdx = 0;

  function drain(): ChainRecord | undefined {
    if (!existsSync(path)) return undefined;
    const journal = new ChainJournal(path);
    try {
      for (const entry of journal.entries()) {
        if (entry.idx < nextIdx) continue;
        nextIdx = entry.idx + 1;
        if (opts.watch) opts.io.out(formatChainEntryLine(entry));
      }
      return chainRecordFrom(journal);
    } finally {
      journal.close();
    }
  }

  for (;;) {
    const record = drain();
    if (record && CHAIN_TERMINAL.has(record.status)) return record;
    await sleep(interval);
  }
}

function finishChain(
  chainId: string,
  record: ChainRecord | undefined,
  flags: CommonFlags,
  { out }: Io,
): number {
  if (!record) {
    out(`chain ${chainId}: no journal`);
    return 1;
  }
  if (flags.json) {
    out(JSON.stringify({ chainId, ...record }));
  } else {
    const journal = new ChainJournal(chainJournalPath(flags.dataDir, chainId));
    try {
      out(renderChainTrace(record, journal.entries()));
    } finally {
      journal.close();
    }
    out(`forensics: chikory trace ${chainId}-node-<node-id>  (per-node run journals)`);
  }
  return record.status === "SUCCESS" ? 0 : 1;
}

export async function cmdChain(
  args: { file: string; watch: boolean } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);

  let yamlText: string;
  try {
    yamlText = await readFile(args.file, "utf8");
  } catch {
    ioPair.err(`chikory: cannot read goal spec '${args.file}'`);
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

  // 1+2: decompose the goal and gate the plan (different-family meta-judge).
  let gate: PlanGateResult;
  try {
    const router = createRouter(spec.routing, deps.routerOptions);
    gate = await planAndGateChain(spec, router, {
      newPlanId: () => `plan-${cryptoRandomId()}`,
      now: () => new Date().toISOString(),
    });
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }

  if (!gate.ok) {
    const what = gate.phase === "plan" ? "goal decomposition" : "plan meta-judge gate";
    ioPair.err(`chikory: ${what} stopped the chain: ${gate.message}`);
    if (gate.verdict && gate.verdict.uncoveredCriteria.length > 0) {
      ioPair.err(`uncovered goal criteria: ${gate.verdict.uncoveredCriteria.join(", ")}`);
    }
    return 1;
  }

  if (!args.json) {
    ioPair.out(`plan ${gate.plan.id} · ${gate.plan.nodes.length} nodes · plan-judge PROCEED`);
    for (const node of gate.plan.nodes) {
      const deps_ = node.dependsOn.length > 0 ? ` (after ${node.dependsOn.join(", ")})` : "";
      ioPair.out(`  ${node.id}${deps_} — ${node.goal}`);
    }
  }

  // 3: start the durable chain executor and follow it to a terminal status.
  try {
    return await hostChainAndFollow(args, args.watch, deps, ioPair, gate.plan, templateFromSpec(spec));
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

async function hostChainAndFollow(
  flags: CommonFlags,
  watch: boolean,
  deps: CliDeps,
  ioPair: Io,
  plan: Plan,
  template: ChainNodeTemplate,
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
    const { chainId } = await runner.startChain({ plan, template });
    if (!flags.json) {
      ioPair.out(`chain-id: ${chainId}`);
      ioPair.out(`(ctrl-c detaches the local worker; node runs are durable — re-run to re-attach)`);
    }
    const record = await followChain(chainId, flags, { watch, deps, io: ioPair });
    return finishChain(chainId, record, flags, ioPair);
  } finally {
    worker.shutdown();
    await workerDone.catch(() => {});
    await runner.close();
  }
}

/** Host-side plan-id mint — not a Temporal side-effect, so plain randomness. */
function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}
