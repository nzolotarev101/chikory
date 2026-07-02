import { describe, expect, it } from "vitest";

import { classifyPlanGateFailure } from "../../src/chain/plan-gate-failure.js";
import { renderPlanGateFailureNotice } from "../../src/chain/plan-gate-notice.js";
import type { PlanVerdict } from "../../src/types.js";

describe("renderPlanGateFailureNotice (WP-233(b), F-33)", () => {
  it("renders the F-33 transport ESCALATE as safe to re-run and preserves the reason", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge LLM call failed after 5 attempts: transport error: fetch failed",
      uncoveredCriteria: [],
    };
    const failureClass = classifyPlanGateFailure(verdict);

    expect(failureClass).not.toBeNull();
    if (failureClass === null) throw new Error("expected an infra plan-gate failure class");

    const notice = renderPlanGateFailureNotice(failureClass);

    expect(notice).toContain("SAFE to re-run");
    expect(notice).toContain("transport error: fetch failed");
    expect(notice).not.toContain("REJECTED");
  });

  it("renders a substantive coverage-floor REVISE as not safe to re-run and preserves the reason", () => {
    const verdict: PlanVerdict = {
      kind: "REVISE",
      rationale: "plan leaves goal criteria uncovered: AC-1, AC-2",
      uncoveredCriteria: ["AC-1", "AC-2"],
    };
    const failureClass = classifyPlanGateFailure(verdict);

    expect(failureClass).not.toBeNull();
    if (failureClass === null) throw new Error("expected a substantive plan-gate failure class");

    const notice = renderPlanGateFailureNotice(failureClass);

    expect(notice).toContain("NOT safe to re-run");
    expect(notice).toContain("plan leaves goal criteria uncovered");
    expect(notice).not.toContain("could not reach the meta-judge");
  });

  it("does not mutate the classified failure object", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge reply was not valid JSON: EOF",
      uncoveredCriteria: [],
    };
    const failureClass = classifyPlanGateFailure(verdict);

    expect(failureClass).not.toBeNull();
    if (failureClass === null) throw new Error("expected an infra plan-gate failure class");

    const snapshot = { ...failureClass };

    renderPlanGateFailureNotice(failureClass);

    expect(failureClass).toEqual(snapshot);
  });
});
