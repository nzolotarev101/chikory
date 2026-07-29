/**
 * F-210 (WP-544) — what the rule-3 stuck-criterion guard is allowed to count.
 *
 * Verdict rule 3 (`judge/verdict.ts`) HALTs a run when one acceptance criterion
 * fails three consecutive verdicts, and calls itself a "goal drift /
 * budget-waste guard". That framing only holds if every counted verdict judged
 * work the executor actually produced and the workspace actually kept. On
 * dogfood-120's `N-2` neither was true for two of the three strikes:
 *
 *   step 0 — executor KILLED at its cap (`step exceeded maxSeconds=600; killed
 *            after 602.9s`). Judged anyway (`cadence: 1`), empty diff, AC fail.
 *            That measures the harness, not the agent.
 *   step 1 — real work, but a destructive-rubric ROLLBACK reverted the diff.
 *            The criterion fail stayed on the ledger describing a tree that no
 *            longer existed.
 *   step 2 — the first honest attempt. Strike 3. HALT.
 *
 * Both exclusions ride the EXISTING `infraFailed` mechanism (WP-263(b)) rather
 * than a second concept: `computeVerdict` and `criteriaHistoryFromJournal`
 * already drop an infra-flagged result from the sequence. Pure — no I/O, no
 * clock.
 */
import type { JudgeForm, StepRecord } from "../types.js";

/**
 * Legacy detection for journals written before `StepRecord.infraFailed`
 * existed. This is not defensive padding: `chain-0723ac0b-…-node-N-2` is a
 * live resumable run whose replay is the regression proof for this very fix,
 * and its step 0 predates the flag.
 */
const LEGACY_CAP_KILL_PREFIX = "step exceeded maxSeconds=";

/**
 * Did this step fail for an INFRASTRUCTURE reason — killed at its wall-clock
 * cap — rather than because the work was wrong? Such a step's verdict is
 * inconclusive: it says the step ran out of time, nothing about the code.
 */
export function isInfraStepFailure(record: Pick<StepRecord, "status" | "failure"> & {
  infraFailed?: boolean;
}): boolean {
  if (record.status !== "FAILED") return false;
  if (record.infraFailed === true) return true;
  return record.failure?.reason.startsWith(LEGACY_CAP_KILL_PREFIX) === true;
}

/**
 * Flag every criterion result of a pass that judged a cap-killed step, so the
 * result rides the JOURNALED form and every later pass skips it too (the
 * history builder reads `infraFailed`, not the step records). The form's
 * `pass` booleans are left exactly as the judge filled them — this suppresses
 * the STRIKE, never the finding: the failing criteria still reach the executor
 * as feedback and still block a SUCCESS seal.
 */
export function markInfraFailedPass(form: JudgeForm, stepInfraFailed: boolean): JudgeForm {
  if (!stepInfraFailed) return form;
  return {
    ...form,
    criterionResults: form.criterionResults.map((result) => ({ ...result, infraFailed: true })),
  };
}

/**
 * A journal entry, reduced to the two facts the sequence cares about: where it
 * sits, and whether it ERASED the work earlier verdicts were judging.
 */
export interface SequenceEvent {
  /** Journal index — the total order the run was written in. */
  idx: number;
  /**
   * True for a ROLLBACK verdict — the judge rejected the diff and `agent-loop`
   * reverted it before the covering checkpoint committed.
   *
   * Deliberately NOT the WP-519 remediation restore, which also rewinds the
   * workspace. Remediation is the tier that fires BECAUSE the criterion is
   * already stuck three verdicts deep; clearing its own trigger would turn one
   * bounded heal attempt into three more judge passes and weaken the guard
   * WP-519 exists to bound.
   */
  restoresWorkspace: boolean;
}

/**
 * The journal index after which criterion history is still meaningful. A
 * workspace restore erases the work every prior verdict was judging, so a
 * guard against goal drift must not keep counting judgements of a diff that no
 * longer exists — it would charge the executor for the very state the judge
 * told it to abandon. Returns -1 when nothing was ever restored.
 */
export function historyCutoffIdx(events: readonly SequenceEvent[]): number {
  let cutoff = -1;
  for (const event of events) {
    if (event.restoresWorkspace && event.idx > cutoff) cutoff = event.idx;
  }
  return cutoff;
}
