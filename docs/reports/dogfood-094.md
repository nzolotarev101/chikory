# dogfood-094 — P2 exit-gate REHEARSAL (reactive-signals greenfield build) — **delivery SUCCESS, but the rehearsal MISSED both target axes**.

- **Vibe check (plain):** Chikory autonomously built a real, correct fine-grained reactive-signals library from scratch (11 increments, 21 tests, all green) — a clean SUCCESS as a *build*. But the run was supposed to REHEARSE the two riskiest 24h behaviors — folding history under **live pacing pressure**, and surviving a **mid-run kill→resume** — and it did **neither**. The pacing window was sized too big for this small greenfield workload, so token pressure never crossed the compact band; the 3 folds that happened were the ordinary count-trigger, not pacing. And the kill→resume drill never fired. Net: a good library, a failed rehearsal — both axes need a re-attempt with a correctly-sized window and a *scripted* kill.
- **Bottom line:** delivery 🟢, Thesis-KPI 🔴 (0/2 axes). Does **not** de-risk the 24h exit-gate run yet.

## Run at a glance — `run-b319713b-efaf-4a4b-bb3e-c409ea285ae8`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 11 steps · **$1.95 / $40** · 13m 10s |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓) |
| Spec | `examples/dogfood/dogfood-094-p2exit-rehearsal-signals-greenfield.yaml` (LOOSE, greenfield, `min_durable_steps: 10`, 11 chunks) · HEAD `da75333` |
| Launch | `CHIKORY_CONTEXT_WINDOW_TOKENS=4000`, `pacing:{mode:auto}`, `unattended:{seal_resumable_failed}` |
| **Pacing** | `peak window 65% (compact 0 · park 0)` — **all 11 events `continue`** (util 0.40→0.65, never near the 0.80 compact band) |
| **Compaction** | `compactions 3 (pacing 0)` — folds at steps 9/10/11 were **`trigger:"count"`** (foldedCount 4/5/6), NOT pacing |
| **Resume** | **0** — the mid-run kill→resume drill never fired |
| Delivery | `src/index.js` + 8 `test/*.test.js`, **21/21 node --test green** in the workspace; 6 primitives present |

## Trace

```
run run-b319713b · SUCCESS · 11 steps · $1.97 / $40.00 · 13m 10s · executor codex(openai) · judge openai-compat
 #  step (chunk)                    tokens(in/out)  cost    diff   verdict            pacing
 1  Part 1 createSignal             106k/2.0k       $0.15   1599B  ✓ PROCEED (1/3)    continue 40%
 2  Part 2 createEffect             98k/2.6k        $0.15   2343B  ✓ PROCEED (1/3)    continue 48%
 3  Part 3 createMemo               93k/1.9k        $0.14          ✓ PROCEED (2/3)    continue 52%
 4  Part 4 batch                    120k/2.5k       $0.18          ✓ PROCEED (3/3)    continue 58%
 5  Part 5 diamond + untrack        153k/4.2k       $0.23          ✓ PROCEED (3/3)    continue 65%
 6  Part 6 untrack (ALREADY DONE)   71k/1.2k        $0.10   0B     ✓ PROCEED (3/3)    continue 60%   ← wasted step
 7  Part 7 onCleanup                128k/3.2k       $0.19          ✓ PROCEED (3/3)    continue 61%
 8  Part 8 dispose                  123k/1.8k       $0.17          ✓ PROCEED (3/3)    continue 59%
 9  Part 9 nested ownership         109k/3.0k       $0.17          ✓ PROCEED (3/3)    continue 61%   → compaction (count) 736→376
10  Part 10 equals/dedup            156k/2.6k       $0.22          ✓ PROCEED (3/3)    continue 57%   → compaction (count) 898→464
11  Part 11 README + regression     122k/2.3k       $0.18          ✓ PROCEED (3/3)    continue 57%   → compaction (count) 997→555
totals: decisions 11 · judge passes 11 ($0.08, 4.0%) · rollbacks 0 · escalations 0 · checkpoints 11
        pacing events 11 · peak window 65% (compact 0 · park 0) · compactions 3 (pacing 0) · evicted 2 · exact cost $1.9498
```

## Delivery quality (human review)

