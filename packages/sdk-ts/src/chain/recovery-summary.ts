import type { NodeOutcome } from "../types.js";

export const MAX_NODE_RECOVERY_REASON_CHARS = 200;

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function capReason(reason: string): string {
  const normalized = oneLine(reason);
  if (normalized.length <= MAX_NODE_RECOVERY_REASON_CHARS) return normalized;

  return `${normalized.slice(0, MAX_NODE_RECOVERY_REASON_CHARS - 1)}…`;
}

/**
 * Renders one sealed chain node as a deterministic, bounded single-line
 * recovery summary.
 */
export function summarizeNodeRecovery(
  nodeId: string,
  outcome: NodeOutcome,
  attempts: number,
  lastFailureReason: string,
): string {
  return `${oneLine(nodeId)} · ${outcome.status} · attempts ${attempts} · last failure: ${capReason(lastFailureReason)}`;
}
