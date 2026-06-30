import { parseWpStatus, type WpStatus } from "./wp-status.js";

export interface SpecStalenessInput {
  targetWpId: string;
  planText: string;
}

export interface SpecStalenessReport {
  targetWpId: string;
  status: WpStatus | null;
  stale: boolean;
  reason: string;
}

/**
 * Assesses whether a dogfood spec targets a work package already marked done.
 */
export function assessSpecStaleness(input: SpecStalenessInput): SpecStalenessReport {
  const status = parseWpStatus(input.planText, input.targetWpId);
  const stale = status === "green";

  const reason =
    status === null
      ? `target ${input.targetWpId} not found in plan`
      : stale
        ? `target ${input.targetWpId} already done (🟢) — spec is stale`
        : `target ${input.targetWpId} is ${status} — spec is fresh`;

  return {
    targetWpId: input.targetWpId,
    status,
    stale,
    reason,
  };
}
