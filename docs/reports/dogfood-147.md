# dogfood-147 — a short run under real memory pressure can finally shrink what it's carrying (WP-594)

**WP:** WP-594 (pressure-triggered compaction must fold below the default keep-last-5 floor) ·
**Date:** 2026-08-16 ·
**Spec:** `examples/dogfood/dogfood-147-wp594-pressure-compaction-floor.yaml` ·
**Run:** `run-a26d41eb-0d41-466a-9614-41b6dd8246c0` · **Landed:** this review's commit ·
**Ladder:** off-ladder (rung 0) — P3's exit gate (rung-5, WP-530 §7) still needs an operator-run
benchmark suite; not agent-runnable, see `## NEXT RUN`

## Plain lead

Before this run, a SHORT run under sustained memory pressure had no working safety valve: the
system correctly noticed the pressure but its only response — shrinking what it remembers —
silently did nothing until a run had racked up more history than it usually has time to. Now the
pressure path folds down to keeping just the latest step verbatim, so a short run under real
pressure actually shrinks instead of sailing past its budget unprotected. The run took 2 steps: the
first missed the delivery's own test-coverage floor by one test, the second added it — a real,
non-wasted self-correction, not friction.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 2 steps · 7m 2s |
| cost | **$0.1229** of $20 budget (**0.6%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — $0.0000/step, known cost-meter-blind (WP-592, F-268, unrelated to this WP) |
| judge | `openai-compat` · 3 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 3/3 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.0k/1.4k | $0.0000 | 2m 2s | ✓ PROCEED (1/2 criteria) |
| 2 | 5.9k/1.5k | $0.0000 | 1m 1s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (3, harvest byte-**IDENTICAL** to the run workspace):

| file | change |
|---|---|
| `packages/sdk-ts/src/runner/activities.ts` | `compactContext`'s `underPressure` branch now builds `{ triggerAfterSteps: 1, keepLastN: 1 }` instead of reusing `DEFAULT_COMPACTION_POLICY.keepLastN` (5) for both fields (`:2284-2289`) |
| `packages/sdk-ts/test/runner/compaction-wiring.test.ts` | +1 live Temporal integration test: a 4-step sustained-pressure run folds below the old floor, existing 2 tests untouched (0 deletions) |
| `packages/sdk-ts/test/runner/compaction.test.ts` | +5 unit tests on `planCompaction`: 3 on the new pressure floor (keepLastN 1, at 1/2/3 summaries), 2 on the **unpressured** count-cadence path (7 steps no-fold, 9 steps folds oldest 4) — coverage AC-1 does not exercise, exactly what the goal asked for |

**Goal, line by line:** every constraint held. `DEFAULT_COMPACTION_POLICY` byte-unchanged
(`triggerAfterSteps: 8, keepLastN: 5`, `activities.ts:133-136`) · `planCompaction` untouched ·
`DEFAULT_PACING_POLICY.compactAtFraction` byte-unchanged (`agent-loop.ts:107`) · the fold never
empties `keepVerbatim` (floor chosen = 1, not 0) · the step summary defends the choice ("keeps the
single most-recent step summary verbatim to prevent immediate context amnesia") · workflow/activity
determinism split respected (the policy branch lives in `activities.ts`, not `agent-loop.ts`).

**Five designed traps, all rejected** (verified independently, not taken on the judge's word):
(A) widen the window instead — rejected, `compactAtFraction` unchanged and AC-1 measured 3/4
pacing decisions still `compact`; (B) lower the global default — rejected, `grep` on the two
constants above; (C) fold to `keepLastN: 0` — rejected, floor is 1 with a stated reason; (D) escalate
to a park instead of folding — rejected, run reached SUCCESS via a real `compaction` journal row,
not a park; (E) fix `compaction.ts`'s guard instead of the pressure policy — rejected, `compaction.ts`
has zero diff lines this run.

**Independent verification beyond what the ACs took on trust:** re-ran `git diff --cached` myself
(not the judge's evidence blob) and counted 1 non-header deletion line across both test files —
i.e. genuinely zero deletions, confirming "existing tests stay green unmodified" by inspection, not
by AC-2's vitest exit code alone.

**Scope discipline:** `git status --short` shows exactly the 3 files above — nothing in
`pacing.ts`, `compaction.ts`, or `verdict.ts` (the NOT-IN-SCOPE list) was touched.

**Step 1 → step 2 is a genuine self-correction, not filler:** step 1 landed the fix and 2 of the 3
new unit tests (390 committed `test/runner/` tests vs. the 391 durability floor); AC-2's own
message named the shortfall (`committed test/runner tests: 390 (floor 391, measured baseline
388)`) and step 2 added the 2 missing unpressured-path tests to close it (394 final). Judge
correctly PROCEED'd both times (no rollback) because nothing was wrong, only incomplete.

## New friction

None. The anomaly-hunt checklist (wasted steps, cost telemetry, token economics, judge behavior,
human ceremony, loop integrity) turned up nothing new this run — see KPI table below for the
standing numbers it does affect.

## Friction disposition

_(none this review)_

## Verdict on the thesis

This is the cleanest live demonstration yet of the durability-floor pattern (WP-623/F-356/F-360):
an AC that only proves behavior through a generated, throwaway check is not pinned at all, so the
spec required a REPO test covering ground the AC doesn't — and the run's own AC-2 mechanically
caught step 1 falling one test short, without any judge model involvement. That is durable
execution + a cheap machine gate doing real work, not the LLM judge.

Separately, this run supplied the **first live datum** for [[standing-findings-append-only]]'s
F-197 caveat, left open since dogfood-146: step 1's `tests_pass` rubric row FAILED
(`justification: "1/2 judge-executed checks failed: AC-2"`), step 2's `tests_pass` PASSED
(`"all 2 judge-executed checks exited 0"`), and judge pass #3 (the completion review, criteria `[]`)
shows **no `tests_pass` row at all** — `isRubricItemSettledAgainstWholeDelivery` correctly pruned
the stale FAIL, live, in production. WP-629's fix works in the wild, not only in its 25 unit/live
tests. F-364/WP-630 (a second, *different* objection on the same rubric id overwriting the first)
was not exercised here — this run only ever had one objection on `tests_pass` — so that residual
stays unproven live and is the natural next headline (see `## NEXT RUN`).

**Standing caution:** none new. The dogfood-146 post-hoc audit's caution about F-197 is now
partially retired by this run's live datum; WP-630's own live-proof is still owed.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window (145–147) |
|---|---|---|
| max horizon survived | 2 steps / 7m 2s | 2 steps (WP-627 2, WP-629 1, WP-594 2) |
| kill → resume count | 0 | 0 |
| judge true-positives pre-land (rollbacks) | 0 | 1 (WP-627 caught 1; WP-629 and WP-594 caught 0) |
| meta:product headline ratio | product | 0/3 harness-meta |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs ≥5 steps — measured at this review's progression-gate read) |
| ladder rung vs exit gate | 0 (off-ladder, by design — see spec header) | P3 exit gate = rung-5 (WP-530 §7), unclimbed; remaining half is an operator-run benchmark suite, not agent-runnable |

## NEXT RUN

**Make it true that the judge cannot lose a second, different objection just because it landed on
the same rubric category as an earlier one.** Today, if the judge raises one design concern, then
later raises a completely different design concern under the same heading, only the second one
survives to the pass that decides the run's fate — the first is gone without a trace.

- **Spec:** `examples/dogfood/dogfood-148-wp630-standing-finding-overwrite.yaml` — advances
  **WP-630** (a second, DIFFERENT objection on the same rubric id must not silently replace the
  first, F-364).
- **Why this and not the ladder rung:** `scripts/dogfood-progression.sh` still reads **⛔ STALLED**
  (no thesis axis moved dogfood-145→147: max steps 2, ladder rung 0, harness-meta 0/3 across the
  trailing window), so the binding rule wants the current phase's ladder rung (P3-rung-5, WP-530
  §7) as the next headline. It cannot run as a dogfood headline — unchanged since dogfood-139: the
  remaining half is WP-304's OpenHands arm plus widening the corpus, a quota-bound multi-hour suite
  the OPERATOR runs by hand (dogfood-122's lesson). Among runnable alternatives (WP-589's write
  boundary, WP-610's machine-settled-override default, WP-616's context-budget regression), WP-630
  wins on signal-to-noise: it sits in the SAME judge machinery this very run (F-197's opening
  datum) just proved correct live, diversifies thesis coverage from context-rot (this run) to
  Agent-as-a-Judge reliability, and directly satisfies its own plan.md condition — "not
  headline-worthy on its own unless it can be seeded into a real run."
- **The designed trap:** a fix that "solves" the overwrite by never clearing anything regresses
  F-361 (WP-629's whole point — a machine-settled row would condemn every later PASS again); the
  narrower trap is coalescing two distinct objections into one combined/garbled string, which can
  pass a shallow "both substrings present" check while still losing one as an independently
  adjudicable finding. AC-1 checks both objections land on **separate** rendered prompt lines, not
  just that both substrings appear somewhere.
- **Gate verdicts:** §0 progression ⛔ STALLED (ladder rung not agent-runnable, exception applied
  and recorded above) · §1.1 failure-surface ✅ (cross-file, judge-catch pillar, real regression
  risk) · §1.2 product-progress ✅ (real open WP-630 row, hosted in `agent-loop.ts`, no invented
  scaffolding) · §1.3 mission-critical ✅ PROCEED (a genuine correctness gap in shipped judge
  code, not busy-work or scaffold-hosted) · §1.5 friction-budget ✅ (class=product, trailing-3
  harness-meta 0/3, cap not busted).
- **AC arming evidence** (`.chikory/review/arm-dogfood-148-wp630-standing-finding-overwrite.json`):

  | AC | RED on HEAD | GREEN vs reference | % of 120s cap |
  |---|---|---|---|
  | AC-1 | ✅ exit 1, 4s | ✅ exit 0, 4s | 3% |
  | AC-2 | ✅ exit 1, 47s | ✅ exit 0, 48s | 40% |

  Worst case 48s = 40% of the judge cap. Both ACs are `VERIFY-SUITE`-classed (real `tsc`/`eslint`/
  `vitest` invocations) and were dry-run by `dogfood-arm.sh`, not hand-simulated. The reference
  fix (`agent-loop.ts`'s map holds a list per rubric id; +1 committed live test proving an
  identical repeat collapses to one line while a distinct one survives, `test/runner/` 394→395)
  was reverted by name after both passes, not discarded.

```sh
devbox run run-dogfood
```
