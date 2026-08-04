/**
 * F-248 (WP-580) — a quota deferral must not erase work the executor already
 * did.
 *
 * A wall read off the executor's OWN stderr arrives after the executor ran. On
 * p3-rung-4 that mattered concretely: `brownfield-005` (`run-455cf368-…`)
 * journaled step 0 at `2026-08-04T03:15:55.123Z` as a FAILED park whose summary
 * said "no executor work was performed" — while the checkpoint 101 ms later, at
 * `03:15:55.224Z`, committed `5ac47158c`: a real 3-file fix wiring an
 * AbortController through `httpBatchStreamLink.ts` and `dataLoader.ts` plus a
 * new streaming test. That fix went on to satisfy all four acceptance criteria,
 * including a probe that cannot pass on stock tRPC.
 *
 * The old record was fabricated from scratch: empty diff, ZERO_TOKENS, cost 0.
 * So the trace denied work that exists, and `appendStepConsumption` wrote zero
 * tokens into the very ledger `decideLimitPacing` reads to predict the next
 * wall.
 */
import { describe, expect, it } from "vitest";

import { createMemoryArtifactStore } from "../../src/artifacts/index.js";
import { applyLimitResponse } from "../../src/executors/limit-response.js";
import type { ClassifiedLimitSignal } from "../../src/limit-signal.js";
import type { LimitResponseDecision } from "../../src/limit-response.js";
import type { ArtifactRef, StepRecord } from "../../src/types.js";

const PARK: LimitResponseDecision = {
  action: "park-until-reset",
  reason: "no-legal-headroom",
  retryAtMs: 1785884700596,
};

const SIGNAL = {
  kind: "limit",
  source: "cli-usage-limit",
  capability: {
    endpointKind: "executor",
    target: "gemini-cli",
    family: "gemini",
    limits: { requestField: "max_tokens", defaultMaxTokens: 4096 },
  },
  reason:
    "Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 19h49m1s.",
} as unknown as ClassifiedLimitSignal;

const PLAN_ITEM = "wire an AbortController through httpBatchStreamLink";

const attemptedDiff: ArtifactRef = {
  id: "5ac47158cc8b852de3ec69b2612f85b0e7b68bc4",
  kind: "diff",
  bytes: 4_182,
  summary: "3 files changed, 100 insertions(+), 4 deletions(-)",
};

const attempted: StepRecord = {
  status: "FAILED",
  diffRef: attemptedDiff,
  transcriptRef: { id: "t0", kind: "transcript", bytes: 900, summary: "executor turn" },
  summary: "wired AbortController into httpBatchStreamLink and dataLoader",
  toolCalls: 14,
  tokens: { input: 61_204, output: 3_318 },
  costUsd: 0,
  costEstimated: false,
  durationMs: 194_000,
  failure: { reason: "executor reported failure", retriable: true },
};

describe("applyLimitResponse — park-until-reset", () => {
  it("preserves the diff, tokens and cost of an attempt the wall interrupted", async () => {
    const record = await applyLimitResponse({
      store: createMemoryArtifactStore(),
      stepIndex: 0,
      planItem: PLAN_ITEM,
      signal: SIGNAL,
      selected: PARK,
      attemptedRecord: attempted,
    });

    // The work is still on disk; the journal must say so.
    expect(record.diffRef).toEqual(attemptedDiff);
    expect(record.tokens).toEqual({ input: 61_204, output: 3_318 });
    expect(record.toolCalls).toBe(14);
    expect(record.durationMs).toBe(194_000);
    expect(record.failure?.reason).toContain("is preserved in this step's diff");
    expect(record.failure?.reason).not.toContain("no executor work was performed");

    // Still FAILED (the plan item did not complete), but not the agent's fault —
    // `infraFailed` is what stops it spending a CG-1 strike (F-246).
    expect(record.status).toBe("FAILED");
    expect(record.infraFailed).toBe(true);
    expect(record.failure?.retriable).toBe(true);
  });

  it("still reports no work when the deferral pre-empted the executor", async () => {
    const record = await applyLimitResponse({
      store: createMemoryArtifactStore(),
      stepIndex: 0,
      planItem: PLAN_ITEM,
      signal: SIGNAL,
      selected: PARK,
    });

    expect(record.diffRef.bytes).toBe(0);
    expect(record.tokens).toEqual({ input: 0, output: 0 });
    expect(record.toolCalls).toBe(0);
    expect(record.durationMs).toBe(0);
    expect(record.failure?.reason).toContain("no executor work was performed");
    expect(record.status).toBe("FAILED");
    expect(record.infraFailed).toBe(true);
  });
});
