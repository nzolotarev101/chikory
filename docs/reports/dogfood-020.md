# Dogfood-020 — WP-230 typecheck gate now covers `test/**` (clean SUCCESS; F-29 closed; F-30 duplicate launch)

**WP**: WP-230 · **Date**: 2026-06-14 · **Task spec**: [`examples/dogfood/dogfood-020.yaml`](../../examples/dogfood/dogfood-020.yaml) · **Run**: `run-3575ba23-e53e-4e78-8df9-b44fe9fb74f3` (and a redundant duplicate `run-f24af22c`, F-30) · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested + staged on `main`, pending commit

> Twentieth campaign, nineteenth first-attempt SUCCESS. WP-230 closes F-29 — the
> typecheck gate the judge sits on top of was blind to `test/**`. The fix is
> verified beyond the run's own green: I injected a bogus field into a test
> fixture and `pnpm typecheck` now fails with `TS2353`; removed it, clean again.
> The cheap gate now catches test-type errors it silently passed in dogfood-019.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI) + Gemini judge behind the
local shim. Family diversity held.

```text
run run-3575ba23... · SUCCESS · 2 steps · $1.31 / $5.00 · 5m 7s · executor codex(openai) · judge openai-compat
 1   Implemented WP-230 with exactly three changes   646k/3.3k  $0.84   (3783-byte diff)
 2   WP-230 was already implemented exactly...        332k/2.0k  $0.43   ✓ PROCEED (3/3 criteria)
totals: decisions 2 · judge passes 1 ($0.03, 2.5%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · issues found 0 · changes made 1 (0:1)
        components over time: s0 s1 j@1
```

All work in step 1 (3783-byte diff). Step 2 was the empty-diff probe (F-11). The
judge ran once at the cadence-2 boundary, graded the cumulative diff, PROCEEDed.
**Notably AC-3 now exercised the new gate**: `pnpm typecheck` =
`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`, both passes green.

## Delivery quality (human review, post-landing)

Exactly the three changes the spec named, nothing else:

