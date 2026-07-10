# dogfood-095 — P2 exit-gate REHEARSAL, re-run (reactive-signals greenfield build) — **delivery SUCCESS, and BOTH rehearsal axes PASSED**.

- **Vibe check (plain):** Chikory successfully built the correct fine-grained reactive-signals library (11 steps, 20 tests, all green) and successfully validated BOTH Thesis-KPI rehearsal axes:
  - **Pacing under live pressure:** With `pacing.autoCalibrate: true`, the context window was automatically sized based on step-1 tokens. Pacing successfully transitioned into `compact` pressure and triggered **6 compaction folds** under live pacing pressure (rather than count-triggered).
  - **Durable Resume Drill:** The worker exited with code `137` deterministically after step index 6 sealed via `CHIKORY_KILL_AT_STEP=6`. Re-running with `chikory resume` successfully re-entered the workflow and finished steps 8-11 with zero re-execution of completed steps.
- **Bottom line:** delivery 🟢, Thesis-KPI 🟢 (2/2 axes). De-risks the 24h exit-gate run!

## Run at a glance — `run-7746e7fa-b16f-47d0-98c0-f99333ecafc6`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 11 steps · **$1.77 / $40** · 22m 29s |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓) |
| Spec | `examples/dogfood/dogfood-095-p2exit-rehearsal-calibrated-resume.yaml` |
| Launch | `CHIKORY_KILL_AT_STEP=6`, `CHIKORY_ALLOW_STALE_SPEC=1`, `pacing:{mode:auto,autoCalibrate:true}` |
| **Pacing** | `peak window 123% (compact 10 · park 0)` — **10 compact pacing decisions** |
| **Compaction** | `compactions 6 (pacing 6)` — 6 folds were **`trigger:"pacing"`**, none were count-only |
| **Resume** | **1** — worker exited with code 137 after step index 6 sealed; resumed to success |
| Delivery | `src/index.js` + `test/signals.test.js`, **20/20 node --test green** in `.chikory-examples/signals-lab` |

## Trace

```
run run-7746e7fa · SUCCESS · 11 steps · $1.77 / $40.00 · 22m 29s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented Part 1 only. Added `cre… 85k/1.2k         $0.12    ✓ PROCEED (1/3 criteria)
 2   Implemented Part 2 only. Added `cre… 77k/1.5k         $0.11    ✓ PROCEED (1/3 criteria)
 3   Implemented Part 3 only. Added `cre… 79k/1.8k         $0.12    ✓ PROCEED (2/3 criteria)
 4   Implemented Part 4 only. Added `bat… 83k/2.2k         $0.13    ✓ PROCEED (3/3 criteria)
 5   Implemented Part 5 only. Changed [s… 97k/1.9k         $0.14    ✓ PROCEED (3/3 criteria)
 6   Implemented Part 6 only. Added `unt… 104k/1.7k        $0.15    ✓ PROCEED (3/3 criteria)
 7   Implemented Part 7 only. Added `onC… 128k/3.4k        $0.19    ✓ PROCEED (3/3 criteria)
 8   Implemented Part 8 by adding a focu… 102k/1.6k        $0.14    ✓ PROCEED (3/3 criteria)
 9   Implemented Part 9 only. Changed `c… 110k/2.1k        $0.16    ✓ PROCEED (3/3 criteria)
10   Implemented Part 10 only. `createSi… 111k/1.9k        $0.16    ✓ PROCEED (3/3 criteria)
11   Updated [README.md](/Users/nikitazo… 181k/3.6k        $0.26    ✓ PROCEED (3/3 criteria)
totals: decisions 11 · judge passes 11 ($0.07, 4.2%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 11 · pacing events 11 · peak window 123% (compact 10 · park 0) · compactions 6 (pacing 6) · pressure-steps 10 (unfolded 4 · first pacing fold step 5) · feedback frequency 1/1 steps
```

## Delivery quality (human review)

- **Correct + complete.** Built a fine-grained reactive signals core with `createSignal` (with `equals` option), `createEffect`, `createMemo`, `batch`, `untrack`, `onCleanup`, and nested ownership disposal. All 20 tests pass cleanly under Node's test runner.
- **Harvesting.** Since this is a meta-rehearsal run inside `.chikory-examples/signals-lab`, it is kept inside that git-ignored directory and not merged into the host code.

## Thesis-KPI verdict — 🟢 both axes passed

| target axis | result | why |
|---|---|---|
| **Fold under LIVE pacing pressure** | 🟢 | The auto-calibrated window successfully triggered compact pressure once context accumulated, producing 6 pacing compactions. |
| **Mid-run kill→resume** | 🟢 | Deterministic exit code 137 triggered right after step index 6 sealed. `chikory resume` re-entered and completed steps 8-11 with zero re-execution. |

## Verdict on the thesis

The newly-introduced mechanisms (F-125 auto-calibration and F-127 crash seam) are fully validated. The durable execution state machine and the pacing/context-rot mitigation strategy are now proven on a real workload.
