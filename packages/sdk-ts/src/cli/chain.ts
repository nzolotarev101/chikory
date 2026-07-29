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
 *      (`runPlanJudgePass`, ADR-005 D2) — a REPAIRABLE rejection feeds the
 *      gate's own evidence back to the planner and re-decomposes, bounded by
 *      attempts and cost (WP-542/F-207, ADR-009 D1); only an unrepairable
 *      class or an exhausted budget stops here;
 *   3. start the durable `chainLoop` workflow over the gated plan and follow
 *      the `ChainJournal` to a terminal `ChainStatus`.
 *
 * Decomposition + gating run in the host process (not a workflow): the chain
 * executor is handed an already-frozen plan so its workflow body stays
 * deterministic (the ADR's core decision — the planner is above the chain, the
 * chain is above the run loop). The node runs are the durable part.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { classifyPlanGateFailure } from "../chain/plan-gate-failure.js";
import { renderPlanGateFailureNotice } from "../chain/plan-gate-notice.js";
import { renderChainReadTrace } from "../chain/read-trace.js";
import { ChainJournal, chainRecordFrom, type ChainEntry } from "../chain/store.js";
import { serializeWriteConflicts } from "../chain/write-set.js";
import type { ChainNodeTemplate } from "../chain/node-spec.js";
import { renderChainTrace } from "../chain/trace.js";
import {
  decideGateRepair,
  gateRepairCostCap,
  MAX_GATE_REPAIR_ATTEMPTS,
} from "../heal/gate-repair.js";
import { Journal } from "../journal/journal.js";
import { FamilyDiversityError } from "../judge/family.js";
import { runPlannerPass } from "../planner/harness.js";
import { runPlanJudgePass } from "../planner/meta-judge-harness.js";
import {
  buildPlanRepairBrief,
  describeRepairTarget,
  familyDiversityFailure,
  gateFailure,
  minNodesFailure,
  plannerTransportFailure,
  writeSetFailure,
  type PlanPhaseFailure,
  type PlanPhaseFailureKind,
} from "../planner/plan-repair.js";
import { createRouter } from "../router.js";
import { createTemporalRunner, describeWorkflowTaskQueue } from "../runner.js";
import { createRunnerWorker } from "../runner/worker.js";
import { chainJournalPath, journalPath } from "../runner/paths.js";
import { parseTaskSpec, TaskSpecValidationError } from "../taskspec.js";
import type {
  ChainRecord,
  ChainStatus,
  Plan,
  PlanVerdict,
  PlanVerdictKind,
  Router,
  TaskSpec,
} from "../types.js";
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
 * Host-side decompose → gate, with the WP-542 bounded repair loop. Pure of
 * Temporal (just LLM calls), so it is the unit-testable seam: a fake `Router`
 * drives planner + plan-judge replies.
 *
 * ADR-009 D1 is binding — every non-infra failure class gets at least one
 * bounded, journaled, automated heal attempt before a terminal seal — and the
 * plan gate used to be the one layer with no tier at all: any rejection ended
 * the launch and the human hand-edited the goal spec (F-207, five times on
 * dogfood-120). Now every repairable rejection composes the gate's own evidence
 * into a repair brief and re-decomposes against it; `onAttempt` surfaces each
 * pass so the self-heal is visible rather than a silent pause.
 *
 * Returns the gated plan on PROCEED, or a stop reason with the full attempt
 * trail. It never returns an ungated plan: an exhausted repair budget stops the
 * launch, because a gate that does not gate is not a gate.
 */
export interface PlanRepairAttempt {
  /** 1-based; attempt 1 is the original pass, 2+ are repairs. */
  attempt: number;
  phase: "plan" | "gate";
  kind: PlanPhaseFailureKind | "PROCEED";
  verdictKind?: PlanVerdictKind;
  /** Independently checkable defects this attempt was rejected for. */
  machineGaps: string[];
  /** USD this attempt spent (planner + plan-judge). */
  costUsd: number;
  reason: string;
}

