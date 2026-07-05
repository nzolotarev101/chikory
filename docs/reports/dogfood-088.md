# dogfood-088 — WP-272 (SOAK / IDLE-SURVIVAL MECHANISM via TIME-PACED DURABLE RE-ENTRY), the ⑦ overnight rung's WALL-CLOCK unblock (F-111). The durable re-entry mechanism was BUILT and LIVE-PROVEN in six dependency-ordered durable steps, but the autonomous run SEALED FAILED on a FALSE NEGATIVE — a mis-specified AC-2 (author bug, F-114) tripped the WP-273 chunk-aware Rule-3 HALT at the final chunk, and one redundant wall-clock assertion in the executor's own no-soak test (F-115) false-fails on a slower host. The delivery was HAND-HARVESTED + HAND-FIXED (TASK-PROTOCOL §4) and re-verified green; WP-272 lands, but NOT via a clean autonomous SUCCESS (the run's rung stays 3).

- **WP:** WP-272 — soak / idle-survival mechanism (durable-execution pillar, the ⑦ overnight rung's wall-clock prerequisite, F-111). A real open plan.md §6 product WP. The WP-271 `unattended` policy is REUSED as the operator-free vehicle (§1.2).
- **Date:** 2026-07-05
- **Spec:** `examples/dogfood/dogfood-088-wp272-soak-durable-reentry.yaml` (LOOSE — outcome-shaped goal, six dependency-ordered PARTs; design direction hand-chosen: time-paced durable re-entry on a durable Temporal timer). Ladder-rung 4 (the wall-clock MECHANISM — the ⑦ enabler, analog of WP-269 for rung 3).
- **Run-id:** `run-eeb0d5d7-9334-47f4-b9ba-c9cb114f14a9` (FAILED · 6 steps — false-negative; delivery hand-harvested to the working tree)
- **Landed:** un-harvested by the loop (FAILED terminal); HAND-HARVESTED to the working tree + hand-fixed (F-115), re-verified green. Uncommitted, pending review.
- **Mode:** `chikory run` (single durable run, UNATTENDED — `unattended:{escalation:seal_resumable_failed}`). A Rule-3 **HALT** (not an ESCALATE) sealed FAILED directly — the unattended policy governs ESCALATE, not HALT.

## Trace

```
run run-eeb0d5d7-9334-47f4-b9ba-c9cb114f14a9 · FAILED · 6 steps · $9.10 / $80.00 · 28m 28s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                         tokens(in/out)  cost      verdict
 1   PART 1 pure decideSoakDelay          1291k/7.9k      $1.69     ✓ PROCEED (2/4)   AC-2/AC-3 fail = PART-3/PART-6 not yet landed, BY DESIGN
 2   PART 2 soak spec-input contract      690k/7.9k       $0.94     ✓ PROCEED (2/4)   TS + Python parity + fixture
 3   PART 3 wire durable sleep re-entry   1662k/9.8k      $2.18     ✓ PROCEED (3/4)   AC-3 green; AC-2 STILL 'fails' (see F-114 — token, not wiring)
 4   PART 4 soak telemetry                580k/4.3k       $0.77     ✓ PROCEED (3/4)   AC-2 suppressed (non-final chunk, WP-273)
 5   PART 5 crash-during-soak resume      1509k/9.7k      $1.98     ✓ PROCEED (3/4)   AC-2 suppressed (non-final chunk, WP-273)
 6   PART 6 live proof                    1122k/7.3k      $1.48     ⛔ HALT            AC-2 3-consecutive → HALT (FINAL chunk, Rule 3 active)
 totals: decisions 6 · judge passes 6 ($0.06, 0.7%) · rollbacks 0 · escalations 0 · checkpoints 6 · peak window 1%
 failed: judge HALT: criterion AC-2 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)
```

- **WP-273 behaved CORRECTLY (this is a validation, not a regression):** the chunk-aware Rule-3 guard suppressed the consecutive-fail HALT on steps 3/4/5 (non-final chunks, AC-2 legitimately unmet by the token grep) and let Rule 3 fire only at step 6 (the final chunk, all 6 consumed). Had WP-273 NOT been in HEAD, the HALT would have fired at step 5. The HALT is honest **given** the AC — the AC is what is wrong.
- **Loop integrity 🟢:** 6 distinct checkpoints, `lastGood` through @24, 0 rollbacks, 0 escalations, 0 resumes. No hollow/probe step.

## Root cause — two independent FALSE NEGATIVES

| # | Defect | Owner | Evidence |
|---|---|---|---|
| **F-114** | **AC-2 mis-specified (type-name AC).** The check required the literal token `SoakPolicy` in `agent-loop.ts`: `grep -rq 'SoakPolicy' src/workflow/agent-loop.ts`. But a correct ADDITIVE wire — `import { decideSoakDelay } from "./soak.js"` (`:68`) + `decideSoakDelay({…}, spec.soak)` (`:277`) — never has to write the TYPE name; `spec.soak` already carries the type. So AC-2 false-failed every step, and Rule 3 HALTed at the final chunk. | Me (spec author) | `grep SoakPolicy agent-loop.ts` = 0; `decideSoakDelay` = 2, `spec.soak` present. An F-90/F-97 cousin. |
| **F-115** | **Flaky wall-clock assertion in the delivery.** The executor's no-soak companion test proved "no timer inserted" with `expect(Date.now() - startedAt).toBeLessThan(1_000)` (`soak-live.test.ts:249`). This false-fails on a slower/loaded host (observed **1898ms** in the review re-run) and proves nothing the structural asserts don't — the same test already asserts NO `SUSPENDED` status and ZERO soak `control_event` entries. | Executor (delivery) | The one red test in a clean-machine full-suite run (106 passed \| 1 failed → after fix 107 passed). |

## Hand-fix applied (TASK-PROTOCOL §4)

1. **F-114 (spec):** `dogfood-088-...yaml` AC-2 re-keyed on the WIRING symbols a correct additive wire emits — `decideSoakDelay` (net-new, F-90-safe) **AND** `spec.soak` (the consumed field) in `agent-loop.ts` — dropping the `SoakPolicy` type-name token. F-114-SAFE note added inline.
2. **F-115 (delivery):** removed the `Date.now() - startedAt < 1000` bound (and the now-unused `startedAt`) from `soak-live.test.ts`; left a comment that the no-timer guarantee is proven STRUCTURALLY (no `SUSPENDED`, zero soak `control_event`).

## Delivery quality (human review, harvested working tree) — 🟢 COMPLETE, additive, contract-safe

All 6 PARTs landed. Reviewed against the goal.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — PURE `decideSoakDelay` + `SoakPolicy`** | `src/workflow/soak.ts`: `decideSoakDelay(state, policy?): { sleepMs } \| null` — pure/total, `Number.isFinite` guards, no-policy null, `sleepMs<=0`/`maxReentries<=0` null, `completedReentries >= maxReentries` null, `maxTotalSleepMs` bound null. `SoakState` accumulators. Re-exported from `index.ts`. Unit-tested. | 🟢 |
| **2 — ADDITIVE `soak` SPEC CONTRACT** | `SoakPolicy` on `types.ts` (`TaskSpec.soak?`) + zod `SoakPolicySchema` (`schemas.ts`, registered) + raw-YAML `soak` (`taskspec.ts`) + Python pydantic parity (`types.py` + `__init__.py` + `test_contracts.py`) + shared `fixtures/contracts/SoakPolicy.valid.json`. Additive optional. | 🟢 |
| **3 — WIRE DURABLE RE-ENTRY** | `agent-loop.ts`: imports `sleep` from `@temporalio/workflow` (`:68`-region), `soakBeforeNextStep()` runs `decideSoakDelay({completedReentries, totalSleptMs}, spec.soak)` → `status="SUSPENDED"` → **durable `sleep(sleepMs)`** (replay-safe Temporal timer, NOT `setTimeout`) → journals a `control_event` `source:"soak"`/`event:"resume"` (additive). No policy → no timer, byte-equivalent. | 🟢 |
| **4 — SOAK TELEMETRY** | `trace.ts`: appends `re-entries N · soak-slept <duration>` to the totals sub-line only when soak `control_event`s exist; no-soak sub-line pinned byte-equivalent (`trace.test.ts`). | 🟢 |
| **5 — CRASH-DURING-SOAK RESUME** | `activities.ts` restore returns `soakState` + (bonus) `consumedWorkChunks`; `agent-loop.ts` rehydrates both before the loop resumes → a restored post-soak run does not replay chunk 0. Regression test in `soak.test.ts`. _(NB: incidentally addresses the latent F-108 `consumedWorkChunks`-not-restored gap.)_ | 🟢 |
| **6 — LIVE PROOF** | `soak-live.test.ts` (co-refs `decideSoakDelay` + `createRunnerWorker`, F-97-safe): a compressed `soak` run durably sleeps between chunks — asserts `SUSPENDED` during the timer, the ~1s durable timer actually elapsed (`>=950ms`), the soak re-entry counter, final `SUCCESS`, never `AWAITING_APPROVAL`, and rendered `re-entries 1 · soak-slept 1s`; PLUS the no-soak no-timer companion (structural, post-F-115-fix). | 🟢 |

- **Frozen contracts held:** `decideSoakDelay` is a NEW pure symbol; `SoakPolicy` is a NEW additive-OPTIONAL `TaskSpec` field; the soak `control_event` + telemetry are ADDITIVE OPTIONAL (reuses the `control_event` journal kind — no new REQUIRED field). No shape change to `StepRecord`/`JournalEntry`/`Checkpoint`/`ContextBundle`/`ArtifactRef`/`RunStatus`. No new dependency (`sleep` is from the pinned `@temporalio/workflow`). Determinism rule honored — the durable sleep is a Temporal timer, never a host busy-wait.

## Independent verify — post-hand-fix

- **All 4 ACs (fixed AC-2) PASS** against the working tree.
- **AC-4 full suite green:** `tsc --noEmit` + `eslint .` clean; `vitest run` → **744 passed / 19 skipped, 107 files** (the previously-red `soak-live` no-soak test now passes). Python `test_contracts.py` → **52 passed**.
- Scope: 16 files (12 modified additively + 4 new: `soak.ts`, `soak.test.ts`, `soak-live.test.ts`, `SoakPolicy.valid.json`). Python parity present. All entailed by the goal.

## New friction

Highest prior = **F-113**. Continue at F-114.

### ⚠️ F-114 → WP-266/511 loose-AC lint (NEW, spec-authoring, the run-killer): a "type-name AC" false-fails a correct additive wire
- **Evidence:** AC-2 grepped `agent-loop.ts` for the TYPE token `SoakPolicy`; the correct wire `decideSoakDelay(spec.soak)` never emits it. The autonomous run FAILED on a defect in MY spec, not the delivery.
- **Impact:** a whole ~$9.10 / 28-min run false-FAILed; WP-272 landed only by hand. This is the F-90 (recursive-grep false-GREEN) / F-97 (bare-symbol false-GREEN) family's inverse — a **false-RED**: an AC that pins a token a correct implementation is free NOT to write.
- **WP it spawns:** fold into the WP-266/511 loose-AC lint (`scripts/dogfood-progression.sh --spec`): flag an AC grep that targets a bare TYPE/interface name (vs a value/function symbol or a consumed field). Rule of thumb now recorded: **AC greps key on function symbols + consumed fields (`decideX`, `spec.x`), never on a type name a call site doesn't have to spell.**

### 🟡 F-115 → track-B (NEW, delivery, timing-flake): a wall-clock upper-bound assertion proves a structural fact fragilely
- **Evidence:** `soak-live.test.ts:249` bounded a no-soak run's wall-clock at `<1000ms` to prove "no timer"; it hit 1898ms on the review host. The structural facts (no `SUSPENDED`, zero soak `control_event`) already prove it.
- **Impact:** one red test on a slower/loaded machine — an F-109-class flake. Hand-fixed this cycle (bound removed, structural asserts kept).
- **WP it spawns:** none beyond the hand-fix; a lint/convention note — **never assert a WALL-CLOCK duration to prove a STRUCTURAL absence**; assert the structure.

### Still-open carry-forward
- 🟡 **F-108** — the crash-during-soak PART incidentally restores `consumedWorkChunks` on resume, which is the F-108 fix surface. Confirm on the WP-206 resume path whether F-108 can now be closed (out of scope for this review; flag for the next resume-touching run).

## Verdict on the thesis

🟡🟢 **Mechanism strong; the autonomous loop mis-certified.** WP-272 — the ⑦ overnight rung's wall-clock unblock — is genuinely built: a durable Temporal-timer re-entry that durably suspends between steps and resumes across real wall-clock time, live-proven (`re-entries 1 · soak-slept 1s`, `>=950ms` elapsed), additive, contract-safe, cross-language. The thesis mechanism (durable execution surviving idle/suspend over real time) is now in the substrate. **But the run itself is the review's sharpest finding: a mis-specified AC (F-114) — mine — false-FAILed a complete, green delivery, and WP-273's chunk-aware HALT correctly enforced my bad AC to a FAILED seal.** The autonomous loop did NOT self-certify rung 4; the mechanism landed by hand-fix. Net: WP-272 → 🟢 (hand-landed), the ⑦ ACTUAL long-horizon soak run is now UNBLOCKED (dogfood-089), and the loose-AC lint (WP-266/511) gains a concrete new rule (no type-name ACs).

## KPI table (DOGFOODING §1.4)

| KPI | 088 | Trailing-3 (086/087/088) | Gate |
|---|---|---|---|
| Max horizon survived | 6 steps / 28m28s | 6 steps | ⑧ P2-exit = 24h+ (far) |
| Kill→resume count | 0 | 0 | resume proven earlier |
| Judge true-positives pre-land | 0 (the one HALT was a FALSE positive off a bad AC) | 0 | opportunistic |
| Meta:product headline ratio | product | **0:3** | ≤1:3 ✅ |
| Per-step reliability (runs ≥5 steps) | 5/6 steps PROCEED; sealed FAILED on a false-AC | — | 99%+ (this run does not certify) |
| Ladder rung | **3** (run false-FAILed; rung-4 mechanism landed by HAND-FIX, not autonomous) | 3 → 3 → 3 (⛔ STALLED persists) | P2 exit = ⑧ 24h+ |

**Glossary:** WP = Work Package · AC = Acceptance Criterion (grep/exit-code check the judge runs) · Rule 3 = the deterministic "criterion failed 3+ consecutive verdicts → HALT" guard · rung = WP-265 horizon-ladder step (⑦ = overnight) · false-negative = a correct delivery a bad check marks failing · soak = a durable idle/re-entry interval that produces real wall-clock time.
