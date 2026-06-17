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
