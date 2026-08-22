/**
 * Pure run-completion review decisions — the cumulative-diff design pass at
 * the SUCCESS seal moment. Deterministic unit tests, `remediation.test.ts`
 * sibling: the decision needs no Temporal and no LLM.
 */
import { describe, expect, it } from "vitest";

import {
  areMateriallySameObjections,
  buildCompletionReviewBrief,
  type CompletionReviewState,
  decideCompletionReview,
  hasRepeatedObjection,
  MAX_COMPLETION_REVIEWS,
  MAX_PROGRESS_GRANTS,
  mergeDesignFindings,
  type RubricResult,
} from "../../src/workflow/completion-review.js";
import type { JudgeForm } from "../../src/types.js";

const BASE = "commit-base";
const LATER = "commit-later";

describe("decideCompletionReview — 2x2x3 input matrix", () => {
  // Dimension 1: { first-verdict seal (sealingDiffBase === baseCommit), later seal (sealingDiffBase !== baseCommit) }
  // Dimension 2: { rubric clean, rubric failing }
  // Dimension 3: { attempts 0, 1, MAX_COMPLETION_REVIEWS (2) }

  // ─── First-verdict seals (sealingDiffBase === baseCommit) ─────────────────
  it("first-verdict seal + clean rubric + attempts 0 => skip (trap A: zero extra passes for clean 1-step run)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("first-verdict seal");
  });

  it("first-verdict seal + clean rubric + attempts 1 => skip", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("first-verdict seal");
  });

  it("first-verdict seal + clean rubric + attempts 2 (exhausted) => skip", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  it("first-verdict seal + failing rubric + attempts 0 => review (the F-180 fix)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("first-verdict seal + failing rubric + attempts 1 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("first-verdict seal + failing rubric + attempts 2 (exhausted) => skip (bound wins over rubric failure)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: BASE,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  // ─── Later seals (sealingDiffBase !== baseCommit) ─────────────────────────
  it("later seal + clean rubric + attempts 0 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + clean rubric + attempts 1 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + clean rubric + attempts 2 (exhausted) => skip", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  it("later seal + failing rubric + attempts 0 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 0,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + failing rubric + attempts 1 => review", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 1,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("review");
  });

  it("later seal + failing rubric + attempts 2 (exhausted) => skip (bound wins over rubric failure)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
      sealingVerdictHasRubricFailures: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") expect(decision.reason).toContain("exhausted");
  });

  // ─── Rubric input spellings (F-194: exactly two, both wired) ──────────────
  it("derives the rubric outcome from a raw rubricResults array when no boolean is given", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        rubricResults: [{ pass: false }],
      }).action,
    ).toBe("review");

    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        rubricResults: [{ pass: true }],
      }).action,
    ).toBe("skip");
  });

  it("the explicit boolean wins over the array when both are supplied", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        sealingVerdictHasRubricFailures: false,
        rubricResults: [{ pass: false }],
      }).action,
    ).toBe("skip");
  });

  it("treats an absent rubric outcome as clean — the pre-F-180 default", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
      }).action,
    ).toBe("skip");
  });

  // ─── Escalation concerns (WP-619) ──────────────────────────────────────────
  it("first-verdict seal + clean rubric + hasEscalationConcerns => review", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        sealingVerdictHasRubricFailures: false,
        hasEscalationConcerns: true,
      }).action,
    ).toBe("review");
  });

  it("first-verdict seal + clean rubric + hasEscalationConcerns + exhausted => skip", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
        sealingVerdictHasRubricFailures: false,
        hasEscalationConcerns: true,
      }).action,
    ).toBe("skip");
  });

  // ─── Standing findings ────────────────────────────────────────────────────
  it("first-verdict seal + clean rubric + hasStandingFindings => review", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: 0,
        sealingVerdictHasRubricFailures: false,
        hasStandingFindings: true,
      }).action,
    ).toBe("review");
  });

  it("first-verdict seal + clean rubric + hasStandingFindings + exhausted => skip", () => {
    expect(
      decideCompletionReview({
        sealingDiffBase: BASE,
        baseCommit: BASE,
        reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
        sealingVerdictHasRubricFailures: false,
        hasStandingFindings: true,
      }).action,
    ).toBe("skip");
  });
});

