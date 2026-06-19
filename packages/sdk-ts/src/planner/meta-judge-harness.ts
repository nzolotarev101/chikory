/**
 * Plan meta-judge harness (WP-219 S2b, ADR-005 D2) — the NON-PURE half of plan
 * gating: enforce plan-judge ≠ planner family (invariant #2 extended to plans),
 * make one `judge`-stage LLM call over the decomposed `Plan`, schema-validate
 * the `{ kind, rationale }` reply, and fold in the deterministic coverage floor
 * with the pure `buildPlanVerdict`. The prompt, response schema, coverage
 * analysis, and verdict assembly are all pure and unit-tested elsewhere
 * (`meta-judge-prompt.ts`, `coverage.ts`, `meta-judge-verdict.ts`).
 *
 * Family diversity is a config error: a same-family plan-judge without the
 * explicit opt-in throws `FamilyDiversityError` before any LLM call (no cost,
 * deterministic — fail fast, exactly like the executor judge setup). Runtime
 * LLM failures (router failure, non-JSON, schema-invalid reply) are values
 * (invariant #4): they yield an ESCALATE `PlanVerdict`, never a throw, so a bad
 * reply escalates to a human instead of spinning Temporal retries that spend
 * meta-judge cost.
 */
import { enforceFamilyDiversity } from "../judge/family.js";
import { PlanJudgeReplySchema } from "../schemas.js";
import type {
  AcceptanceCriterion,
  LLMProvider,
  ModelChoice,
  Plan,
  PlanVerdict,
  Router,
  TokenUsage,
} from "../types.js";
import { buildPlanJudgeMessages, PLAN_VERDICT_RESPONSE_SCHEMA } from "./meta-judge-prompt.js";
import { buildPlanVerdict } from "./meta-judge-verdict.js";

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0 };

export interface RunPlanJudgePassInput {
  router: Router;
  plan: Plan;
  /** Goal-level criteria the plan must cover (the coverage floor input). */
  goalCriteria: AcceptanceCriterion[];
  /** Planner model family — the plan-judge must differ from it (ADR-005 D2). */
  plannerFamily: LLMProvider;
  /** The plan-judge model; its `provider` is the effective routed family. */
  judgeModel: ModelChoice;
  /** Opt in to a same-family plan-judge (loud, warned) — defaults to false. */
  allowSameFamily?: boolean;
}

export interface PlanJudgePassResult {
  verdict: PlanVerdict;
  costUsd: number;
  tokens: TokenUsage;
  /** Non-empty only for the opted-in same-family case — log AND journal these. */
  warnings: string[];
  durationMs: number;
}

function escalate(reason: string): PlanVerdict {
  return { kind: "ESCALATE", rationale: reason, uncoveredCriteria: [] };
}

/** One plan meta-judge pass: enforce diversity → `judge` call → validate → verdict. */
export async function runPlanJudgePass(input: RunPlanJudgePassInput): Promise<PlanJudgePassResult> {
  const started = Date.now();

  // Invariant #2 (ADR-005 D2): refuse a same-family plan-judge unless opted in.
  const { warnings } = enforceFamilyDiversity({
    executorFamily: input.plannerFamily,
    judgeFamily: input.judgeModel.provider,
    judgeProvider: input.judgeModel.provider,
    allowSameFamily: input.allowSameFamily,
  });

  const result = await input.router.complete({
    stage: "judge",
    messages: buildPlanJudgeMessages({ plan: input.plan, goalCriteria: input.goalCriteria }),
    temperature: 0,
    responseSchema: PLAN_VERDICT_RESPONSE_SCHEMA,
  });

  if (result.status === "FAILED") {
    const reason = `plan meta-judge LLM call failed after ${result.attempts} attempts: ${result.reason}`;
    return {
      verdict: escalate(reason),
      costUsd: 0,
      tokens: ZERO_TOKENS,
      warnings,
      durationMs: Date.now() - started,
    };
  }

  const costUsd = result.costUsd;
  const tokens = result.tokens;

  let json: unknown;
  try {
    json = JSON.parse(result.content);
  } catch (error) {
    return {
      verdict: escalate(`plan meta-judge reply was not valid JSON: ${(error as Error).message}`),
      costUsd,
      tokens,
      warnings,
      durationMs: Date.now() - started,
    };
  }

  const parsed = PlanJudgeReplySchema.safeParse(json);
  if (!parsed.success) {
    return {
      verdict: escalate(`plan meta-judge reply failed schema validation: ${parsed.error.message}`),
      costUsd,
      tokens,
      warnings,
      durationMs: Date.now() - started,
    };
  }

  return {
    verdict: buildPlanVerdict(parsed.data, input.plan, input.goalCriteria),
    costUsd,
    tokens,
    warnings,
    durationMs: Date.now() - started,
  };
}
