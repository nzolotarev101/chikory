# dogfood-052 — WP-207: pacing SUMMARY (peak window pressure now actionable in `trace`)

- **WP:** WP-207 (a pure `summarizePacing(entries)` reducer over the journaled `pacing` entries → peak window utilization + compact/park recommendation counts, surfaced additively in the `chikory trace` totals sub-line) — FA-3 / SE-2.
- **Date:** 2026-06-24
- **Spec:** `examples/dogfood/dogfood-052.yaml` (`dogfood-052-wp207-pacing-summary`)
- **Run-id:** `run-7e13ae2a-a233-4e2d-9fdc-d564a9eee5bc`
- **Landed commit:** _uncommitted on the working tree_ (harvest byte-IDENTICAL to the run workspace — see §Independent verification; left for the operator to commit per F-51/WP-249 hygiene, ideally its own commit with a `Ref: run-id:` trailer).
- **Runtime:** HEAD at launch `0880806` (dogfood-051's pacing journaling+wiring, committed first per the spec's build-on discipline).
- **Gate verdict (pre-launch):** 🟡 **ALLOW (fallback)** — §1.1 ✅ · §1.2 ✅ · §1.3 🟡 (no thesis-stressing real-WP *act* slice cleanly unblocked; this is the best unblocked real-WP slice on the context-rot pillar, real trace code not scaffold).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently — AND F-53 CLOSED: the first LIVE read of context-window pressure.**

## Vibe check (plain English)

dogfood-051 taught `chikory trace` to *journal* the per-step context-window pressure, but
it only printed a bare ` · pacing events N` count — and N is just the step count, so it
answered nothing. This run makes that payload **actionable**: a pure `summarizePacing`
reducer folds the journaled `pacing` entries into the run's **peak** window utilization plus
how many steps the pacing decision flagged `compact` / `park`, and the trace totals line now
reads `peak window X% (compact C · park P)`.

The striking part is what it immediately revealed about **its own run**. Because dogfood-051's
journaling was committed to HEAD *before* this launched, this run journaled a real `pacing`
entry — and the new reducer surfaces it:

> **`peak window 602% (compact 0 · park 1)`**

The `codex` executor's single step projected **1,203,440 tokens** against the 200k window
(`remainingTokens -1,003,440`, `utilization 6.0172`) and the pacing decision recommended
**PARK** at step 0 — and the loop continued anyway, because the *act* half (use the decision
to actually compact/park) is still §4-blocked. That is exactly the context-rot signal the
whole WP exists to make visible: **the trace can now answer "did this run blow past the
window ceiling?" — and the honest answer for this run was "by 6×."** F-53 (telemetry
unit-proven but never observed live) is closed by this run's own trace.

## Trace excerpt

