# Dogfood-027 — WP-228 S1: the pure launch-baseline-precheck decision (`evaluateBaselinePrecheck`, clean SUCCESS in ONE step — F-11 stays closed; input tokens 527k, low band)

**WP**: WP-228 (S1, the pure launch-baseline-precheck decision) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-027.yaml`](../../examples/dogfood/dogfood-027.yaml) · **Run**: `run-f97a0e63-3d68-47d2-ba11-ddf0deb37bed` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, staged uncommitted on `main`

> Twenty-seventh campaign, twenty-sixth first-attempt SUCCESS. The F-11-closed
> shape held for a **sixth** straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires off-cadence on that step
> (`components over time: s0 j@0`), SUCCESS seals — no empty-diff probe. The
> delivery is the pure DECISION half of the redundant-run guard that dogfood-017
> F-25 demanded: `evaluateBaselinePrecheck(results): BaselinePrecheckResult`
> (`src/cli/precheck.ts`) — given the exit codes of a spec's acceptance `check`s
> run against the clean baseline, it partitions them into
> `passedIds`/`failedIds` (input order preserved, inputs not mutated), sets
> `satisfied = results.length > 0 && failedIds.length === 0`, and builds a
> one-line `summary` for the launch warning. The exact analog of the judge's
> pure `buildVerdict` and the planner's pure `buildPlanVerdict`: a pure transform
> from already-collected facts to a validated verdict object, local result types,
> no `types.ts` change. The non-pure half — run each `check` against the clean
> baseline (`child_process`) → `evaluateBaselinePrecheck` → warn / refuse unless
> `--force` — stays the hand-design follow-up (TASK-PROTOCOL §4). **No new
> friction.** Cost watch-item: input tokens came in at **527k** — low band in the
> established sawtooth (022 969k → 023 451k → 024 976k → 025 467k → 026 807k →
> **027 527k**), and notably the *largest* diff of the recent set (5070 bytes —
> a whole new module + a whole new test file) drew one of the *smallest* input
> counts, reconfirming per-step input cost tracks neither diff size nor run
> order.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

```text
run run-f97a0e63-3d68-47d2-ba11-ddf0deb37bed · SUCCESS · 1 steps · $0.75 / $5.00 · 4m 33s · executor codex(openai) · judge openai-compat
 1   Implemented WP-228 Slice 1. Added t…  527k/4.9k  $0.71  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 5.2%) · rollbacks 0 · escalations 0
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
shape the goal dictated, a faithful structural mirror of the judge's
`buildVerdict` / planner's `buildPlanVerdict`:

- **`packages/sdk-ts/src/cli/precheck.ts`** (NEW, 53 lines) — named exports only,
  no default export, no `any`, no import from `../types.js` (the inputs are
  plain check results), no I/O / clock / randomness / input mutation. Each export
  JSDoc'd citing WP-228 / dogfood-017 F-25:
  - `interface PrecheckCheckResult { id: string; exitCode: number }`.
  - `interface BaselinePrecheckResult { satisfied; passedIds; failedIds; summary }`
    — fields in exactly the spec's order.
  - `function evaluateBaselinePrecheck(results: readonly PrecheckCheckResult[]):
    BaselinePrecheckResult` — a single forward loop partitions into fresh
    `passedIds`/`failedIds` arrays (input order preserved, `results` and its
    elements never mutated), `satisfied = results.length > 0 &&
    failedIds.length === 0`, and the three-branch `summary` exactly as specified
    (empty ⇒ `"no acceptance checks to precheck"`; satisfied ⇒ `baseline already
    satisfies all N acceptance checks …`; otherwise ⇒ `P/N acceptance checks
    already pass; F still failing`). Returns exactly the four-field shape.
- **`packages/sdk-ts/src/index.ts`** — exactly one added re-export line at
  `index.ts:72`, immediately after the `buildPlanVerdict` re-export (`:71`):
  `export { evaluateBaselinePrecheck, type PrecheckCheckResult, type
  BaselinePrecheckResult } from "./cli/precheck.js";`. Nothing else in the
  barrel changed.
- **`packages/sdk-ts/test/cli/precheck.test.ts`** (NEW, 5 tests) — a
  `describe("evaluateBaselinePrecheck", …)` block covering all five required
  cases: all-pass (`satisfied`, ordered `passedIds`, summary contains `"all 2
  acceptance checks"`), some-fail (`"1/2"`), all-fail (`passedIds === []`),
  empty input (`summary === "no acceptance checks to precheck"`,
  `satisfied === false`), and a purity case asserting the input array length,
  element identity (`toBe`), and element value are unchanged after the call.
  Fixtures are typed `PrecheckCheckResult`.

Scope discipline held: exactly the one new source file, one new test file, and
the single barrel re-export the goal named — no router / agent-loop /
journal-writer / runner / CLI-command-wiring (`run`/`commands.ts`/`main.ts`)
change; no `types.ts`/contract/schema touched; no `--force` or any CLI flag
added; no launch-path wiring; no `child_process`/shell/LLM call; no new
dependency. The result types live locally in the new module (the
`PlanJudgeReply` precedent), so the slice needed nothing un-landed.

