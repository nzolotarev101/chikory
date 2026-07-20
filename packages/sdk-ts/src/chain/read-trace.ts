import type { ChainRecord, PlanNode } from "../types.js";
import { renderChainDesignSummary } from "./chain-design-summary.js";
import { renderChainRecoverySummary } from "./chain-recovery-summary.js";
import { renderChainResumeSummary } from "./resume-summary.js";
import type { ChainCompletionReviewPayload, ChainEntry } from "./store.js";

export const MAX_CHAIN_READ_TRACE_CHARS = 16_000;

const MAX_RENDERED_NODES = 12;
const MAX_LINE_CHARS = 240;

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function limit(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 1)}…`;
}

function boundedLine(value: string): string {
  return limit(oneLine(value), MAX_LINE_CHARS);
}

function boundedNodeLines(lines: readonly string[]): string[] {
  const visible = lines.slice(0, MAX_RENDERED_NODES).map(boundedLine);
  const omitted = lines.length - visible.length;
  return omitted > 0 ? [...visible, `… ${omitted} more node(s)`] : visible;
}

function topologyLine(node: PlanNode): string {
  const dependencies = node.dependsOn.length === 0 ? "(root)" : node.dependsOn.join(", ");
  return `${node.id} <- ${dependencies}`;
}

function statusLine(record: Readonly<ChainRecord>, node: PlanNode): string {
  const outcome = record.nodeOutcomes[node.id];
  const runId = record.nodeRuns[node.id] ?? "(not started)";
  return outcome === undefined
    ? `${node.id} · PENDING · verdict (none) · run ${runId}`
    : `${node.id} · ${outcome.status} · verdict ${outcome.verdict} · run ${runId}`;
}

function latestCompletionReview(
  entries: readonly ChainEntry[],
): ChainCompletionReviewPayload | undefined {
  let latest: ChainEntry | undefined;
  for (const entry of entries) {
    if (
      entry.kind === "chain_completion_review" &&
      (latest === undefined || entry.idx > latest.idx)
    ) {
      latest = entry;
    }
  }
  return latest?.payload as ChainCompletionReviewPayload | undefined;
}

function completionReviewLine(entries: readonly ChainEntry[]): string {
  const review = latestCompletionReview(entries);
  if (review === undefined) return "(not recorded)";

  const failedFindings = review.findings.filter((finding) => !finding.pass);
  const failedIds =
    failedFindings.length === 0
      ? "none"
      : failedFindings.map((finding) => finding.id).join(", ");
  const reviewedNodes =
    review.reviewedNodeIds.length === 0 ? "(none)" : review.reviewedNodeIds.join(", ");

  return boundedLine(
    `${review.verdict} · reviewed ${reviewedNodes} · findings ${failedFindings.length}/${review.findings.length} failed (${failedIds}) · base ${review.diffBase} · ${review.rationale}`,
  );
}

function summaryLines(summary: string): string[] {
  return summary.length === 0 ? ["(none)"] : boundedNodeLines(summary.split("\n"));
}

/**
 * Pure, read-only reconstruction of a sealed chain. The trace is ordered by
 * the frozen plan and capped so malformed or unexpectedly large journal data
 * cannot produce an unbounded operator-facing block.
 */
export function renderChainReadTrace(
  record: Readonly<ChainRecord>,
  entries: readonly ChainEntry[],
): string {
  const nodes = record.plan.nodes;
  const sealedCount = nodes.filter((node) => record.nodeOutcomes[node.id] !== undefined).length;
  const topology = boundedNodeLines(nodes.map(topologyLine));
  const statuses = boundedNodeLines(nodes.map((node) => statusLine(record, node)));
  const recovery = summaryLines(
    renderChainRecoverySummary(record.plan, record.nodeOutcomes, entries),
  );
  const design = summaryLines(renderChainDesignSummary(record.plan, record.nodeOutcomes));
  const resume = renderChainResumeSummary(entries);

  const lines = [
    boundedLine(
      `chain read trace · ${record.planId} · ${record.status} · sealed ${sealedCount}/${nodes.length}`,
    ),
    boundedLine(`goal: ${record.plan.goal}`),
    "topology:",
    ...topology,
    "node status:",
    ...statuses,
    "recovery summary:",
    ...recovery,
    "design summary:",
    ...design,
    "completion review:",
    completionReviewLine(entries),
  ];
  if (resume.length > 0) {
    lines.push("resume summary:", ...resume.split("\n"));
  }

  return limit(lines.join("\n"), MAX_CHAIN_READ_TRACE_CHARS);
}