describe("mergeDesignFindings (trap C: the sealing objection must survive a clean review)", () => {
  const fail = (id: string): RubricResult => ({
    id,
    pass: false,
    justification: `${id} is unsound`,
  });
  const pass = (id: string): RubricResult => ({ id, pass: true, justification: "fine" });

  it("keeps the sealing objection when the completion review comes back clean", () => {
    const merged = mergeDesignFindings([fail("design_serves_overall_goal")], [pass("cumulative")]);
    expect(merged.map((r) => r.id)).toEqual(["design_serves_overall_goal"]);
  });

  it("unions both sides, sealing objections first", () => {
    const merged = mergeDesignFindings([fail("sealing")], [pass("ok"), fail("review")]);
    expect(merged.map((r) => r.id)).toEqual(["sealing", "review"]);
  });

  it("dedupes by rubric id — one finding, not two", () => {
    const merged = mergeDesignFindings([fail("same")], [fail("same")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.justification).toBe("same is unsound");
  });

  it("returns empty when nothing failed on either side", () => {
    expect(mergeDesignFindings([pass("a")], [pass("b")])).toEqual([]);
  });

  it("carries the merged findings into the brief verbatim", () => {
    const merged = mergeDesignFindings([fail("design_serves_overall_goal")], []);
    const brief = buildCompletionReviewBrief({
      criterionResults: [],
      rubricResults: merged,
      concerns: [],
    } as unknown as JudgeForm);
    expect(brief).toContain("design_serves_overall_goal is unsound");
  });

  it("clears a deterministic rubric failure when completion review re-measures as PASS", () => {
    const merged = mergeDesignFindings(
      [fail("no_architecture_violations")],
      [pass("no_architecture_violations")],
    );
    expect(merged).toEqual([]);
  });

  it("clears no_secrets_introduced and pre_existing_suite_still_green when review re-measures as PASS", () => {
    const merged = mergeDesignFindings(
      [fail("no_secrets_introduced"), fail("pre_existing_suite_still_green")],
      [pass("no_secrets_introduced"), pass("pre_existing_suite_still_green")],
    );
    expect(merged).toEqual([]);
  });

  it("fails a deterministic rubric row when completion review fails it, even if sealing passed", () => {
    const merged = mergeDesignFindings(
      [pass("no_architecture_violations")],
      [fail("no_architecture_violations")],
    );
    expect(merged.map((r) => r.id)).toEqual(["no_architecture_violations"]);
  });

  it("keeps deterministic failure when both sealing pass and completion review fail it", () => {
    const merged = mergeDesignFindings(
      [fail("no_architecture_violations")],
      [fail("no_architecture_violations")],
    );
    expect(merged.map((r) => r.id)).toEqual(["no_architecture_violations"]);
  });

  it("acquits deterministic row while keeping LLM-judged design objection when review is otherwise clean", () => {
    const merged = mergeDesignFindings(
      [fail("no_architecture_violations"), fail("design_serves_overall_goal")],
      [pass("no_architecture_violations"), pass("design_serves_overall_goal")],
    );
    expect(merged.map((r) => r.id)).toEqual(["design_serves_overall_goal"]);
  });

  it("unions LLM-judged findings and adopts authoritative deterministic review failure", () => {
    const merged = mergeDesignFindings(
      [fail("design_serves_overall_goal"), pass("no_architecture_violations")],
      [fail("cumulative_design_coherent"), fail("no_architecture_violations")],
    );
    expect(merged.map((r) => r.id)).toEqual([
      "design_serves_overall_goal",
      "cumulative_design_coherent",
      "no_architecture_violations",
    ]);
  });
});

describe("buildCompletionReviewBrief", () => {
  it("folds the failing rubric items into a bounded design-fix brief", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [
        { id: "no_architecture_violations", pass: true, justification: "clean" },
        {
          id: "cumulative_design_coherent",
          pass: false,
          justification: "step 2 duplicated the parser helper from step 1",
        },
      ],
      concerns: [],
    };

    const brief = buildCompletionReviewBrief(form);

    expect(brief).toContain("DESIGN REVIEW BRIEF");
    expect(brief).toContain("cumulative_design_coherent: step 2 duplicated the parser helper");
    expect(brief).not.toContain("no_architecture_violations");
    expect(brief).toContain("do NOT change behavior");
    expect(brief.length).toBeLessThanOrEqual(2000);
  });

  it("builds a REPAIR BRIEF directing a behavior fix when pre_existing_suite_still_green fails", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [
        {
          id: "pre_existing_suite_still_green",
          pass: false,
          justification: "regression suite command `pnpm test` exited 1:\nFAIL test/foo.test.ts > unique_marker_123",
        },
      ],
      concerns: [],
    };

    const brief = buildCompletionReviewBrief(form);

    expect(brief).toContain("REPAIR BRIEF");
    expect(brief).toContain("pre_existing_suite_still_green");
    expect(brief).toContain("unique_marker_123");
    expect(brief).not.toContain("do NOT change behavior, only design");
    expect(brief.length).toBeLessThanOrEqual(2000);
  });

  it("clamps an oversized brief", () => {
    const form: JudgeForm = {
      criterionResults: [],
      rubricResults: [
        { id: "cumulative_design_coherent", pass: false, justification: "x".repeat(5000) },
      ],
      concerns: [],
    };

    expect(buildCompletionReviewBrief(form).length).toBeLessThanOrEqual(2000);
  });
});

