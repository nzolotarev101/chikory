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

/** WP-210: one pairwise comparison between two judged candidates. `a` and `b` are the two
 * candidate ids; `winner` names which side won, or "tie". */
export interface PairwiseOutcome {
  a: string;
  b: string;
  winner: "a" | "b" | "tie";
}

/** WP-210: a single candidate's pairwise record. `winRate` counts a tie as half a win:
 * `(wins + 0.5 * ties) / (wins + losses + ties)`. */
export interface PairwiseTally {
  id: string;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
}

export interface PairwiseResult {
  tallies: PairwiseTally[];
  winnerId: string | null;
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

/**
 * Aggregate WP-210 pairwise outcomes into deterministic tallies and a clear winner.
 */
export function aggregatePairwise(outcomes: PairwiseOutcome[]): PairwiseResult {
  const records = new Map<string, Omit<PairwiseTally, "id" | "winRate">>();

  const ensureRecord = (id: string): Omit<PairwiseTally, "id" | "winRate"> => {
    const existing = records.get(id);
    if (existing !== undefined) {
      return existing;
    }

    const created = { wins: 0, losses: 0, ties: 0 };
    records.set(id, created);
    return created;
  };

  for (const outcome of outcomes) {
    const a = ensureRecord(outcome.a);
    const b = ensureRecord(outcome.b);

    if (outcome.winner === "a") {
      a.wins += 1;
      b.losses += 1;
    } else if (outcome.winner === "b") {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.ties += 1;
      b.ties += 1;
    }
  }

  const tallies = Array.from(records.entries())
    .map(([id, record]): PairwiseTally => {
      const total = record.wins + record.losses + record.ties;
      return {
        id,
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        winRate: (record.wins + 0.5 * record.ties) / total,
      };
    })
    .sort((left, right) => {
      if (left.winRate !== right.winRate) {
        return right.winRate - left.winRate;
      }

      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  const winnerId =
    tallies.length === 0 || tallies[0].winRate === tallies[1]?.winRate ? null : tallies[0].id;

  return { tallies, winnerId };
}
