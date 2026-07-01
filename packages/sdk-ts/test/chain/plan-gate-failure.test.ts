import { describe, expect, it } from "vitest";

import {
  classifyPlanGateFailure,
  PLAN_GATE_INFRA_REASON_PREFIXES,
} from "../../src/chain/plan-gate-failure.js";
import type { PlanVerdict } from "../../src/types.js";

describe("classifyPlanGateFailure (WP-233(a), F-33)", () => {
  it("returns null for a PROCEED verdict", () => {
    const verdict: PlanVerdict = {
      kind: "PROCEED",
      rationale: "plan is ready",
      uncoveredCriteria: [],
    };

    expect(classifyPlanGateFailure(verdict)).toBeNull();
  });

  it("classifies the exact F-33 transport ESCALATE as infra and safe to re-run", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge LLM call failed after 5 attempts: transport error: fetch failed",
      uncoveredCriteria: [],
    };

    const result = classifyPlanGateFailure(verdict);

    expect(result?.kind).toBe("infra");
    expect(result?.safeToReRun).toBe(true);
    expect(result?.reason).toBe(verdict.rationale);
  });

  it("classifies not-valid-JSON ESCALATE as infra and safe to re-run", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge reply was not valid JSON: Unexpected token",
      uncoveredCriteria: [],
    };

    const result = classifyPlanGateFailure(verdict);

    expect(result?.kind).toBe("infra");
    expect(result?.safeToReRun).toBe(true);
  });

  it("classifies schema-validation ESCALATE as infra and safe to re-run", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge reply failed schema validation: kind is required",
      uncoveredCriteria: [],
    };

    const result = classifyPlanGateFailure(verdict);

    expect(result?.kind).toBe("infra");
    expect(result?.safeToReRun).toBe(true);
  });

  it("classifies a substantive coverage-floor REVISE as not safe to re-run", () => {
    const verdict: PlanVerdict = {
      kind: "REVISE",
      rationale: "plan leaves goal criteria uncovered: AC-1, AC-2",
      uncoveredCriteria: ["AC-1", "AC-2"],
    };

    const result = classifyPlanGateFailure(verdict);

    expect(result?.kind).toBe("substantive");
    expect(result?.safeToReRun).toBe(false);
  });

  it("uses an anchored prefix match, not a mid-text includes match", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale:
        "the plan proposes to test that plan meta-judge reply failed schema validation: path works",
      uncoveredCriteria: [],
    };

    const result = classifyPlanGateFailure(verdict);

    expect(result?.kind).toBe("substantive");
    expect(result?.safeToReRun).toBe(false);
  });

  it("does not mutate the input verdict", () => {
    const verdict: PlanVerdict = {
      kind: "ESCALATE",
      rationale: "plan meta-judge reply was not valid JSON: EOF",
      uncoveredCriteria: [],
    };
    const snapshot: PlanVerdict = { ...verdict, uncoveredCriteria: [...verdict.uncoveredCriteria] };

    classifyPlanGateFailure(verdict);

    expect(verdict).toEqual(snapshot);
  });

  it("exports the three infra reason prefixes", () => {
    expect(PLAN_GATE_INFRA_REASON_PREFIXES).toHaveLength(3);
  });
});