describe("areMateriallySameObjections", () => {
  it("returns true for identical id and justification", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "dup helper" },
        { id: "cumulative_design_coherent", justification: "dup helper" },
      ),
    ).toBe(true);
  });

  it("returns false for same id but different justification (dogfood-159)", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "dup helper in utils" },
        { id: "cumulative_design_coherent", justification: "unhandled error in db" },
      ),
    ).toBe(false);
  });

  it("returns false for different id with same justification", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "flawed abstraction" },
        { id: "design_serves_overall_goal", justification: "flawed abstraction" },
      ),
    ).toBe(false);
  });

  it("normalizes leading and trailing whitespace", () => {
    expect(
      areMateriallySameObjections(
        { id: "cumulative_design_coherent", justification: "  dup helper\n" },
        { id: "cumulative_design_coherent", justification: "dup helper" },
      ),
    ).toBe(true);
  });

  it("recognises real judge reworded objections as the same objection (AC-1 / WP-643)", () => {
    const r1 = {
      id: "design_serves_overall_goal",
      justification:
        "The integration passes `attemptedFindings` as an always-defined array, while the original cap is enforced only when `attempted === undefined`. Consequently the normal agent-loop path bypasses `MAX_COMPLETION_REVIEWS` even when the array is empty, explaining the reported third review hit and regressing the established bounded-review behavior.",
    };
    const r2 = {
      id: "design_serves_overall_goal",
      justification:
        "The diff makes cap enforcement conditional on attempted findings being absent or empty, while nonempty history bypasses the fixed review-attempt cap. It also treats an empty history at the cap as exhausted. These choices do not coherently preserve the existing bounded sealing contract and can prematurely stop stalled repairs or permit extra reviews.",
    };
    expect(areMateriallySameObjections(r1, r2)).toBe(true);
    expect(areMateriallySameObjections(r2, r1)).toBe(true);
  });

  it("recognises real judge distinct objections on the same rubric id as different (AC-1 / WP-643)", () => {
    const d1 = {
      id: "design_serves_overall_goal",
      justification:
        "The diff contains concrete goal-breaking defects. Preserved ignored-file bytes are converted from Buffer to UTF-8 text and restored with writeFile(string), so non-UTF-8 files are not byte-preserved. For an ignored file excluded by the preservation budget and then deleted, the committed planner test explicitly expects no restore entry; applyCleanupPlan therefore neither restores it nor reports it. Modified unpreserved files only produce console.warn output, with no mechanism shown for adding the warning to the batch CheckRun output required by the goal.",
    };
    const d2 = {
      id: "design_serves_overall_goal",
      justification:
        "The design bounds ignored-file reads and propagates unrestored-path warnings, but aggregate-budget selection is performed inside 64 concurrent stat workers using shared totalPreservedBytes. Completion order can differ between the before and after snapshots, so an untouched boundary file may receive a content hash in one snapshot and a stat hash in the other. The planner then treats it as modified and may rewrite it or emit a false corruption warning, violating the explicit requirement that untouched ignored files not be rewritten.",
    };
    expect(areMateriallySameObjections(d1, d2)).toBe(false);
    expect(areMateriallySameObjections(d2, d1)).toBe(false);
  });

  it("recognises reworded stream buffer complaints as the same objection (AC-2)", () => {
    const a = {
      id: "design_serves_overall_goal",
      justification:
        "`flushBatchWriter` drops the final chunk because the flush is skipped when `pendingBuffer` is not full, so the consumed seam never receives the tail of the stream.",
    };
    const b = {
      id: "design_serves_overall_goal",
      justification:
        "The tail of the stream is still lost at the consumed seam: `flushBatchWriter` only writes when `pendingBuffer` is full, so a final partial chunk is never emitted.",
    };
    expect(areMateriallySameObjections(a, b)).toBe(true);
  });

  it("recognises different defects concerning the same symbol as DIFFERENT (judge finding)", () => {
    const dropTail = {
      id: "design_serves_overall_goal",
      justification:
        "`flushBatchWriter` drops the final chunk because the flush is skipped when `pendingBuffer` is not full, so the consumed seam never receives the tail of the stream.",
    };
    const duplicateChunks = {
      id: "design_serves_overall_goal",
      justification:
        "`flushBatchWriter` duplicates completed chunks when a retry occurs after a partial network write failure.",
    };
    expect(areMateriallySameObjections(dropTail, duplicateChunks)).toBe(false);
    expect(areMateriallySameObjections(duplicateChunks, dropTail)).toBe(false);
  });

  it("recognises un-named domain objection pairs (connection pool leak vs sql injection)", () => {
    const leakA = {
      id: "design_serves_overall_goal",
      justification:
        "The database connection pool in `db/pool.ts` leaks connections when socket timeout occurs during query execution.",
    };
    const leakB = {
      id: "design_serves_overall_goal",
      justification:
        "Connections in `db/pool.ts` are never released back to the database connection pool when a socket timeout happens, causing resource exhaustion.",
    };
    const sqlInjection = {
      id: "design_serves_overall_goal",
      justification:
        "Raw SQL queries in `db/query.ts` do not parameterize user input, introducing SQL injection vulnerabilities.",
    };
    const deadlock = {
      id: "design_serves_overall_goal",
      justification:
        "`db/pool.ts` deadlocks when acquiring a connection while another worker is resetting the SSL context.",
    };

    expect(areMateriallySameObjections(leakA, leakB)).toBe(true);
    expect(areMateriallySameObjections(leakA, sqlInjection)).toBe(false);
    expect(areMateriallySameObjections(leakA, deadlock)).toBe(false);
  });

  it("recognises un-named domain objection pairs (EventSource leak vs WebSocket heartbeat)", () => {
    const eventSourceA = {
      id: "design_serves_overall_goal",
      justification:
        "Memory leak in EventSource subscription: listeners are not unsubscribed on component unmount.",
    };
    const eventSourceB = {
      id: "design_serves_overall_goal",
      justification:
        "EventSource connection listeners are never removed when unmounting, leaking memory.",
    };
    const websocketHeartbeat = {
      id: "design_serves_overall_goal",
      justification:
        "Race condition in WebSocket heartbeat timer causes premature disconnection.",
    };
    const reconnectFailure = {
      id: "design_serves_overall_goal",
      justification:
        "`EventSource` fails to reconnect with exponential backoff when HTTP 503 is returned.",
    };

    expect(areMateriallySameObjections(eventSourceA, eventSourceB)).toBe(true);
    expect(areMateriallySameObjections(eventSourceA, websocketHeartbeat)).toBe(false);
    expect(areMateriallySameObjections(eventSourceA, reconnectFailure)).toBe(false);
  });

  it("recognises distinct defects on the same symbol with the same defect verb as DIFFERENT", () => {
    // Both defects occur in `db/pool.ts` and both use the verb "leak", but their triggers
    // and conditions are entirely different (socket timeout vs SSL reload temporary cert).
    const timeoutLeak = {
      id: "design_serves_overall_goal",
      justification:
        "The database connection pool in `db/pool.ts` leaks connections when socket timeout occurs during query execution.",
    };
    const certFileLeak = {
      id: "design_serves_overall_goal",
      justification:
        "`db/pool.ts` leaks file descriptors when temporary certificate files are generated during SSL reload.",
    };

    expect(areMateriallySameObjections(timeoutLeak, certFileLeak)).toBe(false);
    expect(areMateriallySameObjections(certFileLeak, timeoutLeak)).toBe(false);
  });

  it("recognises reworded vs distinct defects in validation functions", () => {
    const emailValidationA = {
      id: "design_serves_overall_goal",
      justification:
        "`validateUser` fails to validate email format, allowing malformed email addresses.",
    };
    const emailValidationB = {
      id: "design_serves_overall_goal",
      justification:
        "`validateUser` does not check email formatting, permitting invalid email strings.",
    };
    const passwordLength = {
      id: "design_serves_overall_goal",
      justification:
        "`validateUser` does not check password length, allowing short passwords.",
    };

    expect(areMateriallySameObjections(emailValidationA, emailValidationB)).toBe(true);
    expect(areMateriallySameObjections(emailValidationA, passwordLength)).toBe(false);
  });

  it("recognises reworded vs distinct defects in token authentication", () => {
    const tokenExpiryA = {
      id: "design_serves_overall_goal",
      justification:
        "In `auth/jwt.ts`, token expiration timestamp is checked against local machine clock instead of server time, allowing expired tokens.",
    };
    const tokenExpiryB = {
      id: "design_serves_overall_goal",
      justification:
        "Expired tokens are accepted by `auth/jwt.ts` because token expiry check uses local machine clock instead of server timestamp.",
    };
    const hmacTimingAttack = {
      id: "design_serves_overall_goal",
      justification:
        "In `auth/jwt.ts`, HMAC signature verification uses timing-unsafe string comparison, exposing timing attack vulnerability.",
    };

    expect(areMateriallySameObjections(tokenExpiryA, tokenExpiryB)).toBe(true);
    expect(areMateriallySameObjections(tokenExpiryA, hmacTimingAttack)).toBe(false);
  });

  it("recognises reworded vs distinct defects in service error handling", () => {
    const nullCrashA = {
      id: "design_serves_overall_goal",
      justification:
        "`userService.ts` throws unhandled TypeError when user profile picture is null.",
    };
    const nullCrashB = {
      id: "design_serves_overall_goal",
      justification:
        "`userService.ts` crashes with unhandled null reference when profile avatar image is missing.",
    };
    const unindexedSql = {
      id: "design_serves_overall_goal",
      justification:
        "`userService.ts` performs un-indexed SQL scan when querying users by phone number.",
    };

    expect(areMateriallySameObjections(nullCrashA, nullCrashB)).toBe(true);
    expect(areMateriallySameObjections(nullCrashA, unindexedSql)).toBe(false);
  });

  it("recognises distinct defects sharing generic conditions (format, final, retry) as DIFFERENT", () => {
    // Both defects occur in `validateUser` and share the condition "format", but their
    // focus subjects are different (email vs phone number).
    const emailFormat = {
      id: "design_serves_overall_goal",
      justification:
        "`validateUser` fails to validate email format, allowing malformed email addresses.",
    };
    const phoneFormat = {
      id: "design_serves_overall_goal",
      justification:
        "`validateUser` fails to validate phone number format, allowing malformed phone numbers.",
    };
    expect(areMateriallySameObjections(emailFormat, phoneFormat)).toBe(false);
    expect(areMateriallySameObjections(phoneFormat, emailFormat)).toBe(false);

    // Both defects occur in `flushBatchWriter` and share the condition "final", but their
    // propositions are different (dropping unfull tail buffer vs failing on final retry).
    const unfullBufferFinal = {
      id: "design_serves_overall_goal",
      justification:
        "`flushBatchWriter` drops the final chunk because the flush is skipped when `pendingBuffer` is not full.",
    };
    const finalRetryFailure = {
      id: "design_serves_overall_goal",
      justification:
        "`flushBatchWriter` fails silently on final retry when network write fails repeatedly.",
    };
    expect(areMateriallySameObjections(unfullBufferFinal, finalRetryFailure)).toBe(false);
    expect(areMateriallySameObjections(finalRetryFailure, unfullBufferFinal)).toBe(false);
  });

  it("recognises superset restatements where an objection adds a second point (WP-647)", () => {
    const original = {
      id: "design_serves_overall_goal",
      justification:
        "The design still bases proposition extraction on extensive hand-authored `META_TOKENS`, `GENERIC_CONTAINER_TOKENS`, `GENERIC_VERB_TOKENS`, `CONDITION_TOKENS`, and `DEFECT_CATEGORIES` lists.",
    };
    const superset = {
      id: "design_serves_overall_goal",
      justification:
        "The replacement remains materially vocabulary-driven: `META_TOKENS`, `GENERIC_CONTAINER_TOKENS`, `GENERIC_VERB_TOKENS`, `CONDITION_TOKENS`, and `DEFECT_CATEGORIES` determine proposition contents and operands. The generic `at` stemming suffix can also conflate unrelated terms such as `format` and `form`.",
    };
    expect(areMateriallySameObjections(original, superset)).toBe(true);
    expect(areMateriallySameObjections(superset, original)).toBe(true);
  });

  it("recognises un-named corpus objection pairs (publishableRepoPath prefix handling)", () => {
    // Both findings from run-f3d47cf8 (uncited in labels/acceptance criteria) concern
    // publishableRepoPath returning unpublishable/raw paths when repository prefix match fails.
    const probePathA = {
      id: "design_serves_overall_goal",
      justification:
        "The probe generally reuses ensureGitWorkspace and verifyBaseGreen and isolates refs correctly, but its newly introduced publishableRepoPath returns unpublishable paths when an exact match fails, bypassing workspace isolation.",
    };
    const probePathB = {
      id: "design_serves_overall_goal",
      justification:
        "The probe module generally centralizes the workflow and reuses ensureGitWorkspace and verifyBaseGreen, but publishableRepoPath still exposes internal workspaces when path resolution cannot find a clean repo prefix.",
    };
    const unrelatedCollision = {
      id: "design_serves_overall_goal",
      justification:
        "Although the change consistently applies `publishableRepoPath`, it removes the collision handling that kept the two reported workspace values distinct.",
    };

    expect(areMateriallySameObjections(probePathA, probePathB)).toBe(true);
    expect(areMateriallySameObjections(probePathB, probePathA)).toBe(true);
    expect(areMateriallySameObjections(probePathA, unrelatedCollision)).toBe(false);
    expect(areMateriallySameObjections(unrelatedCollision, probePathA)).toBe(false);
  });
});

