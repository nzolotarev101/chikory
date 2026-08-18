/**
 * WP-519 pure remediation decisions (ADR-009 D3) — bounded heal grants, the
 * deterministic remediation brief, and the every-pass criterion feedback
 * (slice (a)). No Temporal, no I/O: the `decideSoakDelay`/`decideWorkChunk`
 * sibling discipline.
 */
import { describe, expect, test } from "vitest";

import {
  buildCriterionFeedback,
  buildRemediationBrief,
  decideRemediation,
  MAX_REMEDIATION_ATTEMPTS,
  REMEDIATION_BRIEF_MAX_CHARS,
} from "../../src/index.js";
import type { JudgeForm } from "../../src/index.js";

function form(overrides: Partial<JudgeForm> = {}): JudgeForm {
  return {
    criterionResults: [
      { id: "AC-1", pass: false, justification: "check exited 1: marker file missing" },
      { id: "AC-2", pass: true, justification: "confirmed" },
    ],
    rubricResults: [{ id: "tests_pass", pass: true, justification: "suite green" }],
    concerns: [],
    ...overrides,
  };
}

describe("decideRemediation (WP-519 bound)", () => {
  test("grants the first attempt", () => {
    expect(decideRemediation({ attemptsUsed: 0 })).toEqual({ action: "remediate", attempt: 1 });
  });

  test("exhausted budget → seal resumable FAILED", () => {
    expect(decideRemediation({ attemptsUsed: MAX_REMEDIATION_ATTEMPTS })).toEqual({
      action: "seal_resumable_failed",
    });
  });

  test("custom bound is honored", () => {
    expect(decideRemediation({ attemptsUsed: 1 }, 2)).toEqual({ action: "remediate", attempt: 2 });
    expect(decideRemediation({ attemptsUsed: 2 }, 2)).toEqual({ action: "seal_resumable_failed" });
  });
});

describe("buildRemediationBrief (ADR-009 D3 — the diagnosis is never discarded)", () => {
  test("carries trigger, failing criteria with justifications, and the fix contract", () => {
    const brief = buildRemediationBrief(form(), "criterion AC-1 failed 3+ consecutive verdicts");
    expect(brief).toContain("REMEDIATION BRIEF");
    expect(brief).toContain("trigger: criterion AC-1 failed 3+ consecutive verdicts");
    expect(brief).toContain("- AC-1: check exited 1: marker file missing");
    expect(brief).not.toContain("- AC-2:"); // passing criteria are not noise
    expect(brief).toContain("a fix must make each failing criterion's check pass");
  });

  test("includes rubric failures and concerns when present", () => {
    const brief = buildRemediationBrief(
      form({
        rubricResults: [{ id: "tests_pass", pass: false, justification: "2 tests red" }],
        concerns: ["diff touches CI config"],
      }),
      "stuck",
    );
    expect(brief).toContain("- tests_pass: 2 tests red");
    expect(brief).toContain("- diff touches CI config");
  });

  test("is clamped so it cannot rot the next step's context", () => {
    const brief = buildRemediationBrief(
      form({
        criterionResults: [{ id: "AC-1", pass: false, justification: "x".repeat(5000) }],
      }),
      "stuck",
    );
    expect(brief.length).toBeLessThanOrEqual(REMEDIATION_BRIEF_MAX_CHARS);
  });
});

