import { describe, expect, test } from "vitest";

import { summarizeCompaction } from "../../src/index.js";
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

describe("summarizeCompaction", () => {
  test("summarizes digest-bearing folds and pacing-triggered subset", () => {
    const entries: JournalEntry[] = [
      entry(0, "compaction", { digestRef: { id: "digest-a" }, trigger: "pacing" }),
      entry(1, "compaction", { digestRef: { id: "digest-b" }, trigger: "count" }),
    ];

    expect(summarizeCompaction(entries).pacingFolds).toBe(1);
    expect(summarizeCompaction(entries)).toEqual({ folds: 2, pacingFolds: 1 });
  });

  test("returns zero summary for journals with no compaction entries", () => {
    const entries: JournalEntry[] = [
      entry(0, "step", { stepIndex: 0 }),
      entry(1, "checkpoint", { id: "run-x@1" }),
    ];

    expect(summarizeCompaction(entries)).toEqual({ folds: 0, pacingFolds: 0 });
  });

  test("ignores digest-less compaction entries and non-compaction entries", () => {
    const entries: JournalEntry[] = [
      entry(0, "step", { stepIndex: 0 }),
      entry(1, "compaction", { trigger: "pacing" }),
      entry(2, "checkpoint", { id: "run-x@2" }),
      entry(3, "compaction", { digestRef: { id: "digest-c" }, trigger: "count" }),
    ];

    expect(summarizeCompaction(entries)).toEqual({ folds: 1, pacingFolds: 0 });
  });
});