describe("hasRepeatedObjection", () => {
  it("returns true when any current finding matches an attempted finding", () => {
    const current = [
      { id: "cumulative_design_coherent", justification: "dup helper" },
      { id: "design_serves_overall_goal", justification: "missing validation" },
    ];
    const attempted = [
      { id: "cumulative_design_coherent", justification: "dup helper" },
    ];
    expect(hasRepeatedObjection(current, attempted)).toBe(true);
  });

  it("returns false when all current findings are new", () => {
    const current = [
      { id: "cumulative_design_coherent", justification: "new objection B" },
    ];
    const attempted = [
      { id: "cumulative_design_coherent", justification: "old objection A" },
    ];
    expect(hasRepeatedObjection(current, attempted)).toBe(false);
  });

  it("returns false when attempted list is empty", () => {
    const current = [
      { id: "cumulative_design_coherent", justification: "objection" },
    ];
    expect(hasRepeatedObjection(current, [])).toBe(false);
  });
});

describe("decideCompletionReview — dynamic attempts for new findings & headroom (WP-640)", () => {
  const fail = (id: string, justification: string): RubricResult => ({
    id,
    pass: false,
    justification,
  });

  it("grants repair attempt for a NEW objection on the same rubric id (dogfood-159)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new objection 2")],
      attemptedFindings: [fail("cumulative_design_coherent", "old objection 1")],
      // A non-empty attempted history means a grant was issued; the state is
      // only coherent with the grant counted (F-413 — the bound is read on
      // every call, so the exemption has to be earned, not assumed).
      progressGrantsUsed: 1,
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("review");
  });

  it("skips and stops when the objection is materially the SAME as previously attempted", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "same objection 1")],
      attemptedFindings: [fail("cumulative_design_coherent", "same objection 1")],
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });

  it("skips when a reworded superset objection repeats an attempted complaint under the same rubric id (AC-2)", () => {
    const attempted = fail(
      "design_serves_overall_goal",
      "The design still bases proposition extraction on extensive hand-authored `META_TOKENS`, `GENERIC_CONTAINER_TOKENS`, `GENERIC_VERB_TOKENS`, `CONDITION_TOKENS`, and `DEFECT_CATEGORIES` lists.",
    );
    const current = fail(
      "design_serves_overall_goal",
      "The replacement remains materially vocabulary-driven: `META_TOKENS`, `GENERIC_CONTAINER_TOKENS`, `GENERIC_VERB_TOKENS`, `CONDITION_TOKENS`, and `DEFECT_CATEGORIES` determine proposition contents and operands. The generic `at` stemming suffix can also conflate unrelated terms such as `format` and `form`.",
    );

    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [current],
      attemptedFindings: [attempted],
      progressGrantsUsed: 1,
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });

  it("grants review when a genuinely different second objection is raised under the same rubric id (AC-2)", () => {
    const attempted = fail(
      "design_serves_overall_goal",
      "The oversized-endpoint fallback in `renderCompletionReviewConcerns` calls clampText on the oldest and newest findings.",
    );
    const current = fail(
      "design_serves_overall_goal",
      "Raw SQL queries in `db/query.ts` do not parameterize user input, introducing SQL injection vulnerabilities.",
    );

    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [current],
      attemptedFindings: [attempted],
      progressGrantsUsed: 1,
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("review");
  });

  it("skips when one finding is resolved but another previously attempted finding persists", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [
        fail("cumulative_design_coherent", "unresolved finding A"),
        fail("design_serves_overall_goal", "brand new finding C"),
      ],
      attemptedFindings: [
        fail("cumulative_design_coherent", "unresolved finding A"),
        fail("design_serves_overall_goal", "resolved finding B"),
      ],
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });

  it("skips when finding is new but step headroom is exhausted (stepIndex >= maxSteps)", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new finding")],
      attemptedFindings: [fail("cumulative_design_coherent", "old finding")],
      hasStepHeadroom: false,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("step headroom exhausted");
    }
  });

  it("skips when finding is new but budget headroom is exhausted", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new finding")],
      attemptedFindings: [fail("cumulative_design_coherent", "old finding")],
      hasStepHeadroom: true,
      hasBudgetHeadroom: false,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("budget headroom exhausted");
    }
  });

  it("skips when remainingSteps is 0 even if hasStepHeadroom is not explicitly false", () => {
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 2,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "new finding")],
      attemptedFindings: [fail("cumulative_design_coherent", "old finding")],
      remainingSteps: 0,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("step headroom exhausted");
    }
  });

  it("prevents oscillation when an earlier finding re-appears after an intervening finding", () => {
    // Attempted history holds both A and B. Current finding re-introduces A.
    const decision = decideCompletionReview({
      sealingDiffBase: LATER,
      baseCommit: BASE,
      reviewAttemptsUsed: 3,
      sealingVerdictHasRubricFailures: true,
      currentFindings: [fail("cumulative_design_coherent", "finding A")],
      attemptedFindings: [
        fail("cumulative_design_coherent", "finding A"),
        fail("design_serves_overall_goal", "finding B"),
      ],
      hasStepHeadroom: true,
      hasBudgetHeadroom: true,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toContain("repeated objection");
    }
  });
});


