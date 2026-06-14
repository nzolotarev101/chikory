import type { StepRecord } from "../types.js";

/** WP-217/WP-221 F-11 completion milestone trigger. */
export function isCompletionMilestone(record: StepRecord): boolean {
  return (
    record.status === "SUCCESS" &&
    (record.diffRef.bytes === 0 || record.claimsComplete === true)
  );
}
