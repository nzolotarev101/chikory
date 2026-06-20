import { formatUsd } from "./cost.js";

/** Format a USD amount together with its share of a total. */
export function formatCostShare(part: number, total: number): string {
  return `${formatUsd(part)} (${((part / total) * 100).toFixed(1)}%)`;
}
