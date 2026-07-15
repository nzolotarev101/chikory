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

import { classifyPlanGateFailure } from "../chain/plan-gate-failure.js";
import { renderPlanGateFailureNotice } from "../chain/plan-gate-notice.js";
import { ChainJournal, chainRecordFrom, type ChainEntry } from "../chain/store.js";
import { serializeWriteConflicts } from "../chain/write-set.js";
import type { ChainNodeTemplate } from "../chain/node-spec.js";
import { renderChainTrace } from "../chain/trace.js";
import { Journal } from "../journal/journal.js";
import { FamilyDiversityError } from "../judge/family.js";
import { runPlannerPass } from "../planner/harness.js";
import { runPlanJudgePass } from "../planner/meta-judge-harness.js";
import { createRouter } from "../router.js";
import { createTemporalRunner } from "../runner.js";
import { createRunnerWorker } from "../runner/worker.js";
import { chainJournalPath, journalPath } from "../runner/paths.js";
import { parseTaskSpec, TaskSpecValidationError } from "../taskspec.js";
import type { ChainRecord, ChainStatus, Plan, PlanVerdict, Router, TaskSpec } from "../types.js";
import { DEFAULT_ADAPTERS, type CliDeps, type CommonFlags } from "./commands.js";
import { assessLaunchModeMismatch, detectIntendedSingleRun } from "./launch-mode-precheck.js";

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
      ...(spec.minNodes !== undefined ? { minNodes: spec.minNodes } : {}),
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

  // WP-509/F-88: deterministic decomposition floor. A planner that collapses a
  // decomposable goal into too few nodes is caught here — before any judge
  // budget is spent — and surfaced as an actionable stop instead of silently
  // shipping a one-node "chain" with no horizon.
  if (spec.minNodes !== undefined && normalizedPlan.nodes.length < spec.minNodes) {
    return {
      ok: false,
      phase: "plan",
      message:
        `planner under-decomposed: ${normalizedPlan.nodes.length} node(s) < min_nodes ` +
        `${spec.minNodes} — the goal was collapsed too coarsely; re-run or lower min_nodes`,
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
    const failureClass = classifyPlanGateFailure(gated.verdict);
    const message = failureClass ? renderPlanGateFailureNotice(failureClass) : gated.verdict.rationale;
    return { ok: false, phase: "gate", message, verdict: gated.verdict, costUsd };
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
  // WP-243 dogfood/test-only park seam: armed host-side from env so the dogfood
  // spec stays unchanged. `CHIKORY_PARK_BEFORE_STEP=N` parks before step N;
  // `CHIKORY_PARK_NODE_INDEX=K` (optional) restricts the park to the K-th
  // dispatched node (0-based). Read here (host process), frozen into the
  // workflow input → never read inside the deterministic workflow body.
  const beforeStep = process.env["CHIKORY_PARK_BEFORE_STEP"];
  if (beforeStep !== undefined) {
    const idx = process.env["CHIKORY_PARK_NODE_INDEX"];
    template.debugPark = {
      beforeStep: Number(beforeStep),
      ...(idx !== undefined ? { nodeIndex: Number(idx) } : {}),
    };
  }
  // WP-246 dogfood/test-only judge-catch seam, the chain analog of the single-run
  // CHIKORY_SEED_BAD_DIFF_* reader (commands.ts). `_NODE_INDEX` (optional)
  // restricts the seeding to the K-th dispatched node (0-based) — corrupt a
  // dependent node so its real-time judge must catch the regression before it
  // lands. Read here (host process), frozen into the workflow input.
  const badDiffPath = process.env["CHIKORY_SEED_BAD_DIFF_PATH"];
  if (badDiffPath !== undefined && badDiffPath.length > 0) {
    const idx = process.env["CHIKORY_SEED_BAD_DIFF_NODE_INDEX"];
    template.debugSeedBadDiff = {
      atStep: Number(process.env["CHIKORY_SEED_BAD_DIFF_AT_STEP"] ?? 0),
      path: badDiffPath,
      content: process.env["CHIKORY_SEED_BAD_DIFF_CONTENT"] ?? "",
      ...(idx !== undefined ? { nodeIndex: Number(idx) } : {}),
    };
  }
  // WP-521 dogfood/test-only heal-by-default seam: force the named node's FIRST
  // incarnation to seal FAILED so the chain replans+retries it deterministically.
  const seedFailNode = process.env["CHIKORY_SEED_CHAIN_FAIL_NODE"];
  if (seedFailNode !== undefined && seedFailNode.length > 0) {
    template.seedFailNodeId = seedFailNode;
  }
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
    case "node_replanned": {
      const p = entry.payload as { failedNodeId: string; revisedPlan?: { id: string } };
      return `[${entry.ts}] node ${p.failedNodeId} replanned → ${p.revisedPlan?.id ?? "revised plan"}`;
    }
    case "chain_completion_review": {
      const p = entry.payload as {
        verdict: string;
        findings: { pass: boolean }[];
      };
      const failed = p.findings.filter((finding) => !finding.pass).length;
      return `[${entry.ts}] chain-completion review ${p.verdict} — ${failed} design finding(s)`;
    }
    case "terminal": {
      const p = entry.payload as { status: string; reason?: string };
      return `[${entry.ts}] chain ${p.status}${p.reason ? ` — ${p.reason}` : ""}`;
    }
  }
}

