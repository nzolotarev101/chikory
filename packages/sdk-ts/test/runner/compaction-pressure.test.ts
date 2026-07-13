import { describe, expect, test } from "vitest";

import { describeCompactionPressure, pressureFoldGapWarning } from "../../src/index.js";
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
      firstPacingFoldStep: 1,
    });
  });

  test("returns an all-zero description for an empty journal", () => {
    expect(describeCompactionPressure([])).toEqual({
      pressureSteps: 0,
      pacingFolds: 0,
      unfoldedPressureSteps: 0,
      firstPacingFoldStep: null,
    });
  });

  test("returns null first pacing fold step for an unfolded pressure journal", () => {
    const entries: JournalEntry[] = [
      entry(0, "pacing", { atStep: 0, action: "compact" }),
      entry(1, "pacing", { atStep: 1, action: "park" }),
      entry(2, "compaction", { stepIndex: 1, trigger: "count" }),
    ];

    expect(describeCompactionPressure(entries)).toEqual({
      pressureSteps: 2,
      pacingFolds: 0,
      unfoldedPressureSteps: 2,
      firstPacingFoldStep: null,
    });
  });

  test("keeps unfolded pressure loud without a first pacing fold step", () => {
    const entries: JournalEntry[] = [
      entry(0, "pacing", { atStep: 0, action: "compact" }),
      entry(1, "pacing", { atStep: 1, action: "park" }),
      entry(2, "compaction", { stepIndex: 1, trigger: "count" }),
    ];

    const description = describeCompactionPressure(entries);

    expect(description.firstPacingFoldStep).toBeNull();
    expect(pressureFoldGapWarning(description)).not.toBeNull();
  });

  test("derives first pacing fold step from the journaled compaction stepIndex", () => {
    const entries: JournalEntry[] = [
      entry(0, "pacing", { atStep: 4, action: "compact" }),
      entry(1, "compaction", { stepIndex: 6, foldedCount: 1, trigger: "pacing" }),
    ];

    expect(describeCompactionPressure(entries)).toEqual({
      pressureSteps: 1,
      pacingFolds: 1,
      unfoldedPressureSteps: 0,
      firstPacingFoldStep: 6,
    });
  });

  test("falls back to paired pacing event step for legacy compaction payloads", () => {
    const entries: JournalEntry[] = [
      entry(0, "pacing", { atStep: 4, action: "compact" }),
      entry(1, "compaction", { foldedCount: 1, trigger: "pacing" }),
    ];

    expect(describeCompactionPressure(entries)).toEqual({
      pressureSteps: 1,
      pacingFolds: 1,
      unfoldedPressureSteps: 0,
      firstPacingFoldStep: 4,
    });
  });
});

describe("pressureFoldGapWarning", () => {
  test("returns a warning for pressure steps without pacing folds", () => {
    expect(
      pressureFoldGapWarning({
        pressureSteps: 3,
        pacingFolds: 0,
        unfoldedPressureSteps: 3,
        firstPacingFoldStep: null,
      }),
    ).toBe("pressure fired for 3 step(s), but no pacing folds were recorded");
  });

  test("returns null when pressure produced a pacing fold", () => {
    expect(
      pressureFoldGapWarning({
        pressureSteps: 3,
        pacingFolds: 1,
        unfoldedPressureSteps: 2,
        firstPacingFoldStep: 1,
      }),
    ).toBeNull();
  });

  test("returns null when there is no pressure", () => {
    expect(
      pressureFoldGapWarning({
        pressureSteps: 0,
        pacingFolds: 0,
        unfoldedPressureSteps: 0,
        firstPacingFoldStep: null,
      }),
    ).toBeNull();
  });
});