Independent verification (working tree): AC-1 the new precheck unit test
**5 passed** · AC-2 the full SDK suite **289 passed / 19 skipped** (was 284/19
at dogfood-026 — exactly the +5 new tests) · AC-3 typecheck (both `tsc` passes,
incl. the WP-230 `tsconfig.test.json` over `test/**`) + lint clean. Scope =
exactly the three named files; harvest byte-diff **IDENTICAL** on all three.

**WP-228 S1's pure decision half is landed.** The redundant-run guard now has a
pure, unit-tested `evaluateBaselinePrecheck`. Remaining WP-228 is the non-pure
launch-path wiring: run each acceptance `check` against the clean baseline
(`child_process`) → `evaluateBaselinePrecheck` → warn, or refuse unless
`--force` — the hand-design follow-up (TASK-PROTOCOL §4). No CLI behavior
changed in this slice.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: **zero** — one productive step, no empty-diff probe (the
  F-11-closed shape, now six runs deep as the established norm).
- **Cost telemetry**: $0.7076 step + $0.0389 judge = $0.7465, all non-zero,
  models priced (`gpt-5.5`, `gemini-3.1-pro-preview`); no `UNPRICED`/blind-meter
  warning. Sound (budget used 15.0 %).
- **Judge**: one pass, all three judge-executed checks exited 0 (not a form-only
  PROCEED — the pack shows AC-1/AC-2/AC-3 each `exited 0`), rubric
  justifications accurate and specific (scope = exactly the three files;
  no-unrelated-deletions correctly read the diff as additions-only;
  no-secrets true to the logic-only content), verdict a true positive. Family
  diversity real (`gemini-3.1-pro-preview` ≠ codex/openai).
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur**
  — single run for this spec, no duplicate launch.
- **Loop integrity**: one checkpoint (`run-f97a0e63…@3`, commit
  `bed0836abd63`, `lastGood true`), no duplicate journal entries, no
  re-execution.

Baseline data:

- **Token economics**: step 1 = **527k input / 4.9k output** for a 5070-byte
  diff (a whole new 53-line module + a whole new 5-test file + a one-line barrel
  edit) across 21 tool calls. This is **low band** in the established sawtooth —
  next to 023's 451k and 025's 467k, well below 022's 969k / 024's 976k / 026's
  807k. Running input-token series across the seven adjacent one-step pure
  slices: 021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k →
  **027 527k**. Notably the *largest* diff of the recent set drew one of the
  *smallest* input counts — the series tracks neither diff size nor run order.
  Cleanest confirmation yet that per-step input cost is **codex repo-search
  variance, not a structural ratchet**. Still the standing motivation for
  WP-203 compaction / WP-207 pacing as a *variance/ceiling* lever; not new
  friction.

## Verdict on the thesis (twenty-seventh data point — the redundant-run guard's decision half is now pure and tested)

- **The guard that would have caught dogfood-017 now exists in pure code, ahead
  of its wiring.** dogfood-017 FAILED because its spec was redundant — WP-227
  had been hand-landed four hours before launch, so the executor narrated an
  empty diff as done and burned $1.41; the judge correctly ESCALATEd on the
  empty-diff-vs-claim mismatch (a true positive), but the spend was wasted. F-25
  asked for a launch-time precheck. This run lands the pure decision half: the
  moment the (hand-design) launch-path wiring runs the acceptance `check`s
  against the clean baseline and feeds the exit codes in,
  `evaluateBaselinePrecheck` will report `satisfied` and the launcher can warn
  or refuse — with **zero further decision work**, the function is tested against
  the all-pass, partial, all-fail, and empty inputs the wiring can produce. The
  minimal-abstraction / maximal-observability thesis again: the guard's decision
  is built pure and unit-tested before the I/O it guards exists.
- **The F-11-closed loop shape is steady-state.** Six consecutive runs (022–027)
  have sealed SUCCESS in one productive step with no probe. The longest-running
  friction of the campaign stays observably retired.
- **Cost is noisy, not monotonic — now proven across seven swings.** Across
  seven adjacent one-step pure slices of comparable size the input cost ran 862k
  → 969k → 451k → 976k → 467k → 807k → 527k, with the *largest* diff of the
  recent set (this one) drawing a low-band 527k. The honest read is unchanged:
  per-step input cost on small, well-specified changes is high (hundreds of k
  tokens) and *variable*, with no one-way ratchet — which keeps WP-203/WP-207 on
  the priority list as a *variance/ceiling* lever, not a runaway-trend fix.
  Correctness, scope, telemetry, and loop integrity all held.
- Next: WP-228's remaining half is non-pure / hand-design (the `child_process`
  check-execution + warn/`--force` launch wiring, TASK-PROTOCOL §4); WP-219's
  pure surface is exhausted (non-pure remainder); WP-203's S2 digest wiring is
  blocked on WP-202. The next dogfoodable pure slice is **WP-202 — the Memory
  Pointer decision half** (CM-3, dogfood-028): the local-FS `ArtifactStore`
  already exists (`src/artifacts/local.ts`, content-addressed), but the *Memory
  Pointer workflow* — the pure decision of *when* a tool output is large enough
  to store externally and *how* to render the short reference that enters
  context — is unbuilt. A pure `shouldPointerize(bytes, policy)` +
  `formatPointerReference(ref)` over the frozen `ArtifactRef`, local policy type,
  no contract change — the same pure-decision/renderer pattern, and the first
  step toward unblocking WP-203 S2.
