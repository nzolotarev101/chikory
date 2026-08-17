/**
 * Deterministic verdict rules (WP-131) — CONTRACTS.md §4 rules 1–5,
 * precedence, and the PROCEED defaults. Pure unit tests: the LLM never
 * chooses the verdict, so the verdict logic needs no LLM to test.
 */
import { describe, expect, it } from "vitest";

import {
  blockingConcerns,
  computeVerdict,
  MAX_VERDICT_RATIONALE_CHARS,
  RUBRIC_DESIGN_SERVES_OVERALL_GOAL,
  RUBRIC_PRE_EXISTING_SUITE_GREEN,
  STANDING_RUBRIC,
} from "../../src/judge/index.js";
import type { JudgeForm } from "../../src/types.js";
import { buildCompletionReviewBrief } from "../../src/workflow/completion-review.js";

type Item = { id: string; pass: boolean; justification: string };

const pass = (id: string): Item => ({ id, pass: true, justification: `${id} ok` });
const fail = (id: string): Item => ({ id, pass: false, justification: `${id} violated` });

const allRubricPass = STANDING_RUBRIC.map((r) => pass(r.id));

function form(overrides: Partial<JudgeForm> = {}): JudgeForm {
  return {
    criterionResults: [pass("AC-1")],
    rubricResults: allRubricPass,
    concerns: [],
    ...overrides,
  };
}

