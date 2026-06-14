# ADR-006: Compaction at Checkpoint Boundaries

**Status**: Accepted (2026-06-14)
**Date**: 2026-06-14
**WP**: WP-203 · **Origin**: context-rot mitigation (project.md §Critical concepts; CM-1/CM-2)

## Context

Model performance degrades over long sessions as context accumulates rotted,
low-signal history ("context rot", project.md). Chikory's reliability thesis
requires first-class mitigation: a multi-day, multi-session run must not feed
the executor an ever-growing, decaying transcript. The lever is **compaction** —
folding old step history into a compact digest while keeping recent detail
verbatim — but two questions were unresolved and blocked WP-203 from being
dogfoodable:

1. **When does compaction run?** Arbitrary mid-step compaction races the durable
   loop and can rehydrate rotted context on a crash-resume.
2. **What is the pure, testable core** versus the non-deterministic LLM part?

## Decision

1. **Compaction runs at the checkpoint boundary** (`writeCheckpoint`, the CM-1
   co-design point already marked in `runner/activities.ts`). The checkpoint
   already snapshots context (`Checkpoint.contextSnapshotRef`); compaction
   produces *that* snapshot. Because a resume always rehydrates from a
   checkpoint, the resumed context is the **compacted** one — a resume never
   rehydrates rotted history (the CM-1 guarantee).

2. **Split pure decision from non-pure digest.** The decision of *what* to fold
   is a pure function, `planCompaction(summaries, policy) → CompactionPlan`
   (`keepVerbatim` / `toDigest`). The LLM call that turns `toDigest` into a
   digest, the artifact write (the digest is stored behind a Memory Pointer,
   WP-202), and the `compaction` journal row (`CompactionResult`) are the
   non-pure wiring layered on top.

3. **Keep-last-N + trigger threshold policy.** `CompactionPolicy` keeps the
   newest `keepLastN` step summaries verbatim (CM-2 — recent detail is
   load-bearing) and only compacts once the recall tier exceeds
   `triggerAfterSteps`, so short runs never pay a digest call. Structured notes
   (`ContextBundle.notes`) survive compaction verbatim by construction (CM-2).

## Contract surface (hand-done, landed 2026-06-14)

`types.ts` + `CONTRACTS.md` §6a + `journal-format.md` §3 (`compaction`):
`CompactionPolicy`, `CompactionPlan`, `CompactionResult`, and the pure,
unit-tested `planCompaction` (`src/runner/compaction.ts`,
`test/runner/compaction.test.ts`). These are language-local code contracts (no
wire serialization → no conformance fixture); `CompactionResult` is the
journaled payload shape.

## Consequences / implementation slices

- **S1 — contract + pure core (this PR, hand-done).** *Unblocks the WP-203
  dogfoods.*
- **S2 — digest wiring** (dogfoodable): at `writeCheckpoint`, call
  `planCompaction`, fold `toDigest` via one router call, store the digest behind
  a Memory Pointer (WP-202), journal the `CompactionResult`, and write the
  compacted bundle as `contextSnapshotRef`.
- **S3 — recall-tier projection**: the loop builds `ContextBundle.recentSteps`
  from `keepVerbatim` + the digest ref instead of the raw summary list.
- **S4 — trace**: `chikory trace` renders compaction events (tokensBefore→After)
  — pure renderer, dogfoodable 🟢.

Risk: an over-aggressive digest drops load-bearing detail (mitigate — `keepLastN`
verbatim window + structured notes survive verbatim; the digest is a Memory
Pointer, so the full history stays retrievable, never destroyed). Ties to
WP-202 (Memory Pointer store) for digest storage and WP-219 S4 (context handoff
between chained nodes reuses the same compaction note).
