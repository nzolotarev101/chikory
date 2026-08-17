# dogfood-152 — the judge can now say how much a concern matters, but it shipped mute (WP-548)

**WP:** WP-548 (a judge concern needs a severity floor) · **Date:** 2026-08-17 ·
**Spec:** `examples/dogfood/dogfood-152-wp548-concern-severity-floor.yaml` ·
**Run:** `run-ac06b2bf-f6bb-4489-9c18-8da7d963075a` · **Landed:** this review's commit ·
**Ladder:** rung-0 (off-ladder; P3's rung-5 remainder is operator-run, see the spec's WHY)

## Plain lead

The run built the feature it was asked for — the judge can now label each of its
side-comments "minor" or "blocking", and only the blocking ones stop the run — and
it built it correctly at every place the spec named. But the label was thrown away
one file downstream, in code nobody edited, so on a real run every concern still
arrived unlabelled and the whole feature did nothing. The run's own suite caught
it and sealed FAILED; this review found the cause, fixed it, and pinned it.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 2 steps · 11m 44s |
| cost | **$0.1994** of $20 budget (**1%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — steps metered **$0.0000** on real tokens (cost meter blind, unpriced) |
| judge | `openai-compat` (codex `gpt-5.6-sol`) · 4 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run against the harvested tree) |
| harvest | 13/13 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.6k/1.2k | $0.0000 | 4m 0s | ✓ PROCEED (3/3 criteria) |
| 2 | 6.3k/1.4k | $0.0000 | 2m 39s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

### What landed

| file | change | verdict |
|---|---|---|
| `packages/sdk-ts/src/types.ts:484` | `concernSeverities?: Array<"minor" \| "blocking">` added; `concerns` still `string[]` | 🟢 |
| `docs/spec/CONTRACTS.md:201` | mirror in sync, additive, documented default | 🟢 |
| `packages/sdk-ts/src/schemas.ts:474` | `.strict()` runtime mirror accepts the field | 🟢 |
| `packages/sdk-ts/src/judge/prompt.ts` | response schema + instruction text ASK for the field | 🟢 |
| `packages/sdk-ts/src/judge/verdict.ts:72` | `export function blockingConcerns` — one pure policy, order preserved, unmapped ⇒ blocking | 🟢 |
| `packages/sdk-ts/src/judge/verdict.ts:184` | rule 4 escalates on `blocking.length > 0`; `rubricFails.length === 0` guard untouched | 🟢 |
| `packages/sdk-ts/src/workflow/standing-concerns.ts:15` | `accumulateStandingConcerns` extracted (step 2 refactor) | 🟢 |
| `packages/sdk-ts/src/workflow/agent-loop.ts:1168` | accumulation routed through the floor | 🟢 |
| `packages/sdk-ts/src/cli/trace.ts:514` | minor renders `concern (minor):`, blocking byte-identical | 🟢 |
| `packages/sdk-ts/test/**` (4 files) | 4 repo tests incl. a live end-to-end pair | 🟡 — one over-asserted (F-383) |
| `packages/sdk-ts/src/judge/harness.ts:240` | **absent from the delivery** — the field died here | 🔴 **F-380** |
| `packages/sdk-ts/src/workflow/agent-loop.ts:1490,1531` | **left raw** — the floor is bypassed at the seal | 🔴 **F-381** |

Scope discipline is clean: 14 files, every one named or trivially entailed by the
goal, no new dependencies, strict ESM named exports throughout, no `any`, Python
mirror correctly left alone as the goal instructed.

### The goal, line by line

Every explicit instruction in the goal was honoured, including all five traps
AC-1 and AC-3 were built to reject: `concerns` was not retyped, the BRANCH rule
still scans the whole list, rule 4's rubric guard was not widened, no third
severity or numeric score was invented, and the severity is not derived from the
concern's text. The "unmapped concern is BLOCKING" safety default is implemented
exactly as specified, including the ragged-array case.

The delivery failed on the one thing the goal could not name, because the spec
author did not know it either — see F-380.

### Independent verification the ACs took on trust

