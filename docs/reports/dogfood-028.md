# Dogfood-028 — WP-202 / CM-3: the pure Memory Pointer decision + reference renderer (`shouldPointerize` + `formatPointerReference`, clean SUCCESS in ONE step — F-11 stays closed; input tokens 410k, a new series low)

**WP**: WP-202 (CM-3, the pure Memory Pointer decision + reference-rendering half) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-028.yaml`](../../examples/dogfood/dogfood-028.yaml) · **Run**: `run-7681a607-7c0b-4989-bf2d-0609ddf4a266` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, staged uncommitted on `main`

> Twenty-eighth campaign, twenty-seventh first-attempt SUCCESS. The F-11-closed
> shape held for a **seventh** straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), SUCCESS seals — no empty-diff probe. The
> delivery is the pure DECISION + RENDERING half of the Memory Pointer Pattern
> (project.md; CONTRACTS.md §5 / CM-3): `shouldPointerize(bytes, policy)` and
> `formatPointerReference(ref)` (`src/runner/memory-pointer.ts`) — a pure
> threshold predicate (`bytes > policy.maxInlineBytes`; exactly-at-threshold
> inlines) plus a pure single-line renderer over the **frozen** `ArtifactRef`
> (`[memory <kind> <12-char id>] <bytes>B — <summary>`, the `id.slice(0, 12)`
> convention shared with the WP-203 S4 compaction-trace renderer). The same
> pure-decision/renderer pattern as the judge's `buildVerdict`, the planner's
> `buildPlanVerdict`, and dogfood-027's `evaluateBaselinePrecheck`: local policy
> type, a type-only import of `ArtifactRef`, no `types.ts`/contract change. The
> non-pure half — intercept a tool output → `shouldPointerize(output.bytes,
> policy)` → if true `store.put(...)` then inject `formatPointerReference(ref)`,
> else inline — stays the hand-design follow-up (TASK-PROTOCOL §4) and is the
> first step toward unblocking WP-203 S2 digest wiring. **No new friction.** Cost
> watch-item: input tokens came in at **410k** — a **new low** for the
> eight-slice series (022 969k → 023 451k → 024 976k → 025 467k → 026 807k →
> 027 527k → **028 410k**), reconfirming per-step input cost is noisy variance,
> not a one-way ratchet.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-7681a607-7c0b-4989-bf2d-0609ddf4a266 · SUCCESS · 1 steps · $0.59 / $5.00 · 3m 51s · executor codex(openai) · judge openai-compat
 1   Implemented the WP-202 / CM-3 pure …  410k/4.0k  $0.55  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.03, 5.8%) · rollbacks 0 · escalations 0
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
shape the goal dictated, a faithful pure-decision/renderer pair:

- **`packages/sdk-ts/src/runner/memory-pointer.ts`** (NEW, 25 lines) — named
  exports only, no default export, no `any`, a **type-only** import of
  `ArtifactRef` from `../types.js` (the renderer's input; not a contract change),
  no I/O / clock / randomness / input mutation. Each export JSDoc'd citing
  WP-202 / CM-3:
  - `interface MemoryPointerPolicy { maxInlineBytes: number }` — the inline byte
    threshold.
  - `function shouldPointerize(bytes: number, policy: MemoryPointerPolicy):
    boolean` — `return bytes > policy.maxInlineBytes` (strictly greater ⇒ store
    externally; exactly at the threshold ⇒ inline). Pure.
  - `function formatPointerReference(ref: ArtifactRef): string` — returns
    exactly `` `[memory ${ref.kind} ${ref.id.slice(0, 12)}] ${ref.bytes}B — ${ref.summary}` ``.
    Reads four `ArtifactRef` fields, mutates nothing.
- **`packages/sdk-ts/src/index.ts`** — exactly one added re-export line at
  `index.ts:73`, immediately after the `evaluateBaselinePrecheck` re-export
  (`:72`): `export { shouldPointerize, formatPointerReference, type
  MemoryPointerPolicy } from "./runner/memory-pointer.js";`. Nothing else in the
  barrel changed.
- **`packages/sdk-ts/test/runner/memory-pointer.test.ts`** (NEW, 5 tests) — a
  `describe("memory pointer pure helpers", …)` block covering all five required
  cases: above-threshold (`shouldPointerize(2048, {maxInlineBytes: 1024})` ⇒
  `true`), at-threshold (`1024` ⇒ `false`, exactly-at inlines), below-threshold
  (`512` ⇒ `false`), the exact-output render for the 18-char-id fixture (12-char
  prefix `abc123def456`), and a purity case capturing a shallow copy and
  asserting `expect(ref).toEqual(original)` after the call. Fixtures typed
  `ArtifactRef` with `kind: "tool_output"` (a valid `ArtifactKind`).

Scope discipline held: exactly the one new source file, one new test file, and
the single barrel re-export the goal named — no router / agent-loop /
journal-writer / runner-loop / executor / CLI change; no `src/artifacts/*`
touched; no `types.ts`/contract/schema change; no `ArtifactStore.put`/`get`/
`excerpt`, no `createHash`, no `node:` builtin; no LLM/router call; no new
dependency. The policy type lives locally in the new module (the `PlanJudgeReply`
precedent), so the slice needed nothing un-landed beyond the already-frozen
`ArtifactRef`.

Independent verification (working tree): AC-1 the new memory-pointer unit test
**5 passed** · AC-2 the full SDK suite **294 passed / 19 skipped** (was 289/19
at dogfood-027 — exactly the +5 new tests) · AC-3 typecheck (both `tsc` passes,
incl. the WP-230 `tsconfig.test.json` over `test/**`) + lint clean. Scope =
exactly the three named files; harvest byte-diff **IDENTICAL** on all three.

**WP-202's pure decision + rendering half is landed.** The Memory Pointer
workflow now has its pure core: *when* to externalize (`shouldPointerize`) and
*how* to render the short reference that enters context
(`formatPointerReference`). Remaining WP-202 is the non-pure wiring: intercept a
tool output → `shouldPointerize(output.bytes, policy)` → if true `store.put(...)`
(the existing content-addressed `src/artifacts/local.ts`) then inject
`formatPointerReference(ref)` into context, else inline — the hand-design
follow-up (TASK-PROTOCOL §4). No runtime behavior changed in this slice.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now seven runs deep as the established norm).
- **Cost telemetry**: $0.5519 step + $0.0341 judge = $0.5860, all non-zero,
  models priced (`gpt-5.5`, `gemini-3.1-pro-preview`); no `UNPRICED`/blind-meter
  warning. Sound (budget used 11.8 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED — the pack shows AC-1/AC-2/AC-3 each `exited 0`), rubric
  justifications accurate and specific (scope = exactly the requested pure
  functions + barrel export + tests; no-unrelated-deletions correctly read the
  diff as additions-only; no-secrets true to the logic-only content), verdict a
  true positive. Family diversity real (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-7681a607…@3`, commit `b19175265ea2`,
  `lastGood true`), no duplicate journal entries, no re-execution.

Baseline data:

- **Token economics**: step 1 = **410k input / 4.0k output** for a 3546-byte
  diff (a 25-line module + a 5-test file + a one-line barrel edit) across 18 tool
  calls. This is a **new low** for the series — below 023's 451k and 025's 467k,
  well below 022's 969k / 024's 976k / 026's 807k / 027's 527k. Running
  input-token series across the eight adjacent one-step pure slices: 021 862k →
  022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k → **028 410k**.
  The lowest input of the campaign drew the second-smallest diff of the recent
  set — but the series still tracks neither diff size nor run order. Cleanest
  confirmation yet that per-step input cost is **codex repo-search variance, not
  a structural ratchet**. Still the standing motivation for WP-203 compaction /
  WP-207 pacing as a *variance/ceiling* lever; not new friction.

## Verdict on the thesis (twenty-eighth data point — the Memory Pointer's decision + rendering core is now pure and tested, ahead of its wiring)

- **The Memory Pointer Pattern's pure core exists before the I/O it governs.**
  project.md names the pattern foundational (CM-3: "store large tool outputs
  externally, pass short refs into context"); CONTRACTS.md §5 froze `ArtifactRef`
  and the local content-addressed store (`src/artifacts/local.ts`) was built for
  it — but nothing yet *decided* when an output is big enough to externalize, nor
  *rendered* the short reference that takes its place. This run lands exactly that
  decision + renderer as a pure, unit-tested pair: the moment the (hand-design)
  interception wiring measures a tool output and calls `shouldPointerize`, then
  on a true result `store.put`s and injects `formatPointerReference(ref)`, the
  whole pure surface is already tested across above/at/below-threshold and the
  exact render. The minimal-abstraction / maximal-observability thesis again: the
  decision is built pure and tested before the I/O it guards exists.
- **The F-11-closed loop shape is steady-state.** Seven consecutive runs
  (022–028) have sealed SUCCESS in one productive step with no probe. The
  longest-running friction of the campaign stays observably retired.
- **Cost is noisy, not monotonic — now proven across eight swings.** Across eight
  adjacent one-step pure slices of comparable size the input cost ran 862k → 969k
  → 451k → 976k → 467k → 807k → 527k → 410k, this run setting a new low. The
  honest read is unchanged: per-step input cost on small, well-specified changes
  is high (hundreds of k tokens) and *variable*, with no one-way ratchet — which
  keeps WP-203/WP-207 on the priority list as a *variance/ceiling* lever, not a
  runaway-trend fix. Correctness, scope, telemetry, and loop integrity all held.
- Next: WP-202's remaining half is non-pure / hand-design (the tool-output
  interception + `store.put` + `formatPointerReference` injection,
  TASK-PROTOCOL §4); WP-219's and WP-228 S1's pure surfaces are exhausted
  (non-pure remainders). The next dogfoodable pure slice is **WP-203 — the
  compaction digest-prompt half** (dogfood-029): the pure prompt regime for the
  compaction LLM digest call (`DIGEST_SYSTEM_PROMPT` + `buildDigestMessages(toDigest)`
  in a new `src/runner/compaction-prompt.ts`), the analog of `planner/prompt.ts`
  and `judge/prompt.ts`, over the already-frozen `CompactionPlan.toDigest` and
  `Message` types — no contract change. It is the remaining *pure* piece of the
  WP-203 S2 digest path (the non-pure router call + `store.put` of the digest
  behind a Memory Pointer + `CompactionResult` journal write stays hand-design),
  the Phase-2-exit compaction lever.
</content>
</invoke>
