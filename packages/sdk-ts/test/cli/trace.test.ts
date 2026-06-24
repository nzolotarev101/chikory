/**
 * WP-142 — trajectory renderer unit tests: pure functions over synthetic
 * journal rows (the integration path is covered in cli.test.ts).
 */
import { describe, expect, test } from "vitest";

import {
  formatDuration,
  formatEntryLine,
  formatTokens,
  renderStepDetail,
  renderTrace,
  traceJson,
} from "../../src/cli/trace.js";
import type {
  JournalEntry,
  JudgeForm,
  JudgePayload,
  RunRow,
  RunTotals,
  StepPayload,
  TaskSpec,
} from "../../src/index.js";
import type { ArtifactRef, CompactionResult } from "../../src/types.js";

function ref(kind: ArtifactRef["kind"], summary: string): ArtifactRef {
  return { id: "c0ffee".padEnd(64, "0"), kind, bytes: 321, summary };
}

const spec: TaskSpec = {
  name: "trace-test",
  goal: "render a trace",
  repos: [{ url: "/tmp/src", writable: true }],
  acceptanceCriteria: [{ id: "AC-1", description: "rendered" }],
  budgetUsd: 20,
  executor: { adapter: "scripted", family: "anthropic" },
  judge: { family: "openai-compat", cadence: 2 },
  routing: {
    stages: {
      plan: { provider: "anthropic", model: "m" },
      code: { provider: "anthropic", model: "m" },
      review: { provider: "anthropic", model: "m" },
      judge: { provider: "openai-compat", model: "fake-judge" },
    },
  },
};

const run: RunRow = {
  runId: "run-x",
  task: spec,
  startedAt: "2026-06-11T10:00:00.000Z",
  endedAt: "2026-06-11T12:14:00.000Z",
  status: "FAILED",
};

function entry(idx: number, kind: JournalEntry["kind"], payload: unknown, cost = 0): JournalEntry {
  return {
    idx,
    ts: `2026-06-11T10:0${idx}:00.000Z`,
    kind,
    payload,
    costDeltaUsd: cost,
    artifactRefs: [],
  };
}

function step(idx: number, stepIndex: number, summary: string, failed = false): JournalEntry {
  const payload: StepPayload = {
    stepIndex,
    instruction: "do the thing",
    planItem: "render a trace",
    record: {
      status: failed ? "FAILED" : "SUCCESS",
      diffRef: ref("diff", `step ${stepIndex} diff`),
      transcriptRef: ref("transcript", `step ${stepIndex} transcript`),
      summary,
      toolCalls: 3,
      tokens: { input: 12_000, output: 3100 },
      costUsd: 0.21,
      costEstimated: false,
      durationMs: 12_300,
      ...(failed ? { failure: { reason: "scripted failure", retriable: true } } : {}),
    },
  };
  return { ...entry(idx, "step", payload, 0.21), tokens: { input: 12_000, output: 3100 } };
}

function withCost(
  stepEntry: JournalEntry,
  costUsd: number,
  costEstimated: boolean,
): JournalEntry {
  const payload = stepEntry.payload as StepPayload;
  return {
    ...stepEntry,
    payload: {
      ...payload,
      record: { ...payload.record, costUsd, costEstimated },
    },
  };
}

const form: JudgeForm = {
  criterionResults: [{ id: "AC-1", pass: true, justification: "verified by check" }],
  rubricResults: [{ id: "R1", pass: true, justification: "no secrets" }],
  concerns: [],
};

const judgeModel = { provider: "openai-compat" as const, model: "fake-judge" };

