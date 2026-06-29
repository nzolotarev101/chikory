# dogfood-063 — WP-210 PAIRWISE scoring mode (the pure aggregation half)

- **WP:** WP-210 (Pairwise + G-Eval scoring modes, 🟡) — the documented **PAIRWISE** half of the Agent-as-a-Judge scoring-modes pillar, the comparative analog of the binary criteria/rubric verdict. dogfood-058 landed the G-EVAL half (`normalizeGEvalScore` + `aggregateGEval`) in the SAME module; this lands its sibling: a pure `aggregatePairwise(outcomes)` that tallies wins/losses/ties → win-rate → a stable ranking + a clear winner-or-null. The live judge-harness wire that consumes it (the `scoringMethod` TaskSpec field + the harness selection of pairwise vs G-Eval vs binary) is the SEPARATE §4 follow-up — exactly as `aggregateGEval` (dogfood-058) preceded its harness wire.
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-063.yaml` (`dogfood-063-wp210-pairwise-scoring`)
- **Run-id:** `run-72713667-b730-4037-ace7-468c238738c0` (runtime HEAD `3313d62`)
- **Landed commit:** none yet — delivery is **STAGED** (`M` in index) on the working tree, byte-IDENTICAL to the run workspace (pack §5 = `IDENTICAL` ×3), pending the operator's harvest commit.
- **Gate verdict (pre-launch, recorded in the spec header):** ✅ **PROCEED** — §1.1 ✅ (cross-file `scoring.ts` extend + `index.ts` barrel + `scoring.test.ts`, 1–3 steps, real aggregation failure surface: tie=0.5 win-rate, comparisons denominator, stable sort tiebreak, top-tie→null, empty path, no input mutation — extends an existing module, NOT a 1-file port) · §1.2 ✅ (real open plan.md §6 WP-210 🟡 product code on the Agent-as-a-Judge SCORING-modes named thesis pillar — the documented PAIRWISE half, the pure-first shape the G-Eval half landed in; NOT invented scaffolding) · §1.3 ✅ PROCEED (real product-WP thesis slice; UNBLOCKED and not §4-walled — the `scoringMethod` field + live harness wire is the §4 follow-up exactly as G-Eval's was; WP-202 recall wire / WP-228 / WP-247 / WP-254 are §4 non-pure or semantics changes, WP-249 is track-B, WP-251 needs delicate multi-step seam tuning).

## Trace (excerpt)

```
run run-72713667-b730-4037-ace7-468c238738c0 · SUCCESS · 1 steps · $0.64 / $5.00 · 3m 27s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented the WP-210 pairwise sco… 466k/5.0k        $0.63    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.3%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 236% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps: 4`) |
| Executor / judge | `codex`/`openai` (`gpt-5.5`) · judge `openai-compat`/`gemini-3.1-pro-preview` (structurally different family ✓) |
| Step-1 tokens | **466,000 in / 5,000 out** · 20 tool calls · 2m 52s |
| Step-1 cost | **$0.6328** (estimated) · diff `3356c3ddbee5` · 6,060 bytes |
| Judge pass #1 | $0.0084 · 19,530 evidence bytes · 34s · ✓ PROCEED (2/2 criteria, 0 rubric failures) |
| Total cost | **$0.6412** (exact sum, steps + judge) = **12.8%** of $5 budget · judge share **1.3%** |
| Checkpoint | `…@4` · commit `caff354db9f7` · `lastGood true` (1 checkpoint, no resume) |
| Pacing | 1 event · `action park` · `peak window 236% (compact 0 · park 1)` — the **F-56/WP-254** numerator over-read, again (see below) |

**Acronyms:** **WP** = work package (a plan.md unit of work). **AC** = acceptance criterion (a judge-executed `check`). **F-n** = globally-numbered friction finding. **harvest** = landing the run's workspace diff onto `main`. **Pairwise scoring** = ranking judged candidates by head-to-head comparisons (the comparative analog of a single pass/fail verdict). **Win-rate** = `(wins + 0.5·ties) / comparisons` — a tie counts as half a win. **Compact / park** = the two context-window-pressure pacing branches — `compact` folds history; `park` declines to start the next step. **Peak window %** = the calibrated pacing utilization (`projectedTokens / contextWindowTokens`).

---

## Delivery quality (human review, post-landing)

🟢 **Textbook one-shot, exactly to spec.** Three named files changed, nothing else (`git status --short` = the 3 files; harvest byte-diff §5 = `IDENTICAL` for all three). Line-by-line against the `goal`:

- **`src/judge/scoring.ts`** — adds the three exported local types verbatim to the mandated shape: `PairwiseOutcome { a; b; winner: "a"|"b"|"tie" }`, `PairwiseTally { id; wins; losses; ties; winRate }`, `PairwiseResult { tallies; winnerId: string|null }` — none added to `types.ts` (correct, local-only). The pure `aggregatePairwise(outcomes)`:
  - tallies every id appearing as `a`/`b` via a `Map`-backed `ensureRecord`; `"a"`→a +win/b +loss, `"b"`→b +win/a +loss, `"tie"`→both +tie ✓
  - `winRate = (wins + 0.5·ties) / total` with `total = wins+losses+ties` (never 0 for an id that appears) ✓
  - sort: `winRate` DESC, then `id` ASC (`left.id < right.id ? -1 : left.id > right.id ? 1 : 0`) — deterministic ✓
  - `winnerId`: `null` on empty OR when `tallies[0].winRate === tallies[1]?.winRate` (top-tie → `null`); a single-candidate set has no `tallies[1]`, so `undefined !== winRate` → that candidate IS the winner (matches spec: null only on empty or a top-TIE) ✓
  - **pure** — builds a fresh `Map`/arrays/objects, never mutates `outcomes` ✓
- **`src/judge/index.ts`** — `aggregatePairwise` + the three `type` exports appended to the SAME `./scoring.js` re-export block; nothing else touched ✓
- **`test/judge/scoring.test.ts`** — 5 focused cases, all five mandated paths proven: clear winner (`winRate` 1, sorts first, is `winnerId`), tie arithmetic (both 0.5 → `winnerId` null), mixed 3-candidate rank with id-ascending tiebreak (alpha/bravo both 0.75, charlie 0, length 3, winner null), empty → `{ tallies: [], winnerId: null }`, and a snapshot-equality no-mutation assertion. No existing G-Eval assertion weakened ✓

**Independent re-verification (pack §3, against the working tree):** 🟢 both ACs green.
- **AC-1** exit 0 — 6 grep-pins (`aggregatePairwise`/`PairwiseOutcome`/`PairwiseResult`/`PairwiseTally` in `scoring.ts`, `aggregatePairwise` in `index.ts` + the test) + scoped `vitest run test/judge/scoring.test.ts` → **14 passed**.
- **AC-2** exit 0 — `tsc --noEmit` + `eslint .` + full `vitest run` → **515 passed | 19 skipped (80 files)**; the WP-132 seam-armed gate test and the WP-123 crash-recovery test both green.

No contract change, no new dependency, `aggregateGEval`/`normalizeGEvalScore`/`types.ts`/journal untouched. **WP-210's PAIRWISE pure half → done. Both pure primitives of "Pairwise + G-Eval scoring modes" now exist; the pure scoring-modes surface is exhausted** — what remains is the `scoringMethod` TaskSpec field + the live judge-harness selection wire (the §4 act half, operator-landed).

## New friction

**None.** No new F-n. Two standing items reinforced:

- **F-56 / WP-254 (pacing numerator over-read) — reinforced, ~10th data point.** This trivial additive 3-file run PARKED at `peak window 236%` (`projectedTokens 944,000 / 400,000`) while its TRUE step input was 466k = **116%** of the 400k window. Root cause now pinned exactly: `agent-loop.ts:350-352` feeds `decideContextWindowPacing` `currentInputTokens: spentTokens` (the run's CUMULATIVE token total) AND `estimatedNextStepTokens: recordTokens` (the same just-finished step) → `projectedTokens = spentTokens + estimatedNextStepTokens ≈ 2× recordTokens`. The doubling is the defect; `decideContextWindowPacing` (pure, `pacing.ts:29`) is correct given its inputs, and the DENOMINATOR clause is already done (`resolveContextWindowForSpec` → `lookupContextWindow` keys `gpt-5.5`→400k, `context-window.ts:13`). The OPEN half is the numerator: it should measure the step's LIVE resident orchestration-context occupancy (system prompt + retained `recentSummaries` + next-step allowance), NOT the codex subprocess's cumulative cross-turn throughput. **→ WP-254 is now the next headline (dogfood-064).**
- **F-58 / WP-249 (harvest bypasses `chikory land --verify`) — reinforced.** Delivery is again STAGED (`M` in index) with no `Run-ID:` trailer; it will be harvested via `scripts/harvest.sh` + manual `git commit`, which bypasses the `land --verify` re-gate landed in dogfood-061. F-57's failure mode (a harvest sweeping unrelated broken files past the AC re-gate) stays reachable until the harvest adopts the re-gate (track-B).

## Anomaly hunt (checklist walked)

- **Wasted/filler steps:** none — 1 step, no empty diff, no "already done" probe step (F-11 did not recur).
- **Cost telemetry:** $0.6328 step + $0.0084 judge = $0.6412 exact; nonzero, model present in `pricing.ts`; budget gate live (12.8% of $5).
- **Token economics:** 466k in / 5.0k out for a 6,060-byte 3-file diff. Higher than dogfood-062 (319k) and dogfood-058 (355k) for a comparably-sized pure slice — a context-bloat baseline data point for WP-203/207. 20 tool calls.
- **Judge behavior:** both judge-executed checks exited 0 (AC-1 scoped vitest + grep, AC-2 tsc/eslint/full suite); 4/4 rubric criteria pass with sane rationales; verdict PROCEED 2/2; family diversity real (`gemini-3.1-pro-preview` ≠ executor `gpt-5.5`/openai). No ESCALATE/ROLLBACK.
- **Human ceremony:** standard zero-secrets launch (cli-judge-proxy shim + single `chikory run`). No mid-run intervention.
- **Loop integrity:** 1 checkpoint (`…@4`, `caff354db9f7`, `lastGood true`), no resume, no duplicate journal entries, no re-executed steps.

## Verdict on the thesis

🟢 **Agent-as-a-Judge held; durable execution held; the pure scoring-modes pillar is complete.** A structurally-different judge family (`gemini-3.1-pro-preview`) executed the acceptance checks itself and graded a clean clone PROCEED — and independent re-verification against the working tree agrees (515 passed). The run is another clean one-shot pure primitive, which is itself the signal: **the pure-first dogfood surface across the judge scoring/scanning + memory-pointer pillars is now largely exhausted.** The single most-evidenced open friction — the F-56/WP-254 pacing numerator over-read this run reinforced for the ~10th time — is the strongest UNBLOCKED real-product thesis slice left and is cleanly pure-sliceable. dogfood-064 takes it.
