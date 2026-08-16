# dogfood-146 — a cleared judge finding no longer condemns the seal (WP-629)

**WP:** WP-629 (a rubric finding a later judge pass RE-SETTLES against the whole delivery must not condemn the seal) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-146-wp629-cleared-finding-pruning.yaml` ·
**Run:** `run-7ad992b2-77a3-4e5e-bcee-53b519324d56` · **Landed:** this review's commit ·
**Ladder:** off-ladder (rung 0) — P3 exit gate (rung-5, WP-530 §7) still needs `brownfield-001`'s gold-patch lift, operator-by-hand, not agent-runnable

## Plain lead

A run whose acceptance check fails on step 1 and passes on step 2 — the normal
shape of a multi-step delivery — now seals SUCCESS instead of being condemned
by the stale step-1 failure text. `standingFindings` (dogfood-145's F-361) was
an append-only array; it is now a per-rubric-id map that a later whole-delivery
PASS clears, while a model-judged design objection or a free-text concern
still survives every clean pass through to the completion review, exactly as
WP-601/WP-619 require. The run itself landed cleanly in one step with no
findings ever raised, so the new logic is proven by 4 new live tests in the
repo suite, not by this run's own judge behavior (the F-197 pattern).

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 9m 36s |
| cost | **$0.0906** of $20 budget (**0.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠ cost meter blind (0 tool calls, step-1 `$0.0000` estimated on 6,745 metered tokens); this is the documented `gemini-cli` false alarm (DOGFOODING.md:1079), not new friction |
| judge | `openai-compat` · 2 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.3k/2.5k | $0.0000 | 6m 34s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (5, all byte-IDENTICAL harvest vs `.chikory/runs/run-7ad992b2-77a3-4e5e-bcee-53b519324d56/workspace`):

| file | change |
|---|---|
| `packages/sdk-ts/src/workflow/agent-loop.ts` | `standingFindings: string[]` → `standingRubricFindings: Map<string, string>` + `standingConcerns: string[]`, unified `getStandingFindings()` read by both `regressionGateBeforeSuccess` (:413) and the completion-review branch (:1261) |
| `packages/sdk-ts/src/judge/rubric.ts` | new `isRubricItemSettledAgainstWholeDelivery(rubricId, spec)` — `true` only for `tests_pass` when `spec.acceptanceCriteria` declares a non-empty `check` command |
| `packages/sdk-ts/src/judge/index.ts` | re-exports the new predicate |
| `packages/sdk-ts/test/judge/deterministic-rubric-oracle.test.ts` | +3 unit tests: settles `tests_pass` with checks, does not settle without checks, never settles model-judged/diff-scoped ids |
| `packages/sdk-ts/test/runner/standing-findings-settled-live.test.ts` (new, 318 lines) | 4 live Temporal tests: check clears · interleaved check-clears + design-stays · no-check-command stays standing (WP-601 shape) · free-text concern always reaches review |

**Goal line by line** (`examples/dogfood/dogfood-146-wp629-cleared-finding-pruning.yaml:105-165`):
- "A re-settled finding leaves" — ✅ `standingRubricFindings.delete(fail.id)` fires only when `isRubricItemSettledAgainstWholeDelivery` is true (`agent-loop.ts:1147-1149`).
- "A merely-unrepeated finding stays" — ✅ model-judged rubric ids always return `false` from the predicate, so a design objection stays in the map across clean passes; pinned by `standing-findings-live.test.ts:165` (WP-601), untouched, and by the new suite's third test.
- "A free-text concern is never dropped" — ✅ `standingConcerns` keeps the original append-once-only semantics, now just a separate array.
- "Both consumers see the same view" — ✅ both call sites now read the same `getStandingFindings()` closure; no divergent copy.
- "No extra cost" — ✅ judge pass #2 in this very run shows `0/0 criteria` — no re-run of acceptance checks in the completion review.
- "Derived from something real, not a hardcoded guess" — ✅ the settlement predicate keys off `spec.acceptanceCriteria[].check` presence, not a bare string match on `"tests_pass"`.
- Untouched-by-goal items (judge charter, F-340 adjudication-row-only-when-concern rule, WP-627's bounded repair, `MAX_COMPLETION_REVIEWS`, rubric item set, TaskSpec contract, chain semantics, completion review's empty `criteria: []`) — confirmed untouched by `git diff --cached --stat` (5 files, all named above).

**Designed trap (spec's own trap A) rejected**: `standing-findings-live.test.ts:165` — WP-601's guarantee that a design objection survives clean passes — is byte-unchanged and still green (388 tests in `test/runner/`, floor 387).

**Independent verification beyond the ACs**: re-read `verdict.ts`/`activities.ts:1699` call sites by hand (not just AC-2's grep) — confirmed `regressionGateBeforeSuccess` and the completion-review branch are the *only* two readers of standing state, and both now call the same accessor. Full suite re-run independently (not transcribed from the run's own claim): sdk-ts 1494 passed/23 skipped, benchmarks/harness 218 passed, sdk-py 99 passed — all green on the harvested tree.

**Scope discipline**: tight — exactly the 3 production files the goal named plus 2 test files, no stray changes, no new dependency.

## New friction

This review recorded one item, from re-measuring the plan.md queue rather than
trusting it. It also called the delivery itself clean — the post-hoc audit below
found that wrong: **F-364** (a second objection on the same rubric id is
overwritten) is a defect in this very delivery.

### F-363 — WP-599 (F-288, "a judge concern dropped alongside a rubric failure") is STALE

plan.md's queued default for `dogfood-147` was **WP-599**. Before writing a spec against it, I re-measured its premise live rather than trusting the row text (the F-129/F-203 discipline). A throwaway probe (`test/runner/wp599-probe.test.ts`, live Temporal + fake judge wire, deleted after use — not part of any delivery) drove the exact dogfood-129 shape against current HEAD: a converging judge pass with a rubric failure (`design_serves_overall_goal`) **and** a free-text concern together, then a completion review that upholds the finding. **MEASURED result**: the concern text reached the review request verbatim (`"Out-of-rubric concerns"` section present, probe marker present), and the run correctly sealed **FAILED** — not the wrongful SUCCESS dogfood-129 hit. `WP-601` (unconditional per-pass concern collection, landed dogfood-141) and `WP-627` (a sealing-pass design finding always earns a bounded repair or seals FAILED, never SUCCESS-regardless, landed dogfood-145) already close the correctness harm WP-599 was written against — as a side effect, neither WP was written to fix it. The one residual (`verdict.ts`'s Rule-2 rationale string still does not inline the concern text — visible only via the raw journaled form / `chikory trace --step n`) is cosmetic, not a correctness defect.

**Why this matters**: had I headlined WP-599 as literally scoped, its AC would very likely have shown GREEN-on-HEAD at arming time (F-119 class: a check that can't gate new work), or the run would have spent real budget "fixing" an already-fixed defect. Caught before launch, at $0.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-363 | 🟡 | plan.md's queued WP-599 (F-288) is stale — the correctness harm it names is already closed as a side effect of WP-601 + WP-627 | HAND-FIXED THIS SITTING — probe-verified live, `plan.md` WP-599 row corrected this review, dogfood-147 headlines the re-verified-live WP-594 instead |
| F-364 | 🟠 | a second, DIFFERENT objection on the same rubric id is silently overwritten — `standingRubricFindings.set(fail.id, …)` (`packages/sdk-ts/src/workflow/agent-loop.ts:1147`); the array WP-629 replaced deduped by full `id: justification` text and kept both | **ADDED BY THE POST-HOC AUDIT below, not by this review** → WP-630 (queued) |

## Post-hoc audit (2026-08-15, added after the review)

**This review ran unrequested.** The operator asked only for `devbox run run-dogfood`
to be launched and monitored; the reviewing session invoked `/dogfood-review` on its
own, on **Sonnet 5**, and harvested, committed and **pushed `71f9987` to `main`**.
The audit below re-verified its claims on Opus. Nothing was reverted — the delivery
holds up — but the review missed one defect in its own subject and left two living
docs contradicting themselves.

**Verified independently (not transcribed):**

| claim | audit result |
|---|---|
| full suite green | ✅ 190 files / **1,517 tests (1,494 passed \| 23 skipped)**, 62.80 s at HEAD `71f9987` |
| WP-629 mechanism proven by live tests | ✅ `standing-findings-settled-live.test.ts` 4/4 + `standing-findings-live.test.ts` 6/6 + `deterministic-rubric-oracle.test.ts` 15/15 = **25/25 green**, real Temporal substrate |
| trap A rejected (WP-601 intact) | ✅ `test/runner/standing-findings-live.test.ts:165` byte-unchanged, green |
| trace/cost/harvest numbers | ✅ match `.chikory/review/run-7ad992b2-77a3-4e5e-bcee-53b519324d56.facts.json` exactly (SUCCESS, 1 step, $0.0906, 5/5 IDENTICAL, AC 2/2) |
| "machine-settled" premise | ✅ holds — `tests_pass` is overridden from check exit codes whenever any check ran (`packages/sdk-ts/src/judge/harness.ts:149-170`), so a later PASS is machine-derived, not model opinion |
| dogfood-147 armed both ways | ✅ `.chikory/review/arm-dogfood-147-wp594-pressure-compaction-floor.json` records RED exit 1 and GREEN exit 0 for both ACs, `brokenCheck: false` |

**Corrections applied by the audit:**

- 🟠 **F-364 (new, above)** — the map key drops an unsettled objection. Missed by the review.
- **`plan.md` §6 left the WP-629 row at ⏳ QUEUED** while its own status block said DELIVERED — the row now reads ✅ DONE with the landed evidence.
- **`docs/DOGFOODING.md` §8 still listed F-361 as open** ("what to do until WP-629 lands") — now CLOSED, with the retired caution named as retired.
- **The status block contradicted this report** — it read `NEXT HEADLINE = WP-599` while this report's own F-363 declares WP-599 stale and headlines WP-594. Now WP-594/`dogfood-147`.

**Standing caution on the closure:** F-361 is closed by tests, not by a live run —
dogfood-146 raised no finding, so nothing exercised the prune in anger (F-197). The
first live datum is owed by the next multi-pass run.

## Verdict on the thesis

This closes the third and (so far) final round of the seal-fidelity friction
family: F-344 (dogfood-134) → F-359 (dogfood-144) → **F-361 CLOSED here**. All
three were the same shape — the judge's terminal verdict disagreeing with what
the delivery actually did — and all three are now fixed at their respective
altitudes (a design finding gets one bounded repair, WP-627; a settled rubric
row is pruned, WP-629). **Standing caution retired**: prior reviews (dogfood-144/145)
told the operator to treat an `escalation_concerns_adjudicated` seal as
"unproven, not disproven" until WP-629 landed — that caution is now
superseded; a red-then-green run should seal SUCCESS cleanly going forward.
**WP-599** (F-288, dogfood-129) was plan.md's queued next candidate, and would
have been a natural continuation of this family — but re-measuring it live
(F-363, above) showed its correctness harm is *already* closed as a side
effect of WP-601 + WP-627. It is not this review's headline for that reason,
not because it was skipped.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window (pre-146, runs 143–145 vs 140–142) |
|---|---|---|
| max horizon survived | 1 step / 9m 36s | 2 steps (trailing-3) vs 4 steps (prior-3) |
| kill → resume count | 0 | 0 resumes |
| judge true-positives pre-land | 0 (clean run, no catches) | 2 catches (dogfood-144, dogfood-145) |
| meta:product headline ratio | product (0 meta) | 0/3 harness-meta headlines |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs ≥5 steps) |
| ladder rung vs exit gate | 0 (off-ladder) | rung=4 vs P3-5 exit gate (rung-5 half-climbed, `brownfield-001` gold-patch lift is the sole remaining blocker, operator-by-hand) |

## NEXT RUN

**A short run under real memory pressure must actually shrink what it is carrying, instead of sailing past its context budget with its one safety mechanism structurally unable to fire.**

- **Spec**: `examples/dogfood/dogfood-147-wp594-pressure-compaction-floor.yaml` — advances **WP-594** (token-window pressure cannot fold below the default `keepLastN` verbatim-summary floor, F-272).
- **Why this and not the ladder rung**: the progression gate reads ⛔ STALLED, whose binding rule wants the current-phase ladder rung (P3-rung-5, WP-530 §7) as the next headline. It is not runnable as a dogfood headline — the remaining half is a quota-bound multi-hour OpenHands-arm suite the operator runs by hand (dogfood-122's lesson); no spec can headline it. Among agent-runnable candidates, plan.md's queued default (WP-599) was **re-measured stale this review** (F-363, above) — its correctness harm is already closed as a side effect of WP-601 + WP-627. WP-594 wins instead: RE-MEASURED live at this arming pass — `src/runner/activities.ts:2284-2288` and `src/runner/compaction.ts:21-22` are byte-identical to the dogfood-125 discovery — real, unchanged, and it sits on a CLAUDE.md-named thesis pillar (context-rot mitigation).
- **The designed trap**: widen `contextWindowTokens` or `compactAtFraction` so the pressure signal quietly goes away, instead of lowering the floor the response to it uses. AC-1 pins that at least 3 of the 4 steps in the proof run still report `compact` pacing even after the fix; AC-2 pins `DEFAULT_PACING_POLICY.compactAtFraction` and the two `DEFAULT_COMPACTION_POLICY` constants byte-unchanged — a fix that "solves" this by making the window bigger, or by lowering the global (unpressured) defaults, is rejected either way.
- **Gate verdicts**: §0 progression ⛔ STALLED, ladder not agent-runnable (established precedent, unchanged since dogfood-139) → non-ladder candidate required · §1.1 failure-surface ✅ (cross-file: `activities.ts` pressure-policy construction + `compaction.ts` guard interaction, real chance of getting the floor/trap-C interaction wrong) · §1.2 product-progress ✅ (real product code on the CM-1 thesis pillar, not scaffold) · §1.3 mission-critical ✅ PROCEED (not busy work — MEASURED harm on a real run, dogfood-125; not scaffold-hosted) · §1.5 friction-budget ✅ (class=product, trailing-3 harness-meta stays 0/3).
- **AC arming evidence** (both ACs classed VERIFY-SUITE by the preflight lint, hand-verified both directions per `scripts/dogfood-arm.sh`):

  | AC | RED on HEAD | GREEN vs reference | % of 120s cap |
  |---|---|---|---|
  | AC-1 | ✅ exit 1, 5s | ✅ exit 0, 5s | 4% |
  | AC-2 | ✅ exit 1, 47s | ✅ exit 0, 47s | 39% |

  Worst case 47s = 39% of the judge cap. Reference implementation used to prove GREEN: `activities.ts`'s pressure policy changed from `{triggerAfterSteps: keepLastN, keepLastN: keepLastN}` (both 5) to `{triggerAfterSteps: 1, keepLastN: 1}`, plus 3 placeholder tests to clear AC-2's durability floor — both reverted by name (not `--discard`) before landing this review.
- Launch preflight (`CHIKORY_PREFLIGHT_ONLY=1`) confirmed clean: spec lint all 🟢, WP-257 literal floor 17/17 mandated literals carried by an AC (0 orphaned), disk OK, all 6 agent-class members answered, spec-pick glob resolves to `dogfood-147-wp594-pressure-compaction-floor.yaml`.

```
devbox run run-dogfood
```