const entries: JournalEntry[] = [
  step(0, 0, "scaffold blob store interface"),
  step(1, 1, "implement LocalFsStore"),
  entry(2, "judge", {
    judgeIndex: 0,
    atStep: 1,
    form,
    evidenceRefs: [ref("diff", "evidence diff"), ref("test_results", "pytest output")],
    evidenceBytes: 2048,
    judgeModel,
    costUsd: 0.05,
    tokens: { input: 100, output: 50 },
    durationMs: 4000,
  }, 0.05),
  entry(3, "verdict", {
    judgeIndex: 0,
    atStep: 1,
    verdict: { kind: "PROCEED", form, rationale: "all good", costUsd: 0.05, tokens: { input: 100, output: 50 }, judgeModel },
  }),
  entry(4, "checkpoint", {
    id: "run-x@4",
    journalIdx: 4,
    stepIndex: 1,
    gitCommits: { "/tmp/src": "abcdef1234567890" },
    contextSnapshotRef: ref("context_snapshot", "ctx"),
    budgetSpentUsd: 0.47,
    lastGood: true,
  }),
  step(5, 2, "wire into StepRecord", true),
  entry(6, "verdict", {
    judgeIndex: 1,
    atStep: 2,
    verdict: {
      kind: "ROLLBACK",
      form,
      rationale:
        "transcriptRef writes bypass the store API; test for ref round-trip deleted rather than fixed",
      rollbackTo: "run-x@4",
      costUsd: 0.05,
      tokens: { input: 100, output: 50 },
      judgeModel,
    },
  }),
  entry(7, "injection", { injectionIndex: 0, source: "human", text: "prefer sha256", atStep: 2 }),
  entry(8, "terminal", { status: "FAILED", reason: "judge HALT: gave up", lastCheckpoint: "run-x@4" }),
];

const totals: RunTotals = {
  steps: 3,
  judgePasses: 2,
  rollbacks: 1,
  escalations: 0,
  costUsd: 0.73,
  judgeCostUsd: 0.1,
  judgeCostShare: 0.137,
  tokens: { input: 36_200, output: 9400 },
};

describe("formatters", () => {
  test("formatTokens", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(3120)).toBe("3.1k");
    expect(formatTokens(12_345)).toBe("12k");
  });

  test("formatDuration", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(8_040_000)).toBe("2h 14m");
  });
});

