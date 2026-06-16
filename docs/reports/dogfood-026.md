# Dogfood-026 — WP-203 S4: the pure compaction-trace renderer (`formatEntryLine` `case "compaction"`, clean SUCCESS in ONE step — F-11 stays closed; input tokens 807k, mid-band)

**WP**: WP-203 (S4, the pure compaction-trace renderer) · **Date**: 2026-06-15 · **Task spec**: [`examples/dogfood/dogfood-026.yaml`](../../examples/dogfood/dogfood-026.yaml) · **Run**: `run-f9d699d4-5b17-4d93-b506-0823c59a09ba` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, uncommitted on `main`

> Twenty-sixth campaign, twenty-fifth first-attempt SUCCESS. The F-11-closed
> shape held for a **fifth** straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), SUCCESS seals — no empty-diff probe. The
> delivery teaches `chikory trace --watch` to render the `compaction` JIF entry
> (ADR-006): `formatEntryLine` gains a `case "compaction"` that casts
> `entry.payload as CompactionResult` and renders
> `[ts] compaction 120k→40k tokens (digest abc123def456)` — or `(no digest)`
> when nothing folded — the direct analog of the WP-209 process-metric trace
> renderers (dogfood-010/011), pure over a synthetic `JournalEntry[]` fixture,
> no contract touched. With this the **WP-203 S4 pure trace surface is
> complete**; the compaction entry is no longer a bare `[ts] compaction`
> fall-through. **No new friction.** Cost watch-item: input tokens came in at
> **807k** — mid-band in the established sawtooth (021 862k → 022 969k → 023
> 451k → 024 976k → 025 467k → **026 807k**), neither a low nor a new high,
> confirming again that per-step input cost is *noisy, not monotonic*.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-f9d699d4-5b17-4d93-b506-0823c59a09ba · SUCCESS · 1 steps · $1.09 / $5.00 · 4m 6s · executor codex(openai) · judge openai-compat
 1   Implemented WP-203 S4 in exactly th…  807k/3.8k  $1.05  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 4.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

**One step. No probe.** `components over time: s0 j@0` — the judge fired *at* the
productive step (the F-11-closed shape, not the `s0 s1 j@1` probe signature of
dogfood-021 and its twenty predecessors). The step-0 summary ended with
`CHIKORY_TASK_COMPLETE` → `claimsCompleteFromSummary` set `claimsComplete ===
true` → `isCompletionMilestone` fired the judge off-cadence → PROCEED sealed
SUCCESS. The phase-0 evidence pack confirms it independently: `probe step: none
detected (no empty-diff step) — F-11 did not recur this run`.

## Delivery quality (human review, post-landing)

The functional delivery matches the spec line by line, exactly two files, and is
a faithful structural mirror of the existing `formatEntryLine` arms (the WP-209
trace-renderer pattern):

- **`packages/sdk-ts/src/cli/trace.ts`** — two additive edits, nothing else:
  - `CompactionResult` added to the existing `import type { … } from
    "../types.js"` block, alphabetically after `Checkpoint` (now `ArtifactRef,
    Checkpoint, CompactionResult, JournalEntry, …`), kept `import type`.
  - a `case "compaction":` arm inserted immediately before `case "terminal":`,
    casting `entry.payload as CompactionResult` and returning a single line in
    the established `[${ts}] <kind> …` idiom (reusing the in-scope `ts =
    entry.ts.slice(11, 19)` and the existing `formatTokens` helper):
    `` `[${ts}] compaction ${formatTokens(payload.tokensBefore)}→${formatTokens(payload.tokensAfter)} tokens` `` then
    `` payload.digestRef ? ` (digest ${payload.digestRef.id.slice(0, 12)})` : " (no digest)" ``.
    No mutation of `entry`/`payload`; the `default` arm and every other case
    untouched.
- **`packages/sdk-ts/test/cli/trace.test.ts`** — extends the existing
  `describe("formatEntryLine (--watch)", …)` block with **two** new tests built
  with the existing `entry(idx, kind, payload, cost?)` helper, leaving the
  `"one line per entry kind"` assertions intact:
  - digest-present — `entry(9, "compaction", { tokensBefore: 120_000,
    tokensAfter: 40_000, digestRef: { id: "abc123def456ghi", kind:
    "context_snapshot", bytes: 2048, summary: "folded 8 step summaries" } })` —
    asserts the line `toContain("120k")`, `toContain("40k")`, and
    `toContain("(digest abc123def456)")` (the 12-char id prefix of the 15-char
    id);
  - digest-absent — same token figures, `digestRef` omitted — asserts
    `toContain("(no digest)")` and `not.toContain("digest abc")` (the no-digest
    branch, not the digest branch).
  Both fixtures are typed `CompactionResult`; `context_snapshot` is a valid
  `ArtifactKind` (`types.ts:260`). The renderer's `formatTokens` rounding is
  already covered by the standing `formatTokens` test, so the new tests assert
  on required substrings, not full-line equality — exactly as the spec
  instructed.

Scope discipline held: no router/agent-loop/journal-writer/runner/contract/type/
schema/journal-format change; `CompactionResult` and the `compaction`
`JournalEntryKind` untouched; no WP-202 digest wiring; no other `formatEntryLine`
arm or other function in `trace.ts` altered; no new dependency; no new file —
exactly the two existing files the spec named.