describe("computeVerdict (CONTRACTS.md §4)", () => {
  it("rule 1: destructive rubric failure → ROLLBACK even when all criteria pass", () => {
    const rubric = STANDING_RUBRIC.map((r) =>
      r.id === "no_secrets_introduced" ? fail(r.id) : pass(r.id),
    );
    const decision = computeVerdict(form({ rubricResults: rubric }), {});
    expect(decision.kind).toBe("ROLLBACK");
    expect(decision.rationale).toContain("no_secrets_introduced");
  });

  it("rule 1: non-destructive rubric failure (tests_pass) alone does not ROLLBACK", () => {
    const rubric = STANDING_RUBRIC.map((r) => (r.id === "tests_pass" ? fail(r.id) : pass(r.id)));
    const decision = computeVerdict(form({ rubricResults: rubric }), {});
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale).toContain("tests_pass");
  });

  it("rule 1: design_serves_overall_goal failure alone is non-destructive → PROCEED with note", () => {
    const rubric = STANDING_RUBRIC.map((r) =>
      r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL ? fail(r.id) : pass(r.id),
    );
    const decision = computeVerdict(form({ rubricResults: rubric }), {});
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
  });

  it("rule 1: design failure + destructive failure still ROLLBACKs (rule 1 unchanged)", () => {
    const rubric = STANDING_RUBRIC.map((r) =>
      r.id === RUBRIC_DESIGN_SERVES_OVERALL_GOAL || r.id === "no_secrets_introduced"
        ? fail(r.id)
        : pass(r.id),
    );
    const decision = computeVerdict(form({ rubricResults: rubric }), {});
    expect(decision.kind).toBe("ROLLBACK");
    expect(decision.rationale).toContain("no_secrets_introduced");
  });

  it("rule 2: all criteria pass + clean rubric → PROCEED", () => {
    const decision = computeVerdict(
      form({ criterionResults: [pass("AC-1"), pass("AC-2")] }),
      { "AC-1": [false], "AC-2": [false] },
    );
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale).toContain("all 2 acceptance criteria pass");
  });

  it("rule 3: same criterion failing its 3rd consecutive verdict → HALT", () => {
    const decision = computeVerdict(form({ criterionResults: [fail("AC-1")] }), {
      "AC-1": [false, false],
    });
    expect(decision.kind).toBe("HALT");
    expect(decision.rationale).toContain("AC-1");
  });

  it("rule 3: a pass resets the consecutive-failure count", () => {
    const decision = computeVerdict(form({ criterionResults: [fail("AC-1")] }), {
      "AC-1": [false, false, true, false],
    });
    expect(decision.kind).toBe("PROCEED");
  });

  it("rule 3 (F-112): SUPPRESSED while consuming a non-final work chunk — a terminal AC a later chunk satisfies is not goal drift", () => {
    // 3rd consecutive fail of a criterion a later chunk will satisfy: HALT
    // without the flag, PROCEED (work-in-progress) while chunking is in progress.
    const halted = computeVerdict(form({ criterionResults: [fail("AC-2")] }), {
      "AC-2": [false, false],
    });
    expect(halted.kind).toBe("HALT");

    const inProgress = computeVerdict(
      form({ criterionResults: [fail("AC-2")] }),
      { "AC-2": [false, false] },
      STANDING_RUBRIC,
      true,
    );
    expect(inProgress.kind).toBe("PROCEED");
    expect(inProgress.rationale).toContain("unmet criteria: AC-2");
  });

  it("rule 3 (F-112): guard RESUMES on the final chunk / completion re-verification (flag false)", () => {
    const decision = computeVerdict(
      form({ criterionResults: [fail("AC-2")] }),
      { "AC-2": [false, false] },
      STANDING_RUBRIC,
      false,
    );
    expect(decision.kind).toBe("HALT");
    expect(decision.rationale).toContain("AC-2");
  });

  it("rule 3 (WP-263(b)): an INFRA-failed result is inconclusive — it does not extend the stuck sequence", () => {
    // Two real fails on record; the current fail is a check that DID NOT
    // COMPLETE (killed at the per-check cap). Without the flag this is the
    // 3rd consecutive fail → HALT; with it, the sequence stays at 2.
    const infraFail: JudgeForm["criterionResults"][number] = {
      id: "AC-1",
      pass: false,
      justification: "judge-executed check DID NOT COMPLETE (killed at the per-check cap)",
      infraFailed: true,
    };
    const decision = computeVerdict(form({ criterionResults: [infraFail] }), {
      "AC-1": [false, false],
    });
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale).toContain("unmet criteria: AC-1");
  });

  it("rule 3 (WP-263(b)): a real fail after infra noise still HALTs on genuine 3-in-a-row history", () => {
    const decision = computeVerdict(form({ criterionResults: [fail("AC-1")] }), {
      // History holds only CONCLUSIVE results (infra results never enter it).
      "AC-1": [false, false],
    });
    expect(decision.kind).toBe("HALT");
  });

  it("rule 5: criterion flip-flopping twice → ESCALATE with escalateReason", () => {
    // history t,f,t,f + current pass → windows (t,f,t) and (t,f,t) = 2 flip-flops.
    const decision = computeVerdict(form({ criterionResults: [pass("AC-1")] }), {
      "AC-1": [true, false, true, false],
    });
    expect(decision.kind).toBe("ESCALATE");
    expect(decision.escalateReason).toContain("AC-1");
    expect(decision.escalateReason).toContain("flip-flop");
  });

  it("rule 5 (WP-273): flip-flop ESCALATE SUPPRESSED while consuming a non-final chunk — an AC oscillating across chunks is state-change, not judge drift", () => {
    const history = { "AC-1": [true, false, true, false] };
    // Same oscillating history: ESCALATE without the flag, PROCEED while chunking.
    expect(computeVerdict(form({ criterionResults: [pass("AC-1")] }), history).kind).toBe(
      "ESCALATE",
    );
    const inProgress = computeVerdict(
      form({ criterionResults: [pass("AC-1")] }),
      history,
      STANDING_RUBRIC,
      true,
    );
    expect(inProgress.kind).toBe("PROCEED");
  });

  it("rule 5: a single flip-flop is tolerated", () => {
    const decision = computeVerdict(form({ criterionResults: [pass("AC-1")] }), {
      "AC-1": [true, false],
    });
    expect(decision.kind).toBe("PROCEED");
  });

  it("rule 4: concerns with no rubric basis → ESCALATE", () => {
    const decision = computeVerdict(form({ concerns: ["diff rewrites CI config"] }), {});
    expect(decision.kind).toBe("ESCALATE");
    expect(decision.escalateReason).toContain("diff rewrites CI config");
  });

  it("rule 4: cosmetic concern marked minor does NOT escalate (PROCEED)", () => {
    const decision = computeVerdict(
      form({
        concerns: ["minor cosmetic formatting nit"],
        concernSeverities: ["minor"],
      }),
      {},
    );
    expect(decision.kind).toBe("PROCEED");
  });

  it("rule 4: real defect marked blocking DOES escalate", () => {
    const decision = computeVerdict(
      form({
        concerns: ["missing critical authentication check"],
        concernSeverities: ["blocking"],
      }),
      {},
    );
    expect(decision.kind).toBe("ESCALATE");
    expect(decision.escalateClass).toBe("out_of_rubric");
    expect(decision.escalateReason).toContain("missing critical authentication check");
  });

  it("rule 4: mixed minor and blocking concerns escalates naming only blocking concerns", () => {
    const decision = computeVerdict(
      form({
        concerns: ["formatting nit", "critical data loss risk", "spelling error"],
        concernSeverities: ["minor", "blocking", "minor"],
      }),
      {},
    );
    expect(decision.kind).toBe("ESCALATE");
    expect(decision.escalateClass).toBe("out_of_rubric");
    expect(decision.escalateReason).toContain("critical data loss risk");
    expect(decision.escalateReason).not.toContain("formatting nit");
    expect(decision.escalateReason).not.toContain("spelling error");
  });

  it("rule 4: ragged concernSeverities array defaults missing indices to blocking", () => {
    const decision = computeVerdict(
      form({
        concerns: ["cosmetic typo", "unannotated defect"],
        concernSeverities: ["minor"],
      }),
      {},
    );
    expect(decision.kind).toBe("ESCALATE");
    expect(decision.escalateReason).toContain("unannotated defect");
    expect(decision.escalateReason).not.toContain("cosmetic typo");
  });

  it("rule 4: concerns WITH a rubric failure do not ESCALATE (rubric handles it)", () => {
    const rubric = STANDING_RUBRIC.map((r) => (r.id === "tests_pass" ? fail(r.id) : pass(r.id)));
    const decision = computeVerdict(
      form({ rubricResults: rubric, concerns: ["tests look flaky"] }),
      {},
    );
    expect(decision.kind).toBe("PROCEED");
  });

  it("BRANCH: explicit branch concerns recommend branching additively", () => {
    const decision = computeVerdict(
      form({ concerns: ["BRANCH: try an alternative implementation strategy"] }),
      {},
    );
    expect(decision.kind).toBe("BRANCH");
    expect(decision.rationale).toContain("alternative implementation strategy");
  });

  it("precedence: destructive ROLLBACK still beats BRANCH recommendation", () => {
    const rubric = STANDING_RUBRIC.map((r) =>
      r.id === "no_unrelated_deletions" ? fail(r.id) : pass(r.id),
    );
    const decision = computeVerdict(
      form({
        rubricResults: rubric,
        concerns: ["BRANCH: try preserving the deleted files on another line"],
      }),
      {},
    );
    expect(decision.kind).toBe("ROLLBACK");
  });

  it("default: mid-run criteria failures without history → PROCEED (work in progress)", () => {
    const decision = computeVerdict(
      form({ criterionResults: [pass("AC-1"), fail("AC-2")] }),
      { "AC-1": [true], "AC-2": [true] },
    );
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale).toContain("AC-2");
  });

  it("precedence: ROLLBACK (rule 1) beats HALT (rule 3)", () => {
    const rubric = STANDING_RUBRIC.map((r) =>
      r.id === "no_unrelated_deletions" ? fail(r.id) : pass(r.id),
    );
    const decision = computeVerdict(
      form({ criterionResults: [fail("AC-1")], rubricResults: rubric }),
      { "AC-1": [false, false] },
    );
    expect(decision.kind).toBe("ROLLBACK");
  });

  it("precedence: HALT (rule 3) beats flip-flop ESCALATE (rule 5)", () => {
    const decision = computeVerdict(
      form({ criterionResults: [fail("AC-1"), pass("AC-2")] }),
      { "AC-1": [false, false], "AC-2": [true, false, true, false] },
    );
    expect(decision.kind).toBe("HALT");
  });

  it("WP-616 / F-328 (AC-2): computeVerdict rationale is bounded <= 4096 chars with 44 KB raw log and names failing rubric id, while buildCompletionReviewBrief on same form reaches raw log", () => {
    const rawLog =
      "LOG-HEAD: regression failure details\n" +
      "x".repeat(44 * 1024) +
      "\nLOG-TAIL: 1 test failed (AssertionError)";
    const justification = `regression suite command \`npm test\` exited 1:\n${rawLog}`;
    const testForm = form({
      rubricResults: [
        ...STANDING_RUBRIC.map((r) => pass(r.id)),
        { id: RUBRIC_PRE_EXISTING_SUITE_GREEN, pass: false, justification },
      ],
    });

    const decision = computeVerdict(testForm, {});
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale.length).toBeLessThanOrEqual(MAX_VERDICT_RATIONALE_CHARS);
    expect(decision.rationale).toContain(RUBRIC_PRE_EXISTING_SUITE_GREEN);
    expect(decision.rationale).toContain("regression suite command `npm test` exited 1");
    expect(decision.rationale).not.toContain(rawLog);

    // The SAME form passed into buildCompletionReviewBrief must still reach the raw log
    const brief = buildCompletionReviewBrief(testForm);
    expect(brief.length).toBeLessThanOrEqual(2000);
    expect(brief).toContain("LOG-TAIL: 1 test failed (AssertionError)");
  });

  it("bounded rationale: huge justification without newline colon is bounded to MAX_VERDICT_RATIONALE_CHARS", () => {
    const hugeJustification = "a".repeat(10 * 1024);
    const testForm = form({
      rubricResults: [
        ...STANDING_RUBRIC.filter((r) => r.id !== RUBRIC_DESIGN_SERVES_OVERALL_GOAL).map((r) =>
          pass(r.id),
        ),
        { id: RUBRIC_DESIGN_SERVES_OVERALL_GOAL, pass: false, justification: hugeJustification },
      ],
    });

    const decision = computeVerdict(testForm, {});
    expect(decision.kind).toBe("PROCEED");
    expect(decision.rationale.length).toBeLessThanOrEqual(MAX_VERDICT_RATIONALE_CHARS);
    expect(decision.rationale).toContain(RUBRIC_DESIGN_SERVES_OVERALL_GOAL);
  });
});

