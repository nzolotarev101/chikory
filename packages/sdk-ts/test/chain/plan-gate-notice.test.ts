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

  it("renders a substantive ESCALATE as not safe to re-run and preserves the reason", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "the goal contradicts itself; a human must resolve the scope",
      uncoveredCriteria: [],
    };
    const failureClass = classifyPlanGateFailure(verdict);

    expect(failureClass).not.toBeNull();
    if (failureClass === null) throw new Error("expected a substantive plan-gate failure class");

    const notice = renderPlanGateFailureNotice(failureClass);

    expect(notice).toContain("NOT safe to re-run");
    expect(notice).toContain("a human must resolve the scope");
    expect(notice).not.toContain("could not reach the meta-judge");
  });

  // WP-542/F-207: a REVISE reaching the renderer means the repair loop already
  // ran and did not converge, so the notice must name the exhausted budget —
  // not tell the operator the plan cannot be re-run.
  it("renders an exhausted coverage-floor REVISE as safe to re-run, naming the attempts", () => {
    const verdict: PlanVerdict = {
      kind: "REVISE",
      rationale: "plan leaves goal criteria uncovered: AC-1, AC-2",
      uncoveredCriteria: ["AC-1", "AC-2"],
    };
    const failureClass = classifyPlanGateFailure(verdict);

    expect(failureClass).not.toBeNull();
    if (failureClass === null) throw new Error("expected a revisable plan-gate failure class");

    const notice = renderPlanGateFailureNotice(failureClass, 3);

    expect(notice).toContain("REVISION");
    expect(notice).toContain("3 automated repair attempt(s) did not converge");
    expect(notice).toContain("safe to re-run");
    expect(notice).not.toContain("NOT safe to re-run");
    expect(notice).toContain("plan leaves goal criteria uncovered");
  });

  it("says repair is disabled when the loop never ran (CHIKORY_PLAN_REPAIR_ATTEMPTS=0)", () => {
    const verdict: PlanVerdict = {
      kind: "REVISE",
      rationale: "node 2 is underspecified",
      uncoveredCriteria: [],
    };
    const failureClass = classifyPlanGateFailure(verdict);
    if (failureClass === null) throw new Error("expected a revisable plan-gate failure class");

    expect(renderPlanGateFailureNotice(failureClass, 0)).toContain("automated repair is disabled");
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
