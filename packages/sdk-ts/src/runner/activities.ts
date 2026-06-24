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
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  ChainNodeHandoff,
  Checkpoint,
  CheckpointId,
  CompactionPolicy,
  CompactionResult,
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
import { buildDigestMessages } from "./compaction-prompt.js";
import { planCompaction } from "./compaction.js";
import { artifactsDir, journalPath, runDir, sharedArtifactsDir, workspaceDir } from "./paths.js";
import { undeclaredWritePaths } from "../chain/write-set.js";

/** observability.md: one span per checkpoint write (CONTRACTS.md §8). */
export const SPAN_CHECKPOINT = "chikory.checkpoint";

/**
 * Compaction default (WP-203 / ADR-006 / CM-1): once the recall tier exceeds
 * `triggerAfterSteps` summaries, fold everything older than the newest
 * `keepLastN` into one digest at the checkpoint boundary. Hardcoded default —
 * the `DEFAULT_STEP_LIMITS` precedent; a TaskSpec knob can come later.
 */
export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = {
  triggerAfterSteps: 8,
  keepLastN: 5,
};

const execFileAsync = promisify(execFile);

/** Adapters are constructed per run — the store is run-scoped. */
export type AdapterFactory = (ctx: { store: ArtifactStore; model?: string }) => ExecutorAdapter;
export type AdapterRegistry = Record<string, AdapterFactory>;

