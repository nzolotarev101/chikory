import { describe, expect, it } from "vitest";

import { planCompaction } from "../../src/runner/compaction.js";
import type { CompactionPolicy } from "../../src/index.js";

const policy = (over: Partial<CompactionPolicy> = {}): CompactionPolicy => ({
  triggerAfterSteps: 3,
  keepLastN: 2,
  ...over,
});

describe("planCompaction (WP-203, ADR-006)", () => {
  it("keeps everything verbatim below the trigger threshold", () => {
    const s = ["a", "b", "c"]; // length 3 == triggerAfterSteps → not yet eligible
    expect(planCompaction(s, policy())).toEqual({ keepVerbatim: ["a", "b", "c"], toDigest: [] });
  });

  it("folds the oldest, keeps the newest keepLastN verbatim, once eligible", () => {
    const s = ["a", "b", "c", "d", "e"]; // length 5 > 3, keepLastN 2
    expect(planCompaction(s, policy())).toEqual({
      keepVerbatim: ["d", "e"],
      toDigest: ["a", "b", "c"],
    });
  });

  it("never folds the keep-window even when the trigger is 0", () => {
    const s = ["a", "b"]; // length 2 == keepLastN → nothing older to fold
    expect(planCompaction(s, policy({ triggerAfterSteps: 0 }))).toEqual({
      keepVerbatim: ["a", "b"],
      toDigest: [],
    });
  });

  it("folds all-but-the-keep-window with trigger 0 and a full tier", () => {
    const s = ["a", "b", "c"];
    expect(planCompaction(s, policy({ triggerAfterSteps: 0, keepLastN: 1 }))).toEqual({
      keepVerbatim: ["c"],
      toDigest: ["a", "b"],
    });
  });

  it("keepLastN 0 folds the whole tier once eligible", () => {
    const s = ["a", "b", "c", "d"];
    expect(planCompaction(s, policy({ keepLastN: 0 }))).toEqual({
      keepVerbatim: [],
      toDigest: ["a", "b", "c", "d"],
    });
  });

  it("preserves order in both partitions", () => {
    const s = ["1", "2", "3", "4", "5", "6"];
    const plan = planCompaction(s, policy({ triggerAfterSteps: 2, keepLastN: 3 }));
    expect(plan.toDigest).toEqual(["1", "2", "3"]);
    expect(plan.keepVerbatim).toEqual(["4", "5", "6"]);
  });

  it("folds older summaries under pressure policy (keepLastN 1) with fewer than 5 summaries", () => {
    const s = ["step0", "step1", "step2"];
    const plan = planCompaction(s, { triggerAfterSteps: 1, keepLastN: 1 });
    expect(plan.keepVerbatim).toEqual(["step2"]);
    expect(plan.toDigest).toEqual(["step0", "step1"]);
  });

  it("under pressure policy (keepLastN 1), leaves a 1-step history untouched so recent context is never lost", () => {
    const s = ["step0"];
    const plan = planCompaction(s, { triggerAfterSteps: 1, keepLastN: 1 });
    expect(plan.keepVerbatim).toEqual(["step0"]);
    expect(plan.toDigest).toEqual([]);
  });

  it("under pressure policy (keepLastN 1), folds on a 2-step history preserving exactly the most recent step", () => {
    const s = ["step0", "step1"];
    const plan = planCompaction(s, { triggerAfterSteps: 1, keepLastN: 1 });
    expect(plan.keepVerbatim).toEqual(["step1"]);
    expect(plan.toDigest).toEqual(["step0"]);
  });

  it("unpressured default policy (triggerAfterSteps 8, keepLastN 5) does not fold at 7 steps", () => {
    const s = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
    const plan = planCompaction(s, { triggerAfterSteps: 8, keepLastN: 5 });
    expect(plan.keepVerbatim).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(plan.toDigest).toEqual([]);
  });

  it("unpressured default policy (triggerAfterSteps 8, keepLastN 5) folds 4 oldest steps at 9 steps", () => {
    const s = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    const plan = planCompaction(s, { triggerAfterSteps: 8, keepLastN: 5 });
    expect(plan.keepVerbatim).toEqual(["s4", "s5", "s6", "s7", "s8"]);
    expect(plan.toDigest).toEqual(["s0", "s1", "s2", "s3"]);
  });
});

