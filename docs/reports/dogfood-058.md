# dogfood-058 — WP-210: pure G-Eval scoring primitive for the Agent-as-a-Judge harness

- **WP:** WP-210 (pairwise + G-Eval scoring modes — the continuous/comparative-score analog of the binary criteria/rubric verdict; this run lands the PURE first slice, a self-contained `src/judge/scoring.ts` reducer with LOCAL types and NO contract change, the `buildVerdict`/`decideContextWindowPacing` pure-decision-first shape; REQUIREMENTS JD-6).
- **Date:** 2026-06-27
- **Spec:** `examples/dogfood/dogfood-058.yaml` (`dogfood-058-wp210-geval-scoring`)
- **Run-id:** `run-67d39267-c99c-471e-b625-5de20a3bb8ca`
- **Landed commit:** _(none — delivery uncommitted on the working tree; `dogfood-verify §5` byte-IDENTICAL to the run workspace for all 3 files; `§6` no landed commit)_.
- **Runtime:** HEAD at launch `6292f62` (codex executor, `gemini-3.1-pro-preview` judge via the zero-secrets cli-judge-proxy shim). This HEAD is the first that includes the WP-252 calibration wire committed.
- **Gate verdict (pre-launch, recorded in the dogfood-057 review):** ✅ **PROCEED** — §1.1 ✅ (GENUINE new aggregation logic, not a port: weighted mean over per-criterion scores, raw-scale clamping, [0,1] normalization, a threshold-INCLUSIVE pass boundary, the empty / zero-or-negative-weight degenerate paths — each a real way to get it subtly wrong; the `decideContextWindowPacing`/dogfood-031 precedent) · §1.2 ✅ (the landed diff is REAL open plan.md §6 WP-210 🟡 judge-pillar feature code, the legitimate pure-decision-first slice, NOT invented disposable scaffolding like dogfood-046/047/048's clamp/roundTo/truncate throwaways) · §1.3 ✅ PROCEED (strongest UNBLOCKED real-product thesis slice — every meatier act-slice is §4 operator-walled (WP-250 control-flow; WP-253 override) or observability-only (WP-251), and this opens a new product pillar: judge scoring modes).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently. NO new friction.** WP-210's pure scoring primitive lands additively and correctly, opening the judge SCORING-modes pillar. **AND this run is the FIRST calibrated live read of the WP-252 denominator — F-55 is now CLOSED BY OBSERVATION** (`peak window 179%` = `716994 / 400000`, the believable `gpt-5.5`→400k figure vs the pre-wire 904% off a hardcoded 200k). Park-saturation did NOT recur — the calibrated window made the `compact` branch reachable (`compact 1 · park 0`).

## Vibe check (plain English)

Two good things happened in one clean run.

**1. WP-210 — the judge can now score on a continuous scale, not just pass/fail.** Today the Agent-as-a-Judge emits a binary verdict (`buildVerdict`: every criterion either passes or fails). WP-210 is the start of *graded* scoring — taking per-criterion numeric scores (e.g. each rated 1–5), collapsing them into one normalized [0,1] aggregate, and deciding pass/fail against a threshold. This run lands the **pure math primitive** for that (the future `scoringMethod` judge harness will consume it later — that wire is a separate contract-touching follow-up). Two pure functions in a new `src/judge/scoring.ts`:
- `normalizeGEvalScore(raw, scaleMin=1, scaleMax=5)` — clamps `raw` into the scale, returns `(clamped - scaleMin) / (scaleMax - scaleMin)` so the result lands in [0,1]; guards the divide-by-zero (`scaleMax <= scaleMin` → 0).
- `aggregateGEval(scores, opts)` — treats a missing weight as 1, ignores any entry with weight ≤ 0, clamps each score, and returns the weighted mean (on the raw scale), its normalization, and `passed = normalized >= threshold` (threshold **inclusive**). Empty / all-zero-weight input returns the degenerate `{ weightedMean: scaleMin, normalized: 0, passed: 0 >= threshold }`.

**2. F-55 finally died — for real, in the live trace.** For five reports the `peak window N%` context-rot metric was loud but lying (it divided projected tokens by a hardcoded 200k). dogfood-057 fixed that in code (WP-252) but predicted the fix would only *show* on the next run. This is that run. Its journaled pacing entry reads `utilization 1.792485` — exactly `716994 / 400000`, i.e. the projected tokens divided by the **real** `gpt-5.5` 400k window — and the trace renders a believable **`peak window 179%`** instead of the old inflated 904%. The metric now measures genuine context pressure, satisfying the CLAUDE.md "maximal observability — no magic" rule.

## Trace excerpt

```
run run-67d39267-c99c-471e-b625-5de20a3bb8ca · SUCCESS · 1 steps · $0.49 / $5.00 · 2m 57s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Summary: WP-210 is complete. I adde… 355k/3.8k        $0.48    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.8%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 179% (compact 1 · park 0) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

- **Step 1** — `$0.4817 (estimated)` · 355k in / 3.8k out · 2m23s · 16 tool calls · diff `0034b9820abd` (4974 bytes) · checkpoint `run-67d39267@4` commit `08e3ac68339e` `lastGood true`.
- **Judge pass #1** — `openai-compat/gemini-3.1-pro-preview` · $0.0088 · 22347 evidence bytes · 33s · ✓ PROCEED (2/2 criteria); rubric `tests_pass` ✓ (both judge-executed checks `exited 0`), `no_unrelated_deletions` ✓, `no_secrets_introduced` ✓, `scope_matches_instruction` ✓ (exactly the 3 named files).
- **Pacing entry (journal, `pacingEventIndex 0`)** — `action compact · projectedTokens 716994 · remainingTokens -316994 · utilization 1.792485`. `716994 / 1.792485 = 400000` ⇒ the denominator is the calibrated `gpt-5.5` window, NOT the old 200k.

## Delivery quality (human review, post-landing)

Reviewed `scoring.ts`, the `index.ts` barrel diff, and `scoring.test.ts` line by line against the spec `goal`:

- 🟢 **Three local types exact** — `GEvalCriterionScore { id; score; weight? }`, `GEvalAggregateOptions { threshold; scaleMin?; scaleMax? }`, `GEvalScore { weightedMean; normalized; passed }` — named exports, no default, `types.ts` untouched (no contract change).
- 🟢 **`normalizeGEvalScore` correct** — doc comment cites WP-210; `scaleMax <= scaleMin` → 0 guard; `Math.min(Math.max(raw, scaleMin), scaleMax)` clamp; `(clamped - scaleMin) / (scaleMax - scaleMin)`. Pure, reads only its args.
- 🟢 **`aggregateGEval` correct** — `scaleMin ?? 1`, `scaleMax ?? 5`; `weight ?? 1`; `weight <= 0` skipped; per-entry clamp; `weightSum === 0` → `{ weightedMean: scaleMin, normalized: 0, passed: 0 >= opts.threshold }`; otherwise `weightedMean = weightedSum / weightSum`, `normalized = normalizeGEvalScore(weightedMean, …)`, `passed = normalized >= threshold` (inclusive). Pure — no I/O, clock, or randomness. Spot-checked the weighted case by hand: `(5·3 + 1·1) / 4 = 4`, `(4-1)/(5-1) = 0.75`, `0.75 >= 0.7` → `true`. ✅
- 🟢 **Barrel re-export exact** — `index.ts` adds a block exporting `aggregateGEval`, `normalizeGEvalScore`, and the three types from `./scoring.js` (ESM `.js` specifier); mirrors the existing `verdict.js` block; nothing else changed.
- 🟢 **Test ≥ mandated cases** — 9 cases (3 over the 8 named): default-scale normalization, out-of-range clamp, custom scale, single-criterion top/bottom, weighted mean, inclusive-threshold boundary, empty-degenerate, ignored non-positive weight. No assertion weakened.
- 🟢 **Scope discipline** — `git status --short` shows exactly the 3 files (`A scoring.ts`, `M index.ts`, `A scoring.test.ts`); no new dependency; `buildVerdict`/`computeVerdict`/prompt/harness/rubric/journal all untouched.

**Independent re-verification (`dogfood-verify §3`, re-run against the working tree):**
- 🟢 **AC-1 PASS** (exit 0) — 4 grep-pins (`normalizeGEvalScore`/`aggregateGEval` in `scoring.ts`, `scoring.js` in `index.ts`) + `vitest test/judge/scoring.test.ts` **9 passed**.
- 🟢 **AC-2 PASS** (exit 0) — `tsc --noEmit` + `eslint .` + full `vitest` = **489 passed | 19 skipped (508)**, incl. the real-Temporal `verdict-gating` "seedBadDiff ARMED" path and the `crash-recovery` kill -9 path. The primitive is additive — the binary `buildVerdict`/verdict/override logic is not regressed.
- 🟢 **Harvest byte-diff (`§5`)** — all 3 files `IDENTICAL` to the run workspace.

## New friction

Friction numbering is global/sequential; the highest prior is **F-55** (dogfood-054). **This run adds NO new friction.** One long-running finding is now CLOSED by live observation; no recurrences.

### F-55 / WP-252 — uncalibrated pacing-window denominator: CLOSED BY OBSERVATION.

- WP-252 landed in code at dogfood-057 (HEAD `3a3dc8d`) but, by the F-53/F-52 close-when-observed shape, that run's own trace still read the pre-wire 200k-relative `peak window 904%`. dogfood-058 is the FIRST run launched at a HEAD (`6292f62`) with the calibration committed, so it is the first live un-seamed read. The journaled `pacing` entry — `action compact · projectedTokens 716994 · utilization 1.792485` — is exactly `716994 / 400000`, proving the denominator is the calibrated `gpt-5.5`→400k window, and `chikory trace` renders a believable `peak window 179%`. F-55 (recurred dogfood-052→056) is now closed both in code and in observation. No new WP.

### Notable (positive, no WP): park-saturation did NOT recur.

- For six consecutive prior reports the headline step PARKED (`compact 0 · park 1`) because a single overflowing step couldn't be helped by folding — but those readings divided by 200k, so a 355k–898k-token step always looked like 3–6× the window. With the **calibrated 400k denominator**, this step's `utilization 1.79` crossed the compaction threshold but stayed in folding range, so the runner **compacted** (`compact 1 · park 0`) rather than parking — the F-54/WP-250/WP-251 park-saturation series breaks here. This is the calibration paying off: the `compact` branch is now reachable on a normal heavy step, exactly the WP-203/WP-207 act-half intent. WP-250 (park→durable suspend) and WP-251 (observe a seam-forced multi-step `trigger:"pacing"` fold live) remain queued for the genuine multi-step-overflow case; nothing here changes their status.

### Token economics (baseline data, no WP).

- Step 1 **355k in / 3.8k out** for a 4974-byte diff across **16 tool calls** — back in the typical 328k–598k single-step range (vs dogfood-057's 898k series-high), and ~the same 355k as dogfood-056's comparable 3-file slice. $0.4817 / 9.6% of budget — one of the cheapest recent headlines, the codex executor landed it without much exploration. The projected peak of 716,994 tokens (1.79× the 400k window) is the real pre-compaction context size; the 355k billed input is post-fold. Recorded for WP-203/WP-207. Not friction.

### Judge behavior (clean — additive primitive confirmed).

- Both AC checks **actually executed** (`exited 0` each — `dogfood-verify §2`). The LLM rubric correctly passed `tests_pass`, `no_unrelated_deletions` (recognized two new files + one re-export block addition, no deletions), `no_secrets_introduced` (the diff is numeric scores + a threshold only — the now-live `scanDiffForSecrets` over this run's diff returned `[]`), and `scope_matches_instruction` (exactly the 3 named files). Family diversity real (`codex`/openai vs Google `gemini-3.1-pro-preview` via the shim). No ESCALATE/ROLLBACK; `issues found 0 · changes made 1`. ✅

### Human ceremony (F-10 territory, nothing new).

- Operator started the cli-judge-proxy shim, committed the dogfood-057 delivery so the tree was clean, launched once (no seam env), watched to terminal. Delivery left uncommitted on the working tree for review (the standing harvest pattern). F-51/WP-249 (harvest commit cites no run-id) is N/A — nothing committed yet.

## Verdict on the thesis

🟢 **Positive.** Two thesis pillars advanced in one clean, cheap one-shot. **(1)** WP-210 opens the Agent-as-a-Judge *scoring-modes* pillar — the judge now has the continuous-score math (`aggregateGEval`/`normalizeGEvalScore`) it needs to grade rather than only gate, delivered as a pure, fully-tested primitive with zero contract change, the same pure-decision-first decomposition every prior judge/runner WP used (`buildVerdict`, `decideContextWindowPacing`, `summarizePacing`). **(2)** F-55 — the five-report "magic number" denominator — is now closed in the live trace: `peak window 179%` is a number an operator can trust, computed against the executor's real 400k window, and the same calibration flipped this step from a structural `park` to a real `compact`, the first observed payoff of the WP-203/WP-207 act half. Delivered for **$0.4905 / 9.8%** of budget with **1.8%** judge share, breaking nothing in a 489-pass suite, by an executor whose work a structurally-different judge family re-ran and approved. **The act half of WP-210 (the `scoringMethod` TaskSpec field + the live judge-harness wire that consumes `aggregateGEval`) is a §4 contract-touching follow-up — operator-landed, NOT a dogfood headline; the next dogfoodable headline should re-gate the strongest UNBLOCKED pure-product slice at selection time.**