export interface RunnerActivityDeps {
  dataDir: string;
  adapters: AdapterRegistry;
  /** Router construction options for judge passes (test seam: env/baseUrls). */
  routerOptions?: RouterOptions;
  /** All workers on a distributed task queue must point this at one namespace. */
  handoffStore?: ArtifactStore;
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

function sharedHandoffStore(deps: RunnerActivityDeps): ArtifactStore {
  return deps.handoffStore ?? createLocalArtifactStore(sharedArtifactsDir(deps.dataDir));
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
    }): Promise<
      | { status: "SUCCESS"; workspaceDir: string; baseCommit: string }
      | { status: "FAILED"; reason: string }
    > {
      return withHeartbeat(async () => {
        const ws = workspaceDir(deps.dataDir, input.runId);
        const repo = input.spec.repos[0];
        if (!repo) throw new Error("TaskSpec.repos is empty");
        const setupJournal = openJournal(deps, input.runId);
        try {
          setupJournal.createRun(input.runId, input.spec);
        } finally {
          setupJournal.close();
        }
        const parentRunId = input.spec.chainLink?.parentRunId;
        const parentHandoffs = input.spec.chainLink?.parentHandoffs ?? [];
        if (!existsSync(join(ws, ".git"))) {
          await mkdir(ws, { recursive: true });
          if (parentHandoffs.length > 0) {
            await execFileAsync("git", ["clone", repo.url, ws]);
            if (repo.ref) await git(ws, ["checkout", repo.ref]);
            await git(ws, ["config", "user.name", "chikory"]);
            await git(ws, ["config", "user.email", "runner@chikory.local"]);

            for (const [index, parent] of parentHandoffs.entries()) {
              const parentRepo = parent.repos.find((candidate) => candidate.repoUrl === repo.url);
              if (!parentRepo) {
                return {
                  status: "FAILED",
                  reason: `parent ${parent.nodeId} has no handoff for ${repo.url}`,
                };
              }
              const bundlePath = join(runDir(deps.dataDir, input.runId), `parent-${index}.bundle`);
              await writeFile(bundlePath, await sharedHandoffStore(deps).get(parentRepo.bundleRef));
              const parentRef = `refs/chikory/parents/${index}`;
              await git(ws, [
                "fetch",
                bundlePath,
                `refs/heads/chikory/run-${parent.runId}:${parentRef}`,
              ]);
              await unlink(bundlePath);
              const fetchedHead = await git(ws, ["rev-parse", `${parentRef}^{commit}`]);
              if (fetchedHead !== parentRepo.headCommit) {
                return {
                  status: "FAILED",
                  reason: `parent ${parent.nodeId} bundle head mismatch: ${fetchedHead} != ${parentRepo.headCommit}`,
                };
              }
              if (index === 0) {
                await git(ws, ["checkout", "--detach", parentRef]);
              } else {
                try {
                  await git(ws, ["merge", "--no-ff", "--no-edit", parentRef]);
                } catch {
                  try {
                    await git(ws, ["merge", "--abort"]);
                  } catch {
                    // Git may fail before creating merge state.
                  }
                  return {
                    status: "FAILED",
                    reason: `artifact fan-in conflict while merging parent ${parent.nodeId}`,
                  };
                }
              }
            }
          } else if (parentRunId !== undefined) {
            const parentWs = workspaceDir(deps.dataDir, parentRunId);
            // --no-tags is correctness-critical: inheriting the predecessor's
            // chikory-base tag would make this node's judge diff include the
            // predecessor's work and make <runId>@base roll back too far.
            await execFileAsync("git", ["clone", "--no-tags", parentWs, ws]);
            await git(ws, ["checkout", `chikory/run-${parentRunId}`]);
          } else {
            await execFileAsync("git", ["clone", repo.url, ws]);
            if (repo.ref) await git(ws, ["checkout", repo.ref]);
          }
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
        return { status: "SUCCESS", workspaceDir: ws, baseCommit };
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
     * artifact (the CM-1 co-design point — WP-203 compacts *here*: call the
     * pure `planCompaction` over the recall tier, fold `toDigest` into a
     * digest artifact, journal a `compaction` `CompactionResult`, and snapshot
     * the compacted context — ADR-006). Idempotent by stepIndex; a crash
     * between commit and journal write costs one extra empty commit, never a
     * duplicate journal row.
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

    /**
     * Compaction digest (WP-203 S2 / ADR-006 / CM-1). At the checkpoint
     * boundary, fold the older recall-tier summaries into one LLM-generated
     * prose digest so a resumed run rehydrates the gist, not rotted verbatim
     * context. The pure `planCompaction` decides WHAT folds; this activity makes
     * the digest router call, stores the digest behind a Memory Pointer (WP-202,
     * reusing the `context_snapshot` kind), and journals a `compaction`
     * `CompactionResult`. Idempotent by stepIndex. Returns undefined — with no
     * LLM call and no journal row — when there is nothing NEW to fold, so a
     * best-effort digest never re-summarizes the same prefix every step.
     */
    async compactContext(input: {
      runId: string;
      stepIndex: number;
      summaries: string[];
      // WP-207 act half: when the live pacing decision is `compact`/`park`, fold
      // history beyond the verbatim window NOW instead of waiting for the
      // count-based trigger. The pressure path lowers the effective trigger to
      // `keepLastN` — `planCompaction` is unchanged, it just receives a different
      // policy. Optional so legacy callers default to the count cadence.
      underPressure?: boolean;
    }): Promise<CompactionResult | undefined> {
      return withHeartbeat(async () => {
        const journal = openJournal(deps, input.runId);
        try {
          const existing = journal.findByKey("compaction", "stepIndex", input.stepIndex);
          if (existing) return existing.payload as CompactionResult;

          const policy: CompactionPolicy = input.underPressure
            ? {
                triggerAfterSteps: DEFAULT_COMPACTION_POLICY.keepLastN,
                keepLastN: DEFAULT_COMPACTION_POLICY.keepLastN,
              }
            : DEFAULT_COMPACTION_POLICY;
          const plan = planCompaction(input.summaries, policy);
          if (plan.toDigest.length === 0) return undefined;

          // Cost guard: only re-digest when the folded set actually grew since
          // the last compaction — never re-summarize the same prefix each step.
          // `foldedCount` rides on the journaled payload (the `stepIndex`-on-
          // checkpoint-payload precedent) purely as this dedupe signal.
          const prior = journal.entries("compaction");
          const lastFolded =
            prior.length > 0
              ? ((prior[prior.length - 1]!.payload as { foldedCount?: number }).foldedCount ?? 0)
              : 0;
          if (plan.toDigest.length <= lastFolded) return undefined;

          const spec = requireSpec(journal, input.runId);
          // Single-stage routing off the spec's review model (the judgeStep
          // precedent): only that provider's adapter is constructed.
          const reviewModel: ModelChoice = {
            provider: spec.routing.stages.review.provider,
            model: spec.routing.stages.review.model,
          };
          const routing: RoutingPolicy = {
            stages: { plan: reviewModel, code: reviewModel, review: reviewModel, judge: reviewModel },
          };
          const router = createRouter(routing, deps.routerOptions);
          const result = await router.complete({
            stage: "review",
            messages: buildDigestMessages(plan.toDigest),
            temperature: 0,
          });
          if (result.status !== "SUCCESS") {
            // Best-effort: a failed digest never fails the run (CM-1 is an
            // optimization, not a correctness gate).
            console.warn(
              `[chikory] compaction digest call failed at step ${input.stepIndex}: ${result.reason}`,
            );
            return undefined;
          }

          const store = createLocalArtifactStore(artifactsDir(deps.dataDir, input.runId));
          const digestRef = await store.put(result.content, {
            kind: "context_snapshot",
            summary: `digest of ${plan.toDigest.length} older step summaries`,
          });
          const compaction: CompactionResult = {
            tokensBefore: result.tokens.input,
            tokensAfter: result.tokens.output,
            digestRef,
          };
          journal.appendOnce(
            { field: "stepIndex", value: input.stepIndex },
            {
              kind: "compaction",
              payload: {
                ...compaction,
                foldedCount: plan.toDigest.length,
                // WP-207: which cadence fired this fold — `pacing` (token-window
                // pressure) or `count` (the recall-tier reached triggerAfterSteps).
                trigger: input.underPressure ? "pacing" : "count",
              },
              costDeltaUsd: result.costUsd,
              tokens: result.tokens,
              artifactRefs: [digestRef],
            },
          );
          return compaction;
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
     * WP-244 dogfood/test-only judge-catch seam: overwrite a workspace-relative
     * file with known-wrong content, deterministically introducing a regression
     * the real-time judge must catch via its acceptance `check` (JD-3) — the
     * analog of the WP-243 park seam for the Agent-as-a-Judge true-positive
     * pillar (dogfood-045 F-46). Idempotent (same path+content writes the same
     * bytes), so it stays replay-safe. Only reached when `spec.debug.seedBadDiff`
     * is armed host-side; refuses any path that escapes the workspace.
     */
    async seedBadDiff(input: { runId: string; path: string; content: string }): Promise<void> {
      const rel = input.path;
      if (rel.length === 0 || rel.startsWith("/") || rel.split("/").includes("..")) {
        throw new Error(
          `seedBadDiff: refusing unsafe path "${rel}" (must be a non-empty workspace-relative path with no "..")`,
        );
      }
      const target = join(workspaceDir(deps.dataDir, input.runId), rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.content);
    },

    /**
     * Seam ledger events (WP-245, F-47): durable, replay-safe telemetry that
     * the WP-244 bad-diff judge-catch seam fired.
     */
    async recordSeamEvent(input: {
      runId: string;
      seamEventIndex: number;
      atStep: number;
      path: string;
      byteCount: number;
    }): Promise<void> {
      const journal = openJournal(deps, input.runId);
      try {
        journal.appendOnce(
          { field: "seamEventIndex", value: input.seamEventIndex },
          {
            kind: "seam",
            payload: {
              seamEventIndex: input.seamEventIndex,
              atStep: input.atStep,
              path: input.path,
              byteCount: input.byteCount,
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
     * Context-window pacing ledger events (WP-207, FA-3 / SE-2): durable,
     * replay-safe telemetry for live context pressure decisions.
     */
    async recordPacingEvent(input: {
      runId: string;
      pacingEventIndex: number;
      atStep: number;
      action: "continue" | "compact" | "park";
      projectedTokens: number;
      remainingTokens: number;
      utilization: number;
    }): Promise<void> {
      const journal = openJournal(deps, input.runId);
      try {
        journal.appendOnce(
          { field: "pacingEventIndex", value: input.pacingEventIndex },
          {
            kind: "pacing",
            payload: {
              pacingEventIndex: input.pacingEventIndex,
              atStep: input.atStep,
              action: input.action,
              projectedTokens: input.projectedTokens,
              remainingTokens: input.remainingTokens,
              utilization: input.utilization,
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
      /**
       * WP-218: which budget tripped. Absent ⇒ "usd" (back-compatible).
       * WP-243: "debug" marks a deterministic dogfood park-injection halt.
       */
      cause?: "usd" | "tokens" | "debug";
      /** WP-218: token headroom at a token HALT (rides the token gate). */
      remainingTokens?: number;
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
              // Additive (WP-218): omit `cause`/`remainingTokens` on the USD
              // path so existing journals/readers stay byte-identical; an
              // absent `cause` means "usd".
              ...(input.cause !== undefined ? { cause: input.cause } : {}),
              ...(input.remainingTokens !== undefined
                ? { remainingTokens: input.remainingTokens }
                : {}),
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

    /** Publish a self-contained repository bundle before a chain node seals SUCCESS. */
    async publishChainHandoff(input: {
      runId: string;
    }): Promise<
      | { status: "SUCCESS"; handoff: ChainNodeHandoff }
      | { status: "FAILED"; reason: string }
    > {
      return withHeartbeat(async () => {
        const journal = openJournal(deps, input.runId);
        try {
          const spec = requireSpec(journal, input.runId);
          const link = spec.chainLink;
          const repo = spec.repos[0];
          if (!link || !repo) return { status: "FAILED", reason: "chain handoff metadata is absent" };
          if (spec.repos.length !== 1) {
            return { status: "FAILED", reason: "chain handoff currently supports exactly one repo" };
          }

          const ws = workspaceDir(deps.dataDir, input.runId);
          const baseCommit = await git(ws, ["rev-parse", `${BASE_TAG}^{commit}`]);
          const headCommit = await git(ws, ["rev-parse", "HEAD"]);
          const changedPaths = (await git(ws, ["diff", "--name-only", `${BASE_TAG}..HEAD`]))
            .split("\n")
            .filter(Boolean)
            .sort();
          if (changedPaths.length === 0) {
            return { status: "FAILED", reason: `node ${link.nodeId} produced no repository changes` };
          }
          const undeclared =
            link.writeSet === undefined
              ? []
              : undeclaredWritePaths(
                  {
                    id: link.nodeId,
                    goal: spec.goal,
                    acceptanceCriteria: spec.acceptanceCriteria,
                    dependsOn: [],
                    writeSet: link.writeSet,
                    budgetUsd: spec.budgetUsd,
                  },
                  changedPaths,
                );
          if (undeclared.length > 0) {
            return {
              status: "FAILED",
              reason: `node ${link.nodeId} wrote outside its declared writeSet: ${undeclared.join(", ")}`,
            };
          }

          const parentSources = new Set(
            (link.parentHandoffs ?? []).flatMap((parent) =>
              parent.repos.map((parentRepo) => parentRepo.sourceCommit),
            ),
          );
          if (parentSources.size > 1) {
            return { status: "FAILED", reason: "parent handoffs do not share one source commit" };
          }
          const sourceCommit = [...parentSources][0] ?? baseCommit;
          const bundlePath = join(runDir(deps.dataDir, input.runId), "handoff.bundle");
          try {
            await unlink(bundlePath);
          } catch {
            // First publication attempt.
          }
          await git(ws, ["bundle", "create", bundlePath, `refs/heads/chikory/run-${input.runId}`]);
          const bundleRef = await sharedHandoffStore(deps).put(await readFile(bundlePath), {
            kind: "repo_snapshot",
            summary: `sealed repository snapshot for ${link.nodeId}`,
          });
          await unlink(bundlePath);

          return {
            status: "SUCCESS",
            handoff: {
              nodeId: link.nodeId,
              runId: input.runId,
              repos: [
                {
                  repoUrl: repo.url,
                  sourceCommit,
                  baseCommit,
                  headCommit,
                  changedPaths,
                  bundleRef,
                },
              ],
            },
          };
        } finally {
          journal.close();
        }
      });
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
      handoff?: ChainNodeHandoff;
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
              ...(input.handoff !== undefined ? { handoff: input.handoff } : {}),
            },
            costDeltaUsd: 0,
            artifactRefs:
              input.handoff?.repos.map((repo) => repo.bundleRef) ?? [],
          });
        }
        journal.sealRun(input.status);
      } finally {
        journal.close();
      }
    },
  };
}
