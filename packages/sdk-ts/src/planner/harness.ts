/**
 * Planner harness (WP-219 S2, ADR-005 D1) — the NON-PURE half of goal
 * decomposition: one `plan`-stage LLM call, schema-validate the reply, and
 * assemble it into a `Plan` with the pure `buildPlan`. The prompt, response
 * schema, and assembly are all pure and unit-tested elsewhere (`prompt.ts`,
 * `assemble.ts`); this module owns only the router call and the failure
 * handling around it.
 *
 * Failures are values (invariant #4): a router failure, non-JSON content, a
 * schema-invalid reply, or an unassemblable plan all yield a `FAILED`
 * `PlannerPassResult`, never a throw. The durable chain executor consumes the
 * value form so a bad reply never triggers unbounded, cost-spending Temporal
 * activity retries. The `DecomposingPlanner` adapter below exists only to
 * satisfy the frozen `GoalPlanner` contract (`Promise<Plan>`); it throws
 * `PlannerError` on failure and is for non-durable / test callers.
 */
import { PlannerReplySchema } from "../schemas.js";
import type { Plan, PlanInput, Router, TokenUsage } from "../types.js";
import type { GoalPlanner } from "../types.js";
import { buildPlan } from "./assemble.js";
import { buildPlannerMessages, PLAN_RESPONSE_SCHEMA } from "./prompt.js";

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0 };

export interface RunPlannerPassInput {
  router: Router;
  input: PlanInput;
  /** Injected plan id (Temporal determinism: the workflow supplies it). */
  planId: string;
  /** Injected ISO-8601 UTC clock read (Temporal determinism). */
  createdAt: string;
}

export type PlannerPassResult =
  | { status: "SUCCESS"; plan: Plan; costUsd: number; tokens: TokenUsage }
  | { status: "FAILED"; reason: string; costUsd: number; tokens: TokenUsage };

/** One decomposition pass: `plan`-stage call → validate → assemble. */
export async function runPlannerPass(input: RunPlannerPassInput): Promise<PlannerPassResult> {
  const result = await input.router.complete({
    stage: "plan",
    messages: buildPlannerMessages(input.input),
    temperature: 0,
    responseSchema: PLAN_RESPONSE_SCHEMA,
  });

  if (result.status === "FAILED") {
    return {
      status: "FAILED",
      reason: `planner LLM call failed after ${result.attempts} attempts: ${result.reason}`,
      costUsd: 0,
      tokens: ZERO_TOKENS,
    };
  }

  const spent = { costUsd: result.costUsd, tokens: result.tokens };

  let json: unknown;
  try {
    json = JSON.parse(result.content);
  } catch (error) {
    return {
      status: "FAILED",
      reason: `planner reply was not valid JSON: ${(error as Error).message}`,
      ...spent,
    };
  }

  const parsed = PlannerReplySchema.safeParse(json);
  if (!parsed.success) {
    return {
      status: "FAILED",
      reason: `planner reply failed schema validation: ${parsed.error.message}`,
      ...spent,
    };
  }

  try {
    const plan = buildPlan(parsed.data, input.input, {
      id: input.planId,
      createdAt: input.createdAt,
    });
    return { status: "SUCCESS", plan, ...spent };
  } catch (error) {
    return {
      status: "FAILED",
      reason: `planner reply did not assemble into a valid plan: ${(error as Error).message}`,
      ...spent,
    };
  }
}

/** Thrown by `DecomposingPlanner.decompose` when a pass fails (contract adapter). */
export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerError";
  }
}

export interface DecomposingPlannerOptions {
  router: Router;
  /** Plan-id minter (Temporal: a deterministic side-effect / uuid activity). */
  newPlanId: () => string;
  /** Clock read (Temporal: `workflowInfo` time or a side-effect). */
  now: () => string;
}

/**
 * `GoalPlanner` adapter over `runPlannerPass`. Satisfies the frozen
 * `decompose(input): Promise<Plan>` contract by throwing `PlannerError` on a
 * failed pass — durable callers should use `runPlannerPass` directly to keep
 * failures as values (invariant #4).
 */
export class DecomposingPlanner implements GoalPlanner {
  constructor(private readonly opts: DecomposingPlannerOptions) {}

  async decompose(input: PlanInput): Promise<Plan> {
    const result = await runPlannerPass({
      router: this.opts.router,
      input,
      planId: this.opts.newPlanId(),
      createdAt: this.opts.now(),
    });
    if (result.status === "FAILED") throw new PlannerError(result.reason);
    return result.plan;
  }
}
