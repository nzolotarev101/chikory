import { describe, expect, test } from "vitest";

import { describeCompactionPressure } from "../../src/index.js";
import type { JournalEntry } from "../../src/index.js";

function entry(idx: number, kind: JournalEntry["kind"], payload: unknown): JournalEntry {
  return {
    idx,
    ts: `2026-07-09T10:0${idx}:00.000Z`,
    kind,
    payload,
    costDeltaUsd: 0,
    artifactRefs: [],
  };
}

describe("describeCompactionPressure", () => {
  test("joins mixed pacing decisions to pressure-driven compaction folds", () => {
    const entries: JournalEntry[] = [
      entry(0, "pacing", { atStep: 0, action: "continue" }),
      entry(1, "pacing", { atStep: 1, action: "compact" }),
      entry(2, "compaction", { stepIndex: 1, trigger: "pacing" }),
      entry(3, "pacing", { atStep: 2, action: "compact" }),
      entry(4, "compaction", { stepIndex: 2, trigger: "pacing" }),
      entry(5, "pacing", { atStep: 3, action: "park" }),
      entry(6, "compaction", { stepIndex: 3, trigger: "count" }),
    ];

    expect(describeCompactionPressure(entries)).toEqual({
      pressureSteps: 3,
      pacingFolds: 2,
      unfoldedPressureSteps: 1,
    });
  });

  test("returns an all-zero description for an empty journal", () => {
    expect(describeCompactionPressure([])).toEqual({
      pressureSteps: 0,
      pacingFolds: 0,
      unfoldedPressureSteps: 0,
    });
  });
});
