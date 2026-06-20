/**
 * Plan meta-judge harness (WP-219 S2b, ADR-005 D2). Unit-tests the non-pure
 * coordinator over an injected fake `Router`: a same-family plan-judge is
 * refused before any call (config error, throws); runtime LLM failures are
 * values that ESCALATE (invariant #4); the deterministic coverage floor still
 * downgrades a PROCEED that leaves a goal criterion uncovered.
 */
import { describe, expect, it } from "vitest";

import { FamilyDiversityError } from "../../src/judge/index.js";
import { runPlanJudgePass } from "../../src/planner/meta-judge-harness.js";
import type {
  AcceptanceCriterion,
  LLMCallResult,
  ModelChoice,
  Plan,
  Router,
  RouterError,
} from "../../src/types.js";

const GOAL_CRITERIA: AcceptanceCriterion[] = [
  { id: "AC-1", description: "the first slice ships" },
  { id: "AC-2", description: "the second slice ships" },
];

const PLAN: Plan = {
  id: "plan-1",
  goal: "Ship both slices",
  createdAt: "2026-06-19T00:00:00.000Z",
  nodes: [
    {
      id: "N-1",
      goal: "first slice",
      acceptanceCriteria: [{ id: "AC-1", description: "the first slice ships" }],
      dependsOn: [],
      budgetUsd: 5,
    },
    {
      id: "N-2",
      goal: "second slice",
      acceptanceCriteria: [{ id: "AC-2", description: "the second slice ships" }],
      dependsOn: ["N-1"],
      budgetUsd: 5,
    },
  ],
};

const GEMINI_JUDGE: ModelChoice = { provider: "gemini", model: "gemini-test" };

function ok(content: string): LLMCallResult {
  return {
    status: "SUCCESS",
    content,
    provider: "gemini",
    model: "gemini-test",
    tokens: { input: 80, output: 12 },
    costUsd: 0.03,
  };
}

function fail(reason: string): RouterError {
  return { status: "FAILED", reason, retriable: false, attempts: 2 };
}

function router(reply: LLMCallResult | RouterError): Router {
  return { complete: async () => reply };
}

describe("runPlanJudgePass", () => {
  it("returns the meta-judge PROCEED verdict when coverage is complete", async () => {
    const result = await runPlanJudgePass({
      router: router(ok(JSON.stringify({ kind: "PROCEED", rationale: "sound decomposition" }))),
      plan: PLAN,
      goalCriteria: GOAL_CRITERIA,
      plannerFamily: "openai",
      judgeModel: GEMINI_JUDGE,
    });

    expect(result.verdict.kind).toBe("PROCEED");
    expect(result.verdict.uncoveredCriteria).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.costUsd).toBe(0.03);
  });

  it("accepts the real reply shape that includes uncoveredCriteria (the response schema requires it)", async () => {
    // The model is REQUIRED by PLAN_VERDICT_RESPONSE_SCHEMA to emit
    // `uncoveredCriteria`; the parse must accept it (regression for the schema
    // mismatch that stopped the chain in dogfood-041 attempt 3 — F-35).
    const result = await runPlanJudgePass({
      router: router(
        ok(JSON.stringify({ kind: "PROCEED", rationale: "sound", uncoveredCriteria: [] })),
      ),
      plan: PLAN,
      goalCriteria: GOAL_CRITERIA,
      plannerFamily: "openai",
      judgeModel: GEMINI_JUDGE,
    });

    expect(result.verdict.kind).toBe("PROCEED");
    expect(result.verdict.uncoveredCriteria).toEqual([]);
  });

  it("applies the deterministic coverage floor: PROCEED with a gap becomes REVISE", async () => {
    const result = await runPlanJudgePass({
      router: router(ok(JSON.stringify({ kind: "PROCEED", rationale: "looks fine to me" }))),
      plan: PLAN,
      // AC-3 is required by the goal but no node covers it.
      goalCriteria: [...GOAL_CRITERIA, { id: "AC-3", description: "the third slice ships" }],
      plannerFamily: "openai",
      judgeModel: GEMINI_JUDGE,
    });

    expect(result.verdict.kind).toBe("REVISE");
    expect(result.verdict.uncoveredCriteria).toEqual(["AC-3"]);
    expect(result.verdict.rationale).toContain("coverage override");
  });

  it("ESCALATEs (a value, not a throw) when the router call fails", async () => {
    const result = await runPlanJudgePass({
      router: router(fail("upstream 500")),
      plan: PLAN,
      goalCriteria: GOAL_CRITERIA,
      plannerFamily: "openai",
      judgeModel: GEMINI_JUDGE,
    });

    expect(result.verdict.kind).toBe("ESCALATE");
    expect(result.verdict.rationale).toContain("upstream 500");
    expect(result.costUsd).toBe(0);
  });

  it("ESCALATEs when the reply is not valid JSON", async () => {
    const result = await runPlanJudgePass({
      router: router(ok("}{ not json")),
      plan: PLAN,
      goalCriteria: GOAL_CRITERIA,
      plannerFamily: "openai",
      judgeModel: GEMINI_JUDGE,
    });

    expect(result.verdict.kind).toBe("ESCALATE");
    expect(result.verdict.rationale).toContain("not valid JSON");
  });

  it("ESCALATEs when the reply fails schema validation", async () => {
    const result = await runPlanJudgePass({
      router: router(ok(JSON.stringify({ kind: "MAYBE", rationale: "unsure" }))),
      plan: PLAN,
      goalCriteria: GOAL_CRITERIA,
      plannerFamily: "openai",
      judgeModel: GEMINI_JUDGE,
    });

    expect(result.verdict.kind).toBe("ESCALATE");
    expect(result.verdict.rationale).toContain("schema validation");
  });

  it("refuses a same-family plan-judge before any call (ADR-005 D2)", async () => {
    await expect(
      runPlanJudgePass({
        router: router(ok(JSON.stringify({ kind: "PROCEED", rationale: "x" }))),
        plan: PLAN,
        goalCriteria: GOAL_CRITERIA,
        plannerFamily: "openai",
        judgeModel: { provider: "openai", model: "gpt-test" },
      }),
    ).rejects.toBeInstanceOf(FamilyDiversityError);
  });

  it("warns but proceeds for an opted-in same-family plan-judge", async () => {
    const result = await runPlanJudgePass({
      router: router(ok(JSON.stringify({ kind: "PROCEED", rationale: "sound" }))),
      plan: PLAN,
      goalCriteria: GOAL_CRITERIA,
      plannerFamily: "openai",
      judgeModel: { provider: "openai", model: "gpt-test" },
      allowSameFamily: true,
    });

    expect(result.verdict.kind).toBe("PROCEED");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