describe("buildCriterionFeedback (WP-519 slice (a) / WP-599 — every-pass feedback)", () => {
  test("failing criteria ride forward with their judge evidence", () => {
    const feedback = buildCriterionFeedback(form());
    expect(feedback).toContain("unmet acceptance criteria");
    expect(feedback).toContain("- AC-1: check exited 1: marker file missing");
  });

  test("nothing to feed back when every criterion passes", () => {
    const allPass = form({
      criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
    });
    expect(buildCriterionFeedback(allPass)).toBeUndefined();
  });

  test("no criteria evaluated → undefined (caller falls back)", () => {
    expect(buildCriterionFeedback(form({ criterionResults: [] }))).toBeUndefined();
  });

  test("blocking out-of-rubric concerns ride into feedback alongside passing criteria (WP-599)", () => {
    const blocking = "the new retry wrapper swallows the AbortError, so a cancelled run can never stop";
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
        concerns: [blocking],
        concernSeverities: ["blocking"],
      }),
    );
    expect(feedback).toBeDefined();
    expect(feedback).toContain("judge concerns (out-of-rubric — address these directly):");
    expect(feedback).toContain(`- ${blocking}`);
    expect(feedback).not.toContain("unmet acceptance criteria");
  });

  test("minor concern produces undefined feedback when all criteria pass (WP-599)", () => {
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
        concerns: ["trailing whitespace in docstring"],
        concernSeverities: ["minor"],
      }),
    );
    expect(feedback).toBeUndefined();
  });

  test("unmarked concern defaults to blocking and rides into feedback (WP-599 fail-safe)", () => {
    const legacyConcern = "legacy unannotated concern";
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [{ id: "AC-1", pass: true, justification: "confirmed" }],
        concerns: [legacyConcern],
      }),
    );
    expect(feedback).toBeDefined();
    expect(feedback).toContain(`- ${legacyConcern}`);
  });

  test("both failing criteria and blocking concerns ride forward together (WP-599)", () => {
    const blocking = "blocking resource leak";
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [
          { id: "AC-1", pass: false, justification: "check exited 1: marker file missing" },
        ],
        concerns: [blocking, "minor nit"],
        concernSeverities: ["blocking", "minor"],
      }),
    );
    expect(feedback).toBeDefined();
    expect(feedback).toContain("unmet acceptance criteria");
    expect(feedback).toContain("- AC-1: check exited 1: marker file missing");
    expect(feedback).toContain("judge concerns");
    expect(feedback).toContain(`- ${blocking}`);
    expect(feedback).not.toContain("minor nit");
  });

  test("is clamped when combined criteria and concerns exceed brief budget", () => {
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [{ id: "AC-1", pass: false, justification: "x".repeat(3000) }],
        concerns: ["y".repeat(3000)],
        concernSeverities: ["blocking"],
      }),
    );
    expect(feedback).toBeDefined();
    expect(feedback!.length).toBeLessThanOrEqual(REMEDIATION_BRIEF_MAX_CHARS);
  });

  /**
   * F-384 (dogfood-153 review): the clamp must not decide WHICH diagnosis the
   * executor hears. A judge's failing-criterion justification quotes the check
   * it ran — the three measured on run-8113a98d were 6532 / 3757 / 2851 bytes
   * against a 2000-char budget — so clamping the concatenation dropped the
   * whole concerns section in every combined case. Asserting only the total
   * length (the test above) passes either way; these assert survival.
   */
  test("a verbose failing criterion does not clamp the blocking concern away (F-384)", () => {
    const blocking = "the retry wrapper swallows AbortError, so a cancelled run can never stop";
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [
          { id: "AC-1", pass: false, justification: "the check exited 1; ".repeat(400) },
          { id: "AC-2", pass: false, justification: "the check exited 1; ".repeat(400) },
        ],
        concerns: [blocking],
        concernSeverities: ["blocking"],
      }),
    )!;
    expect(feedback.length).toBeLessThanOrEqual(REMEDIATION_BRIEF_MAX_CHARS);
    expect(feedback).toContain("unmet acceptance criteria");
    expect(feedback).toContain("judge concerns");
    expect(feedback).toContain(blocking);
  });

  test("a verbose concern does not clamp the failing-criterion evidence away (F-384)", () => {
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [
          { id: "AC-1", pass: false, justification: "the marker file is absent" },
        ],
        concerns: ["z".repeat(4000)],
        concernSeverities: ["blocking"],
      }),
    )!;
    expect(feedback.length).toBeLessThanOrEqual(REMEDIATION_BRIEF_MAX_CHARS);
    expect(feedback).toContain("- AC-1: the marker file is absent");
    expect(feedback).toContain("judge concerns");
  });

  test("a section under its fair share is never truncated to pay for the other (F-384)", () => {
    const blocking = "the retry wrapper swallows AbortError";
    const feedback = buildCriterionFeedback(
      form({
        criterionResults: [{ id: "AC-1", pass: false, justification: "q".repeat(4000) }],
        concerns: [blocking],
        concernSeverities: ["blocking"],
      }),
    )!;
    expect(feedback).toContain(`- ${blocking}`);
    // the short section survives WHOLE — no ellipsis mid-concern
    expect(feedback.endsWith(`- ${blocking}`)).toBe(true);
  });
});