describe("decideCompletionReview — the bound survives a repair history (F-412/F-413)", () => {
  const fail = (id: string, justification: string): RubricResult => ({
    id,
    pass: false,
    justification,
  });

  // The two objections THIS defect was found on: run-de555224's completion
  // review #1 (journal idx 12) and #2 (idx 24), verbatim. Same rubric id, the
  // same complaint — that an always-defined `attemptedFindings` array bypasses
  // the cap — in different words. `areMateriallySameObjections` cannot see it.
  const REWORDED_1 = fail(
    "design_serves_overall_goal",
    "The integration passes `attemptedFindings` as an always-defined array, while the original cap is enforced only when `attempted === undefined`. Consequently the normal agent-loop path bypasses `MAX_COMPLETION_REVIEWS` even when the array is empty, explaining the reported third review hit and regressing the established bounded-review behavior.",
  );
  const REWORDED_2 = fail(
    "design_serves_overall_goal",
    "The diff makes cap enforcement conditional on attempted findings being absent or empty, while nonempty history bypasses the fixed review-attempt cap. It also treats an empty history at the cap as exhausted. These choices do not coherently preserve the existing bounded sealing contract and can prematurely stop stalled repairs or permit extra reviews.",
  );

  const withHeadroom = (extra: Partial<CompletionReviewState>): CompletionReviewState => ({
    sealingDiffBase: LATER,
    baseCommit: BASE,
    reviewAttemptsUsed: 0,
    sealingVerdictHasRubricFailures: true,
    hasStepHeadroom: true,
    hasBudgetHeadroom: true,
    ...extra,
  });

  it("F-412 / WP-643: a REWORDED repeat is recognized as a repeat and stops immediately", () => {
    // The comparator recognizes REWORDED_2 as the same objection as REWORDED_1,
    // so the run stops as a repeated objection rather than burning grants.
    const decision = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: 1,
        currentFindings: [REWORDED_2],
        attemptedFindings: [REWORDED_1],
        progressGrantsUsed: 1,
      }),
    );
    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" && decision.reason).toBe(
      "completion review: repeated objection on a converged step",
    );
  });

  it("F-412: genuinely new findings cannot buy more than MAX_PROGRESS_GRANTS extra passes", () => {
    // When findings are genuinely distinct, MAX_PROGRESS_GRANTS still caps total passes.
    const atCeiling = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: MAX_COMPLETION_REVIEWS + MAX_PROGRESS_GRANTS,
        currentFindings: [fail("cumulative_design_coherent", "genuinely new objection B")],
        attemptedFindings: [fail("design_serves_overall_goal", "distinct objection A")],
        progressGrantsUsed: 99, // a judge that finds new problems on every pass
      }),
    );
    expect(atCeiling.action).toBe("skip");
    expect(atCeiling.action === "skip" && atCeiling.reason).toBe("completion reviews exhausted");
  });

  it("F-413: the cap is consulted even once a repair history exists", () => {
    // The shape of the agent loop's FIRST call site: no currentFindings (the
    // review has not run yet), a non-empty attempted history from an earlier
    // grant. Before the fix this returned `review` at any attempt count.
    const decision = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: 99,
        hasRegressionSuite: true,
        hasEscalationConcerns: true,
        hasStandingFindings: true,
        attemptedFindings: [REWORDED_1],
        progressGrantsUsed: 1,
      }),
    );
    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" && decision.reason).toBe("completion reviews exhausted");
  });

  it("one NEW finding still buys exactly one extra pass past the base cap", () => {
    expect(
      decideCompletionReview(
        withHeadroom({
          reviewAttemptsUsed: MAX_COMPLETION_REVIEWS,
          currentFindings: [fail("cumulative_design_coherent", "a genuinely new objection")],
          attemptedFindings: [fail("design_serves_overall_goal", "the first objection")],
          progressGrantsUsed: 1,
        }),
      ).action,
    ).toBe("review");
    expect(
      decideCompletionReview(
        withHeadroom({
          reviewAttemptsUsed: MAX_COMPLETION_REVIEWS + 1,
          currentFindings: [fail("cumulative_design_coherent", "a genuinely new objection")],
          attemptedFindings: [fail("design_serves_overall_goal", "the first objection")],
          progressGrantsUsed: 1,
        }),
      ).action,
    ).toBe("skip");
  });

  it("F-414: lastAttemptedFindings is read even when attemptedFindings is an empty array", () => {
    const decision = decideCompletionReview(
      withHeadroom({
        reviewAttemptsUsed: 1,
        currentFindings: [REWORDED_1],
        attemptedFindings: [],
        lastAttemptedFindings: [REWORDED_1],
        progressGrantsUsed: 1,
      }),
    );
    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" && decision.reason).toBe(
      "completion review: repeated objection on a converged step",
    );
  });
});