/** A chain node's child run that is parked awaiting a human (WP-241, F-42). */
export interface ChildParked {
  nodeId: string;
  childRunId: string;
  kind: "AWAITING_APPROVAL" | "SUSPENDED";
  reason: string;
}

/**
 * The node the chain is currently waiting on: it has a child run id
 * (`node_started`) but no sealed outcome (`node_sealed`). A RUNNING chain under
 * the v1 sequential dispatcher (ADR-005 §S3) has at most one.
 */
export function inflightNode(
  record: ChainRecord,
): { nodeId: string; childRunId: string } | undefined {
  for (const [nodeId, childRunId] of Object.entries(record.nodeRuns)) {
    if (record.nodeOutcomes[nodeId] === undefined) return { nodeId, childRunId };
  }
  return undefined;
}

/**
 * Whether a chain node's child run is currently parked awaiting a human — the
 * F-42 visibility gap. A child workflow that ESCALATEs (judge or loop-breaker)
 * or SUSPENDs (budget cap) blocks *inside* `executeChild`, so the chain
 * workflow stalls with nothing new to journal at chain scope; the only durable
 * signal is in the child's own per-run journal. Fold oldest→newest so a later
 * resolution (a resolving verdict, a budget top-up, or a terminal seal) clears
 * an earlier park. Mirrors the per-run `followRun` drain (commands.ts).
 */
export function childParkedState(
  dataDir: string,
  nodeId: string,
  childRunId: string,
): ChildParked | undefined {
  const path = journalPath(dataDir, childRunId);
  if (!existsSync(path)) return undefined;
  const journal = new Journal(path);
  try {
    let parked: ChildParked | undefined;
    for (const entry of journal.entries()) {
      if (entry.kind === "terminal") return undefined; // sealed → not parked
      if (entry.kind === "verdict") {
        const v = (
          entry.payload as { verdict?: { kind: string; escalateReason?: string; rationale?: string } }
        ).verdict;
        parked =
          v?.kind === "ESCALATE"
            ? {
                nodeId,
                childRunId,
                kind: "AWAITING_APPROVAL",
                reason: v.escalateReason ?? v.rationale ?? "escalation",
              }
            : undefined; // any later resolving verdict clears the escalation
      } else if (entry.kind === "budget_event") {
        const p = entry.payload as {
          event: string;
          cause?: string;
          details?: {
            spentUsd?: number;
            budgetUsd?: number;
            projectedTokens?: number;
            remainingTokens?: number;
            utilizationPercent?: number;
          };
        };
        if (p.event === "halt") {
          const spent = p.details?.spentUsd;
          const budget = p.details?.budgetUsd;
          const projected = p.details?.projectedTokens;
          const remaining = p.details?.remainingTokens;
          const utilization = p.details?.utilizationPercent;
          parked = {
            nodeId,
            childRunId,
            kind: "SUSPENDED",
            // WP-243: an injected park is honest about being a debug seam, not a
            // fake budget breach.
            reason:
              p.cause === "debug"
                ? "debug park-injection (WP-243)"
                : p.cause === "window"
                  ? projected !== undefined && remaining !== undefined && utilization !== undefined
                    ? `context window (${projected} projected tokens, ${remaining} remaining, ${utilization}% window)`
                    : "context window"
                : spent !== undefined && budget !== undefined
                  ? `budget cap ($${spent.toFixed(2)} / $${budget.toFixed(2)})`
                  : "budget cap",
          };
        } else if (p.event === "top_up") {
          parked = undefined; // funds added → gate cleared
        }
      }
    }
    return parked;
  } finally {
    journal.close();
  }
}

