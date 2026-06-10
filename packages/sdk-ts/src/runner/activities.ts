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
import { Journal } from "../journal/journal.js";
import { getTracer } from "../otel.js";
import type {
  AcceptanceCriterion,
  ArtifactStore,
  Checkpoint,
  ContextBundle,
  ExecutorAdapter,
  JudgeVerdict,
  StepLimits,
  StepRecord,
  TaskSpec,
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

/** Stub until WP-131 (Lane M4) ships the real harness — see judgeStep. */
const JUDGE_STUB_RATIONALE =
  "auto-PROCEED stub: judge harness lands in WP-131 (Lane M4); criteria intentionally unconfirmed";

export type RunnerActivities = ReturnType<typeof createRunnerActivities>;

export function createRunnerActivities(deps: RunnerActivityDeps) {
  return {
    /**
     * Idempotent run setup: journal run row + workspace. The workspace is a
     * clone of the task repo on a run-private branch `chikory/run-<id>` —
     * user repos never see step commits (durable-runner.md §Checkpoints).
     */
    async prepareRun(input: { runId: string; spec: TaskSpec }): Promise<{ workspaceDir: string }> {
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
        const journal = openJournal(deps, input.runId);
        try {
          journal.createRun(input.runId, input.spec);
        } finally {
          journal.close();
        }
        return { workspaceDir: ws };
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
     * One judge pass = one activity (journaled as a `verdict` entry).
     * WP-121 ships an auto-PROCEED stub so the loop shape (cadence, verdict
     * journaling, activity-per-pass) is real; WP-131/132 (Lane M4) replace
     * the body with the evidence → rubric → verdict harness and wire
     * ROLLBACK/HALT/ESCALATE gating into the workflow.
     */
    async judgeStep(input: {
      runId: string;
      judgeIndex: number;
      atStep: number;
      criteria: AcceptanceCriterion[];
    }): Promise<JudgeVerdict> {
      return withHeartbeat(async () => {
        const journal = openJournal(deps, input.runId);
        try {
          const existing = journal.findByKey("verdict", "judgeIndex", input.judgeIndex);
          if (existing) return (existing.payload as VerdictPayload).verdict;

          const spec = requireSpec(journal, input.runId);
          const verdict: JudgeVerdict = {
            kind: "PROCEED",
            form: {
              criterionResults: input.criteria.map((c) => ({
                id: c.id,
                pass: false,
                justification: JUDGE_STUB_RATIONALE,
              })),
              rubricResults: [],
              concerns: [],
            },
            rationale: JUDGE_STUB_RATIONALE,
            costUsd: 0,
            tokens: { input: 0, output: 0 },
            judgeModel: spec.routing.stages.judge,
          };
          const payload: VerdictPayload = {
            judgeIndex: input.judgeIndex,
            atStep: input.atStep,
            verdict,
          };
          journal.appendOnce(
            { field: "judgeIndex", value: input.judgeIndex },
            {
              kind: "verdict",
              payload,
              costDeltaUsd: verdict.costUsd,
              tokens: verdict.tokens,
              artifactRefs: [],
            },
          );
          return verdict;
        } finally {
          journal.close();
        }
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