```
run run-7e13ae2a-a233-4e2d-9fdc-d564a9eee5bc · SUCCESS · 1 steps · $0.80 / $5.00 · 3m 4s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented WP-207 pacing trace sur… 597k/5.0k        $0.80    ✓ PROCEED (1/1 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 602% (compact 0 · park 1) · feedback frequency 1/1 steps
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (1 step, ≤ `max_steps` 8) |
| Cost (exact sum) | **$0.8032** / $5.00 budget (**16.0%**) |
| Step 1 | $0.7959 · **597k in / 5.0k out** · 2m49s · 19 tool calls · diff 6638 bytes |
| Judge pass #1 | $0.0073 · 15s · 8389 evidence bytes · **0.9% judge share** |
| Executor / Judge family | `codex` (openai) **vs** `gemini-3.1-pro-preview` (openai-compat, Google) — diverse ✅ |
| Checkpoint | `run-7e13ae2a…@4` · commit `a6dcdfd9fc58` · `lastGood true` |
| Duration | 3m 4s |
| Empty-diff probe (F-11) | none — `s0 j@0`, F-11 did not recur |
| **Live pacing entry** | `action park · projectedTokens 1,203,440 · remainingTokens -1,003,440 · utilization 6.0172` |

## Delivery quality (human review, post-landing)

Reviewed the landed diff line-by-line against the spec `goal`. **Byte-perfect, in scope, on
spec** — `dogfood-verify §5` reports all five files `IDENTICAL` to the run workspace.

- 🟢 **`src/runner/pacing-summary.ts`** (NEW, 27 lines) — pure `summarizePacing(entries)`:
  filters `e.kind === "pacing"`, casts payload `{ action, utilization }`, returns
  `peakUtilization` = `Math.max` (NOT sum, NOT projectedTokens), `compactRecommended` /
  `parkRecommended` = action counts (`continue` excluded), `0` on empty. Type-only
  `JournalEntry` import, local `PacingSummary` interface, JSDoc cites WP-207 / FA-3 / SE-2.
  No I/O, no mutation, no `types.ts`/schema change. ✅
- 🟢 **`src/index.ts`** — single barrel re-export beside the `./runner/pacing.js` line:
  `export { summarizePacing, type PacingSummary } from "./runner/pacing-summary.js";`. ✅
- 🟢 **`src/cli/trace.ts`** — `const pacing = summarizePacing(entries);` then the non-empty
  branch extends to `… · pacing events N · peak window ${Math.round(peakUtilization*100)}%
  (compact C · park P)`; the empty branch stays `""` (no-pacing path byte-identical). No
  other totals line or the `formatEntryLine` switch touched. ✅
- 🟢 **`test/runner/pacing-summary.test.ts`** (NEW, 3 cases) — verbatim
  `expect(summarizePacing(entries).peakUtilization).toBe(0.9)` + counts; empty → 0; non-`pacing`
  (`step`/`checkpoint`) ignored. ✅
- 🟢 **`test/cli/trace.test.ts`** — extends, keeps dogfood-051's `pacing events 1` case; new
  case asserts `toContain("peak window 90% (compact 1 · park 0)")` and the no-pacing journal
  `not.toContain("peak window")`. ✅

Independent verification (`dogfood-verify` §3): AC-1 re-run against the working tree exits 0 —
grep-pins (`peak window`, `peakUtilization`, `summarizePacing` in def/wire/barrel) all green,
`vitest` 25 passed (trace 22 + pacing-summary 3), `tsc --noEmit` clean, `eslint .` clean.
Judge pass #1 PROCEED 1/1; rubric `tests_pass` / `no_unrelated_deletions` /
`no_secrets_introduced` / `scope_matches_instruction` all ✓ (the judge-executed AC check
exited 0 in-loop — a real executed gate, not a text read).

## New friction

**None.** No empty/filler step, no `.00`-with-tokens cost anomaly, no scope creep (exactly the
5 named files), no duplicate journal entries, no resume. Family diversity real. Judge true
PROCEED. The 597k input tokens for a ~5-file additive slice is the standing series norm (the
very pressure WP-207 now instruments), not a new finding.

- **F-53 → CLOSED 🟢.** dogfood-051's pacing telemetry was unit-proven but never observed
  live (its own trace predated the wiring). This run is the first to journal a `pacing` entry
  *and* render the summary over it: `peak window 602% (compact 0 · park 1)`, payload
  `utilization 6.0172`. Telemetry confirmed live end-to-end.

## Verdict on the thesis

🟢 **Context-rot observability is now complete and self-evidencing.** The product's first-class
claim — long-horizon agent reliability requires *measuring* context-window pressure — now has
a trace that, on the very run that built it, reports the executor ran at **602% of the window
with PARK recommended and unheeded**. That single number is the strongest standing argument
for the next priority: the WP-207 **act half** (use the pacing decision to actually
compact/checkpoint), which is §4-blocked on the **WP-203 S2 runtime compaction trigger** (WP-202
store + a non-pure LLM-call hand-design, TASK-PROTOCOL §4 — operator-landed, not a dogfood
headline). Unblocking WP-203 S2 is the highest-leverage move to break the loop out of the
additive-observability regime. Until then the dogfood loop rides the best unblocked real-WP
slices — and the next escalation (dogfood-053) is to prove the **Agent-as-a-Judge true-positive
catch on REAL product-WP code**, not the throwaway utilities of dogfood-046/047/048.
