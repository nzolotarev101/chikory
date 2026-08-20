import type { StepRecord } from "../types.js";

/**
 * Legacy detection for journals written before `StepRecord.infraFailed`
 * existed. This is not defensive padding: `chain-0723ac0b-…-node-N-2` is a
 * live resumable run whose replay is the regression proof for this very fix,
 * and its step 0 predates the flag.
 */
export const LEGACY_CAP_KILL_PREFIX = "step exceeded maxSeconds=";

/**
 * Did this step fail for an INFRASTRUCTURE reason — killed at its wall-clock
 * cap, or crashed before producing an answer — rather than because the work was wrong?
 * Such a step's verdict is inconclusive: it says the step was interrupted / died,
 * nothing about the code.
 */
export function isInfraStepFailure(record: Pick<StepRecord, "status"> & Partial<StepRecord>): boolean {
  if (record.status !== "FAILED") return false;
  if (record.infraFailed === true) return true;
  if (record.failure?.reason.startsWith(LEGACY_CAP_KILL_PREFIX) === true) return true;
  if (record.tokens !== undefined && record.tokens.output === 0) return true;
  return false;
}
