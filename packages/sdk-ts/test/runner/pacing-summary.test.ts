import { describe, expect, test } from "vitest";

import { summarizePacing } from "../../src/index.js";
import type { JournalEntry } from "../../src/index.js";

function entry(idx: number, kind: JournalEntry["kind"], payload: unknown): JournalEntry {
  return {
    idx,
    ts: `2026-06-11T10:0${idx}:00.000Z`,
    kind,
    payload,
    costDeltaUsd: 0,
    artifactRefs: [],
  };
}

describe("summarizePacing", () => {
  test("summarizes peak utilization and compact/park recommendations", () => {
    const entries: JournalEntry[] = [
      entry(0, "pacing", { action: "continue", utilization: 0.4 }),
      entry(1, "pacing", { action: "compact", utilization: 0.9 }),
      entry(2, "pacing", { action: "park", utilization: 0.7 }),
    ];

    expect(summarizePacing(entries).peakUtilization).toBe(0.9);
    expect(summarizePacing(entries).compactRecommended).toBe(1);
    expect(summarizePacing(entries).parkRecommended).toBe(1);
    expect(summarizePacing(entries)).toEqual({
      peakUtilization: 0.9,
      compactRecommended: 1,
      parkRecommended: 1,
    });
  });

  test("returns zero summary for journals with no pacing entries", () => {
    const entries: JournalEntry[] = [
      entry(0, "step", { stepIndex: 0 }),
      entry(1, "checkpoint", { id: "run-x@1" }),
    ];

    expect(summarizePacing(entries)).toEqual({
      peakUtilization: 0,
      compactRecommended: 0,
      parkRecommended: 0,
    });
  });

  test("ignores non-pacing entries", () => {
    const entries: JournalEntry[] = [
      entry(0, "step", { stepIndex: 0 }),
      entry(1, "pacing", { action: "compact", utilization: 0.9 }),
      entry(2, "checkpoint", { id: "run-x@2" }),
    ];

    expect(summarizePacing(entries)).toEqual({
      peakUtilization: 0.9,
      compactRecommended: 1,
      parkRecommended: 0,
    });
  });
});
