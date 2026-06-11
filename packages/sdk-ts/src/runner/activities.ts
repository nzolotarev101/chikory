/**
 * Runner activities (WP-121) — ALL side effects of the agent loop live here;
 * the workflow itself is pure orchestration (durable-runner.md determinism
 * rules). Each executor step and judge pass is one activity, memoized in
 * Temporal history (the replay journal) AND journaled in SQLite (the
 * product-facing record). Activities are idempotent: journal writes are
 * keyed by deterministic workflow-assigned indices, so re-execution after a
 * crash never duplicates rows or LLM spend (WP-123).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { heartbeat } from "@temporalio/activity";

import { createLocalArtifactStore } from "../artifacts/index.js";
import { buildVerdict, enforceFamilyDiversity, runJudgePass } from "../judge/index.js";
import { Journal, runTotals } from "../journal/journal.js";
import { getTracer, recordJudgePassSpan } from "../otel.js";
import { createRouter, type RouterOptions } from "../router.js";
import type {
  AcceptanceCriterion,
  ArtifactRef,
  ArtifactStore,
  Checkpoint,
  CheckpointId,
  ContextBundle,
  ExecutorAdapter,
  JudgeForm,
  JudgeVerdict,
  ModelChoice,
  RoutingPolicy,
  StepLimits,
  StepRecord,
  TaskSpec,
  TokenUsage,
} from "../types.js";
import { artifactsDir, journalPath, workspaceDir } from "./paths.js";

/** observability.md: one span per checkpoint write (CONTRACTS.md §8). */
export const SPAN_CHECKPOINT = "chikory.checkpoint";

const execFileAsync = promisify(execFile);

/** Adapters are constructed per run — the store is run-scoped. */
export type AdapterFactory = (ctx: { store: ArtifactStore; model?: string }) => ExecutorAdapter;
export type AdapterRegistry = Record<string, AdapterFactory>;

export interface RunnerActivityDeps {
  dataDir: string;
  adapters: AdapterRegistry;
  /** Router construction options for judge passes (test seam: env/baseUrls). */
  routerOptions?: RouterOptions;
}

export interface StepPayload {
  stepIndex: number;
  instruction: string;
  planItem: string;
  record: StepRecord;
}

export interface VerdictPayload {
  judgeIndex: number;
  atStep: number;
  verdict: JudgeVerdict;
}