/** The chain-level command that unblocks a parked child (WP-241). */
function unblockHint(chainId: string, parked: ChildParked): string {
  if (parked.kind === "AWAITING_APPROVAL") {
    return `unblock with: chikory chain approve ${chainId} [--reject "<reason>"]`;
  }
  return parked.reason.startsWith("context window")
    ? `unblock with: chikory chain resume ${chainId}`
    : `unblock with: chikory chain resume ${chainId} --add-budget <usd>`;
}

function readChainRecord(dataDir: string, chainId: string): ChainRecord | undefined {
  const path = chainJournalPath(dataDir, chainId);
  if (!existsSync(path)) return undefined;
  const journal = new ChainJournal(path);
  try {
    return chainRecordFrom(journal);
  } finally {
    journal.close();
  }
}

/**
 * Poll the chain journal to a terminal `ChainStatus`. The chain is durable —
 * detaching this process only stops the local worker; the node runs continue
 * and the journal is the offline source of truth. With --watch, surface each
 * new chain entry (node dispatched/sealed, chain sealed) as it lands. Always
 * (watch or not) surface a parked in-flight child once per distinct park — the
 * F-42 fix, so the chain never *appears* hung while a node awaits a human.
 */
export async function followChain(
  chainId: string,
  flags: CommonFlags,
  opts: { watch: boolean; deps: CliDeps; io: Io },
): Promise<ChainRecord | undefined> {
  const interval = opts.deps.pollIntervalMs ?? 1000;
  const path = chainJournalPath(flags.dataDir, chainId);
  let nextIdx = 0;
  let announcedPark: string | undefined;

  function drain(): ChainRecord | undefined {
    if (!existsSync(path)) return undefined;
    const journal = new ChainJournal(path);
    let record: ChainRecord | undefined;
    try {
      for (const entry of journal.entries()) {
        if (entry.idx < nextIdx) continue;
        nextIdx = entry.idx + 1;
        if (opts.watch) opts.io.out(formatChainEntryLine(entry));
      }
      record = chainRecordFrom(journal);
    } finally {
      journal.close();
    }

    // F-42: surface a parked in-flight child. The chain workflow is blocked
    // inside executeChild with nothing new to journal at chain scope, so
    // without this the follow stream goes silent for the whole human wait.
    if (record) {
      const inflight = inflightNode(record);
      const parked = inflight
        ? childParkedState(flags.dataDir, inflight.nodeId, inflight.childRunId)
        : undefined;
      const sig = parked ? `${parked.childRunId}:${parked.kind}:${parked.reason}` : undefined;
      if (parked && sig !== announcedPark) {
        announcedPark = sig;
        opts.io.out(
          `node ${parked.nodeId} child ${parked.childRunId} ⏸ ${parked.kind} — ${parked.reason}`,
        );
        opts.io.out(unblockHint(chainId, parked));
      } else if (!parked) {
        announcedPark = undefined;
      }
    }
    return record;
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

  // WP-261 / WP-262(a): after a successful parse and BEFORE any planning spend,
  // refuse a spec that asks for a single `chikory run` but was launched as a
  // chain. The single-run marker lives in the header comment, so match the raw
  // yamlText (F-68). Overridable with a NON-EMPTY CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH.
  const launchModeMismatch = assessLaunchModeMismatch({
    intendedSingleRun: detectIntendedSingleRun(yamlText),
    launchedAsChain: true,
  });
  if (
    launchModeMismatch !== null &&
    (process.env["CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH"] ?? "") === ""
  ) {
    ioPair.err(launchModeMismatch.warning);
    ioPair.err(
      "[chikory] relaunch with `chikory run`, or set CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=1 to override",
    );
    return 1;
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

/**
 * Deliver a decision to a chain's parked in-flight child and follow the chain
 * to its terminal status — the WP-241 chain-level approve/resume that keeps the
 * parent orchestration attached (F-42). The chain workflow is blocked inside
 * `executeChild`; signalling the child (by its deterministic child run id, read
 * from the ChainJournal) lets that child seal, which unblocks the parent. We
 * host a worker for the duration so the unblocked chain actually progresses —
 * no separate "detach, approve, restart, resume" dance.
 */
async function hostChainControlAndFollow(
  chainId: string,
  flags: CommonFlags & { watch: boolean },
  deps: CliDeps,
  ioPair: Io,
  action:
    | { kind: "approve"; approved: boolean; reason?: string }
    | { kind: "resume"; addBudgetUsd?: number },
): Promise<number> {
  const record = readChainRecord(flags.dataDir, chainId);
  if (!record) {
    ioPair.err(`chikory: no chain journal for '${chainId}' under ${flags.dataDir}`);
    return 1;
  }
  if (CHAIN_TERMINAL.has(record.status)) {
    ioPair.out(`chain ${chainId} already ${record.status} — nothing to ${action.kind}`);
    return record.status === "SUCCESS" ? 0 : 1;
  }
  const inflight = inflightNode(record);
  if (!inflight) {
    ioPair.err(`chikory: chain ${chainId} has no in-flight node awaiting a decision`);
    return 1;
  }

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
    if (action.kind === "approve") {
      const handle = await runner.get(inflight.childRunId);
      await handle.approve({
        approved: action.approved,
        ...(action.reason !== undefined ? { reason: action.reason } : {}),
      });
      ioPair.out(
        `${action.approved ? "approval" : "rejection"} delivered to node ${inflight.nodeId} ` +
          `(${inflight.childRunId})`,
      );
    } else {
      await runner.resume(
        inflight.childRunId,
        action.addBudgetUsd !== undefined ? { addBudgetUsd: action.addBudgetUsd } : undefined,
      );
      ioPair.out(
        `resume delivered to node ${inflight.nodeId} (${inflight.childRunId})` +
          (action.addBudgetUsd !== undefined ? ` (+$${action.addBudgetUsd.toFixed(2)})` : ""),
      );
    }
    const final = await followChain(chainId, flags, { watch: flags.watch, deps, io: ioPair });
    return finishChain(chainId, final, flags, ioPair);
  } finally {
    worker.shutdown();
    await workerDone.catch(() => {});
    await runner.close();
  }
}

/** `chikory chain approve <chain-id>` — answer a parked child's ESCALATE (WP-241). */
export async function cmdChainApprove(
  args: { chainId: string; reject?: string; watch: boolean } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  try {
    return await hostChainControlAndFollow(args.chainId, args, deps, ioPair, {
      kind: "approve",
      approved: args.reject === undefined,
      ...(args.reject !== undefined ? { reason: args.reject } : {}),
    });
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

/** `chikory chain resume <chain-id>` — clear a parked child's budget cap (WP-241). */
export async function cmdChainResume(
  args: { chainId: string; addBudgetUsd?: number; watch: boolean } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  try {
    return await hostChainControlAndFollow(args.chainId, args, deps, ioPair, {
      kind: "resume",
      ...(args.addBudgetUsd !== undefined ? { addBudgetUsd: args.addBudgetUsd } : {}),
    });
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

/** Host-side plan-id mint — not a Temporal side-effect, so plain randomness. */
function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}