// ── F-416 (dogfood-161 review): unseen real prose, driven through the seam ────
// `run-eef8a03d-c6b6-4165-9738-d002cef3d56d` — the WP-643 run itself — raised ONE
// complaint in its four completion reviews: the comparator uses broad lexical
// shortcuts that can collapse distinct objections. It restated that complaint
// against different code every pass. Neither the acceptance checks nor the
// committed tests the delivery authored ever saw this prose, which is exactly why
// it is pinned here (F-403: a test copied from a grading check inherits its blind
// spots).
//
// Measured at the review: pairwise, the comparator answers "same" on only 2 of the
// 6 pairs, and review #4's wording matches NONE of its three predecessors. What
// makes the loop stop anyway is the ACCUMULATING history at `agent-loop.ts:263`
// (pushed at `:1406`) — this test drives that seam, because the pairwise answer is
// not the behaviour the run feels.
const EEF8A03D_REVIEWS: RubricResult[] = [
  { id: "design_serves_overall_goal", pass: false, justification: "The diff still determines sameness through broad shortcuts and fixed similarity thresholds. In particular, one shared nontrivial code entity immediately returns true, so distinct defects involving the same symbol\u2014such as `flushBatchWriter` dropping a tail versus duplicating chunks\u2014would be collapsed. The shared-bigram and 0.30/0.60 token-overlap cutoffs are also similarity thresholds. This directly conflicts with the goal of deciding what an objection is about while preserving genuinely different objections as new." },
  { id: "design_serves_overall_goal", pass: false, justification: "The comparator remains an ad hoc lexical-classification system rather than a sound representation of what an objection is about. For example, two objections sharing a code entity and one stemmed defect action return true regardless of whether the action describes different failures; likewise, one shared defect bigram is sufficient, and another branch uses a fixed minimum of two shared non-entity tokens. The added categories handle selected counterexamples such as loss versus duplication, but do not generally prevent distinct defects involving the same symbol and action from collapsing. This is a real unfulfilled requirement because genuinely different objections must remain new, not merely the supplied examples." },
  { id: "design_serves_overall_goal", pass: false, justification: "The comparator remains a hand-built lexical-similarity heuristic rather than a sound representation of the objection proposition. It can return true from a shared target plus one shared condition and defect category, and its fallback explicitly uses fixed cutoffs of at least three shared mechanism tokens and 50% overlap. Distinct defects involving the same symbol, generic condition, and broad category can therefore be collapsed. This is the threshold/shortcut design the goal explicitly warns against, even though the selected examples pass." },
  { id: "design_serves_overall_goal", pass: false, justification: "The implementation removes the stated numeric thresholds, but still equates objections using a hand-built lexical profile that can collapse distinct propositions. For example, same-rubric objections that say `flushBatchWriter` \u201cdrops metadata on retry\u201d and \u201closes checksum on retry\u201d share a code entity, the LOSS_OR_OMISSION category, and the retry condition; neither metadata nor checksum is represented as a distinguishing focus or attribute. The final hasSharedFocus/hasSharedMechanism test therefore returns true even though the objections concern different lost data. This is a concrete structural failure of the goal that genuinely different objections remain new." },
];

