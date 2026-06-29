import { describe, expect, it } from "vitest";

import {
  aggregateGEval,
  aggregatePairwise,
  normalizeGEvalScore,
  type GEvalAggregateOptions,
  type GEvalCriterionScore,
  type GEvalScore,
  type PairwiseOutcome,
} from "../../src/judge/scoring.js";

describe("normalizeGEvalScore (WP-210)", () => {
  it("normalizes default scale scores", () => {
    expect(normalizeGEvalScore(5)).toBe(1);
    expect(normalizeGEvalScore(1)).toBe(0);
    expect(normalizeGEvalScore(3)).toBe(0.5);
  });

  it("clamps out-of-range raw scores", () => {
    expect(normalizeGEvalScore(7)).toBe(1);
    expect(normalizeGEvalScore(0)).toBe(0);
  });

  it("normalizes a custom scale", () => {
    expect(normalizeGEvalScore(7, 0, 10)).toBe(0.7);
  });
});

describe("aggregateGEval (WP-210)", () => {
  it("passes a single criterion at the top of the scale", () => {
    const scores: GEvalCriterionScore[] = [{ id: "a", score: 5 }];
    const opts: GEvalAggregateOptions = { threshold: 0.7 };

    const result: GEvalScore = aggregateGEval(scores, opts);

    expect(result.normalized).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("fails a single criterion at the bottom of the scale", () => {
    const result = aggregateGEval([{ id: "a", score: 1 }], { threshold: 0.7 });

    expect(result.normalized).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("computes a weighted mean aggregate", () => {
    const result = aggregateGEval(
      [
        { id: "a", score: 5, weight: 3 },
        { id: "b", score: 1, weight: 1 },
      ],
      { threshold: 0.7 },
    );

    expect(result.weightedMean).toBe(4);
    expect(result.normalized).toBe(0.75);
    expect(result.passed).toBe(true);
  });

  it("treats the threshold as inclusive", () => {
    const result = aggregateGEval([{ id: "a", score: 4 }], { threshold: 0.75 });

    expect(result.normalized).toBe(0.75);
    expect(result.passed).toBe(true);
  });

  it("returns the degenerate result for empty input", () => {
    const result = aggregateGEval([], { threshold: 0.7 });

    expect(result.weightedMean).toBe(1);
    expect(result.normalized).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("ignores non-positive weights", () => {
    const result = aggregateGEval(
      [
        { id: "a", score: 5, weight: 0 },
        { id: "b", score: 4, weight: 2 },
      ],
      { threshold: 0.7 },
    );

    expect(result.weightedMean).toBe(4);
    expect(result.passed).toBe(true);
  });
});

describe("aggregatePairwise (WP-210)", () => {
  it("returns a clear winner that wins all comparisons", () => {
    const result = aggregatePairwise([
      { a: "alpha", b: "beta", winner: "a" },
      { a: "gamma", b: "alpha", winner: "b" },
    ]);

    expect(result.tallies[0]).toEqual({
      id: "alpha",
      wins: 2,
      losses: 0,
      ties: 0,
      winRate: 1,
    });
    expect(result.winnerId).toBe("alpha");
  });

  it("counts a tie as half a win and leaves the top winner ambiguous", () => {
    const result = aggregatePairwise([{ a: "alpha", b: "beta", winner: "tie" }]);

    expect(result.tallies).toEqual([
      { id: "alpha", wins: 0, losses: 0, ties: 1, winRate: 0.5 },
      { id: "beta", wins: 0, losses: 0, ties: 1, winRate: 0.5 },
    ]);
    expect(result.winnerId).toBeNull();
  });

  it("ranks mixed candidates by win rate with id-ascending tiebreaks", () => {
    const result = aggregatePairwise([
      { a: "bravo", b: "charlie", winner: "a" },
      { a: "alpha", b: "bravo", winner: "tie" },
      { a: "alpha", b: "charlie", winner: "a" },
    ]);

    expect(result.tallies).toHaveLength(3);
    expect(result.tallies.map((tally) => tally.id)).toEqual(["alpha", "bravo", "charlie"]);
    expect(result.tallies).toEqual([
      { id: "alpha", wins: 1, losses: 0, ties: 1, winRate: 0.75 },
      { id: "bravo", wins: 1, losses: 0, ties: 1, winRate: 0.75 },
      { id: "charlie", wins: 0, losses: 2, ties: 0, winRate: 0 },
    ]);
    expect(result.winnerId).toBeNull();
  });

  it("returns the degenerate result for empty input", () => {
    expect(aggregatePairwise([])).toEqual({ tallies: [], winnerId: null });
  });

  it("does not mutate the input array or outcome elements", () => {
    const outcomes: PairwiseOutcome[] = [
      { a: "alpha", b: "beta", winner: "a" },
      { a: "beta", b: "gamma", winner: "tie" },
    ];
    const snapshot = outcomes.map((outcome) => ({ ...outcome }));

    aggregatePairwise(outcomes);

    expect(outcomes).toEqual(snapshot);
  });
});
