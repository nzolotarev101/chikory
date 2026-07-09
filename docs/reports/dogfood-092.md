# dogfood-092 — WP-251 (observe a live pacing-driven compaction fold) re-run, the ⑧ P2-exit context-rot axis. The product delivery was **correct, complete, and SUCCESS-sealed** (4 bounded parts, full SDK suite green, harvested clean), and the two dogfood-091 launch bugs (F-119 unsatisfiable AC, F-120/F-121 wrong window denominator) are **both cured** — the window was finally sized right (`peak window 115% · compact 4`). **But the real run STILL did not fold** (`pressure-steps 4 (unfolded 4)` · 0 compaction entries): 4 pacing decisions said "compact", zero produced an actual fold. Root cause is NEW and distinct from 053/091 — the run was only 4 steps long, and `planCompaction` needs **>5 resident summaries** to fold, so history never crossed the fold threshold. WP-251 stays un-live-proven for the THIRD time (053 over-park → 091 under-window → 092 too-short).

- **Vibe check (plain):** We built the right thing and it works — a real run under real memory pressure, correctly measured this time. But the run finished its 4-part task so fast that there was never enough history piled up to actually trigger a "fold" (summarize-and-drop-old-context). The pacing gate kept shouting "compact!" but the compactor had nothing old enough to compact. Fix next time: give the run a longer to-do list (≥6 steps) so history builds past the fold threshold. Window sizing — the thing we blamed twice before — is now correct and no longer the problem.

- **WP:** WP-251 — observe the compaction-summary telemetry live (context-rot pillar; CLAUDE.md "context rot … first-class mitigation required"; REQUIREMENTS FA-3/SE-2). A real open plan.md §6 product WP. The net-new `describeCompactionPressure` (pressure-join reducer) + its `chikory trace` render is the LANDED PRODUCT DIFF; the `debug.contextWindowTokens` compact-band seam is the RUN VEHICLE.
- **Date:** 2026-07-09
- **Spec:** `examples/dogfood/dogfood-092-wp251-live-compaction-pressure-rerun.yaml` (LOOSE — outcome goal, four dependency-ordered PARTs; module/test layout left to the executor). Ladder-rung 4. Thesis-KPI: CONTEXT-ROT MITIGATION OBSERVED LIVE.
- **Run-id:** `run-4481c735-d3b2-4885-b755-d2ad2c73a551` (**SUCCESS** · 4 steps · $2.93 / $80.00 · 9m 46s)
- **Landed:** **uncommitted on the working tree** (6 files staged, byte-identical to the run workspace — pack §5 all `IDENTICAL`). HEAD = `1729b5e`. No harvest commit; delivery awaits the user's review.
- **Mode:** `chikory run` (single durable run, UNATTENDED — `unattended:{escalation:seal_resumable_failed}`), `pacing:{mode:auto}`, launched with `CHIKORY_CONTEXT_WINDOW_TOKENS=2000` (F-120-corrected assembled-context scale; F-121 launch guard confirmed the seam reached the workflow — first pacing entry `remaining 227 + projected 1773 = 2000` ✓).
- **Executor:** codex(openai) · **Judge:** openai-compat/gemini-3.1-pro-preview (family-diverse ✓).

## Trace

```
run run-4481c735-d3b2-4885-b755-d2ad2c73a551 · SUCCESS · 4 steps · $2.93 / $80.00 · 9m 46s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                          tokens(in/out)  cost     diff    verdict
 1   PART 1 pure describeCompactionPress…  588k/3.6k       $0.77    3704B   ✓ PROCEED (3/4)   AC-3 unmet BY DESIGN (part 3 test not yet landed)
 2   PART 2 wire join into chikory trace   576k/3.2k       $0.75    4050B   ✓ PROCEED (3/4)   AC-3 still unmet by design
 3   PART 3 live Temporal pressure-fold    931k/3.7k       $1.20    3752B   ✓ PROCEED (4/4)   all ACs green
 4   PART 4 full-suite regression          127k/1.3k       $0.17    0B      ✓ PROCEED (4/4)   empty verify-only diff, no HALT (F-118/WP-268 root-span fix held)
totals: decisions 4 · judge passes 4 ($0.03, 1.2%) · rollbacks 0 · escalations 0
        pacing events 4 · peak window 115% (compact 4 · park 0) · pressure-steps 4 (unfolded 4) · feedback 1/1 steps
        checkpoint chain @4→@9→@14→@19 · commits 440eabb→941c1ee→62c2eb0→56066d1 · exact cost sum $2.9283
```

### Pacing / compaction journal (ground truth — the finding)

| pacing idx | atStep | action | projectedTokens | remainingTokens | utilization |
|---|---|---|---|---|---|
| 0 | 0 | compact | 1773 | 227 | 88.7% |
| 1 | 1 | compact | 1926 | 74 | 96.3% |
| 2 | 2 | compact | 2205 | -205 | 110.3% |
| 3 | 3 | compact | 2292 | -292 | 114.6% |

- **compaction entries: `0`.** Four `compact` pacing decisions, **zero folds**. `describeCompactionPressure` renders this exactly: `pressure-steps 4 (unfolded 4)` — the WP-251 payoff (a "pressure fired but folded nothing" run is now DISTINGUISHABLE from a no-pressure run, which was the dogfood-053 blind spot).

## Delivery quality (human review, post-landing)

**Correct, complete, in scope, SUCCESS-sealed.** Line-by-line against the goal's four PARTs:

