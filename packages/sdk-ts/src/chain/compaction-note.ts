import type { ChainNodeHandoff, NodeOutcome, PlanNode } from "../types.js";

export const DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS = 1_200;

export interface StructuredCompactionNoteInput {
  node: PlanNode;
  outcome: NodeOutcome;
  handoff?: ChainNodeHandoff;
  maxChars?: number;
}

function limit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - 3)}...`;
}

function normalizedMax(maxChars: number | undefined): number {
  return Number.isFinite(maxChars) && maxChars !== undefined && maxChars > 0
    ? Math.floor(maxChars)
    : DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS;
}

/**
 * Deterministic, bounded predecessor summary for S4 handoff context. The Git
 * bundle remains the source of files; this note is a compact map of what the
 * predecessor sealed and where its bundle changed the workspace.
 */
export function buildStructuredCompactionNote(input: StructuredCompactionNoteInput): string {
  const changedPaths = (input.handoff?.repos ?? [])
    .flatMap((repo) => repo.changedPaths)
    .slice()
    .sort();
  const lines = [
    `node: ${input.node.id}`,
    `goal: ${input.node.goal}`,
    `outcome: ${input.outcome.status}`,
    `verdict: ${input.outcome.verdict}`,
    `changed_paths: ${changedPaths.length === 0 ? "(none recorded)" : changedPaths.join(", ")}`,
  ];
  return limit(lines.join("\n"), normalizedMax(input.maxChars));
}
