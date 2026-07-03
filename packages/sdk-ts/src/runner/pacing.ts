/**
 * WP-207 / FA-3 / SE-2 pure context-window pacing decision. Estimates whether
 * the next local runner step fits the configured context window before any
 * non-pure agent-loop integration, journaling, or compaction wiring exists.
 */

export interface ContextWindowUsage {
  currentInputTokens: number;
  currentOutputTokens: number;
  estimatedNextStepTokens: number;
  contextWindowTokens: number;
}

export interface ContextWindowPacingPolicy {
  compactAtFraction: number;
}

export interface ContextWindowPacingDecision {
  action: "continue" | "compact" | "park";
  projectedTokens: number;
  remainingTokens: number;
  utilization: number;
}

/**
 * WP-254: the parts of the LIVE resident orchestration-context window going into the next
 * step. `systemTokens` is the fixed system/instruction preamble carried into every step;
 * `recentSummaryTokens` is the per-summary token count of the retained recent-step summaries,
 * MOST-RECENT LAST (the agent-loop's `recentSummaries`); `retainedSummaryCount` is how many of
 * the most-recent summaries actually stay in the verbatim window after folding.
 */
export interface ResidentContextParts {
  systemTokens: number;
  recentSummaryTokens: number[];
  retainedSummaryCount: number;
}

/**
 * WP-254 pure live-resident orchestration-context occupancy estimator.
 */
export function estimateResidentContextTokens(parts: ResidentContextParts): number {
  const retainedSummaryCount = Math.max(
    0,
    Math.min(parts.retainedSummaryCount, parts.recentSummaryTokens.length),
  );
  const retainedSummaryTokens =
    retainedSummaryCount > 0 ? parts.recentSummaryTokens.slice(-retainedSummaryCount) : [];
  const summaryTokens = retainedSummaryTokens.reduce((sum, tokens) => sum + tokens, 0);

  return Math.max(0, parts.systemTokens + summaryTokens);
}

/**
 * WP-254: chars-per-token heuristic. The runner has no tokenizer dependency, so it
 * estimates the resident occupancy of orchestration text WE control (system preamble,
 * goal, criteria, retained summaries) from character length — an honest, deterministic
 * approximation (CLAUDE.md "no magic"), NOT the executor subprocess's reported throughput.
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * WP-254: the inputs the agent loop has on hand to describe the next step's LIVE
 * resident orchestration-context window. `systemTexts` are the FIXED, non-summary
 * strings carried into every step (system preamble / goal / acceptance criteria /
 * judge feedback / injections); `recentSummaries` are the recent step summaries,
 * MOST-RECENT LAST; `retainedSummaryCount` is how many of the most-recent summaries
 * stay verbatim after folding (the recall window).
 */
export interface ResidentContextInput {
  systemTexts: string[];
  recentSummaries: string[];
  retainedSummaryCount: number;
}

/**
 * WP-254: assemble {@link ResidentContextParts} from the agent loop's plain-string
 * inputs by token-estimating each piece. Pure; does not mutate the input.
 */
export function buildResidentContextParts(input: ResidentContextInput): ResidentContextParts {
  return {
    systemTokens: input.systemTexts.reduce((sum, text) => sum + estimateTokensFromText(text), 0),
    recentSummaryTokens: input.recentSummaries.map(estimateTokensFromText),
    retainedSummaryCount: input.retainedSummaryCount,
  };
}

export function decideContextWindowPacing(
  usage: ContextWindowUsage,
  policy: ContextWindowPacingPolicy,
): ContextWindowPacingDecision {
  const projectedTokens =
    usage.currentInputTokens + usage.currentOutputTokens + usage.estimatedNextStepTokens;
  const remainingTokens = usage.contextWindowTokens - projectedTokens;
  const utilization = projectedTokens / usage.contextWindowTokens;
  const compactThreshold = usage.contextWindowTokens * policy.compactAtFraction;

  if (usage.estimatedNextStepTokens > usage.contextWindowTokens) {
    return {
      action: "park",
      projectedTokens,
      remainingTokens,
      utilization,
    };
  }

  if (projectedTokens > compactThreshold) {
    return {
      action: "compact",
      projectedTokens,
      remainingTokens,
      utilization,
    };
  }

  return {
    action: "continue",
    projectedTokens,
    remainingTokens,
    utilization,
  };
}

/** Pure workflow gate: a `park` pacing decision requires a durable human resume. */
export function shouldParkForWindow(decision: ContextWindowPacingDecision): boolean {
  return decision.action === "park";
}
