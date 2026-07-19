/**
 * Chain activities (WP-219 S3-wiring, ADR-005) — the I/O side effects the
 * deterministic `chainLoop` workflow proxies. Mirrors `createRunnerActivities`:
 * the workflow stays pure (reducer + sequencing), every durable write or read
 * is an activity, memoized in Temporal history. All chain-journal writes are
 * idempotent (keyed by nodeId) so a re-executed activity never double-journals
 * a node event (the WP-123 crash-recovery discipline, chain scope).
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { createLocalArtifactStore } from "../artifacts/local.js";
import { COMPLETION_REVIEW_RUBRIC } from "../judge/rubric.js";
import { runJudgePass } from "../judge/harness.js";
import { renderOverallGoalContext } from "../judge/prompt.js";
import { Journal, reportFromJournal } from "../journal/journal.js";
import { createRouter, type RouterOptions } from "../router.js";
import { BASE_TAG } from "../runner/activities.js";
import { artifactsDir, chainJournalPath, journalPath, workspaceDir } from "../runner/paths.js";
import { collectWorkspaceRepos } from "../runner/workspace-repos.js";
import type {
  ChainNodeHandoff,
  ChainRecord,
  JudgePolicy,
  ModelChoice,
  NodeOutcome,
  Plan,
  RepoSpec,
  RoutingPolicy,
} from "../types.js";
import { deriveNodeOutcome } from "./node-spec.js";
import { buildReplanBrief, buildRetryPlan } from "./replan-plan.js";
import type { ReplanDecision } from "./replan.js";
import { ChainJournal, chainRecordFrom, type ChainCompletionReviewFinding } from "./store.js";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.trim();
}

/** Workspace-repo checkout dir (mirrors the private `workspaceRepoDir` in runner/activities). */
function repoDirIn(ws: string, relativePath: string): string {
  return relativePath === "." ? ws : join(ws, relativePath);
}

export interface ChainActivityDeps {
  dataDir: string;
  replanRemaining?: (input: ReplanRemainingInput) => Promise<ReplanRemainingResult>;
  /** Judge/router construction options — threaded so `reviewChainCompletion` fires in the real worker. */
  routerOptions?: RouterOptions;
}

export interface ReviewChainCompletionInput {
  chainId: string;
  plan: Plan;
  /** node id → child run id (`ChainRecord.nodeRuns`). */
  nodeRuns: Record<string, string>;
  /** node id → sealed outcome (`ChainRecord.nodeOutcomes`). */
  nodeOutcomes: Record<string, NodeOutcome>;
  repos: RepoSpec[];
  judge: JudgePolicy;
  routing: RoutingPolicy;
}

export type ReviewChainCompletionResult =
  | { reviewed: false; reason: string }
  | { reviewed: true; verdict: string; findings: number; diffBase: string };

export interface ReplanRemainingInput {
  chainId: string;
  plan: Plan;
  failedNodeId: string;
  remainingNodeIds: string[];
  decision: ReplanDecision;
  /** WP-521: the failed node's seal reason (judge evidence) fed into the retry brief. */
  failureReason?: string;
}

export type ReplanRemainingResult =
  | { status: "SUCCESS"; plan: Plan; brief?: string }
  | { status: "HALT"; reason: string };

function openChain(deps: ChainActivityDeps, chainId: string): ChainJournal {
  return new ChainJournal(chainJournalPath(deps.dataDir, chainId));
}

export type ChainActivities = ReturnType<typeof createChainActivities>;

