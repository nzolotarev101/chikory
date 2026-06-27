export interface GEvalCriterionScore {
  id: string;
  score: number;
  weight?: number;
}

export interface GEvalAggregateOptions {
  threshold: number;
  scaleMin?: number;
  scaleMax?: number;
}

export interface GEvalScore {
  weightedMean: number;
  normalized: number;
  passed: boolean;
}

/**
 * Normalize a raw G-Eval criterion score for WP-210 onto the [0, 1] range.
 */
export function normalizeGEvalScore(raw: number, scaleMin = 1, scaleMax = 5): number {
  if (scaleMax <= scaleMin) {
    return 0;
  }

  const clamped = Math.min(Math.max(raw, scaleMin), scaleMax);
  return (clamped - scaleMin) / (scaleMax - scaleMin);
}

export function aggregateGEval(
  scores: GEvalCriterionScore[],
  opts: GEvalAggregateOptions,
): GEvalScore {
  const scaleMin = opts.scaleMin ?? 1;
  const scaleMax = opts.scaleMax ?? 5;

  let weightedSum = 0;
  let weightSum = 0;

  for (const item of scores) {
    const weight = item.weight ?? 1;
    if (weight <= 0) {
      continue;
    }

    const clampedScore = Math.min(Math.max(item.score, scaleMin), scaleMax);
    weightedSum += clampedScore * weight;
    weightSum += weight;
  }

  if (weightSum === 0) {
    return {
      weightedMean: scaleMin,
      normalized: 0,
      passed: 0 >= opts.threshold,
    };
  }

  const weightedMean = weightedSum / weightSum;
  const normalized = normalizeGEvalScore(weightedMean, scaleMin, scaleMax);

  return {
    weightedMean,
    normalized,
    passed: normalized >= opts.threshold,
  };
}
