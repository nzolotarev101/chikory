import type { ChainEntry } from "./store.js";

export const MAX_CHAIN_RESUME_SUMMARY_CHARS = 3_000;

const MAX_REOPEN_BOUNDARIES = 12;
const MAX_LINE_CHARS = 220;
const MAX_NODE_ID_CHARS = 64;

interface PlanView {
  nodes: readonly { id: string }[];
}

interface ReopenFact {
  idx: number;
  failedNodeId?: string;
}

interface ReplanFact {
  idx: number;
  failedNodeId: string;
  retryNodeId?: string;
}

interface SealFact {
  idx: number;
  nodeId: string;
  status: "SUCCESS" | "FAILED";
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function planView(value: unknown): PlanView | undefined {
  const candidate = record(value);
  if (candidate === undefined || !Array.isArray(candidate.nodes)) return undefined;

  const nodes: Array<{ id: string }> = [];
  for (const valueNode of candidate.nodes) {
    const node = record(valueNode);
    if (node === undefined || typeof node.id !== "string") return undefined;
    nodes.push({ id: node.id });
  }
  return { nodes };
}

function reopenFact(entry: ChainEntry): ReopenFact | undefined {
  if (entry.kind !== "control_event") return undefined;
  const payload = record(entry.payload);
  if (
    payload === undefined ||
    payload.event !== "resume" ||
    payload.source !== "chain_failed_seal"
  ) {
    return undefined;
  }

  return {
    idx: entry.idx,
    ...(typeof payload.failedNodeId === "string"
      ? { failedNodeId: payload.failedNodeId }
      : {}),
  };
}

function retryNodeId(
  activePlan: PlanView | undefined,
  failedNodeId: string,
  revisedPlan: PlanView,
): string | undefined {
  const failedIndex = activePlan?.nodes.findIndex((node) => node.id === failedNodeId) ?? -1;
  const positionalReplacement =
    failedIndex < 0 ? undefined : revisedPlan.nodes[failedIndex]?.id;
  if (positionalReplacement !== undefined && positionalReplacement !== failedNodeId) {
    return positionalReplacement;
  }

  const prefixedRetry = revisedPlan.nodes.find(
    (node) => node.id !== failedNodeId && node.id.startsWith(`${failedNodeId}-r`),
  );
  if (prefixedRetry !== undefined) return prefixedRetry.id;

  if (activePlan === undefined) return undefined;
  const activeNodeIds = new Set(activePlan.nodes.map((node) => node.id));
  return revisedPlan.nodes.find((node) => !activeNodeIds.has(node.id))?.id;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function limit(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function displayNodeId(value: string | undefined): string {
  const normalized = value === undefined ? "" : oneLine(value);
  return normalized.length === 0 ? "(not recorded)" : limit(normalized, MAX_NODE_ID_CHARS);
}

function outcomeCell(retryNodeIdValue: string | undefined, seal: SealFact | undefined): string {
  if (retryNodeIdValue === undefined) return "recovery not recorded";
  if (seal === undefined) return "outcome not recorded";
  return seal.status === "SUCCESS" ? "recovered SUCCESS" : "sealed FAILED";
}

/**
 * Folds already-read chain journal entries into a deterministic, bounded
 * history of sealed-FAILED reopen boundaries and their replacement retries.
 * The caller remains responsible for reading entries through ChainJournal;
 * this renderer performs no I/O and never re-parses the SQLite store.
 */
export function renderChainResumeSummary(entries: readonly ChainEntry[]): string {
  const orderedEntries = [...entries].sort((left, right) => left.idx - right.idx);
  const reopens: ReopenFact[] = [];
  const replans: ReplanFact[] = [];
  const seals: SealFact[] = [];
  let activePlan: PlanView | undefined;

  for (const entry of orderedEntries) {
    const reopen = reopenFact(entry);
    if (reopen !== undefined) reopens.push(reopen);

    if (entry.kind === "plan") {
      activePlan = planView(entry.payload) ?? activePlan;
      continue;
    }

    if (entry.kind === "node_replanned") {
      const payload = record(entry.payload);
      const revisedPlan = planView(payload?.revisedPlan);
      if (
        payload === undefined ||
        typeof payload.failedNodeId !== "string" ||
        revisedPlan === undefined
      ) {
        continue;
      }
      const replacementNodeId = retryNodeId(activePlan, payload.failedNodeId, revisedPlan);
      replans.push({
        idx: entry.idx,
        failedNodeId: payload.failedNodeId,
        ...(replacementNodeId !== undefined ? { retryNodeId: replacementNodeId } : {}),
      });
      activePlan = revisedPlan;
      continue;
    }

    if (entry.kind === "node_sealed") {
      const payload = record(entry.payload);
      const outcome = record(payload?.outcome);
      if (
        payload !== undefined &&
        typeof payload.nodeId === "string" &&
        (outcome?.status === "SUCCESS" || outcome?.status === "FAILED")
      ) {
        seals.push({ idx: entry.idx, nodeId: payload.nodeId, status: outcome.status });
      }
    }
  }

  const visibleReopens = reopens.slice(0, MAX_REOPEN_BOUNDARIES);
  const lines = visibleReopens.map((reopen, index) => {
    const nextReopenIdx = reopens[index + 1]?.idx ?? Number.POSITIVE_INFINITY;
    const segmentReplans = replans.filter(
      (replan) => replan.idx > reopen.idx && replan.idx < nextReopenIdx,
    );
    const replan =
      reopen.failedNodeId === undefined
        ? segmentReplans[0]
        : segmentReplans.find((candidate) => candidate.failedNodeId === reopen.failedNodeId);
    const seal =
      replan?.retryNodeId === undefined
        ? undefined
        : seals.find(
            (candidate) =>
              candidate.idx > replan.idx &&
              candidate.idx < nextReopenIdx &&
              candidate.nodeId === replan.retryNodeId,
          );

    return limit(
      [
        `reopen boundary ${index + 1}`,
        `journal idx ${reopen.idx}`,
        `failed node ${displayNodeId(reopen.failedNodeId)}`,
        `retry node ${displayNodeId(replan?.retryNodeId)}`,
        outcomeCell(replan?.retryNodeId, seal),
      ].join(" · "),
      MAX_LINE_CHARS,
    );
  });

  const omitted = reopens.length - visibleReopens.length;
  if (omitted > 0) lines.push(`… ${omitted} more reopen boundary(s)`);
  return limit(lines.join("\n"), MAX_CHAIN_RESUME_SUMMARY_CHARS);
}