describe("renderTrace (WP-142)", () => {
  const text = renderTrace(run, entries, totals);

  test("header: run id, status, steps, spend vs budget, duration, families", () => {
    expect(text).toContain(
      "run run-x · FAILED · 3 steps · $0.73 / $20.00 · 2h 14m · executor scripted(anthropic) · judge openai-compat",
    );
  });

  test("per-step rows with tokens, cost, verdicts", () => {
    expect(text).toContain(" 1   scaffold blob store interface");
    expect(text).toContain("12k/3.1k");
    expect(text).toContain("$0.21");
    expect(text).toContain("✓ PROCEED (1/1 criteria)");
    expect(text).toContain("⟲ ROLLBACK → run-x@4");
  });

  test("multi-line summaries collapse to one table row (dogfood-001 catch)", () => {
    const multiline = renderTrace(
      run,
      [step(0, 0, "Implemented Memory Pointer Store:\n\n- remember()\n- recall()")],
      totals,
    );
    expect(multiline).toContain(" 1   Implemented Memory Pointer Store: -…");
  });

  test("non-PROCEED rationale rides under the row", () => {
    expect(text).toContain('judge: "transcriptRef writes bypass the store API;');
  });

  test("totals footer + terminal failure line", () => {
    expect(text).toContain("totals: decisions 3 · judge passes 2 ($0.10, 13.7%) · rollbacks 1 · escalations 0");
    expect(text).toContain("injections 1 · checkpoints 1");
    expect(text).toContain("failed: judge HALT: gave up (last checkpoint run-x@4)");
  });

  test("reports seam fire count only when seam entries exist", () => {
    const entriesWithSeam: JournalEntry[] = [
      ...entries,
      entry(9, "seam", {
        seamEventIndex: 0,
        atStep: 0,
        path: "step-1.txt",
        byteCount: 18,
      }),
    ];
    const entriesNoSeam = entries;

    expect(renderTrace(run, entriesWithSeam, totals)).toContain("seams fired 1");
    expect(renderTrace(run, entriesNoSeam, totals)).not.toContain("seams fired");
  });

  test("reports pacing event count only when pacing entries exist", () => {
    const entriesWithPacing: JournalEntry[] = [
      ...entries,
      entry(9, "pacing", {
        pacingEventIndex: 0,
        atStep: 0,
        action: "compact",
        projectedTokens: 180_000,
        remainingTokens: 20_000,
        utilization: 0.9,
      }),
    ];
    const entriesNoPacing = entries;

    expect(renderTrace(run, entriesWithPacing, totals)).toContain("pacing events 1");
    expect(renderTrace(run, entriesNoPacing, totals)).not.toContain("pacing events");
  });

  test("reports actionable pacing summary only when pacing entries exist", () => {
    const entriesWithPacing: JournalEntry[] = [
      ...entries,
      entry(9, "pacing", {
        pacingEventIndex: 0,
        atStep: 0,
        action: "compact",
        projectedTokens: 180_000,
        remainingTokens: 20_000,
        utilization: 0.9,
      }),
    ];
    const entriesNoPacing = entries;

    expect(renderTrace(run, entriesWithPacing, totals)).toContain("peak window 90% (compact 1 · park 0)");
    expect(renderTrace(run, entriesNoPacing, totals)).not.toContain("peak window");
  });

  test("reports issues found and changes made", () => {
    const changedStep = step(0, 0, "changed files");
    const probeStep = step(1, 1, "checked state");
    const probePayload = probeStep.payload as StepPayload;
    const metricEntries: JournalEntry[] = [
      changedStep,
      {
        ...probeStep,
        payload: {
          ...probePayload,
          record: {
            ...probePayload.record,
            diffRef: { ...probePayload.record.diffRef, bytes: 0 },
          },
        },
      },
      entry(2, "judge", {
        judgeIndex: 0,
        atStep: 1,
        form: {
          criterionResults: [{ id: "AC-1", pass: true, justification: "verified" }],
          rubricResults: [{ id: "R1", pass: false, justification: "needs revision" }],
          concerns: ["missing edge-case coverage"],
        },
        evidenceRefs: [],
        evidenceBytes: 0,
        judgeModel,
        costUsd: 0.05,
        tokens: { input: 100, output: 50 },
        durationMs: 4000,
      }),
    ];

    expect(renderTrace(run, metricEntries, totals)).toContain(
      "        issues found 2 · changes made 1 (issues:changes 2:1)",
    );
  });

  test("reports components over time in journal order", () => {
    const judgePayload: JudgePayload = {
      judgeIndex: 0,
      atStep: 1,
      form,
      evidenceRefs: [],
      evidenceBytes: 0,
      judgeModel,
      costUsd: 0.05,
      tokens: { input: 100, output: 50 },
      durationMs: 4000,
    };
    const timelineEntries: JournalEntry[] = [
      step(0, 0, "first step"),
      step(1, 1, "second step"),
      entry(2, "judge", judgePayload),
    ];

    expect(renderTrace(run, timelineEntries, totals)).toContain(
      "        components over time: s0 s1 j@1",
    );
  });

  test("warns when metered tokens have an estimated zero cost", () => {
    const unpricedEntries = [withCost(step(0, 0, "unpriced model"), 0, true)];
    const trace = renderTrace(run, unpricedEntries, totals);
    const detail = renderStepDetail(unpricedEntries, 1);

    expect(trace).toContain("⚠ cost meter blind (unpriced tokens)");
    expect(detail).toContain("$0.0000 (estimated — UNPRICED: 15100 tokens metered)");
  });

  test("does not warn for priced or non-estimated steps", () => {
    const pricedEntries = [withCost(step(0, 0, "priced model"), 0.21, true)];
    const exactEntries = [withCost(step(0, 0, "exact zero"), 0, false)];

    expect(renderTrace(run, pricedEntries, totals)).not.toContain("cost meter blind");
    expect(renderStepDetail(pricedEntries, 1)).not.toContain("UNPRICED");
    expect(renderTrace(run, exactEntries, totals)).not.toContain("cost meter blind");
    expect(renderStepDetail(exactEntries, 1)).not.toContain("UNPRICED");
  });
});

