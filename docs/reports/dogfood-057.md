# dogfood-057 — WP-252: calibrate the pacing-window denominator to the executor model

- **WP:** WP-252 (calibrate the WP-207/WP-252 pacing-window denominator to the executor model — a pure `pricing.ts`/`lookupPricing` analog provider→context-window table + lookup + spec-aware resolver, WIRED into the live agent loop so `decideContextWindowPacing` divides by the routing model's REAL window instead of a hardcoded 200k; REQUIREMENTS FA-3/SE-2 observability accuracy).
- **Date:** 2026-06-27
- **Spec:** `examples/dogfood/dogfood-057.yaml` (`dogfood-057-wp252-context-window-calibration`)
- **Run-id:** `run-6b23da51-c440-432a-bbf8-51d4ee8a24af`
- **Landed commit:** _(none — delivery uncommitted on the working tree; `dogfood-verify §5` byte-IDENTICAL to the run workspace for all 3 files; `§6` no landed commit)_.
- **Runtime:** HEAD at launch `3a3dc8d` (codex executor, `gemini-3.1-pro-preview` judge via the zero-secrets cli-judge-proxy shim).
- **Gate verdict (pre-launch, recorded in the dogfood-056 review):** ✅ **PROCEED** — §1.1 ✅ (cross-file: a NEW pure `src/runner/context-window.ts` module + the live `agent-loop.ts` denominator wire + a test; genuinely failable on longest-prefix resolution, unknown→fallback, AND the no-regression constraint that the `debug.contextWindowTokens` seam STILL wins — `compaction-wiring.test.ts` + the pacing tests are the guard; a real bug surface five reports flagged — NOT a 1-file port) · §1.2 ✅ (the landed diff is REAL open plan.md §6 WP-252 🟢 feature code: the live pacing denominator is actually calibrated — a context-rot / "no magic" observability thesis mechanism seeded into real runtime code, NOT invented scaffolding) · §1.3 ✅ PROCEED (the strongest UNBLOCKED real-product thesis slice; WP-250 park→durable-suspend + WP-253 destructive override are §4 operator-walled, WP-251 is observability-only — this retires a five-report-recurring finding).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently. NO new friction.** WP-252 lands additively and correctly; the long-running F-55 (uncalibrated denominator) is now **fixed in code** and closes-by-observation on the next run (the F-53 live-read shape — this run's own trace still reads the pre-wire 200k-based figure). Park-saturation recurs as expected (6th data point, already tracked F-54/WP-250/WP-251).

## Vibe check (plain English)

For five consecutive reports the headline **`peak window N%`** context-rot metric has been loud but lying: pacing divided projected tokens by a hardcoded `200_000` that had nothing to do with the executor model's real context window. A `gpt-5.5` step that runs ~900k tokens looked like "904% of the window — catastrophic rot" when the divisor was just an arbitrary constant. That is the exact opposite of the project's "maximal observability — no magic" rule.

This run lands the fix (**WP-252**): the pacing denominator is now sourced from the routing model's known window.

Two pure functions + one new module + the live wire + a test:
- `context-window.ts` — a static `CONTEXT_WINDOW_TABLE` (model id → window tokens, mirroring `pricing.ts`'s `PRICE_TABLE` family keys: Anthropic 200k, OpenAI 400k, Gemini 1M) + `lookupContextWindow(model, fallback)` (longest-prefix, the EXACT `lookupPricing` shape — a dated snapshot id resolves to its family row) + `resolveContextWindowForSpec(spec, fallback)` (reads the executor's `routing.stages.code.model`).
- `agent-loop.ts` — one line at the `decideContextWindowPacing(...)` call: `spec.debug?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS` → `spec.debug?.contextWindowTokens ?? resolveContextWindowForSpec(spec, DEFAULT_CONTEXT_WINDOW_TOKENS)`. The `debug.contextWindowTokens` **seam still wins** (so the tiny-window compaction/pacing tests are unaffected); an un-seamed real run now divides by the calibrated window.

The slice is **deliberately additive**: `decideContextWindowPacing`, the pacing/compaction journal payloads, `types.ts`, and the trace renderer are all untouched. `codex`/`gpt-5.5` one-shot all three files in a single step; the structurally-different judge family (Google `gemini-3.1-pro-preview`) re-ran both acceptance checks (`exited 0`) and passed all four rubric items.

**Live-read note (NOT new friction — the F-53 shape, anticipated in the spec header):** the wire takes effect on the NEXT run after this lands + rebuilds. HEAD at launch (`3a3dc8d`) predates the wire, so THIS run's own trace still reads the 200k-based `peak window 904%`. The first calibrated live read is automatically the next dogfood (confirm its `peak window %` drops to the executor-window-relative figure); the new test asserts the `gpt-5.5`→400k resolution directly in the meantime.

## Trace excerpt

```
run run-6b23da51-c440-432a-bbf8-51d4ee8a24af · SUCCESS · 1 steps · $1.20 / $5.00 · 4m 28s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   ✅ Completed the WP-207/WP-252 pacin… 898k/6.5k        $1.19    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.8%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 904% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

- **Step 1** — `$1.1870 (estimated)` · 898k in / 6.5k out · 3m54s · 31 tool calls · diff `e286932c1af0` (4796 bytes) · checkpoint `run-6b23da51@4` commit `797113b5549b` `lastGood true`.
- **Judge pass #1** — `openai-compat/gemini-3.1-pro-preview` · $0.0092 · 22126 evidence bytes · 34s · ✓ PROCEED (2/2 criteria); rubric `tests_pass` ✓ (both judge-executed checks `exited 0`), `no_unrelated_deletions` ✓, `no_secrets_introduced` ✓, `scope_matches_instruction` ✓ (exactly the 3 named files).

## Delivery quality (human review, post-landing)

Reviewed `context-window.ts`, `agent-loop.ts` diff, and `context-window.test.ts` line by line against the spec `goal`:

- 🟢 **Table exact** — all 14 rows present with the mandated `PRICE_TABLE` family keys and values (6× Anthropic 200k, 4× OpenAI 400k, 4× Gemini 1M).
- 🟢 **`lookupContextWindow` mirrors `lookupPricing` byte-for-byte in shape** (`pricing.ts:43`) — exact-match short-circuit, then longest `startsWith` prefix, then `fallback` (default 200_000). The dated-snapshot path (`gpt-5.5-2026-06-01` → 400k) works; a `-mini` id correctly resolves to its own row, not the base row.
- 🟢 **`resolveContextWindowForSpec` pure** — reads `spec.routing.stages.code?.model`, returns `fallback` on missing/empty, type-only `import type { TaskSpec }`. No I/O, no `Date`, no random — replay-safe inside the Temporal workflow.
- 🟢 **Live wire exact** — `agent-loop.ts:355` now calls `resolveContextWindowForSpec(spec, DEFAULT_CONTEXT_WINDOW_TOKENS)` with the `debug.contextWindowTokens` seam still first in the `??` chain; `DEFAULT_CONTEXT_WINDOW_TOKENS` kept as the constant; nothing else in the workflow changed.
- 🟢 **Test ≥ mandated cases** — 6 cases covering exact families, dated-snapshot longest-prefix, unknown→fallback (both the passed `123_456` and the default `200_000`), the spec resolver `gpt-5.5`→400k, and the unknown/empty code-model→fallback paths. No assertion weakened.
- 🟢 **Scope discipline** — `git status --short` shows exactly the 3 files (`A context-window.ts`, `M agent-loop.ts`, `A context-window.test.ts`); no new dependency; no contract change.

**Independent re-verification (`dogfood-verify §3`, re-run against the working tree):**
- 🟢 **AC-1 PASS** (exit 0) — 4 grep-pins (`CONTEXT_WINDOW_TABLE`/`lookupContextWindow`/`resolveContextWindowForSpec` in `context-window.ts`; `resolveContextWindowForSpec` in `agent-loop.ts`) + `vitest` **6 passed**.
- 🟢 **AC-2 PASS** (exit 0) — `tsc --noEmit` + `eslint .` + full `vitest` = **480 passed | 19 skipped (499)**, incl. the real-Temporal `verdict-gating` "seedBadDiff ARMED" path and the `crash-recovery` kill -9 path. The denominator wire is additive — the `decideContextWindowPacing` decision and `debug.contextWindowTokens` seam precedence are not regressed.
- 🟢 **Harvest byte-diff (`§5`)** — all 3 files `IDENTICAL` to the run workspace.

## New friction

Friction numbering is global/sequential; the highest prior is **F-55** (dogfood-054). **This run adds NO new friction.** One earlier finding is now FIXED-in-code (closes by observation next run), one recurs (already tracked).

### F-55 / WP-252 — uncalibrated pacing-window denominator: NOW FIXED IN CODE (closes by observation on the next run).

- This is the run that lands WP-252. The denominator is now sourced from the routing model's real window via `resolveContextWindowForSpec`, with the `debug.contextWindowTokens` seam still overriding for tests. F-55 had recurred across FIVE consecutive reports (dogfood-052→056). **Closure is the F-53/F-52 close-when-observed shape:** HEAD at launch predates the wire, so this run's own trace still reads the pre-wire `peak window 904%`; the FIRST calibrated live read is automatically the next dogfood (confirm its `peak window %` drops to the `gpt-5.5`-window-relative figure — ~898k/400k ≈ 225%-class, no longer the 200k-relative 904%). The new test already asserts the `gpt-5.5`→400k resolution directly. No new WP.

### Recurrence (not new): F-54 / WP-250 / WP-251 — park-saturation, 6th data point.

- `peak window 904% (compact 0 · park 1)` — the single step PARKED, **0 compaction folds**, exactly as the F-54 entry predicts (a single step that alone exceeds the window can't be helped by folding history). Data points now **602% (052) → 604% (053) → 759% (054) → 585% (055) → 334% (056) → 904% (057)** — this run's 904% is a NEW series high (driven by 898k input tokens, the largest single-step input recorded). The compaction-summary telemetry (`compactions N (pacing M)`) again never rendered live (correctly — 0 folds). No new WP — the standing closure targets are **WP-251** (seam-forced multi-step fold, observe a `trigger:"pacing"` fold live) and **WP-250** (park→durable suspend act-slice).

### Token economics (baseline data, no WP).

- Step 1 **898k in / 6.5k out** for a 4796-byte diff across **31 tool calls** — the NEW high end of the 328k–793k-input series every report records, ~2.7× dogfood-056's 328k for a comparably-sized 3-file slice. $1.1870 / 23.7% of budget — the most expensive of the recent single-step headlines (vs $0.47 dogfood-056), driven by the higher tool-call count and input volume (executor explored more before landing). Pure executor variance on an equivalently-scoped task, not friction. Recorded for WP-203/WP-207. (Notably: this very 898k/200k=904% reading is the exact mis-calibration WP-252 just retired — the next run reads the same volume against the real 400k window.)

### Judge behavior (clean — additive calibration confirmed).

- Both AC checks **actually executed** (`exited 0` each — `dogfood-verify §2`). The LLM rubric correctly passed `tests_pass`, `no_unrelated_deletions` (recognized the change as two new files + one modified line), `no_secrets_introduced` (the diff is context-window integers only — no secret-like literal, so the now-live `scanDiffForSecrets` over this run's diff returned `[]`), and `scope_matches_instruction` (exactly the 3 named files). Family diversity real (`codex`/openai vs Google `gemini-3.1-pro-preview` via the shim). No ESCALATE/ROLLBACK; `issues found 0 · changes made 1`. ✅

### Human ceremony (F-10 territory, nothing new).

- Operator started the cli-judge-proxy shim, launched once (no seam env this run), watched to terminal. Delivery left uncommitted on the working tree for review (the standing harvest pattern). F-51/WP-249 (harvest commit cites no run-id) is N/A here — nothing committed yet.

## Verdict on the thesis

🟢 **Positive.** The context-rot observability pillar is now honest end-to-end. For 50+ runs the `peak window N%` metric measured token volume against an arbitrary 200k constant; WP-252 makes the denominator the executor's real window, so the figure finally distinguishes genuine context pressure from a miscalibrated divisor — closing a "magic number" that directly contradicted the CLAUDE.md "maximal observability — no magic" invariant. Delivered additively (the pacing decision, journal payloads, types, and trace renderer all untouched) for **$1.19 / 23.7%** of budget with **0.8%** judge share, breaking nothing in a 480-pass suite, by an executor whose work a structurally-different judge family re-ran and approved. The honest residual is the F-53-shape live-read lag (this run's own trace predates the wire — the next run is the first calibrated read) and the standing act-slices: WP-250 (park→durable suspend) and WP-251 (observe a seam-forced fold live), both queued. **The pacing/context-rot observability sub-series is now complete (dogfood-051 wiring → 052 summary → 053 compaction-summary → 057 calibration); the next dogfoodable headline pivots to the Agent-as-a-Judge scoring pillar — WP-210 (pairwise + G-Eval scoring modes), the strongest UNBLOCKED real-product slice now that the pacing seam-forced act-slices and the secret-override are §4-walled.**