- **Correct + complete.** A real reactive-signals core: `createSignal` (with `equals`), `createEffect` (auto-tracking observer stack), `createMemo`, `batch` (deduped scheduler), a **glitch-free diamond** (depth-ordered flush), `untrack`, `onCleanup`, idempotent `dispose`, and nested-effect ownership disposal. 21 `node:test` cases across 8 files, **all green** (verified in the run workspace: `# pass 21 # fail 0`). 6 public primitives present. Pure ESM, zero deps.
- **Not harvested** (greenfield delivery lives in the run workspace `.chikory/runs/…/workspace`; `.chikory-examples/signals-lab` seed is unchanged — expected for a greenfield run).
- **Pack §3 caveat:** the evidence pack re-ran the run's own ACs against the **chikory repo root**, so AC-1 (`node --test`) shows 116 fails — that's chikory's *vitest* suite under node's runner, a cwd artifact, NOT the delivery. Scoped to the workspace, the suite is 21/21. AC-2/AC-3 pass; the real delivery is sound.

## Thesis-KPI verdict — 🔴 both axes missed

| target axis (why the rehearsal existed) | result | why |
|---|---|---|
| **Fold under LIVE pacing pressure** | ❌ | Window `4000` was too big for this greenfield's small assembled context (projected 1.6k–2.6k = 40–65%). Pacing never crossed the 0.80 compact band → 0 `compact` decisions. The 3 folds were `trigger:"count"` (the ordinary >`triggerAfterSteps`=8 fold), not pacing. |
| **Mid-run kill→resume** | ❌ | 0 resume events. The drill was a *manual* action on a 13-minute run; it was never performed (nothing to catch, or the run finished first). |

**What it DID prove (secondary):** an 11-step non-hollow horizon, count-triggered compaction firing live (steps 9/10/11 once resident summaries crossed 8), 100% per-step reliability, family-diverse judging, unattended SUCCESS. Useful, but not what the run was for.

## New friction

**F-125 (🔴→WP) — seam-window sizing is workload-dependent with NO calibration; a static author guess mis-fired a 4th distinct way.** The live-fold saga is now four sizing failures: 053 overshoot→park, 091 undershoot→no-compact, 092 too-short→no-fold, **094 too-big→count-only-fold**. Here I extrapolated `4000` from dogfood-093's chikory-SDK build, but a greenfield signals-lib build carries ~half the per-step assembled context (proj ~2.4k vs 093's ~3.4k), so pacing stalled at ≤65%. **Evidence:** all 11 pacing events `continue`, util 0.40–0.65, `compact 0`. **WP it spawns:** a pre-flight window auto-calibration — dry-measure step-1 assembled-context tokens (or read the first pacing entry's `projectedTokens`) and set/adjust the window RELATIVE to it (e.g. `0.6× projected`), or at minimum echo the first pacing utilization at launch with an abort-and-resize hint. The 24h exit-gate run **cannot** rely on a hand-guessed window.

**F-126 (🟡 track-B) — stale-spec precheck false-positive.** Launch printed `WARNING: stale spec: target WP-270 already done (🟢)`. The spec targets no WP-270 — `extractTargetWpId` grabbed the `F-100/WP-270` *concept reference* in the goal preamble ("the non-hollow horizon"). A recurrence of the WP-260-class mis-target (a goal that name-drops a done WP as context). Harmless here (warning only), but the gate mis-fires. Folds into WP-260/WP-256.

**F-127 (🟡→WP) — the kill→resume drill relies on a human racing a fast run; no deterministic mid-run kill seam.** The resume axis went unexercised because catching a 13-minute run mid-step by hand is impractical. **WP it spawns:** a deterministic `debug.killAtStep` (or `CHIKORY_KILL_AT_STEP`) test seam that hard-kills the worker after a named sealed step so `chikory resume` can be driven reproducibly — the same way `debug.seedBadDiff` made the judge-catch reproducible. Alternatively, prove resume via the existing crash-recovery Temporal test rather than a live manual kill.

_Recurrence (not new): wasted step 6_ ($0.10, 0-byte diff) — the executor front-loaded `untrack` into step 5 (which added both the diamond flush AND untrack), so Part 6 had nothing to do (F-8 class). The bounded-work-unit "do not front-load" directive did not bind.

## Verdict on the thesis + the user's caveat

**The user is right: this was not a real long build, and it did not stress the hypothesis.** 11 tiny one-shot increments, 13 minutes, $1.95 — a *library*, not an application built up to a load-bearing feature, and with no real memory pressure it behaved like any ordinary short run. The rehearsal's value turned out to be **negative-space**: it proved that (a) window sizing is too fragile to hand-guess per workload (F-125) and (b) the resume drill must be scripted, not manual (F-127). Both must be fixed before either the rehearsal or the 24h exit-gate run can honestly de-risk pacing-fold + suspend/resume. The signals library is kept in the run workspace as a real artifact; the rehearsal re-attempts with a calibrated window + a deterministic kill seam.
