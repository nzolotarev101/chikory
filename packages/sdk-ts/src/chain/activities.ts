/**
 * Chain activities (WP-219 S3-wiring, ADR-005) — the I/O side effects the
 * deterministic `chainLoop` workflow proxies. Mirrors `createRunnerActivities`:
 * the workflow stays pure (reducer + sequencing), every durable write or read
 * is an activity, memoized in Temporal history. All chain-journal writes are
 * idempotent (keyed by nodeId) so a re-executed activity never double-journals
 * a node event (the WP-123 crash-recovery discipline, chain scope).
 */
import { Journal, reportFromJournal } from "../journal/journal.js";
import { chainJournalPath, journalPath } from "../runner/paths.js";
import type { ChainNodeHandoff, NodeOutcome, Plan } from "../types.js";
import { deriveNodeOutcome } from "./node-spec.js";
import type { ReplanDecision } from "./replan.js";
import { ChainJournal } from "./store.js";

export interface ChainActivityDeps {
  dataDir: string;
  replanRemaining?: (input: ReplanRemainingInput) => Promise<ReplanRemainingResult>;
}

export interface ReplanRemainingInput {
  chainId: string;
  plan: Plan;
  failedNodeId: string;
  remainingNodeIds: string[];
  decision: ReplanDecision;
}

export type ReplanRemainingResult =
  | { status: "SUCCESS"; plan: Plan }
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
    async initChain(input: { chainId: string; plan: Plan }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        journal.createChain(input.chainId, input.plan);
        if (journal.entries("plan").length === 0) {
          journal.append("plan", input.plan);
        }
        journal.setStatus("RUNNING");
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
    }): Promise<{ outcome: NodeOutcome; handoff?: ChainNodeHandoff }> {
      const journal = new Journal(journalPath(deps.dataDir, input.childRunId));
      try {
        const report = reportFromJournal(journal);
        if (!report) {
          throw new Error(`child run ${input.childRunId} has no journal — cannot seal node`);
        }
        const terminal = journal.entries("terminal").at(-1)?.payload as
          | { handoff?: ChainNodeHandoff }
          | undefined;
        const result: { outcome: NodeOutcome; handoff?: ChainNodeHandoff } = {
          outcome: deriveNodeOutcome(report.status, report.lastVerdict?.kind),
        };
        if (terminal?.handoff !== undefined) result.handoff = terminal.handoff;
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
      if (deps.replanRemaining === undefined) {
        return { status: "HALT", reason: "no chain replanner is configured" };
      }
      return deps.replanRemaining(input);
    },

    async recordNodeReplanned(input: {
      chainId: string;
      failedNodeId: string;
      reason: string;
      revisedPlan: Plan;
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
          },
        );
        journal.updatePlan(input.revisedPlan);
        journal.setStatus("RUNNING");
      } finally {
        journal.close();
      }
    },

    /** Seal the chain at a terminal status: a `terminal` entry + the chain row. */
    async sealChain(input: {
      chainId: string;
      status: "SUCCESS" | "FAILED";
      reason?: string;
    }): Promise<void> {
      const journal = openChain(deps, input.chainId);
      try {
        if (journal.entries("terminal").length === 0) {
          journal.append("terminal", { status: input.status, reason: input.reason });
        }
        journal.setStatus(input.status, true);
      } finally {
        journal.close();
      }
    },
  };
}
