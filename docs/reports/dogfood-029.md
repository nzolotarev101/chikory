# Dogfood-029 — WP-203 S2: the pure compaction digest-prompt half (`DIGEST_SYSTEM_PROMPT` + `buildDigestMessages`, clean SUCCESS in ONE step — F-11 stays closed; input tokens 462k, low band)

**WP**: WP-203 (S2, the pure compaction digest-prompt half) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-029.yaml`](../../examples/dogfood/dogfood-029.yaml) · **Run**: `run-74f88081-af51-40d8-9722-99824c3e9dbf` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, staged uncommitted on `main`

> Twenty-ninth campaign, twenty-eighth first-attempt SUCCESS. The F-11-closed
> shape held for an **eighth** straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), SUCCESS seals — no empty-diff probe. The
> delivery is the pure PROMPT half of the WP-203 S2 compaction digest call
> (ADR-006 / CM-1): `DIGEST_SYSTEM_PROMPT` (a frozen `[...].join("\n")` system
> prompt instructing the model to fold older step summaries into one faithful
> prose digest — preserve decisions/file+symbol names/open threads, drop
> redundancy, no JSON) and `buildDigestMessages(toDigest: readonly string[]):
> Message[]` (a pure builder returning `[{role:"system", content:
> DIGEST_SYSTEM_PROMPT}, {role:"user", content:<numbered oldest→newest block>}]`)
> in a new `src/runner/compaction-prompt.ts`. The direct analog of
> `planner/prompt.ts` and `judge/prompt.ts`: a pure transform from
> already-collected facts to chat `Message`s, with **no response schema** (the
> digest call returns PROSE, not JSON), a **type-only** `Message` import, no
> `types.ts`/contract change. The non-pure half — the router call that folds
> `toDigest` into a digest string, `store.put` of that digest behind a Memory
> Pointer (WP-202), and the `CompactionResult` journal write at the checkpoint
> boundary — stays the hand-design follow-up (TASK-PROTOCOL §4). **No new
> friction.** Cost watch-item: input tokens came in at **462k** — low band for
> the nine-slice series (022 969k → 023 451k → 024 976k → 025 467k → 026 807k →
> 027 527k → 028 410k → **029 462k**), reconfirming per-step input cost is noisy
> variance, not a one-way ratchet.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-74f88081-af51-40d8-9722-99824c3e9dbf · SUCCESS · 1 steps · $0.65 / $5.00 · 4m 9s · executor codex(openai) · judge openai-compat
 1   Implemented the WP-203 pure compact…  462k/3.9k  $0.62  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 5.6%) · rollbacks 0 · escalations 0
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

The delivery matches the spec line by line — exactly three files, exactly the
shape the goal dictated, a faithful pure prompt+builder pair mirroring the
planner/judge precedent:

- **`packages/sdk-ts/src/runner/compaction-prompt.ts`** (NEW) — named exports
  only, no default export, no `any`, a **type-only** import of `Message` from
  `../types.js` (the builder's return element; not a contract change), no I/O /
  clock / randomness / input mutation. Each export JSDoc'd citing WP-203 /
  ADR-006 / CM-1:
  - `DIGEST_SYSTEM_PROMPT: string` — a frozen multi-line `[...].join("\n")` (the
    `PLANNER_SYSTEM_PROMPT` precedent): fold older step summaries into one
    faithful prose digest preserving decisions, file/symbol names, and open
    threads; preserve oldest→newest causality where it matters; drop redundancy
    and transient chatter; keep concrete implementation facts; mention
    unresolved questions / failed attempts / follow-up work; "Output prose only.
    Do not return JSON or wrap the digest in a schema." Prose output, no schema.
  - `buildDigestMessages(toDigest: readonly string[]): Message[]` — pure.
    Renders the summaries as a numbered block (`${index + 1}. ${summary}`,
    joined by `\n`, under a `## Older step summaries to fold (oldest to newest)`
    header) and returns `[{role:"system", content: DIGEST_SYSTEM_PROMPT},
    {role:"user", content: <rendered>}]`. Uses `toDigest.map(...)` — does not
    mutate the input.
- **`packages/sdk-ts/src/index.ts`** — exactly one added re-export line at
  `index.ts:74`, immediately after the `shouldPointerize, formatPointerReference`
  re-export (`:73`): `export { DIGEST_SYSTEM_PROMPT, buildDigestMessages } from
  "./runner/compaction-prompt.js";`. Nothing else in the barrel changed.
- **`packages/sdk-ts/test/runner/compaction-prompt.test.ts`** (NEW, 4 tests) — a
  `describe("compaction digest prompt (WP-203, ADR-006, CM-1)", …)` block
  covering all four required cases: shape (`["a","b"]` ⇒ 2-element array, first
  message `{role:"system", content: DIGEST_SYSTEM_PROMPT}`, second `role ===
  "user"`), ordering (`["oldest","newest"]` ⇒ "oldest" before "newest", `"1."`
  before `"2."`), empty input (`[]` ⇒ still both messages, no throw), and purity
  (captures length + a shallow copy, asserts the input array unchanged after the
  call). Fixtures typed `readonly string[]` in, `Message[]` out.

Scope discipline held: exactly the one new source file, one new test file, and
the single barrel re-export the goal named — no router / agent-loop /
journal-writer / runner-loop / executor / CLI change; no `src/artifacts/*`
touched; no `src/runner/compaction.ts` change (`planCompaction` unchanged); no
`types.ts`/contract/schema change; no `ArtifactStore.put`/`get`/`excerpt`, no
`createHash`, no `node:` builtin; no LLM/router call; no new dependency; no
response schema (the digest call returns prose). `Message` is imported type-only,
so the slice needed nothing un-landed beyond the already-frozen `Message` type.