export function createChainActivities(deps: ChainActivityDeps) {
  return {
    /**
     * Idempotent chain setup: the chain row + the durable `plan` entry. Safe to
     * re-run on a workflow replay — the plan is journaled at most once.
     */
    async initChain(input: { chainId: string; plan: Plan; template?: unknown }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        journal.createChain(input.chainId, input.plan, input.template);
        if (journal.entries("plan").length === 0) {
          journal.append("plan", input.plan);
        }
        journal.setStatus("RUNNING");
      } finally {
        journal.close();
      }
    },

    /**
     * WP-521(c) restore: rebuild the chain record from the journal at chainLoop
     * (re-)entry. `resumed` is true when the chain previously sealed (a `terminal`
     * entry exists) — a `chikory chain resume` re-start; the reopen boundary
     * (`control_event source:"chain_failed_seal"` + `reopenChain`) is journaled
     * once here (idempotent), mirroring the run-level `restoreWorkflowState`.
     */
    async restoreChain(input: {
      chainId: string;
    }): Promise<{ record?: ChainRecord; resumed: boolean }> {
      const journal = openChain(deps, input.chainId);
      try {
        const record = chainRecordFrom(journal);
        const terminals = journal.entries("terminal");
        const resumed = terminals.length > 0;
        if (resumed) {
          // Append the reopen boundary once per seal→resume cycle: only when the
          // last terminal is newer than the last reopen (mirrors the run-level
          // `lastTerminal.idx > lastReopenIdx` guard — idempotent on replay,
          // distinct across repeated resumes).
          const lastTerminalIdx = terminals[terminals.length - 1]!.idx;
          const reopens = journal.entries("control_event");
          const lastReopenIdx = reopens[reopens.length - 1]?.idx ?? -1;
          if (lastTerminalIdx > lastReopenIdx) {
            const failedNodeId = record
              ? record.plan.nodes.find((n) => record.nodeOutcomes[n.id]?.status === "FAILED")?.id
              : undefined;
            journal.append("control_event", {
              event: "resume",
              source: "chain_failed_seal",
              ...(failedNodeId !== undefined ? { failedNodeId } : {}),
            });
            journal.reopenChain();
          }
        }
        return { ...(record !== undefined ? { record } : {}), resumed };
      } finally {
        journal.close();
      }
    },

    /** Journal that the chain dispatched a node → child run (idempotent). */
    async recordNodeStarted(input: {
      chainId: string;
      nodeId: string;
      childRunId: string;
    }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        journal.appendOnce(
          "node_started",
          { field: "nodeId", value: input.nodeId },
          { nodeId: input.nodeId, childRunId: input.childRunId },
        );
      } finally {
        journal.close();
      }
    },

    /**
     * Read a sealed child run's terminal outcome from its per-run journal and
     * map it to the `NodeOutcome` the reducer folds. The chain never re-judges;
     * it records what the child run already sealed.
     */
    async readNodeResult(input: {
      childRunId: string;
    }): Promise<{ outcome: NodeOutcome; handoff?: ChainNodeHandoff; reason?: string }> {
      const journal = new Journal(journalPath(deps.dataDir, input.childRunId));
      try {
        const report = reportFromJournal(journal);
        if (!report) {
          throw new Error(`child run ${input.childRunId} has no journal — cannot seal node`);
        }
        const terminal = journal.entries("terminal").at(-1)?.payload as
          | { handoff?: ChainNodeHandoff; reason?: string }
          | undefined;
        const result: { outcome: NodeOutcome; handoff?: ChainNodeHandoff; reason?: string } = {
          outcome: deriveNodeOutcome(report.status, report.lastVerdict?.kind),
        };
        if (terminal?.handoff !== undefined) result.handoff = terminal.handoff;
        // WP-521: the seal reason is the retry brief's evidence on a FAILED node.
        if (terminal?.reason !== undefined) result.reason = terminal.reason;
        return result;
      } finally {
        journal.close();
      }
    },

    /** Journal a node's sealed outcome (idempotent). */
    async recordNodeSealed(input: {
      chainId: string;
      nodeId: string;
      outcome: NodeOutcome;
      handoff?: ChainNodeHandoff;
    }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        journal.appendOnce(
          "node_sealed",
          { field: "nodeId", value: input.nodeId },
          {
            nodeId: input.nodeId,
            outcome: input.outcome,
            ...(input.handoff !== undefined ? { handoff: input.handoff } : {}),
          },
        );
      } finally {
        journal.close();
      }
    },

    async replanRemaining(input: ReplanRemainingInput): Promise<ReplanRemainingResult> {
      // An injected replanner (test scripts, a future LLM re-decomposer) wins.
      if (deps.replanRemaining !== undefined) {
        return deps.replanRemaining(input);
      }
      // WP-521 heal-by-default: the self-contained deterministic retry-the-failed-
      // node-with-evidence path — fires in the REAL worker (no injected dep, no
      // router), the `reviewChainCompletion` self-containment principle at the
      // replan seam. `decideReplan` already confirmed we are under budget.
      const brief = buildReplanBrief(input.failedNodeId, input.failureReason ?? "unknown");
      const retryPlan = buildRetryPlan(
        input.plan,
        input.failedNodeId,
        input.failureReason ?? "unknown",
        input.decision.replansUsed,
      );
      return { status: "SUCCESS", plan: retryPlan, brief };
    },

    async recordNodeReplanned(input: {
      chainId: string;
      failedNodeId: string;
      reason: string;
      revisedPlan: Plan;
      brief?: string;
    }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        journal.appendOnce(
          "node_replanned",
          { field: "failedNodeId", value: input.failedNodeId },
          {
            failedNodeId: input.failedNodeId,
            reason: input.reason,
            revisedPlan: input.revisedPlan,
            ...(input.brief !== undefined ? { brief: input.brief } : {}),
          },
        );
        journal.updatePlan(input.revisedPlan);
        journal.setStatus("RUNNING");
      } finally {
        journal.close();
      }
    },

    /**
     * WP-311 chain-completion aggregate design review: ONE judge pass over the
     * chain's cumulative cross-node diff + `plan.goal` + every sealed
     * `NodeOutcome`, run at the SUCCESS seal. Non-destructive — it journals a
     * `chain_completion_review` entry (idempotent per chain) and NEVER re-judges
     * a sealed node or changes the chain status (the F-107 discipline at chain
     * scope). Self-contained (builds its own judge via `createRouter`) so it
     * fires in the real worker, not only test-injected paths.
     *
     * Cumulative diff = the LAST sealed-SUCCESS node's workspace vs the CHAIN
     * base (the FIRST node's `chikory-base`). In a linear chain each node builds
     * on its predecessor's sealed tree, so that diff is the whole-chain delta.
     * If the chain base cannot be resolved in the last node's workspace (e.g. a
     * non-linear handoff), fall back to the last node's own base (its delta) so
     * the review still fires — a degraded, never-fatal path.
     */
    async reviewChainCompletion(
      input: ReviewChainCompletionInput,
    ): Promise<ReviewChainCompletionResult> {
      const journal = openChain(deps, input.chainId);
      try {
        if (journal.entries("chain_completion_review").length > 0) {
          return { reviewed: false, reason: "already reviewed" };
        }
      } finally {
        journal.close();
      }

      // Sealed-SUCCESS nodes in plan order → first (chain base) and last (cumulative head).
      const succeeded = input.plan.nodes.filter(
        (node) => input.nodeOutcomes[node.id]?.status === "SUCCESS",
      );
      if (succeeded.length < 2) {
        return { reviewed: false, reason: "fewer than two sealed-SUCCESS nodes" };
      }
      const firstRunId = input.nodeRuns[succeeded[0]!.id];
      const lastRunId = input.nodeRuns[succeeded[succeeded.length - 1]!.id];
      if (firstRunId === undefined || lastRunId === undefined) {
        return { reviewed: false, reason: "missing node→run linkage" };
      }

      const workspaceRepos = collectWorkspaceRepos(input.repos).all;
      const writable = workspaceRepos.filter((repo) => repo.writable);
      if (writable.length === 0) {
        return { reviewed: false, reason: "no writable repo to diff" };
      }
      const firstWs = workspaceDir(deps.dataDir, firstRunId);
      const lastWs = workspaceDir(deps.dataDir, lastRunId);

      // Resolve the chain base per writable repo from the FIRST node's workspace,
      // then confirm it is reachable in the LAST node's workspace (git bundles
      // preserve history across the handoff). Any failure → node-local fallback.
      const repoDiffBases: Record<string, string> = {};
      let diffBase = "chain-base";
      try {
        for (const repo of writable) {
          const base = await git(repoDirIn(firstWs, repo.relativePath), [
            "rev-parse",
            `${BASE_TAG}^{commit}`,
          ]);
          await git(repoDirIn(lastWs, repo.relativePath), ["cat-file", "-e", `${base}^{commit}`]);
          repoDiffBases[repo.name] = base;
        }
      } catch {
        diffBase = BASE_TAG;
        for (const repo of writable) repoDiffBases[repo.name] = BASE_TAG;
      }
      const sinceCommit = repoDiffBases[writable[0]!.name] ?? BASE_TAG;

      const judgeModel: ModelChoice = {
        provider: input.routing.stages.judge.provider,
        model: input.judge.model ?? input.routing.stages.judge.model,
      };
      const routing: RoutingPolicy = {
        stages: { plan: judgeModel, code: judgeModel, review: judgeModel, judge: judgeModel },
        ...(input.routing.failover?.judge
          ? { failover: { judge: input.routing.failover.judge } }
          : {}),
      };

      const pass = await runJudgePass({
        runId: lastRunId,
        router: createRouter(routing, deps.routerOptions),
        judgeModel,
        workspaceDir: lastWs,
        store: createLocalArtifactStore(artifactsDir(deps.dataDir, lastRunId)),
        goal: input.plan.goal,
        overallGoal: renderOverallGoalContext(
          input.plan.goal,
          input.plan.nodes.map((node) => `${node.id}: ${node.goal}`),
        ),
        criteria: [],
        sinceCommit,
        workspaceRepos,
        repoDiffBases,
        criteriaHistory: {},
        stepSummaries: [],
        rubric: COMPLETION_REVIEW_RUBRIC,
        reviewScope: "cumulative",
      });

      const findings: ChainCompletionReviewFinding[] = pass.verdict.form.rubricResults.map(
        (result) => ({ id: result.id, pass: result.pass, justification: result.justification }),
      );
      const reviewedNodeIds = succeeded.map((node) => node.id);

      const writer = openChain(deps, input.chainId);
      try {
        writer.appendOnce(
          "chain_completion_review",
          { field: "chainId", value: input.chainId },
          {
            chainId: input.chainId,
            verdict: pass.verdict.kind,
            rationale: pass.verdict.rationale,
            findings,
            reviewedNodeIds,
            diffBase,
          },
        );
      } finally {
        writer.close();
      }
      return {
        reviewed: true,
        verdict: pass.verdict.kind,
        findings: findings.filter((finding) => !finding.pass).length,
        diffBase,
      };
    },

    /** Seal the chain at a terminal status: a `terminal` entry + the chain row. */
    async sealChain(input: {
      chainId: string;
      status: "SUCCESS" | "FAILED";
      reason?: string;
      /** WP-521(c): mark a replan-exhausted FAILED that `chikory chain resume` can re-enter. */
      resumable?: boolean;
    }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        // One terminal entry per incarnation: a resumed chain seals again after
        // its reopen `control_event`, so gate on "no terminal since the last
        // reopen" rather than "no terminal ever" (mirrors the run-level re-seal
        // guard keyed on the reopen boundary).
        const terminals = journal.entries("terminal");
        const reopens = journal.entries("control_event");
        const lastReopenIdx = reopens[reopens.length - 1]?.idx ?? -1;
        const sealedSinceReopen = terminals.some((t) => t.idx > lastReopenIdx);
        if (!sealedSinceReopen) {
          journal.append("terminal", {
            status: input.status,
            reason: input.reason,
            ...(input.resumable === true ? { resumable: true } : {}),
          });
        }
        journal.setStatus(input.status, true);
      } finally {
        journal.close();
      }
    },
  };
}