- **The declared regression suite.** All 3 ACs passed while the full SDK suite
  was **RED**: `pnpm --filter @chikory/sdk exec vitest run` → `1 failed | 1559
  passed` on the harvested tree. AC-3's suite clause runs `vitest run test/judge/
  test/workflow/` — and the executor's own new live test lives in `test/runner/`.
  Both the executor's self-verification and my acceptance oracle used the same
  too-narrow scope (F-382).
- **End-to-end behaviour of the floor.** The unit tests all construct a
  `JudgeForm` literal by hand, so none crosses the judge harness. The one test
  that does — the executor's own live test — is the one that failed.

## New friction

Highest prior friction id = **F-379** (dogfood-151). This review opens F-380…F-383.

### F-380 🔴 — an additive contract field dies in the form's reconstruction, and the feature ships inert

`applyCheckOverrides` (`packages/sdk-ts/src/judge/harness.ts:240`) is where a real
judge pass turns the LLM's parsed form into the form the loop consumes. It builds
the result by **naming each field explicitly**:

```ts
return { form: { criterionResults, rubricResults, concerns: form.concerns } };
```

`concernSeverities` is not named, so it is dropped on **every real judge pass**.
`blockingConcerns` then sees `severities === undefined`, applies its (correct)
fail-safe default, and treats every concern as blocking. The feature was a no-op
end-to-end on the day it landed.

Two things make this worth a friction id rather than a shrug:

1. **The spec enumerated this exact line and got it wrong.** dogfood-152's premise
   block lists all seven readers of `form.concerns` and says *"harness.ts:91,231
   still parses and carries the whole list"*. It does carry the *list*. It does not
   carry the *form*. The F-376 rule (enumerate every reader before writing the AC)
   was followed to the letter and still missed it, because the defect is not in a
   **reader** — it is in a **re-constructor**. A place that rebuilds a contract
   object field-by-field silently deletes every field added after it was written,
   and it never appears in the diff because nobody has to touch it.
2. **Every unit test crosses the seam by construction, so none of them can see it.**
   All 6 AC-1 cases, all 32 `verdict.test.ts` cases and the whole new
   `standing-concerns.test.ts` build a `JudgeForm` literal. Only a test that goes
   through the harness with a real (or faked-transport) judge can catch it.

**Hand-fixed this sitting.** `harness.ts:240` now spreads the field through when
present. Pinned by two direct unit tests on the merge —
`test/judge/harness.test.ts:434` (carries `["minor","blocking"]` through) and
`:450` (omits the key entirely for a legacy form) — plus the live end-to-end pair.
Arming probe: reverting the one-line fix turns **3 tests RED**.

### F-381 🔴 — the converged out-of-rubric seal hands the completion review the RAW concerns, bypassing the floor

The goal correctly identified that filtering only at rule 4 leaves the defect one
altitude up, and had the executor route `standingConcerns` through the floor
(`agent-loop.ts:1168`). But `standingConcerns` is not the only thing that reaches
the completion review. The converged-escalation seal and the operator-approved
seal each call `regressionGateBeforeSuccess(sealingDiffBase, verdict.form.concerns)`
(`agent-loop.ts:1490` and `:1531`) — the **raw** list — and that argument is
unioned into `escalationConcerns` inside the gate.

This is reachable, not hypothetical. A form carrying **both** a blocking and a
minor concern still escalates `out_of_rubric` (rule 4 fires on the blocking one),
so the seal path runs and re-injects the minor concern into the adjudication
rubric the floor had just filtered it out of. The spec's own premise block cites
`agent-loop.ts:1492,1533` while describing them as carrying `standingConcerns` —
the same misread as F-380, at a different line.

**Hand-fixed this sitting.** Both call sites now pass `blockingConcerns(verdict.form)`
(`agent-loop.ts:1490,1531`). Pinned by a new live test —
`test/runner/standing-findings-live.test.ts:529`, a mixed `["blocking","minor"]`
form driven through the real converged-seal path, asserting the blocking marker
reaches the review and the minor marker does not. Arming probe: reverting only
this fix turns that test RED while the other 8 stay green.

### F-382 🟠 — the executor verified with a scope that excluded the file it had just created

Step 2 created `test/runner/standing-findings-live.test.ts` additions and then
reported *"🟢 Unit Tests | `vitest run test/workflow/ test/judge/ test/cli/` | 0 |
83 passed"* and *"🟢 Judge + Workflow Suite | `vitest run test/judge/
test/workflow/` | 0 | 192 passed"*. Neither command includes `test/runner/`. The
executor wrote a failing test, ran a suite that could not see it, and declared the
run ready for grading.

**My AC-3 had the identical hole**, and that is the part that matters: its
durability clause runs `vitest run test/judge/ test/workflow/` and counts 192 ≥ 175.
So all 3 acceptance criteria passed on a delivery whose declared regression suite
was red. The acceptance oracle is only as wide as the directories it names, and
the executor is free to put its work outside them.

The goal did tell the executor not to run the full suite in a step (F-345, the step
time cap) and to trust the declared `regression_suite`. That instruction is sound
and the run's outcome vindicates it — but the AC that grades durability must not
inherit the same narrow window as the executor's fast checks.

**→ WP-634 (queued).** An AC that asserts a suite is green must run the spec's
declared `regression_suite`, or assert its scope is a superset of the paths the
delivery touched — not a hand-picked subdirectory list frozen when the spec was
written.

### F-383 🟡 — a live assertion confounded by its own fixture

The executor's minor-concern live test seeded `scope_matches_instruction` as a
rubric **fail** in pass 1 (to keep the pass from sealing), then asserted the
completion review contains no `escalation_concerns_adjudicated` row. That rubric
fail becomes a standing finding on its own and puts the row there regardless of
what the severity floor does — so the assertion could never pass, and had the
floor been broken in the other direction it would have "failed correctly" for the
wrong reason. The sibling blocking-concern test has the mirror-image problem: its
`toContain(RUBRIC_ESCALATION_CONCERNS_ADJUDICATED)` is satisfied by the seeded
rubric fail, not by the concern.

**Hand-fixed this sitting** for the minor case: the fixture's rubric is now
all-green (`test/runner/standing-findings-live.test.ts:428`), so the concern is
the only thing that could produce a standing finding and the assertion is sharp.
The blocking sibling keeps its rubric fail (removing it would fire rule 4 and change
the path under test); its `toContain(marker)` assertion is the load-bearing one and
is unconfounded.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-380 | 🔴 | `applyCheckOverrides` rebuilds `JudgeForm` field-by-field and drops `concernSeverities`, making the whole WP-548 floor inert on every real judge pass | **HAND-FIXED THIS SITTING** — `src/judge/harness.ts:240`; pinned by `test/judge/harness.test.ts:434` and `:450` (14 tests in file, all green); reverting the fix turns 3 tests RED |
| F-381 | 🔴 | the converged and approved out-of-rubric seals pass raw `verdict.form.concerns` into the completion review, re-injecting a filtered minor concern | **HAND-FIXED THIS SITTING** — `src/workflow/agent-loop.ts:1490,1531`; pinned by `test/runner/standing-findings-live.test.ts:529` (9 tests in file, all green); reverting turns exactly that one RED |
| F-382 | 🟠 | both the executor's self-check and AC-3's durability clause run `test/judge/ test/workflow/`, excluding `test/runner/` where the delivery's own new test lives — 3/3 ACs green on a RED declared suite | **→ WP-634 (queued)** |
| F-383 | 🟡 | the minor-concern live test asserted absence of a rubric row its own fixture seeded, making the assertion unsatisfiable and its sibling vacuous | **HAND-FIXED THIS SITTING** — `test/runner/standing-findings-live.test.ts:428`; the test now passes for the reason it names |

Suite after all four dispositions: **193 files / 1,586 tests (1,563 passed | 23
skipped)**, up from the 1,583 the delivery shipped (with 1 failing). Lint and
strict typecheck green.

## Verdict on the thesis

**The gate worked, and it worked at exactly the altitude it was built for.** The
deterministic `pre_existing_suite_still_green` rubric row (WP-609/WP-619) ran the
declared regression suite at the completion review, found the red, and sealed
FAILED over an executor that had reported four green check tables. That is one
judge **true positive**, and it is the second run in three where the declared-suite
gate is the only thing standing between a confident summary and a broken landing.

**What the gate cannot do is diagnose.** It reported *"the suite is red"*; it did
not report *"your new field is deleted in `harness.ts` and the feature is inert."*
The run spent 0 steps on the difference. Both root causes were found by human
review reading a stack trace — which is the third consecutive run where the judge
correctly condemns and a human supplies the cause (dogfood-150, 151, 152).

**The standing caution sharpens.** F-376 said: an unchanged **reader** never shows
up in a diff, so grep every reader before writing the AC. dogfood-152 did that,
and lost anyway, because the killer was an unchanged **re-constructor** — a
function that rebuilds a contract object from a hand-written field list. For any
additive-field WP the reader sweep is now necessary but not sufficient: the same
sweep must find every site that *rebuilds* the type, and at least one AC must drive
the field through the real production seam rather than a literal built in the test.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 2 steps / 11m 44s | 3 steps (dogfood-149) over the last 8 |
| kill → resume count | 0 | 0 across the last 8 |
| judge true-positives pre-land | **1** (declared-suite gate) | 3 of the last 4 runs (149, 151, 152) |
| meta:product headline ratio | 0:1 (product) | **0 harness-meta of the last 3** — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps) — target 99%+ |
| ladder rung vs exit gate | rung-0 (off-ladder) | P3 rung-5 remainder is operator-run (WP-304); no agent-runnable rung |

## NEXT RUN

**When the judge spots a real problem its checklist has no row for, and the checklist also has a failing row, the agent doing the work finally gets told — while it still has steps left to fix it.**

- **Spec:** `examples/dogfood/dogfood-153-wp599-concern-beside-rubric-fail.yaml`
- **WP:** WP-599 (a judge concern raised alongside a rubric failure never reaches the executor)

**Why this and not the ladder rung.** §0 reads ✅ PROGRESSING, so the default is
the P3 ladder rung (WP-530 §7, rung-5). Rung-5's remaining half is WP-304 — the
OpenHands arm plus a corpus wide enough to separate 19 requirements at 95%
confidence — a quota-bound multi-hour suite the **operator** runs by hand
(dogfood-122's lesson: an LLM executor may not supervise it). No spec can headline
it, unchanged since dogfood-139. Among runnable candidates WP-599 is the judge
pillar *and* the self-correction pillar at once, its premise was re-measured this
review (and the measurement **corrected the plan.md row**), and it composes
directly on WP-548 landed one run ago.

**The premise, re-measured not transcribed (F-203/F-342).** Driving the built
`computeVerdict` and `buildCriterionFeedback` over a form with all criteria
passing, one non-destructive rubric failure and one blocking out-of-rubric concern:

```
verdict.kind      : PROCEED
escalateClass     : (none)
rationale names concern?  false
criterionFeedback : (undefined — nothing rides to the executor)
```

plan.md said the concern is *"dropped entirely"*. It is not — `standingConcerns`
(`packages/sdk-ts/src/workflow/agent-loop.ts:1168`) still accumulates it and the
completion review still adjudicates it. **The real defect is sharper: the loop holds
a diagnosis it will condemn the run over at the seal, and refuses to hand it to the
only agent that could fix it.**

**The designed trap.** Delete rule 4's `rubricFails.length === 0` guard
(`packages/sdk-ts/src/judge/verdict.ts:184`). It is the obvious fix and it is
wrong: `escalateClass: "out_of_rubric"` carries F-154's force-seal-on-approve
semantics, so an operator approving that escalation with all criteria passing would
seal SUCCESS **over a red rubric row**, in one keystroke. AC-1 drives that exact
input and demands PROCEED with `escalateClass` absent. Four more: moving the
concern out of `standingConcerns` instead of adding a consumer (AC-2 asserts both
ends over one form); a header emitted on every healthy pass; reading
`concernSeverities` directly instead of `blockingConcerns`, re-opening the
unmarked-concern hole; and assembling the string inline so nothing can test it.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ | PROGRESSING; ladder rung-5 is operator-run (WP-304), so it cannot headline |
| §1.1 failure surface | ✅ | judge + self-correction pillar, cross-file, five designed traps — plausibly failable |
| §1.2 product progress | ✅ | WP-599 is a real open plan.md §6 product WP; no scaffolding invented |
| §1.3 mission-critical | ✅ PROCEED | not busy work, not scaffold-hosted — feature code on the thesis pillar |
| §1.5 friction budget | ✅ | `class=product`; 0 harness-meta headlines in the trailing 3, cap ≤1/3 intact. WP-634 (F-382) is harness-meta and only 🟠 → **⛔ VETOED as a headline**, tracked track-B |

**AC arming evidence** — all three ACs are VERIFY-SUITE, so `scripts/dogfood.sh`
did **not** dry-run them; every one was hand-verified in BOTH directions with
`scripts/dogfood-arm.sh` against `942d023`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **2s** | ✅ exit 0, **3s** | 3 % |
| AC-2 | ✅ exit **1**, **1s** | ✅ exit 0, **1s** | 1 % |
| AC-3 | ✅ exit **1**, **6s** | ✅ exit 0, **76s** | 63 % |

Worst case **76s = 63% of the 120s judge cap**; the spec declares
`check_timeout_ms: 180000`, which covers it. AC-3 runs the **declared regression
suite** rather than a hand-picked subdirectory list — the F-382 fix applied to this
spec's own oracle, which is why it is the slow one.

Both RED readings are genuine assertion failures, not crashes (*"expected undefined
to be defined"* on the executor-feedback half), read from the logs rather than the
exit codes (F-133's lesson).

Two arming findings worth recording:

- **AC-2's first draft was GREEN on HEAD.** It asserted only the seal-side
  no-regression half, which is already true, so it could not gate new work. It now
  drives **both** consumers over **one** form and is RED until the executor half lands.
- **AC-3's RED pass caught a real defect in this review's own hand-fixes.**
  `tsc --noEmit` covers only `src/**/*`; the `CheckRun` type error in the new
  `harness.test.ts` pins was invisible until `pnpm run typecheck` also ran
  `tsc --noEmit -p tsconfig.test.json`. Fixed in `942d023` — and it is the same
  lesson as F-382 one level down: a verification whose scope you chose by hand
  cannot see what you put outside it.

Launch preflight is green and the spec-pick glob resolves to this file.

```sh
devbox run run-dogfood
```