describe("blockingConcerns (WP-548)", () => {
  it("returns empty array when concerns is empty", () => {
    expect(blockingConcerns(form({ concerns: [] }))).toEqual([]);
    expect(blockingConcerns(form({ concerns: [], concernSeverities: [] }))).toEqual([]);
  });

  it("filters out minor concerns and preserves blocking concerns", () => {
    const f = form({
      concerns: ["minor concern 1", "blocking concern 1", "minor concern 2", "blocking concern 2"],
      concernSeverities: ["minor", "blocking", "minor", "blocking"],
    });
    expect(blockingConcerns(f)).toEqual(["blocking concern 1", "blocking concern 2"]);
  });

  it("treats unannotated concerns as blocking by default (safe legacy default)", () => {
    const f = form({
      concerns: ["legacy concern 1", "legacy concern 2"],
    });
    expect(blockingConcerns(f)).toEqual(["legacy concern 1", "legacy concern 2"]);
  });

  it("treats missing indices in ragged concernSeverities as blocking", () => {
    const f = form({
      concerns: ["minor concern", "unannotated concern 1", "unannotated concern 2"],
      concernSeverities: ["minor"],
    });
    expect(blockingConcerns(f)).toEqual(["unannotated concern 1", "unannotated concern 2"]);
  });

  it("preserves original concerns order for all retained blocking concerns", () => {
    const f = form({
      concerns: ["b1", "m1", "b2", "m2", "b3"],
      concernSeverities: ["blocking", "minor", "blocking", "minor", "blocking"],
    });
    expect(blockingConcerns(f)).toEqual(["b1", "b2", "b3"]);
  });
});