- **`packages/sdk-ts/tsconfig.test.json`** (new) — `extends "./tsconfig.json"`,
  sets `noEmit: true` and `rootDir: "."` (so `test/**` is allowed in the
  program despite the base config's `src` rootDir), `include` covers
  `src/**/*` + `test/**/*`. Inherits the base strict settings.
- **`packages/sdk-ts/package.json`** — `typecheck` is now
  `tsc --noEmit && tsc --noEmit -p tsconfig.test.json` (sequential; either pass
  failing fails the script). `build` and `tsconfig.json` untouched, so the
  src-only emit is unchanged.
- **`packages/sdk-ts/test/runner/judge-trigger.test.ts`** — the six
  `ArtifactRef` fixture literals are corrected from the fabricated
  `{uri, sha256, bytes}` to the real `{id, kind, bytes, summary}` (valid
  `ArtifactKind` — `"diff"`/`"transcript"`), `bytes` preserved per case, test
  names/cases/assertions unchanged.

Independent verification (working tree): AC-1 typecheck (both passes) clean ·
AC-2 242 passed/19 skipped · AC-3 lint clean + judge-trigger 6 passed. Scope =
exactly the three named files; harvest byte-diff **IDENTICAL** on all three. No
deps, no source-type/contract/runtime change.

**The gate genuinely works (verified this review, not just AC green):** with a
temporary `bogusField: 1` added to a fixture, `pnpm --filter @chikory/sdk
typecheck` fails `test/runner/judge-trigger.test.ts(31,76): error TS2353:
'bogusField' does not exist in type 'ArtifactRef'`; reverting restores a clean
gate. dogfood-019's F-29 (contract-violating test fixtures shipping green) can
no longer recur. **F-29 closed.**

## New friction

**F-30 — the same spec was launched twice, wasting a full run's spend, with no
guard.** Two independent runs of `dogfood-020` exist: `run-f24af22c` (journal
created 10:53:19, $1.04) and `run-3575ba23` (created 11:04:41, $1.31), ~11
minutes apart, both SUCCESS, both producing the byte-identical WP-230 change
(both workspaces byte-`IDENTICAL` to the working tree). The second run was pure
waste — ~$1 and ~5 min of executor+judge compute on a goal the first run had
already delivered. Nothing warned the operator that a run for this spec was
already complete (or in flight). Note: **WP-228 (launch baseline precheck) would
NOT catch this** — neither run was committed to `HEAD`, so each cloned a baseline
that legitimately failed the acceptance checks; the precheck only catches
already-*landed* goals, not duplicate launches of an unlanded one. → **No new
WP.** This is operator/launch ceremony (F-10 family): the mitigation is
discipline — launch once, watch to terminal, then `/dogfood-review`. A
same-spec-in-flight lockfile guard is *possible* but is exactly the kind of
self-generated tooling polish the dogfood-assessor flagged the queue is already
over-feeding on; deliberately deprioritized. Recorded so the spend data point
isn't mistaken for a single-run cost.

Recurrences and baseline:

- **F-11 recurred (nineteenth data point)** — step 2 empty-diff probe: 0 bytes,
  332k input tokens, $0.4347, **33.2 % of run cost** (upper end of the
  5.4 %–35.1 % spread). Still unaddressed until WP-221 Slice B wires the
  completion signal. No new WP.
- **Token economics**: step 1 = 646k input / $0.84 for a 3783-byte diff (a tiny
  config + a one-line script edit + six mechanical fixture corrections). Run
  26.2 % of $5. Mid-range for codex on a small, well-specified change.
- **Determinism note**: the two F-30 runs converged on byte-identical output —
  consistent with this spec's tighter prescription (it named the exact script
  string and the exact `ArtifactRef` shape). Lower F-28 risk here than dogfood-018
  because the *fix* (a known type shape) genuinely has one right answer.

## Verdict on the thesis (twentieth data point — the gate floor is now trustworthy)

- **The cheap gate the judge depends on is now sound.** dogfood-019 proved a
  type error could hide in `test/**`; dogfood-020 closes that hole and I verified
  the gate actually trips on a bad fixture. The judge's diff-grading now sits on
  a typecheck floor that covers the whole tree — exactly the layering the thesis
  wants (cheap deterministic checks first, judge for what they can't see).
- **Loop integrity held** on the canonical run: two checkpoints, `lastGood` true
  only at the PROCEED step, no duplicate entries within a run. (The duplication
  was *across* two operator launches, F-30 — not a loop-integrity defect.)
- **Structural caution carried forward (dogfood-assessor).** Three of the last
  four campaigns (017, 018, 020) were friction-driven polish; the genuine
  Phase-2 pillars — WP-202 memory pointer next slice, WP-203 compaction, the
  WP-219 planner/chain-executor slices — and the WP-221 cost win have not
  advanced since dogfood-016. The honest reason is an **architect/contract wall**:
  the high-value next steps each need a hand-done design decision first
  (WP-221 Slice B needs the executor completion-marker protocol; WP-218's gate
  wiring needs the token HALT-event shape; WP-219 S2 needs the planner contract),
  so the dogfoodable surface right now is pure slices. dogfood-021 takes the best
  remaining pure, contract-landed pillar slice (WP-218 token-budget math), **but
  the recommendation to the human is to land those design decisions next** so
  dogfoods can resume advancing pillars end-to-end instead of circling tooling.
- Next: **WP-218 pure token-budget gate math** (`estimateNextStepTokens` +
  `tokenBudgetBreached`, mirroring the USD gate) — contract `TaskSpec.budgetTokens`
  already landed; makes CG-2's spend governance real on $0-metered subscription
  runs (the F-9 blind meter). Wiring into the pre-step gate (HALT-event shape) is
  the hand-done follow-up.