Independent verification (working tree): AC-1 the new compaction-prompt unit
test **4 passed** · AC-2 the full SDK suite **298 passed / 19 skipped** (was
294/19 at dogfood-028 — exactly the +4 new tests) · AC-3 typecheck (both `tsc`
passes, incl. the WP-230 `tsconfig.test.json` over `test/**`) + lint clean.
Scope = exactly the three named files; harvest byte-diff **IDENTICAL** on all
three.

**WP-203's pure digest-prompt half is landed.** The compaction digest call now
has its pure prompt regime: the frozen system prompt that tells the model what a
faithful digest preserves, and the pure builder that turns `CompactionPlan.toDigest`
into the chat messages. With the WP-203 S4 trace renderer (dogfood-026), WP-203's
pure surface is now exhausted; everything left is the non-pure S2 digest wiring:
`planCompaction` → `buildDigestMessages(plan.toDigest)` → router call → digest
string → `store.put` behind a Memory Pointer (WP-202) → journal a
`CompactionResult` with `digestRef` — the hand-design follow-up (TASK-PROTOCOL
§4), still blocked on the WP-202 store wiring. No runtime behavior changed in
this slice.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now eight runs deep as the established norm).
- **Cost telemetry**: $0.6160 step + $0.0363 judge = $0.6523, all non-zero,
  models priced (`gpt-5.5`, `gemini-3.1-pro-preview`); no `UNPRICED`/blind-meter
  warning. Sound (budget used 13.0 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED — the pack shows AC-1/AC-2/AC-3 each `exited 0`), rubric
  justifications accurate and specific (scope = exactly the requested pure
  prompt+builder + barrel export + tests; no-unrelated-deletions correctly read
  the diff as additions-only plus a single `index.ts` line; no-secrets true to
  the logic-only content), verdict a true positive. Family diversity real
  (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-74f88081…@3`, commit `8dd73027075b`,
  `lastGood true`), no duplicate journal entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = **462k input / 3.9k output** for a 4372-byte
  diff (a new prompt+builder module + a 4-test file + a one-line barrel edit)
  across 18 tool calls. Low band — next to 025's 467k and 028's 410k, well below
  022's 969k / 024's 976k / 026's 807k. Running input-token series across the
  nine adjacent one-step pure slices: 021 862k → 022 969k → 023 451k → 024 976k
  → 025 467k → 026 807k → 027 527k → 028 410k → **029 462k**. The series still
  tracks neither diff size nor run order — per-step input cost is **codex
  repo-search variance, not a structural ratchet**. Still the standing
  motivation for WP-203 compaction / WP-207 pacing as a *variance/ceiling*
  lever; not new friction.

## Verdict on the thesis (twenty-ninth data point — WP-203's pure surface is now exhausted, the digest prompt built and tested ahead of its wiring)

- **The compaction digest's prompt regime exists before the LLM call it shapes.**
  ADR-006 froze the checkpoint-boundary compaction contract and the pure
  `planCompaction` that decides what folds (`CompactionPlan.toDigest`); CM-1
  names context-rot mitigation foundational. This run lands the pure prompt half
  — *what* a faithful digest preserves (`DIGEST_SYSTEM_PROMPT`) and *how* the
  set-aside summaries become chat messages (`buildDigestMessages`) — as a pure,
  unit-tested pair, the symbol-for-symbol analog of `planner/prompt.ts` and
  `judge/prompt.ts`. The moment the (hand-design) wiring calls the router with
  `buildDigestMessages(plan.toDigest)`, the prompt surface is already tested
  across shape, oldest→newest ordering, empty input, and input purity. The
  minimal-abstraction / maximal-observability thesis again: the prompt is built
  pure and tested before the I/O it feeds exists.
- **The F-11-closed loop shape is steady-state.** Eight consecutive runs
  (022–029) have sealed SUCCESS in one productive step with no probe. The
  longest-running friction of the campaign stays observably retired.
- **Cost is noisy, not monotonic — now proven across nine swings.** Across nine
  adjacent one-step pure slices of comparable size the input cost ran 862k →
  969k → 451k → 976k → 467k → 807k → 527k → 410k → 462k, this run squarely in
  the low band. The honest read is unchanged: per-step input cost on small,
  well-specified changes is high (hundreds of k tokens) and *variable*, with no
  one-way ratchet — which keeps WP-203/WP-207 on the priority list as a
  *variance/ceiling* lever, not a runaway-trend fix. Correctness, scope,
  telemetry, and loop integrity all held.
- Next: WP-203's pure surface is now exhausted (S4 trace renderer dogfood-026 +
  this S2 digest-prompt half); the remaining S2 digest wiring is non-pure /
  hand-design (router fold → `store.put` behind a Memory Pointer →
  `CompactionResult` journal write, TASK-PROTOCOL §4) and **stays blocked on the
  WP-202 store wiring**. WP-202's, WP-219's, and WP-228 S1's pure surfaces are
  likewise exhausted — their remainders are all non-pure hand-design. The next
  dogfoodable pure slice is **WP-207 — the pure context-window pacing decision**
  (`shouldCompact(usage, policy)` / a pure pacing predicate over the frozen
  token-accounting + `CompactionPolicy` types), the variance/ceiling lever the
  nine-run cost series keeps motivating; if no clean pure WP-207 contract is
  frozen yet, the hand-design compaction/Memory-Pointer wiring (WP-202 + WP-203
  S2) is the next architect-wall item, after which the digest path runs
  end-to-end.