/** journal-format.md §3 `judge` entry: evidence refs + form + model + cost. */
export interface JudgePayload {
  judgeIndex: number;
  atStep: number;
  form: JudgeForm;
  evidenceRefs: ArtifactRef[];
  evidenceBytes: number;
  judgeModel: ModelChoice;
  costUsd: number;
  tokens: TokenUsage;
  durationMs: number;
  /** Same-family opt-in warnings (WP-133) — journaled for the audit trail. */
  warnings?: string[];
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Long-running activities heartbeat every second so a kill -9'd worker is
 * detected via heartbeatTimeout and the activity is retried promptly
 * (WP-123) instead of waiting out startToCloseTimeout.
 */
async function withHeartbeat<T>(fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    try {
      heartbeat();
    } catch {
      // Not inside an activity context (direct unit-test invocation) — fine.
    }
  }, 1000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

function openJournal(deps: RunnerActivityDeps, runId: string): Journal {
  return new Journal(journalPath(deps.dataDir, runId));
}

function requireSpec(journal: Journal, runId: string): TaskSpec {
  const run = journal.getRun();
  if (!run) throw new Error(`run ${runId} has no journal run row — was prepareRun skipped?`);
  return run.task;
}

/** Git tag marking the workspace state right after prepareRun (= `<runId>@base`). */
const BASE_TAG = "chikory-base";

/**
 * Per-criterion pass booleans from previous JUDGE verdicts, oldest first
 * (rule 3/5 inputs). Runner-sourced loop-breaker escalations carry no form
 * and are skipped.
 */
function criteriaHistoryFromJournal(journal: Journal): Record<string, boolean[]> {
  const history: Record<string, boolean[]> = {};
  for (const entry of journal.entries("verdict")) {
    const payload = entry.payload as VerdictPayload & { source?: string };
    if (payload.source === "runner") continue;
    for (const r of payload.verdict.form.criterionResults) {
      (history[r.id] ??= []).push(r.pass);
    }
  }
  return history;
}

/** Executor step summaries the previous verdict has not already covered. */
function summariesSinceLastVerdict(journal: Journal, atStep: number): string[] {
  let lastJudgedStep = -1;
  for (const entry of journal.entries("verdict")) {
    const payload = entry.payload as VerdictPayload & { source?: string };
    if (payload.source === "runner") continue;
    lastJudgedStep = Math.max(lastJudgedStep, payload.atStep);
  }
  return journal
    .entries("step")
    .map((e) => e.payload as StepPayload)
    .filter((p) => p.stepIndex > lastJudgedStep && p.stepIndex <= atStep)
    .map((p) => p.record.summary);
}

export type RunnerActivities = ReturnType<typeof createRunnerActivities>;

export function createRunnerActivities(deps: RunnerActivityDeps) {
  return {
    /**
     * Idempotent run setup: journal run row + workspace. The workspace is a
     * clone of the task repo on a run-private branch `chikory/run-<id>` —
     * user repos never see step commits (durable-runner.md §Checkpoints).
     */
    async prepareRun(input: {
      runId: string;
      spec: TaskSpec;
    }): Promise<{ workspaceDir: string; baseCommit: string }> {
      return withHeartbeat(async () => {
        const ws = workspaceDir(deps.dataDir, input.runId);
        const repo = input.spec.repos[0];
        if (!repo) throw new Error("TaskSpec.repos is empty");
        if (!existsSync(join(ws, ".git"))) {
          await mkdir(ws, { recursive: true });
          await execFileAsync("git", ["clone", repo.url, ws]);
          if (repo.ref) await git(ws, ["checkout", repo.ref]);
          await git(ws, ["checkout", "-b", `chikory/run-${input.runId}`]);
          await git(ws, ["config", "user.name", "chikory"]);
          await git(ws, ["config", "user.email", "runner@chikory.local"]);
        }
        // Tag the run's base state — `<runId>@base` rollbacks resolve to it
        // (WP-132). Steps only run after prepareRun completes, so on a crashed
        // retry HEAD is still the base commit and tagging stays correct.
        let baseCommit: string;
        try {
          baseCommit = await git(ws, ["rev-parse", `${BASE_TAG}^{commit}`]);
        } catch {
          await git(ws, ["tag", BASE_TAG]);
          baseCommit = await git(ws, ["rev-parse", `${BASE_TAG}^{commit}`]);
        }
        const journal = openJournal(deps, input.runId);
        try {
          journal.createRun(input.runId, input.spec);
        } finally {
          journal.close();
        }
        return { workspaceDir: ws, baseCommit };
      });
    },

    /**
     * One executor step = one activity. Memoization beyond Temporal's own:
     * if the journal already holds a step entry for this stepIndex (crash
     * after journal write, before activity completion ack), the persisted
     * record is returned without re-driving the executor — no duplicate
     * LLM spend (DX-2/3, WP-123).
     */
    async executeStep(input: {
      runId: string;
      stepIndex: number;
      instruction: string;
      context: ContextBundle;
      limits: StepLimits;
    }): Promise<StepRecord> {
      return withHeartbeat(async () => {
        const journal = openJournal(deps, input.runId);
        try {
          const existing = journal.findByKey("step", "stepIndex", input.stepIndex);
          if (existing) return (existing.payload as StepPayload).record;

          const spec = requireSpec(journal, input.runId);
          const factory = deps.adapters[spec.executor.adapter];
          if (!factory) {
            throw new Error(
              `no adapter registered for "${spec.executor.adapter}" (registered: ${Object.keys(deps.adapters).join(", ") || "none"})`,
            );
          }
          const store = createLocalArtifactStore(artifactsDir(deps.dataDir, input.runId));
          const adapter = factory({ store, model: spec.routing.stages.code.model });

          const record = await adapter.runStep({
            workspaceDir: workspaceDir(deps.dataDir, input.runId),
            instruction: input.instruction,
            context: input.context,
            limits: input.limits,
          });

          const payload: StepPayload = {
            stepIndex: input.stepIndex,
            instruction: input.instruction,
            planItem: input.context.planItem,
            record,
          };
          journal.appendOnce(
            { field: "stepIndex", value: input.stepIndex },
            {
              kind: "step",
              payload,
              costDeltaUsd: record.costUsd,
              tokens: record.tokens,
              artifactRefs: [record.diffRef, record.transcriptRef],
            },
          );
          return record;
        } finally {
          journal.close();
        }
      });
    },

    /**
     * One judge pass = one activity (WP-131/132): evidence → form → verdict
     * via the judge harness, journaled as a `judge` entry (form + cost) and a
     * `verdict` entry. Two-stage memoization keeps crashes spend-free: an
     * existing `verdict` entry is returned as-is; an existing `judge` entry
     * without its `verdict` (crash between the two writes) reuses the
     * persisted form and recomputes the verdict deterministically — the LLM
     * is never re-asked (WP-123 discipline).
     */
    async judgeStep(input: {
      runId: string;
      judgeIndex: number;
      atStep: number;
      criteria: AcceptanceCriterion[];
      /** Diff base: checkpoint commit covering the previous verdict (or run base). */
      sinceCommit: string;
      /** ROLLBACK target; absent → `<runId>@base`. */
      lastGoodCheckpointId?: CheckpointId;
    }): Promise<JudgeVerdict> {
      return withHeartbeat(async () => {
        // Read phase — the journal handle is NOT held across the judge pass
        // (an LLM call + git work); long-held writers starve status pollers.
        const reader = openJournal(deps, input.runId);
        let spec: TaskSpec;
        let criteriaHistory: Record<string, boolean[]>;
        let stepSummaries: string[];
        let journaledForm: JudgePayload | undefined;
        try {
          const existing = reader.findByKey("verdict", "judgeIndex", input.judgeIndex);
          if (existing) return (existing.payload as VerdictPayload).verdict;
          spec = requireSpec(reader, input.runId);
          criteriaHistory = criteriaHistoryFromJournal(reader);
          stepSummaries = summariesSinceLastVerdict(reader, input.atStep);
          journaledForm = reader.findByKey("judge", "judgeIndex", input.judgeIndex)?.payload as
            | JudgePayload
            | undefined;
        } finally {
          reader.close();
        }

        let verdict: JudgeVerdict;
        let artifactRefs: ArtifactRef[] = [];
        let judgePayload: JudgePayload | undefined;
        if (journaledForm) {
          // Crash window: form persisted, verdict not yet — recompute
          // deterministically, never re-ask the LLM (zero duplicate spend).
          verdict = buildVerdict(journaledForm.form, criteriaHistory, {
            runId: input.runId,
            judgeModel: journaledForm.judgeModel,
            costUsd: journaledForm.costUsd,
            tokens: journaledForm.tokens,
            lastGoodCheckpointId: input.lastGoodCheckpointId,
          });
        } else {
          const judgeModel: ModelChoice = {
            provider: spec.routing.stages.judge.provider,
            model: spec.judge.model ?? spec.routing.stages.judge.model,
          };
          // Invariant #2 (WP-133): refuse a same-family judge unless the
          // spec opted in — and then warn loudly on EVERY pass, journaled.
          const { warnings } = enforceFamilyDiversity({
            executorFamily: spec.executor.family,
            judgeFamily: spec.judge.family,
            judgeProvider: judgeModel.provider,
            allowSameFamily: spec.judge.allowSameFamily,
          });
          for (const warning of warnings) console.warn(warning);
          // Single-stage routing: only the judge provider's adapter is
          // constructed, so executor-stage env keys are not required here.
          const routing: RoutingPolicy = {
            stages: { plan: judgeModel, code: judgeModel, review: judgeModel, judge: judgeModel },
            ...(spec.routing.failover?.judge
              ? { failover: { judge: spec.routing.failover.judge } }
              : {}),
          };
          const pass = await runJudgePass({
            runId: input.runId,
            router: createRouter(routing, deps.routerOptions),
            judgeModel,
            workspaceDir: workspaceDir(deps.dataDir, input.runId),
            store: createLocalArtifactStore(artifactsDir(deps.dataDir, input.runId)),
            goal: spec.goal,
            criteria: input.criteria,
            sinceCommit: input.sinceCommit,
            criteriaHistory,
            stepSummaries,
            lastGoodCheckpointId: input.lastGoodCheckpointId,
          });
          verdict = pass.verdict;
          const testRef = pass.collected.evidence.testResults?.ref;
          artifactRefs = [...pass.collected.evidence.diffRefs, ...(testRef ? [testRef] : [])];
          judgePayload = {
            judgeIndex: input.judgeIndex,
            atStep: input.atStep,
            form: verdict.form,
            evidenceRefs: artifactRefs,
            evidenceBytes: pass.collected.evidenceBytes,
            judgeModel,
            costUsd: verdict.costUsd,
            tokens: verdict.tokens,
            durationMs: pass.durationMs,
            ...(warnings.length > 0 ? { warnings } : {}),
          };
        }

        // Write phase: `judge` entry carries the spend, once — the paired
        // `verdict` entry is cost-free, so a crash between the two writes
        // can never double-count (journal-format.md §4 cost conservation).
        const writer = openJournal(deps, input.runId);
        try {
          if (judgePayload) {
            writer.appendOnce(
              { field: "judgeIndex", value: input.judgeIndex },
              {
                kind: "judge",
                payload: judgePayload,
                costDeltaUsd: verdict.costUsd,
                tokens: verdict.tokens,
                artifactRefs,
              },
            );
          }
          const payload: VerdictPayload = {
            judgeIndex: input.judgeIndex,
            atStep: input.atStep,
            verdict,
          };
          writer.appendOnce(
            { field: "judgeIndex", value: input.judgeIndex },
            { kind: "verdict", payload, costDeltaUsd: 0, artifactRefs: [] },
          );

          // Judge telemetry (WP-134): span per pass + JD-7 cost-share warning.
          const totals = runTotals(writer);
          if (
            spec.judge.maxCostShare !== undefined &&
            totals.judgeCostShare > spec.judge.maxCostShare
          ) {
            console.warn(
              `[chikory] WARNING: judge spend is ${(totals.judgeCostShare * 100).toFixed(1)}% ` +
                `of run cost ($${totals.judgeCostUsd.toFixed(4)} of $${totals.costUsd.toFixed(4)}), ` +
                `above judge.maxCostShare=${spec.judge.maxCostShare}. Consider a larger cadence (JD-7).`,
            );
          }
          const source = judgePayload ?? journaledForm;
          recordJudgePassSpan({
            runId: input.runId,
            judgeIndex: input.judgeIndex,
            atStep: input.atStep,
            verdict,
            evidenceBytes: source?.evidenceBytes ?? 0,
            latencyMs: source?.durationMs ?? 0,
            judgeCostShare: totals.judgeCostShare,
            maxCostShare: spec.judge.maxCostShare,
          });
          return verdict;
        } finally {
          writer.close();
        }
      });
    },

    /**
     * ROLLBACK restore (WP-132): hard-reset the run workspace to the commit
     * a checkpoint captured. Naturally idempotent; no journal entry of its
     * own — the verdict's `rollbackTo` plus the next checkpoint's commit are
     * the audit trail.
     */
    async restoreCheckpoint(input: { runId: string; checkpointId: string }): Promise<void> {
      return withHeartbeat(async () => {
        const ws = workspaceDir(deps.dataDir, input.runId);
        let sha: string;
        if (input.checkpointId === `${input.runId}@base`) {
          sha = await git(ws, ["rev-parse", `${BASE_TAG}^{commit}`]);
        } else {
          const journal = openJournal(deps, input.runId);
          try {
            const entry = journal
              .entries("checkpoint")
              .find((e) => (e.payload as Checkpoint).id === input.checkpointId);
            if (!entry) {
              throw new Error(`rollback target checkpoint not found: ${input.checkpointId}`);
            }
            const commits = Object.values((entry.payload as Checkpoint).gitCommits);
            if (commits.length === 0 || !commits[0]) {
              throw new Error(`checkpoint ${input.checkpointId} has no git commit recorded`);
            }
            sha = commits[0];
          } finally {
            journal.close();
          }
        }
        await git(ws, ["reset", "--hard", sha]);
        await git(ws, ["clean", "-fd"]);
      });
    },

    /**
     * Checkpointer (WP-122): every step ends in a git commit on the
     * run-private branch + a journal checkpoint row + a context snapshot
     * artifact (the CM-1 co-design point — WP-203 compacts *here*).
     * Idempotent by stepIndex; a crash between commit and journal write
     * costs one extra empty commit, never a duplicate journal row.
     */
    async writeCheckpoint(input: {
      runId: string;
      stepIndex: number;
      context: ContextBundle;
      budgetSpentUsd: number;
      lastGood: boolean;
    }): Promise<Checkpoint> {
      return withHeartbeat(async () => {
        const journal = openJournal(deps, input.runId);
        try {
          const existing = journal.findByKey("checkpoint", "stepIndex", input.stepIndex);
          if (existing) return existing.payload as Checkpoint;

          const spec = requireSpec(journal, input.runId);
          const repoUrl = spec.repos[0]?.url ?? "unknown";
          const ws = workspaceDir(deps.dataDir, input.runId);
          const startTime = Date.now();

          await git(ws, ["add", "-A"]);
          // --allow-empty: a no-change step still checkpoints (DX-4 holds
          // for every step, and resume always has a commit to anchor on).
          await git(ws, ["commit", "--allow-empty", "-m", `chikory: step ${input.stepIndex}`]);
          const sha = await git(ws, ["rev-parse", "HEAD"]);

          const store = createLocalArtifactStore(artifactsDir(deps.dataDir, input.runId));
          const contextSnapshotRef = await store.put(JSON.stringify(input.context, null, 2), {
            kind: "context_snapshot",
            summary: `context snapshot after step ${input.stepIndex}`,
          });

          const journalIdx = journal.nextIdx();
          const checkpoint: Checkpoint = {
            id: `${input.runId}@${journalIdx}`,
            journalIdx,
            gitCommits: { [repoUrl]: sha },
            contextSnapshotRef,
            budgetSpentUsd: input.budgetSpentUsd,
            lastGood: input.lastGood,
          };
          journal.appendOnce(
            { field: "stepIndex", value: input.stepIndex },
            {
              kind: "checkpoint",
              payload: { ...checkpoint, stepIndex: input.stepIndex },
              costDeltaUsd: 0,
              artifactRefs: [contextSnapshotRef],
            },
          );

          const span = getTracer().startSpan(SPAN_CHECKPOINT, { startTime });
          span.setAttribute("run.id", input.runId);
          span.setAttribute("step", input.stepIndex);
          span.setAttribute("git.commit", sha);
          span.setAttribute("journal.idx", journalIdx);
          span.setAttribute("last.good", input.lastGood);
          span.setAttribute("budget.spent.usd", input.budgetSpentUsd);
          span.end();

          return checkpoint;
        } finally {
          journal.close();
        }
      });
    },

    /** WP-212 plumbing: journaled when drained into a step's context. */
    async recordInjection(input: {
      runId: string;
      injectionIndex: number;
      atStep: number;
      text: string;
    }): Promise<void> {
      const journal = openJournal(deps, input.runId);
      try {
        journal.appendOnce(
          { field: "injectionIndex", value: input.injectionIndex },
          {
            kind: "injection",
            payload: {
              injectionIndex: input.injectionIndex,
              source: "human",
              text: input.text,
              atStep: input.atStep,
            },
            costDeltaUsd: 0,
            artifactRefs: [],
          },
        );
      } finally {
        journal.close();
      }
    },

    /**
     * Budget ledger events (WP-124, CG-2): `halt` when the pre-step gate
     * trips, `top_up` when `chikory resume --add-budget` adds funds. The
     * journal makes spend governance auditable (exit-gate #4).
     */
    async recordBudgetEvent(input: {
      runId: string;
      budgetEventIndex: number;
      event: "halt" | "top_up";
      remainingUsd: number;
      details: Record<string, number>;
    }): Promise<void> {
      const journal = openJournal(deps, input.runId);
      try {
        journal.appendOnce(
          { field: "budgetEventIndex", value: input.budgetEventIndex },
          {
            kind: "budget_event",
            payload: {
              budgetEventIndex: input.budgetEventIndex,
              event: input.event,
              remainingUsd: input.remainingUsd,
              details: input.details,
            },
            costDeltaUsd: 0,
            artifactRefs: [],
          },
        );
      } finally {
        journal.close();
      }
    },

    /**
     * Runner-sourced ESCALATE (WP-124 loop-breaker, CG-1). Journaled as a
     * `verdict` entry with `source: "runner"` — no JudgeForm/judgeModel,
     * because no judge ran (journal-format.md §3 documents both shapes).
     */
    async recordEscalation(input: {
      runId: string;
      escalationIndex: number;
      atStep: number;
      reason: string;
    }): Promise<void> {
      const journal = openJournal(deps, input.runId);
      try {
        journal.appendOnce(
          { field: "escalationIndex", value: input.escalationIndex },
          {
            kind: "verdict",
            payload: {
              escalationIndex: input.escalationIndex,
              source: "runner",
              atStep: input.atStep,
              verdict: { kind: "ESCALATE", rationale: input.reason, escalateReason: input.reason },
            },
            costDeltaUsd: 0,
            artifactRefs: [],
          },
        );
      } finally {
        journal.close();
      }
    },

    /**
     * Terminal seal — every run ends with an explicit journal terminal
     * entry; runs never end ambiguously (CG-1, durable-runner.md).
     */
    async sealRun(input: {
      runId: string;
      status: "SUCCESS" | "FAILED" | "CANCELLED";
      reason?: string;
      lastCheckpoint?: string;
    }): Promise<void> {
      const journal = openJournal(deps, input.runId);
      try {
        if (journal.entries("terminal").length === 0) {
          journal.append({
            kind: "terminal",
            payload: {
              status: input.status,
              reason: input.reason,
              lastCheckpoint: input.lastCheckpoint,
            },
            costDeltaUsd: 0,
            artifactRefs: [],
          });
        }
        journal.sealRun(input.status);
      } finally {
        journal.close();
      }
    },
  };
}
