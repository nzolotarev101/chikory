/**
 * WP-515 (F-96) — honest accounting for a blind-metered step. A step killed
 * at the `maxSeconds` cap (or failed before its `turn.completed` usage event)
 * reports `$0.00 / 0 tokens` while its transcript shows real work (dogfood-080:
 * 57 tool calls, 10m0s, $0 journaled). A run that repeatedly times-out-and-
 * retries could blow past `budgetUsd`/`budgetTokens` while the ledger shows a
 * fraction — the CG-2 hard cap undercounts.
 *
 * The estimator is deterministic and evidence-based: scale the run's OBSERVED
 * per-tool-call token/cost rate (from prior metered steps in the same journal)
 * by the killed step's tool-call count. No prior metered step → no estimate
 * (never invent a rate). Pure; the `describeStepDeadline` sibling.
 */
import type { TokenUsage } from "../types.js";

/** The step facts that decide whether the meter went blind (F-9/F-96 class). */
export interface BlindMeterStepFacts {
  status: "SUCCESS" | "FAILED";
  toolCalls: number;
  tokens: TokenUsage;
}

/** One prior step's observed rate basis. */
export interface ObservedStepUsage {
  toolCalls: number;
  tokens: TokenUsage;
  costUsd: number;
}

export interface KilledStepUsageEstimate {
  tokens: TokenUsage;
  costUsd: number;
  /** Σ prior tokens ÷ Σ prior tool calls — the rate the estimate scaled. */
  perToolCallTokens: number;
  basis: "per_tool_call_rate";
}

/**
 * A FAILED step that made real tool calls but metered zero tokens is
 * under-accounted: the spend happened, the usage event never arrived.
 */
export function isBlindMeteredStep(facts: BlindMeterStepFacts): boolean {
  return (
    facts.status === "FAILED" &&
    facts.toolCalls > 0 &&
    facts.tokens.input + facts.tokens.output === 0
  );
}

/**
 * Estimate a blind-metered step's usage from the run's observed
 * per-tool-call rate. Returns null when there is no evidence to scale
 * (no metered prior step, or the killed step made no tool calls).
 */
export function estimateKilledStepUsage(
  killedToolCalls: number,
  priorSteps: readonly ObservedStepUsage[],
): KilledStepUsageEstimate | null {
  if (killedToolCalls <= 0) return null;
  const basis = priorSteps.filter(
    (step) => step.toolCalls > 0 && step.tokens.input + step.tokens.output > 0,
  );
  if (basis.length === 0) return null;

  const totalCalls = basis.reduce((sum, step) => sum + step.toolCalls, 0);
  const totalInput = basis.reduce((sum, step) => sum + step.tokens.input, 0);
  const totalOutput = basis.reduce((sum, step) => sum + step.tokens.output, 0);
  const totalCost = basis.reduce((sum, step) => sum + step.costUsd, 0);

  const tokens: TokenUsage = {
    input: Math.round((totalInput / totalCalls) * killedToolCalls),
    output: Math.round((totalOutput / totalCalls) * killedToolCalls),
  };
  return {
    tokens,
    costUsd: (totalCost / totalCalls) * killedToolCalls,
    perToolCallTokens: Math.round((totalInput + totalOutput) / totalCalls),
    basis: "per_tool_call_rate",
  };
}