describe("the reworded-repeat instrument on prose it was not fitted to (F-416)", () => {
  /** Mirrors `agent-loop.ts:263`/`:1406` — findings accumulate, repeats are not pushed. */
  const passAtWhichTheLoopStops = (
    reviews: ReadonlyArray<RubricResult>,
    same: (a: RubricResult, b: RubricResult) => boolean,
  ): number | null => {
    const attempted: RubricResult[] = [];
    for (let p = 0; p < reviews.length; p += 1) {
      const current = reviews[p]!;
      if (attempted.some((a) => same(current, a))) return p + 1;
      attempted.push(current);
    }
    return null;
  };

  const byteEquality = (a: RubricResult, b: RubricResult): boolean =>
    a.id === b.id && a.justification.trim() === b.justification.trim();

  it("stops an oscillation the shipped string equality ran to the end of", () => {
    expect(
      passAtWhichTheLoopStops(EEF8A03D_REVIEWS, byteEquality),
      "the comparator WP-643 replaced never recognised any of these four restatements, so every one bought another repair attempt — the F-412 defect, measured on a real run.",
    ).toBeNull();
    expect(
      passAtWhichTheLoopStops(EEF8A03D_REVIEWS, areMateriallySameObjections),
      "driven through the accumulating history, the instrument must stop this real oscillation at review #2. A regression here means a reworded repeat buys repair attempts again.",
    ).toBe(2);
  });

  it("recognises at least the adjacent restatements pairwise", () => {
    // Deliberately NOT 6/6: the review measured 2/6 and queued the gap as WP-644.
    // This floor exists so the number can only move up. Raise it when it does.
    let same = 0;
    for (let i = 0; i < EEF8A03D_REVIEWS.length; i += 1) {
      for (let j = i + 1; j < EEF8A03D_REVIEWS.length; j += 1) {
        if (areMateriallySameObjections(EEF8A03D_REVIEWS[i]!, EEF8A03D_REVIEWS[j]!)) same += 1;
      }
    }
    expect(
      same,
      "of the 6 pairs of one complaint restated four ways, the instrument recognised 2 at the dogfood-161 review; fewer than that is a regression.",
    ).toBeGreaterThanOrEqual(2);
  });

  it("keeps two genuinely different complaints on one rubric id apart", () => {
    // Both from `run-ec5c4bb8-de16-4c28-beba-a8cd09795fa1`, neither named by any
    // acceptance check in this shape: a UTF-8 round-trip corruption and an
    // unstable concurrent budget selection.
    const corruption: RubricResult = {
      id: "design_serves_overall_goal",
      pass: false,
      justification:
        "Preserved ignored-file bytes are converted from Buffer to UTF-8 text and restored with writeFile(string), so non-UTF-8 files are not byte-preserved.",
    };
    const concurrency: RubricResult = {
      id: "design_serves_overall_goal",
      pass: false,
      justification:
        "Aggregate-budget selection runs inside 64 concurrent stat workers sharing totalPreservedBytes, so completion order can differ between the before and after snapshots and an untouched boundary file is treated as modified.",
    };
    expect(
      areMateriallySameObjections(corruption, concurrency),
      "calling two different complaints a repeat strands a run that could have healed itself — the error a similarity threshold makes.",
    ).toBe(false);
  });
});