export type PlanGateResult =
  | {
      ok: true;
      plan: Plan;
      verdict: PlanVerdict;
      costUsd: number;
      attempts: PlanRepairAttempt[];
    }
  | {
      ok: false;
      phase: "plan" | "gate";
      message: string;
      verdict?: PlanVerdict;
      costUsd: number;
      attempts: PlanRepairAttempt[];
    };

export interface PlanGateOptions {
  /** Repair attempts beyond the first pass; `0` = the pre-WP-542 single shot. */
  maxRepairAttempts?: number;
  /** Absolute USD ceiling for the whole plan phase; `0` disables the cost stop. */
  repairCostCapUsd?: number;
  /** Per-attempt operator callback — the visible half of the self-heal. */
  onAttempt?: (attempt: PlanRepairAttempt, maxAttempts: number) => void;
}

/** One decompose → normalize → floor → gate pass. Failures are values. */
async function planGatePass(
  spec: TaskSpec,
  router: Router,
  ids: { newPlanId: () => string; now: () => string },
  repairBrief: string | undefined,
): Promise<
  | { ok: true; plan: Plan; verdict: PlanVerdict; costUsd: number }
  | { ok: false; failure: PlanPhaseFailure; plan?: Plan; costUsd: number }
> {
  const planned = await runPlannerPass({
    router,
    input: {
      goal: spec.goal,
      acceptanceCriteria: spec.acceptanceCriteria,
      budgetUsd: spec.budgetUsd,
      family: spec.executor.family,
      ...(spec.minNodes !== undefined ? { minNodes: spec.minNodes } : {}),
      ...(repairBrief !== undefined ? { repairBrief } : {}),
    },
    planId: ids.newPlanId(),
    createdAt: ids.now(),
  });
  if (planned.status === "FAILED") {
    return {
      ok: false,
      failure: plannerTransportFailure(planned.reason),
      costUsd: planned.costUsd,
    };
  }

  let normalizedPlan: Plan;
  try {
    normalizedPlan = serializeWriteConflicts(planned.plan, { requireWriteSets: true });
  } catch (err) {
    return {
      ok: false,
      failure: writeSetFailure(err instanceof Error ? err.message : String(err)),
      plan: planned.plan,
      costUsd: planned.costUsd,
    };
  }

  // WP-509/F-88: deterministic decomposition floor. A planner that collapses a
  // decomposable goal into too few nodes is caught here — before any judge
  // budget is spent — and now feeds the shortfall back as repair evidence
  // instead of ending the launch.
  if (spec.minNodes !== undefined && normalizedPlan.nodes.length < spec.minNodes) {
    return {
      ok: false,
      failure: minNodesFailure(normalizedPlan.nodes.length, spec.minNodes),
      plan: normalizedPlan,
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
    // — fail fast, never repaired, before any node spends budget (invariant #2,
    // ADR-005 D2).
    if (err instanceof FamilyDiversityError) {
      return {
        ok: false,
        failure: familyDiversityFailure(err.message),
        plan: normalizedPlan,
        costUsd: planned.costUsd,
      };
    }
    throw err;
  }

  const costUsd = planned.costUsd + gated.costUsd;
  if (gated.verdict.kind !== "PROCEED") {
    return {
      ok: false,
      failure: gateFailure(gated.verdict, normalizedPlan),
      plan: normalizedPlan,
      costUsd,
    };
  }
  return { ok: true, plan: normalizedPlan, verdict: gated.verdict, costUsd };
}

export async function planAndGateChain(
  spec: TaskSpec,
  router: Router,
  ids: { newPlanId: () => string; now: () => string },
  options: PlanGateOptions = {},
): Promise<PlanGateResult> {
  const maxRepairAttempts = options.maxRepairAttempts ?? MAX_GATE_REPAIR_ATTEMPTS;
  const costCapUsd = options.repairCostCapUsd ?? gateRepairCostCap(spec.budgetUsd);
  const attempts: PlanRepairAttempt[] = [];
  // Total passes = the original + the repairs, so the operator-facing "k of n"
  // counts what a human would count.
  const maxPasses = maxRepairAttempts + 1;

  let costUsd = 0;
  let repairBrief: string | undefined;

  for (;;) {
    const passIndex = attempts.length + 1;
    const pass = await planGatePass(spec, router, ids, repairBrief);
    costUsd += pass.costUsd;

    if (pass.ok) {
      const record: PlanRepairAttempt = {
        attempt: passIndex,
        phase: "gate",
        kind: "PROCEED",
        verdictKind: pass.verdict.kind,
        machineGaps: [],
        costUsd: pass.costUsd,
        reason: pass.verdict.rationale,
      };
      attempts.push(record);
      options.onAttempt?.(record, maxPasses);
      return { ok: true, plan: pass.plan, verdict: pass.verdict, costUsd, attempts };
    }

    const { failure } = pass;
    const record: PlanRepairAttempt = {
      attempt: passIndex,
      phase: failure.phase,
      kind: failure.kind,
      ...(failure.verdict !== undefined ? { verdictKind: failure.verdict.kind } : {}),
      machineGaps: failure.machineGaps,
      costUsd: pass.costUsd,
      reason: failure.message,
    };
    attempts.push(record);
    options.onAttempt?.(record, maxPasses);

    const decision = decideGateRepair(
      { attemptsUsed: attempts.length - 1, costUsdSpent: costUsd, repairable: failure.repairable },
      { maxAttempts: maxRepairAttempts, costCapUsd },
    );
    if (decision.action === "stop") {
      return {
        ok: false,
        phase: failure.phase,
        message: renderPlanPhaseStop(failure, attempts.length - 1),
        ...(failure.verdict !== undefined ? { verdict: failure.verdict } : {}),
        costUsd,
        attempts,
      };
    }

    repairBrief = buildPlanRepairBrief({
      failure,
      attempt: decision.attempt,
      maxAttempts: maxRepairAttempts,
      ...(pass.plan !== undefined ? { priorPlan: pass.plan } : {}),
    });
  }
}

/** The operator-facing stop line: the pre-WP-542 wording, plus what repair did. */
function renderPlanPhaseStop(failure: PlanPhaseFailure, repairsUsed: number): string {
  if (failure.verdict === undefined) return failure.message;
  const failureClass = classifyPlanGateFailure(failure.verdict);
  return failureClass
    ? renderPlanGateFailureNotice(failureClass, repairsUsed)
    : failure.verdict.rationale;
}

/**
 * The exhausted-repair trail (WP-542/F-207). When the loop gives up, the
 * operator gets every attempt, what each was rejected for, and what the phase
 * cost — one read instead of one re-launch per data point.
 */
export function renderPlanRepairTrail(
  attempts: readonly PlanRepairAttempt[],
  costUsd: number,
): string[] {
  if (attempts.length === 0) return [];
  const lines = [`plan repair trail (${attempts.length} attempt(s), $${costUsd.toFixed(4)}):`];
  for (const attempt of attempts) {
    const verdict = attempt.verdictKind ?? attempt.kind;
    lines.push(
      `  attempt ${attempt.attempt} · ${attempt.phase} · ${verdict} · $${attempt.costUsd.toFixed(4)}`,
    );
    for (const gap of attempt.machineGaps) lines.push(`    - ${gap}`);
    if (attempt.machineGaps.length === 0) {
      lines.push(`    ${attempt.reason.replace(/\s+/g, " ").trim().slice(0, 300)}`);
    }
  }
  return lines;
}

/**
 * WP-542 repair budget. `CHIKORY_PLAN_REPAIR_ATTEMPTS=0` restores the
 * pre-WP-542 single-shot stop (the seam the unit tests and any "prove the old
 * dead end" drill use); unset applies the `MAX_GATE_REPAIR_ATTEMPTS` default.
 * Read host-side only — the plan phase never runs inside a workflow body.
 */
export function planRepairBudgetFromEnv(
  raw = process.env["CHIKORY_PLAN_REPAIR_ATTEMPTS"],
): number {
  if (raw === undefined || raw.trim() === "") return MAX_GATE_REPAIR_ATTEMPTS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return MAX_GATE_REPAIR_ATTEMPTS;
  return parsed;
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
    case "control_event": {
      const p = entry.payload as { event: string; source: string; failedNodeId?: string };
      return `[${entry.ts}] chain ${p.event} (${p.source})${p.failedNodeId ? ` — retry ${p.failedNodeId}` : ""}`;
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

/** Count of journal entries already sealed — the `followChain` resume baseline. */
function chainEntryCount(dataDir: string, chainId: string): number {
  const path = chainJournalPath(dataDir, chainId);
  if (!existsSync(path)) return 0;
  const journal = new ChainJournal(path);
  try {
    let count = 0;
    for (const _entry of journal.entries()) count += 1;
    return count;
  } finally {
    journal.close();
  }
}

/** Route read-only `chikory chain` subcommands without entering a write path. */
export function cmdChainReadSubcommand(
  positionals: readonly string[],
  flags: CommonFlags,
  deps: CliDeps = {},
): number | undefined {
  if (positionals[0] !== "trace") return undefined;

  const chainId = positionals[1];
  if (chainId === undefined) {
    io(deps).err(`chikory: missing chain-id (see chikory --help)`);
    return 1;
  }
  return cmdChainTrace({ chainId, ...flags }, deps);
}

/** `chikory chain trace <chain-id>` — render a sealed chain from its local journal. */
export function cmdChainTrace(
  args: { chainId: string } & CommonFlags,
  deps: CliDeps = {},
): number {
  const ioPair = io(deps);
  const path = chainJournalPath(args.dataDir, args.chainId);
  if (!existsSync(path)) {
    ioPair.err(
      `chikory: unknown chain id '${args.chainId}' (no journal under ${args.dataDir}/chains)`,
    );
    return 1;
  }

  const journal = new ChainJournal(path);
  try {
    const record = chainRecordFrom(journal);
    if (record === undefined) {
      ioPair.err(`chikory: unknown chain id '${args.chainId}' (journal has no chain record)`);
      return 1;
    }
    ioPair.out(renderChainReadTrace(record, journal.entries()));
    return 0;
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
  // `sinceIdx` (WP-521(c) resume-follow fix): a resume re-enters a chain whose
  // journal already holds a terminal FAILED tail. Starting the terminal check
  // at idx 0 raced the freshly-started workflow — drain()'s FIRST poll (often
  // before the worker even picks up the task) saw only the pre-existing FAILED
  // entries and returned instantly, reporting the stale seal as the resume's
  // own outcome. Callers resuming a sealed chain pass the entry count AT
  // RESUME TIME; the terminal check then waits for at least one entry past
  // that baseline (a genuine reopen/dispatch) before honoring a verdict.
  opts: { watch: boolean; deps: CliDeps; io: Io; sinceIdx?: number },
): Promise<ChainRecord | undefined> {
  const interval = opts.deps.pollIntervalMs ?? 1000;
  const path = chainJournalPath(flags.dataDir, chainId);
  const baselineIdx = opts.sinceIdx ?? 0;
  let nextIdx = baselineIdx;
  let sawNewEntry = false;
  let announcedPark: string | undefined;

  function drain(): ChainRecord | undefined {
    if (!existsSync(path)) return undefined;
    const journal = new ChainJournal(path);
    let record: ChainRecord | undefined;
    try {
      for (const entry of journal.entries()) {
        if (entry.idx < nextIdx) continue;
        nextIdx = entry.idx + 1;
        sawNewEntry = true;
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
    if (record && CHAIN_TERMINAL.has(record.status) && (baselineIdx === 0 || sawNewEntry)) {
      return record;
    }
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

  // 1+2: decompose the goal and gate the plan (different-family meta-judge),
  // repairing a repairable rejection in-loop rather than ending the launch
  // (WP-542/F-207).
  let gate: PlanGateResult;
  try {
    const router = createRouter(spec.routing, deps.routerOptions);
    gate = await planAndGateChain(
      spec,
      router,
      {
        newPlanId: () => `plan-${cryptoRandomId()}`,
        now: () => new Date().toISOString(),
      },
      {
        maxRepairAttempts: planRepairBudgetFromEnv(),
        onAttempt: (attempt, maxPasses) => {
          if (args.json || attempt.kind === "PROCEED") return;
          ioPair.err(
            `plan gate ${attempt.verdictKind ?? attempt.kind} ` +
              `(attempt ${attempt.attempt}/${maxPasses}) — repairing: ` +
              describeRepairTarget({ message: attempt.reason, machineGaps: attempt.machineGaps }),
          );
        },
      },
    );
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
    // The whole repair trail, so the residual failure is diagnosable in one read
    // instead of one line per re-launch (F-207).
    for (const line of renderPlanRepairTrail(gate.attempts, gate.costUsd)) ioPair.err(line);
    return 1;
  }

  if (!args.json) {
    const repairs = gate.attempts.length - 1;
    const healed = repairs > 0 ? ` (healed in ${repairs} repair attempt(s))` : "";
    ioPair.out(
      `plan ${gate.plan.id} · ${gate.plan.nodes.length} nodes · plan-judge PROCEED${healed} · ` +
        `plan phase $${gate.costUsd.toFixed(4)}`,
    );
    for (const node of gate.plan.nodes) {
      const deps_ = node.dependsOn.length > 0 ? ` (after ${node.dependsOn.join(", ")})` : "";
      ioPair.out(`  ${node.id}${deps_} — ${node.goal}`);
    }
  }

  // 3: start the durable chain executor and follow it to a terminal status.
  try {
    return await hostChainAndFollow(
      args,
      args.watch,
      deps,
      ioPair,
      gate.plan,
      templateFromSpec(spec),
      replanBudgetFromEnv(),
      gate.attempts,
    );
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

/**
 * WP-532 dogfood/test-only heal-budget seam: `CHIKORY_CHAIN_MAX_REPLANS=0` seals
 * a seeded-failure chain FAILED (heal-by-default OFF) so the two-phase operator
 * `chikory chain resume` drill (P3-rung-2) has a sealed-FAILED chain to resume.
 * Unset → the WP-521 heal-by-default `startChain` default (1) applies. Read here
 * (host process), frozen into the workflow input — never inside the workflow body.
 */
export function replanBudgetFromEnv(
  raw = process.env["CHIKORY_CHAIN_MAX_REPLANS"],
): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

async function hostChainAndFollow(
  flags: CommonFlags,
  watch: boolean,
  deps: CliDeps,
  ioPair: Io,
  plan: Plan,
  template: ChainNodeTemplate,
  maxReplans?: number,
  planAttempts?: PlanRepairAttempt[],
): Promise<number> {
  // Chain-scoped task queue (F-158, mirrors cmdRun): queue = chain-id; node
  // child workflows inherit it via workflowInfo().taskQueue. An orphaned chain
  // from a killed launch can never re-attach to this worker.
  const chainId = `chain-${randomUUID()}`;
  const taskQueue = deps.taskQueue ?? chainId;
  const worker = await createRunnerWorker({
    adapters: deps.adapters ?? DEFAULT_ADAPTERS,
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue,
    routerOptions: deps.routerOptions,
    workflowBundlePath: deps.workflowBundlePath,
  });
  const workerDone = worker.run();
  const runner = createTemporalRunner({
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue,
  });
  try {
    await runner.startChain({
      plan,
      template,
      chainId,
      ...(maxReplans !== undefined ? { maxReplans } : {}),
      ...(planAttempts !== undefined ? { planAttempts } : {}),
    });
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

  // Join the live chain's ORIGINAL queue (F-158: pre-change chains sit on the
  // shared default, post-change on their own chain-id queue — ask the server).
  const taskQueue =
    deps.taskQueue ??
    (await describeWorkflowTaskQueue(chainId, { address: flags.address })) ??
    chainId;
  const worker = await createRunnerWorker({
    adapters: deps.adapters ?? DEFAULT_ADAPTERS,
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue,
    routerOptions: deps.routerOptions,
    workflowBundlePath: deps.workflowBundlePath,
  });
  const workerDone = worker.run();
  const runner = createTemporalRunner({
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue,
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

/**
 * `chikory chain resume <chain-id>` — resume a chain past a park. Two cases:
 * a RUNNING chain with a parked in-flight child clears its budget cap (WP-241);
 * a sealed-FAILED, resumable chain re-enters `chainLoop` to retry the failed
 * node (WP-521(c) / P3-rung-2).
 */
export async function cmdChainResume(
  args: { chainId: string; addBudgetUsd?: number; watch: boolean } & CommonFlags,
  deps: CliDeps = {},
): Promise<number> {
  const ioPair = io(deps);
  try {
    const record = readChainRecord(args.dataDir, args.chainId);
    if (record && CHAIN_TERMINAL.has(record.status)) {
      // WP-521(c): a sealed-FAILED chain re-enters via runner.resumeChain (which
      // refuses SUCCESS / dead-FAILED); a sealed-SUCCESS falls through to the
      // WP-241 path, which reports "already SUCCESS".
      if (record.status === "FAILED") {
        return await hostChainResumeAndFollow(args.chainId, args, deps, ioPair);
      }
    }
    return await hostChainControlAndFollow(args.chainId, args, deps, ioPair, {
      kind: "resume",
      ...(args.addBudgetUsd !== undefined ? { addBudgetUsd: args.addBudgetUsd } : {}),
    });
  } catch (err) {
    ioPair.err(`chikory: ${actionable(err)}`);
    return 1;
  }
}

/**
 * WP-521(c): host a worker, re-enter a sealed-FAILED chain over its own
 * chain-id, and follow it to terminal (mirrors `hostChainControlAndFollow`'s
 * worker lifecycle, but the action is a whole-chain resume, not a child signal).
 */
async function hostChainResumeAndFollow(
  chainId: string,
  flags: CommonFlags & { watch: boolean },
  deps: CliDeps,
  ioPair: Io,
): Promise<number> {
  // Sealed chain re-start: keep the chain on the queue it lived on (the
  // completed workflow is still describable); no workflow → chain-id queue.
  const taskQueue =
    deps.taskQueue ??
    (await describeWorkflowTaskQueue(chainId, { address: flags.address })) ??
    chainId;
  const worker = await createRunnerWorker({
    adapters: deps.adapters ?? DEFAULT_ADAPTERS,
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue,
    routerOptions: deps.routerOptions,
    workflowBundlePath: deps.workflowBundlePath,
  });
  const workerDone = worker.run();
  const runner = createTemporalRunner({
    address: flags.address,
    dataDir: flags.dataDir,
    taskQueue,
  });
  try {
    // Snapshot the pre-resume journal length BEFORE starting the new workflow
    // execution — this is the `sinceIdx` baseline followChain needs to avoid
    // reporting the chain's pre-resume FAILED seal as this resume's outcome.
    const sinceIdx = chainEntryCount(flags.dataDir, chainId);
    await runner.resumeChain(chainId);
    ioPair.out(`resume delivered to chain ${chainId} (retrying the failed node)`);
    const final = await followChain(chainId, flags, { watch: flags.watch, deps, io: ioPair, sinceIdx });
    return finishChain(chainId, final, flags, ioPair);
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
