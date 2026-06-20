import type { ChainRecord, PlanNode } from "../types.js";
import type { ChainEntry } from "./store.js";

interface TerminalPayload {
  status: string;
  reason?: string;
}

const RULE_WIDTH = 60;

function outcomeCell(record: ChainRecord, node: PlanNode): string {
  const outcome = record.nodeOutcomes[node.id];
  if (!outcome) return "· pending";
  switch (outcome.status) {
    case "SUCCESS":
      return `✓ SUCCESS (${outcome.verdict})`;
    case "FAILED":
      return `⛔ FAILED (${outcome.verdict})`;
  }
}

/**
 * Chain-trace renderer (WP-219 / ADR-005 §S6).
 *
 * Pure chain-level analog of `renderTrace`: renders a `ChainRecord` plus the
 * chain journal entries into a human-readable reconstruction with no I/O.
 */
export function renderChainTrace(record: ChainRecord, entries: ChainEntry[]): string {
  const lines: string[] = [];
  const nodes = record.plan.nodes;
  const total = nodes.length;
  const succeeded = nodes.filter((node) => record.nodeOutcomes[node.id]?.status === "SUCCESS").length;
  const failed = nodes.filter((node) => record.nodeOutcomes[node.id]?.status === "FAILED").length;
  const pending = total - succeeded - failed;

  lines.push(`chain ${record.planId} · ${record.status} · ${total} nodes · ${succeeded}/${total} succeeded`);
  lines.push(`goal: ${record.plan.goal}`);
  lines.push("─".repeat(RULE_WIDTH));

  for (const node of nodes) {
    const deps = node.dependsOn.length > 0 ? node.dependsOn.join(",") : "—";
    const run = record.nodeRuns[node.id] ?? "—";
    lines.push(`${node.id} · depends-on ${deps} · run ${run} · ${outcomeCell(record, node)}`);
  }

  lines.push(`totals: nodes ${total} · succeeded ${succeeded} · failed ${failed} · pending ${pending}`);

  const terminal = entries.find((entry) => entry.kind === "terminal");
  if (terminal) {
    const payload = terminal.payload as TerminalPayload;
    if (payload.status === "FAILED" && payload.reason) {
      lines.push(`failed: ${payload.reason}`);
    }
  }

  return lines.join("\n");
}