| PART | Deliverable | Landed | Verdict |
|---|---|---|---|
| 1 | pure `describeCompactionPressure(entries)` join reducer | `src/runner/compaction-pressure.ts` (33 LOC), barrel re-export `src/index.ts:180`; unit test `test/runner/compaction-pressure.test.ts` (mixed fixture + all-zero) | 🟢 |
| 2 | render the join in `chikory trace` | `src/cli/trace.ts:227` consume, `:272-275` additive `· pressure-steps K (unfolded U)`, guarded `> 0` so a no-fold run renders byte-equivalent | 🟢 |
| 3 | LIVE Temporal pressure-fold proof | `test/runner/compaction-wiring.test.ts` — real worker (`createRunnerWorker`), `pacing:{mode:auto}` + `debug.contextWindowTokens:40` in compact band, asserts SUCCESS + `digestHits>0` + `describeCompactionPressure(...).pacingFolds ≥ 1` (F-97 co-reference ✓) | 🟢 |
| 4 | full-suite regression | `tsc --noEmit && eslint . && vitest run` — **781 passed / 19 skipped / 111 files**; no frozen-contract shape change | 🟢 |

- **Reducer is genuinely pure** — reads `pacing` + `compaction` journal kinds from one list, no wall-clock, no ambient state. `unfoldedPressureSteps = max(pressureSteps − pacingFolds, 0)`.
- **Scope discipline clean** — only 6 files touched (2 new, 4 modified), all named/entailed by the goal; no new dependency; no decision relocated out of the workflow/activities gate.
- **Independent re-verify (pack §3):** all 4 ACs PASS against the working tree; pack §5 byte-diff all `IDENTICAL` — harvest did not diverge.
- **The Part-3 deterministic proof PASSED** — so the mechanism (pacing "compact" → real digest fold → `pacingFolds ≥ 1`) IS proven end-to-end, independent of real codex token counts. The gap is exclusively the **real-codex headline run**, which is what the thesis-KPI demanded.

## New friction

**F-122 — a correctly-sized compact window still folds NOTHING on a run too short to accumulate `> keepLastN` summaries (the THIRD distinct live-fold miss; the ⑧ P2-exit axis stays un-proven).**
- **Evidence:** `run-4481c735` journal — 4 `pacing action:"compact"` decisions (utilization 88.7%→114.6%, `peak window 115%`), **0 `compaction` entries**. `describeCompactionPressure` → `pressure-steps 4 (unfolded 4)`.
- **Root cause (verified in code):** `planCompaction` (`src/runner/compaction.ts:22`) returns a no-fold unless `summaries.length > triggerAfterSteps AND > keepLastN`. Under pacing pressure the effective trigger is lowered to `keepLastN` (`activities.ts:1103`), and `DEFAULT_COMPACTION_POLICY.keepLastN = 5` (`activities.ts:74`). The run ran **4 steps** (`min_durable_steps:4`) → ≤4 resident summaries → `4 ≤ 5` → `planCompaction` folds nothing on EVERY compact decision. The compact *decision* and an actual *fold* are two different gates; a short run satisfies the first and never reaches the second.
- **Why this is distinct from 053/091:** dogfood-053 OVERSHOT into PARK (0 folds); dogfood-091 UNDERSHOT the window (1.2M denominator, `peak 1%`, never in compact band, 0 folds). dogfood-092 sized the window **correctly** (`peak 115%`, 4 compact decisions) — proving F-120/F-121 are cured — but under-sized the **horizon**. Re-sizing the env (the spec's pre-authorized remedy) would NOT fix this; the window is right.
- **Spawns WP:** none new — it re-scopes **WP-251**, which stays 🟡 OPEN. The corrective is dogfood-093: same WP, same window (~2000), but decompose the goal into **≥6 bounded parts** (`min_durable_steps: 6-7`) so resident summaries cross `keepLastN=5` and a real `trigger:"pacing"` fold fires by ~step 6 (matches the deterministic test's maxSteps-7 fold-at-step-6 behavior). Horizon length, not window size, is the last knob.

**F-123 — the compact-band window seam has no operator warning when a compact decision folds nothing (silent "pressure fired, nothing to fold").**
- **Evidence:** the run sealed SUCCESS with `unfolded 4` and zero diagnostics; only a hand journal query surfaced that no fold occurred. The new `describeCompactionPressure` render DOES expose `unfolded U`, but nothing flags `unfolded == pressureSteps AND pacingFolds == 0` as the "sized-window-but-too-short" condition.
- **Spawns WP:** track-B note against WP-251 — a one-line trace hint (e.g. `⚠ pressure fired but 0 folds — history below keepLastN`) when `pacingFolds == 0 && pressureSteps > 0`, so the next live-fold attempt fails loudly instead of green-and-silent. Hand-fix candidate; not a headline (not 🔴 loop-integrity).

## Verdict on the thesis

- **Durable execution:** 🟢 4 clean sealed checkpoints (`@4→@9→@14→@19`), lastGood every step, harvest byte-identical.
- **Agent-as-a-Judge, family diversity:** 🟢 openai-compat/gemini judge ≠ codex/openai executor; judge-executed checks ran (AC-1…AC-4 each pass), rubric sane; no false HALT this time (F-118/WP-268 terminal-root-span fix held on the part-4 empty verify diff — the exact failure mode that killed 091).
- **Context-rot mitigation (the headline):** 🟡 the PRODUCT increment landed and the mechanism is deterministically proven, but the LIVE observation — the thesis-KPI — missed a THIRD time. The ⑧ P2-exit axis remains the single un-live-proven pillar. The `describeCompactionPressure` reducer is what made the miss legible, which is exactly the observability the WP exists to provide.
- **Net:** a SUCCESS run that delivered real product AND precisely diagnosed why the live fold keeps not firing. The knob is now known (horizon ≥6 steps). dogfood-093 is the 4th, best-armed attempt.
