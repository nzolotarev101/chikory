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
import { isInfraStepFailure as isInfraStepFailureExec } from "../executors/infra-failure.js";
import type { JudgeForm, StepRecord } from "../types.js";

/**
 * Did this step fail for an INFRASTRUCTURE reason — killed at its wall-clock
 * cap, or crashed before producing an answer — rather than because the work was wrong?
 * Such a step's verdict is inconclusive: it says the step was interrupted / died,
 * nothing about the code.
 */
export function isInfraStepFailure(record: Pick<StepRecord, "status"> & Partial<StepRecord>): boolean {
  return isInfraStepFailureExec(record);
}

/** The fields the CG-1 strike counters read off a step record. */
type StrikeCountable = Pick<StepRecord, "status"> & Partial<StepRecord>;

/**
 * F-246 (WP-578) — advance the CG-1 loop-breaker's consecutive-failure count by
 * one step.
 *
 * An infra failure NEITHER adds nor resets: it is not evidence the agent is
 * spinning (it never got its turn), but it must not launder a genuine failing
 * streak either. Skipping — rather than breaking, which is what the rotation
 * counter in `activities.ts` deliberately does for its own reasons — is what
 * keeps `[fail, park, fail, park, fail]` escalating on the third real failure
 * instead of spinning forever.
 *
 * `p3-rung-4`'s `brownfield-001` is why this exists: two steps killed at
 * `maxSeconds=840` plus one quota park counted 3/3, escalated to
 * AWAITING_APPROVAL with no operator behind it, and burned the run's remaining
 * 4 hours on a wall the agent had no part in. Zero of the three strikes were
 * the agent's.
 */
export function advanceStrikeCount(current: number, record: StrikeCountable): number {
  if (isInfraStepFailure(record)) return current;
  return record.status === "FAILED" ? current + 1 : 0;
}

/**
 * The same accounting, re-derived from a journal's step tail — `restoreWorkflowState`
 * must hand the resumed loop the count the live loop held, or a resume silently
 * disagrees with the run it is resuming.
 */
export function consecutiveStrikeTail(records: readonly StrikeCountable[]): number {
  let count = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!;
    if (isInfraStepFailure(record)) continue;
    if (record.status !== "FAILED") break;
    count++;
  }
  return count;
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