One cosmetic note, not friction: in `trace.test.ts` the executor moved
`ArtifactRef` out of the `"../../src/index.js"` type-import block and re-imported
it (with the new `CompactionResult`) from `"../../src/types.js"` in a single
added `import type { ArtifactRef, CompactionResult } from "../../src/types.js"`
line. This is within the spec's "import any needed types from `../../src/types.js`"
instruction, keeps the import `import type`, and is type-correct (both symbols
resolve from `types.js`); it touches no behavior and the lint/typecheck gate
passed. Noted only for completeness.

Independent verification (working tree): AC-1 trace formatter 18 passed (the two
new compaction tests included) · AC-2 full SDK suite **284 passed / 19 skipped**
(was 282/19 at dogfood-025 — exactly the +2 new tests) · AC-3 typecheck (both
`tsc` passes, incl. the WP-230 `tsconfig.test.json` over `test/**`) + lint clean.
Scope = exactly the two named files; harvest byte-diff **IDENTICAL** on both. The
`CompactionResult` shape was re-checked field-for-field against the frozen
contract (`types.ts:362`: `{ tokensBefore, tokensAfter, digestRef? }`) and
`ArtifactKind` against `types.ts:252`.

**WP-203 S4's pure trace surface is landed — the `compaction` JIF entry is now
legible in `chikory trace --watch`.** Remaining WP-203 is all blocked or
hand-design: the **S2 digest wiring** (fold a real digest behind a Memory
Pointer at the checkpoint boundary and journal the `CompactionResult`) stays
**BLOCKED on the WP-202 Memory Pointer store** (`CompactionResult.digestRef`);
the S3 recall-tier projection and any OTel emission are later slices.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now five runs deep as the established norm).
- **Cost telemetry**: $1.0472 step + $0.0441 judge = $1.0913, all non-zero,
  models priced (`gpt-5.5`, `gemini-3.1-pro-preview`); no `UNPRICED`/blind-meter
  warning. Sound (budget used 21.8 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED — the pack shows AC-1/AC-2/AC-3 each `exited 0`), rubric
  justifications accurate and specific (scope = exactly the two files;
  no-unrelated-deletions correctly read the import-consolidation as in-scope;
  no-secrets true to the dummy `abc123def456ghi` fixture id), verdict a true
  positive. Family diversity real (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-f9d699d4...@3`, commit `6a6185e8dcdd`,
  `lastGood true`), no duplicate journal entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = **807k input / 3.8k output** for a 2940-byte
  diff (two additive edits to one source file + two new tests) across 20 tool
  calls. This is **mid-band** in the established sawtooth — above 023's 451k and
  025's 467k, below 022's 969k and 024's 976k. Running input-token series across
  the six adjacent one-step pure slices: 021 862k → 022 969k → 023 451k → 024
  976k → 025 467k → **026 807k**. The series has now swung
  high→low→high→low→mid across six consecutive near-identical small changes — it
  tracks neither diff size (this run's 2940-byte diff is the *smallest* of the
  six yet drew 807k) nor run order. Cleanest confirmation yet that per-step
  input cost is **codex repo-search variance, not a structural ratchet**. Still
  the standing motivation for WP-203 compaction / WP-207 pacing as a
  *variance/ceiling* lever; not new friction.

## Verdict on the thesis (twenty-sixth data point — the WP-203 trace surface now renders every JIF kind)

- **The compaction lifecycle is now observable end to end in pure code, ahead
  of its wiring.** ADR-006 froze the `CompactionResult` contract and
  `planCompaction` (the pure decision of *what* to fold); this run lands the
  pure *rendering* of the journaled outcome. So the moment the (still-blocked)
  S2 digest wiring folds a real digest at a checkpoint and journals a
  `CompactionResult`, `chikory trace --watch` will render it with **zero further
  trace work** — the renderer is tested against both the digest-present and
  digest-absent payloads the wiring can emit. This is the minimal-abstraction /
  maximal-observability thesis playing out: the observability surface is built
  pure and unit-tested before the I/O it observes exists.
- **The F-11-closed loop shape is steady-state.** Five consecutive runs (022,
  023, 024, 025, 026) have sealed SUCCESS in one productive step with no probe.
  The longest-running friction of the campaign stays observably retired.
- **Cost is noisy, not monotonic — now proven across six swings.** Across six
  adjacent one-step pure slices of near-identical size the input cost ran 862k →
  969k → 451k → 976k → 467k → 807k, with the *smallest* diff of the set (this
  one) drawing a mid-high 807k. The honest read is unchanged: per-step input
  cost on small, well-specified changes is high (hundreds of k tokens) and
  *variable*, with no one-way ratchet — which keeps WP-203/WP-207 on the
  priority list as a *variance/ceiling* lever, not a runaway-trend fix.
  Correctness, scope, telemetry, and loop integrity all held.
- Next: WP-219's pure surface is exhausted and its remainder is non-pure /
  hand-design (TASK-PROTOCOL §4); WP-203's remaining slices are blocked on
  WP-202 (S2 digest wiring) or are later work (S3 recall-tier projection, OTel).
  The next dogfoodable pure slice is **WP-228 — the launch baseline precheck**
  (dogfood-017 F-25): a pure, unit-tested precheck that validates a `TaskSpec`'s
  launch preconditions before a run starts, the same renderer/validator pattern,
  no contract change (dogfood-027).
