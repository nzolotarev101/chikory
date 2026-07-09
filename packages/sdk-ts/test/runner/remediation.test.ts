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

describe("buildCriterionFeedback (WP-519 slice (a) — every-pass feedback)", () => {
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
});