describe("renderStepDetail (--step)", () => {
  test("drill-down: refs, judge form, verdict", () => {
    const text = renderStepDetail(entries, 2);
    expect(text).toContain("step 2 · SUCCESS · $0.2100");
    expect(text).toContain("diff:        c0ffee");
    expect(text).toContain("transcript:  c0ffee");
    expect(text).toContain("✓ AC-1 — verified by check");
    expect(text).toContain("✓ R1 — no secrets");
    expect(text).toContain("evidence: ");
    expect(text).toContain("test_results");
    expect(text).toContain("checkpoint:  run-x@4 · commit abcdef123456 · lastGood true");
    expect(text).toContain("verdict:     ✓ PROCEED (1/1 criteria)");
  });

  test("failed step shows the failure", () => {
    const text = renderStepDetail(entries, 3);
    expect(text).toContain("step 3 · FAILED");
    expect(text).toContain("failure:     scripted failure (retriable: true)");
  });

  test("unknown step is a readable error, not a throw", () => {
    expect(renderStepDetail(entries, 99)).toContain("no step 99 in this run (3 steps journaled)");
  });
});

describe("traceJson (--json)", () => {
  test("raw journal interchange shape", () => {
    const json = traceJson(run, entries, totals);
    expect(json["totals"]).toEqual(totals);
    expect((json["run"] as { runId: string }).runId).toBe("run-x");
    expect((json["entries"] as unknown[]).length).toBe(entries.length);
  });
});

describe("formatEntryLine (--watch)", () => {
  test("one line per entry kind", () => {
    expect(formatEntryLine(entries[0]!)).toContain("step 1 SUCCESS $0.2100 — scaffold blob store interface");
    expect(formatEntryLine(entries[3]!)).toContain("verdict ✓ PROCEED (1/1 criteria) @ step 2");
    expect(formatEntryLine(entries[4]!)).toContain("checkpoint run-x@4 (lastGood)");
    expect(formatEntryLine(entries[8]!)).toContain("terminal FAILED — judge HALT: gave up");
  });

  test("compaction renders token delta and digest pointer", () => {
    const payload: CompactionResult = {
      tokensBefore: 120_000,
      tokensAfter: 40_000,
      digestRef: {
        id: "abc123def456ghi",
        kind: "context_snapshot",
        bytes: 2048,
        summary: "folded 8 step summaries",
      },
    };
    const line = formatEntryLine(entry(9, "compaction", payload));

    expect(line).toContain("120k");
    expect(line).toContain("40k");
    expect(line).toContain("(digest abc123def456)");
  });

  test("compaction renders the absence of a digest pointer", () => {
    const payload: CompactionResult = {
      tokensBefore: 120_000,
      tokensAfter: 40_000,
    };
    const line = formatEntryLine(entry(9, "compaction", payload));

    expect(line).toContain("(no digest)");
    expect(line).not.toContain("digest abc");
  });

  test("compaction flags a pacing-pressure-triggered fold (WP-207)", () => {
    const base: CompactionResult = { tokensBefore: 120_000, tokensAfter: 40_000 };
    const pacingLine = formatEntryLine(entry(9, "compaction", { ...base, trigger: "pacing" }));
    expect(pacingLine).toContain("(pacing)");

    // Count-triggered and legacy (untagged) folds render without the marker.
    expect(formatEntryLine(entry(9, "compaction", { ...base, trigger: "count" }))).not.toContain(
      "(pacing)",
    );
    expect(formatEntryLine(entry(9, "compaction", base))).not.toContain("(pacing)");
  });

  test("pacing renders action, utilization, and projected tokens", () => {
    const line = formatEntryLine(
      entry(9, "pacing", {
        pacingEventIndex: 0,
        atStep: 0,
        action: "compact",
        projectedTokens: 180_000,
        remainingTokens: 20_000,
        utilization: 0.9,
      }),
    );

    expect(line).toContain("pacing compact — 90% window (180k proj)");
  });
});
