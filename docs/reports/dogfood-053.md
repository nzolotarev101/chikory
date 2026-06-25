# dogfood-053 — WP-203/WP-207: compaction SUMMARY (the act-half `trigger` field now actionable in `trace` totals)

- **WP:** WP-203 / WP-207 (a pure `summarizeCompaction(entries)` reducer over the journaled `compaction` entries → digest-bearing fold count + the pacing-pressure-driven subset, surfaced additively in the `chikory trace` totals sub-line) — FA-3 / SE-2.
- **Date:** 2026-06-24
- **Spec:** `examples/dogfood/dogfood-053.yaml` (`dogfood-053-wp203-compaction-summary`)
- **Run-id:** `run-41f2744f-82d6-4e54-825d-9704f77b1ee7`
- **Landed commit:** _uncommitted on the working tree_ (harvest byte-IDENTICAL to the run workspace — see §Independent verification; left for the operator to commit per F-51/WP-249 hygiene, ideally its own commit with a `Ref: run-id:` trailer).
- **Runtime:** HEAD at launch `4abb478` (the WP-207 *act* half / WP-203 S2 — the `trigger:"pacing"|"count"` tag on the compaction payload + the per-entry ` (pacing)` marker — committed first per the spec's build-on discipline).
- **Gate verdict (pre-launch):** 🟡 **ALLOW (fallback)** — §1.1 ✅ · §1.2 ✅ (real WP-203/207 trace code) · §1.3 🟡 (the meatier next thesis slice — park→suspend, WP-250 — is a §4 control-flow hand-design; this is the best unblocked real-WP slice on the context-rot pillar).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently. New residual F-54: the compaction telemetry is unit-proven but NOT observed live (this run PARKED, 0 folds).**

## Vibe check (plain English)

The WP-207 *act* half landed just before this run: the live context-window pacing decision
now **drives** compaction cadence, so a fold under real token pressure is tagged
`trigger:"pacing"` (vs the count-trigger `"count"`), and `chikory trace --step` shows ` (pacing)`
per-entry. But the trace **totals** line — the one-liner an operator scans — said nothing about
compaction at all. This run closes that, exactly as dogfood-052 did for pacing: a pure
`summarizeCompaction(entries)` reducer folds the journaled `compaction` entries into **how many
folds actually produced a digest** and **how many of those were pacing-pressure-driven**, and the
totals line now reads `compactions N (pacing M)`.

The honest result: **this run never folded.** Its own pacing decision recommended **PARK**
(peak window **604%**, `compact 0 · park 1`), not compact — a single step that overflows the
window by 6× cannot be helped by folding history, so it parks (the WP-250 suspend path, still
§4-blocked). So the totals line on this very run shows **no** `compactions` segment (0 folds, the
byte-identical no-compaction path working as designed). The new telemetry is unit-proven (3 reducer
cases + 2 renderer cases) but, like dogfood-051's pacing telemetry before dogfood-052 observed it
live, it has **not yet been read off a real fold** — recorded as **F-54** below.

## Trace excerpt

```
run run-41f2744f-82d6-4e54-825d-9704f77b1ee7 · SUCCESS · 1 steps · $0.81 / $5.00 · 3m 29s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented the WP-203/WP-207 compa… 598k/5.4k        $0.80    ✓ PROCEED (1/1 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 604% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (1 step, ≤ `max_steps` 8) |
| Cost (exact sum) | **$0.8086** / $5.00 budget (**16.2%**) |
| Step 1 | $0.8016 · **598k in / 5.4k out** · 3m11s · 22 tool calls · diff 6634 bytes |
| Judge pass #1 | $0.0070 · 17s · 8390 evidence bytes · **0.9% judge share** |
| Executor / Judge family | `codex` (openai) **vs** `gemini-3.1-pro-preview` (openai-compat, Google) — diverse ✅ |
| Checkpoint | `run-41f2744f…@4` · commit `67900399b87d` · `lastGood true` |
| Duration | 3m 29s |
| Empty-diff probe (F-11) | none — `s0 j@0`, F-11 did not recur |
| **Live pacing entry** | `peak window 604% (compact 0 · park 1)` — PARK recommended; **0 compaction folds this run** |

## Delivery quality (human review, post-landing)

Reviewed the landed diff line-by-line against the spec `goal`. **In scope, on spec** —
`dogfood-verify §5` reports all five files `IDENTICAL` to the run workspace.

- 🟢 **`src/runner/compaction-summary.ts`** (NEW, 25 lines) — pure `summarizeCompaction(entries)`:
  filters `e.kind === "compaction"`, casts payload `{ digestRef?: unknown; trigger?: string }`,
  **digestRef-gated** (`payload.digestRef === undefined` → `continue`, a no-op fold MUST NOT count),
  `folds` = digest-bearing count, `pacingFolds` = of those, `trigger === "pacing"`. Type-only
  `JournalEntry` import, local `CompactionSummary` interface, JSDoc cites WP-203/WP-207/FA-3/SE-2.
  No I/O, no mutation, no `types.ts`/schema change. ✅
- 🟢 **`src/index.ts`** — single barrel re-export beside the `./runner/pacing-summary.js` line:
  `export { summarizeCompaction, type CompactionSummary } from "./runner/compaction-summary.js";`. ✅
- 🟢 **`src/cli/trace.ts`** — `const compaction = summarizeCompaction(entries);` (`trace.ts:175`),
  the non-empty branch builds `` ` · compactions ${compaction.folds} (pacing ${compaction.pacingFolds})` ``
  and appends `${compactionSummary}` to the **same** totals sub-line after `${pacingSummary}`
  (`trace.ts:213-218`); empty branch stays `""` (no-compaction path byte-identical). `formatEntryLine`
  switch and every other totals line untouched. ✅
- 🟢 **`test/runner/compaction-summary.test.ts`** (NEW, 3 cases) — verbatim
  `expect(summarizeCompaction(entries)).toEqual({ folds: 2, pacingFolds: 1 })` (one pacing + one count,
  both digest-bearing) + `pacingFolds` asserted alone; empty → `{0,0}`; digest-less compaction NOT
  counted and `step`/`checkpoint` ignored (`{folds:1, pacingFolds:0}`). ✅
- 🟢 **`test/cli/trace.test.ts`** — extends (no case removed); new case asserts
  `toContain("compactions 2 (pacing 1)")` over two digest-bearing entries and the no-compaction
  journal `not.toContain("compactions")`. ✅

Independent verification (`dogfood-verify §3`): AC-1 re-run against the working tree exits 0 —
grep-pins (`compactions ` in `trace.test.ts`, `pacingFolds` in the reducer test, `summarizeCompaction`
in def/wire/barrel, `export function summarizeCompaction`) all green, `vitest` **27 passed** (trace 24 +
compaction-summary 3), `tsc --noEmit` clean, `eslint .` clean. Judge pass #1 PROCEED 1/1; rubric
`tests_pass` / `no_unrelated_deletions` / `no_secrets_introduced` / `scope_matches_instruction` all ✓
(the judge-executed AC check exited 0 in-loop — a real executed gate, not a text read). Family
diversity real (`gemini-3.1-pro-preview` ≠ executor `codex`/openai).

## New friction

No empty/filler step, no `.00`-with-tokens cost anomaly, no scope creep (exactly the 5 named files),
no duplicate journal entries, no resume, `s0 j@0` (F-11 held). The 598k input tokens for a ~5-file
additive slice is the standing series norm (the very pressure WP-203/207 instruments), not a new
finding.

- **F-54 (NEW) 🟡 — the compaction-summary telemetry is unit-proven but never observed live; the
  standing 1-step `codex` headline runs PARK, never compact.** Evidence: this run's pacing decision
  read `peak window 604%` and recommended **PARK** (`compact 0 · park 1`), so it produced **0
  compaction folds** and the new `compactions N (pacing M)` segment never rendered on its own trace.
  A single step that overflows the 200k window by 6× cannot be helped by folding verbatim history, so
  the act-half correctly parks it (the suspend path is WP-250, §4-blocked). The new reducer is
  therefore in exactly dogfood-051/F-53's pre-close state: proven by 5 tests, but not yet read off a
  **real** fold. It closes the moment a dogfood run actually folds under pressure and the totals line
  renders a non-zero `compactions N (pacing M)`. **WP it spawns:** **WP-251** (Next up, dogfood-053 F-54)
  — a context-rot dogfood that drives a **multi-step** run under the deterministic
  `CHIKORY_CONTEXT_WINDOW_TOKENS` seam (the act-half proof seam) past `keepLastN` so a `trigger:"pacing"`
  fold actually happens, then reads `compactions N (pacing M)` live — exactly the seam-forced close
  dogfood-052 did for pacing. Folds into WP-203/WP-207 observability; same shape as F-52 (seam) / F-53
  (pacing), both closed once observed live.

## Verdict on the thesis

🟢 **The context-rot pillar's observability is now end-to-end on the act half — and self-honest about
its limit.** `chikory trace` can now report, in one line, both the window pressure (`peak window X%`,
dogfood-052) **and** whether that pressure actually triggered a fold (`compactions N (pacing M)`, this
run). On the very run that built it, the totals correctly read 604% pressure with **zero folds** —
because the right action at 6×-in-one-step is PARK/suspend, not compact. That is the strongest standing
argument for the **next thesis act-slice: WP-250 park→suspend** (a single overflowing step can't be
helped by folding — it must be suspended/checkpointed and the work re-sliced), a §4 control-flow
hand-design that is operator-landed, not a dogfood headline. Meanwhile the dogfood loop's next run is
already gated and queued: **dogfood-054** — the Agent-as-a-Judge **true-positive catch on REAL
product-WP code** (WP-215 `scanDiffForSecrets` + the WP-244 seam), escalating the catch off the
dogfood-046/048 throwaway utilities onto real feature code (gate ✅ PROCEED). F-54 (this run) and the
WP-250/WP-251 follow-ups are the context-rot continuation behind it.
