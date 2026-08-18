# dogfood-153 — the judge's off-checklist warnings now reach the agent that can still fix them (WP-599)

**WP:** WP-599 (a judge concern raised beside a rubric failure never reaches the executor, F-288) · **Date:** 2026-08-18 ·
**Spec:** `examples/dogfood/dogfood-153-wp599-concern-beside-rubric-fail.yaml` ·
**Run:** `run-8113a98d-53e2-42b6-bed0-41e7d08920ca` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder) — P3 (moat phase) rung-5's remaining half is operator-run, not agent-runnable

## Plain lead

When the reviewer spotted a problem its checklist had no row for, the worker was
never told — the problem sat on file until the end of the job, where it could
fail the whole thing. After this run the worker hears it while it still has time
to act. The run shipped that correctly, and shipped one hole with it: whenever
the reviewer also has a failing checklist row to explain, its explanation is long
enough to use up the entire message budget, so the warning is cut off the end and
never arrives. Fixed by hand here, with three tests that fail without the fix.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 7m 21s |
| cost | **$0.0852** of $20 budget (**0.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — step cost **$0.00 on 6,820 metered tokens**; trace flags `⚠ cost meter blind (unpriced tokens)` (CLI-OAuth executor, no price table — known, and the warning is the WP-218 gate working) |
| judge | `openai-compat` (`gpt-5.6-sol`, xhigh) · 2 passes · $0.0514 + $0.0338 |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 4/4 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.4k/2.4k | $0.0000 | 4m 7s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (all 4 byte-identical to the run workspace):

| file | what changed |
|---|---|
| `packages/sdk-ts/src/workflow/remediation.ts:91` | `buildCriterionFeedback` now also emits a `judge concerns (out-of-rubric …)` section, filtered through `blockingConcerns` |
| `packages/sdk-ts/test/runner/helpers.ts:346` | `judgeForm` test helper accepts optional `concernSeverities` |
| `packages/sdk-ts/test/runner/remediation.test.ts:98` | 5 unit tests: blocking rides, minor does not, unmarked fails safe, combined, clamped |
| `packages/sdk-ts/test/runner/remediation-live.test.ts:229` | 3 Temporal live-loop tests over the real `judgeFeedback` path |

**The goal, line by line — what the run got right:**

- ✅ **One policy, not two.** It imports the existing `blockingConcerns`
  (`packages/sdk-ts/src/judge/verdict.ts:72`) rather than re-deriving severity. No keyword scan,
  no second notion. `src/judge/verdict.ts` imports only `types` and `rubric`, so the new
  `remediation.ts → judge/verdict.ts` edge introduces **no cycle**.
- ✅ **Trap 1 rejected — the verdict did not move.** Rule 4's `rubricFails.length === 0` guard
  (`packages/sdk-ts/src/judge/verdict.ts:185`) is untouched. The obvious "fix" — widening rule 4 —
  would have handed F-154's force-seal-on-approve semantics to a run with a red rubric row.
- ✅ **Trap 2 rejected — the seal still adjudicates.** `accumulateStandingConcerns` is unchanged;
  the concern gained a consumer instead of moving to one.
- ✅ **Trap 3 rejected — silence stays cheap.** A pass with no failing criterion and no blocking
  concern still returns `undefined`; a MINOR concern still puts nothing in the prompt.
- ✅ **No new contract field**, so the `applyCheckOverrides` re-constructor
  (`packages/sdk-ts/src/judge/harness.ts:236`) had nothing to silently drop — the F-380 lesson held.
- ✅ **Live-loop tests are real, not confounded.** They ride `echoJudgeFeedback`
  (`packages/sdk-ts/test/runner/helpers.ts:165`), which echoes the string the loop actually handed
  the next step, and assert on a unique concern sentence only the behaviour under test can
  produce — the F-383 confound was avoided. All 3 executed in the declared suite (skipped count
  held at 23 while passes went 1563 → 1571).
- ✅ **Instruction compliance on the optional half.** The goal asked the executor to say so if it
  left `buildRemediationBrief` alone; the step summary says so explicitly ("Left Alone … as
  permitted by the task specification").

**Independent verification of what the ACs took on trust** — the acceptance checks used
short, toy justifications. Production justifications are not short. Measured from this run's
own persisted verdict form (`.chikory/runs/run-8113a98d-…/journal.db`, `kind='verdict'`):

| criterion | justification bytes |
|---|---|
| AC-1 | 6,532 |
| AC-2 | 3,757 |
| AC-3 | 2,851 |

The feedback budget is **2,000 chars** (`REMEDIATION_BRIEF_MAX_CHARS`,
`packages/sdk-ts/src/workflow/remediation.ts:21`). See F-384.

**Scope discipline:** ✅ 4 files, all named or trivially entailed by the goal. No dependency
change, no rubric edit, no Python mirror, no TaskSpec change.

## New friction

### F-384 🔴 — the clamp deleted the whole feature whenever it mattered most

`buildCriterionFeedback` built the criteria section, then the concerns section, joined them and
clamped the **concatenation** (now `packages/sdk-ts/src/workflow/remediation.ts:109`). `clampBrief`
truncates from the tail, so the concerns section is the part that disappears.

That is not a corner case. A judge's failing-criterion justification quotes the check it ran, and
the three this run produced were 6,532 / 3,757 / 2,851 bytes against a 2,000-char budget — **one
failing criterion alone overruns the entire budget**. Probe on the delivered code, two failing
criteria at ~1,200 chars each plus one blocking concern:

```
PROBE-A len= 2000 cap= 2000
PROBE-A contains concern text?  false
PROBE-A contains 'judge concerns' header?  false
```

So WP-599's payload reached the executor only in the sub-case where **no** criterion was failing —
and was dropped, silently and always, in exactly the "alongside the failing-criterion evidence"
case the goal names. The run's own clamp test asserted only `length <= REMEDIATION_BRIEF_MAX_CHARS`,
which passes whether or not the concern survives; it pinned the wrong invariant.

**Disposition: HAND-FIXED THIS SITTING.** `clampSections`
(`packages/sdk-ts/src/workflow/remediation.ts:127`) gives each present section a fair share of the
budget, shortest first, so a section under its share releases the remainder and a short concern
list is never truncated to pay for a verbose criterion. Pinned by 3 tests at
`packages/sdk-ts/test/runner/remediation.test.ts:175` — **2 of the 3 verified RED against the
delivered code** before the fix (the third guards the mirror-image regression, a naive
"put concerns first" fix). Declared suite: **1,574 passed | 23 skipped**, up from 1,571.

### F-385 🟡 — the `??` at the milestone site displaces the rationale instead of composing with it

`packages/sdk-ts/src/workflow/agent-loop.ts:1422` reads `buildCriterionFeedback(verdict.form) ?? (completionMilestone ?
verdict.rationale : undefined)`. Once WP-599 made a concern-only form return a string, that
fall-back stopped firing for it. Probe on the delivered code:

```
PROBE-B rationale        : "work in progress, no regressions — all 1 acceptance criteria pass; non-destructive rubric failures: scope_matches_instruction: touched an unrelated module"
PROBE-B judgeFeedback NOW: "judge concerns (out-of-rubric — address these directly):\n- …"
PROBE-B feedback carries rationale?  false
```

One diagnosis gained, one lost — and the file's own F-212 doctrine sits 1,240 lines above it
(`packages/sdk-ts/src/workflow/agent-loop.ts:159`): "A mechanical violation must never mask the
substantive one." The loop's three other feedback sites (`:1175`, `:1454`, `:1456`) already use
`withCriterionFeedback`, which composes; `:1422` is the lone outlier.

Reachability is narrow: `:1422` is reached only when `allCriteriaPass` is false
(`packages/sdk-ts/src/workflow/agent-loop.ts:138` requires `criterionResults.length > 0`), and the
newly-defined case needs `fails.length === 0` — so the regression window is exactly *a completion
milestone whose judge pass evaluated **zero** criteria while holding a blocking concern*, i.e. a
spec with no acceptance criteria. **Disposition: → WP-635 (queued).** Not hand-fixed: the correct
fix (`withCriterionFeedback` at `:1422`) also adds the rationale to every milestone pass that *has*
failing criteria, and that common-path prompt change deserves its own run rather than an unpinned
edit during a review. A live test for the narrow case did not reach a terminal state in 60 s —
further evidence the zero-AC shape is degenerate.

### F-386 🟡 — WP-548's live behaviour is still unmeasured, two runs on

The spec picked this WP partly to re-measure, for free, whether a real judge populates
`concernSeverities` now that the prompt asks for it (the F-197 debt: a run cannot exercise the
judge fix it delivers). It did not: **the judge raised 0 concerns across both passes**, so the
field was never populated with a real value. The persisted forms differ, too — pass #1 carries
`concernSeverities: []`, pass #2 (the completion review) omits the key entirely. Both are
fail-safe (absent ⇒ blocking), so neither is a defect, but WP-548's live population is now
**two runs old and still unproven**. **Disposition: track-B note** — carried into the next spec's
premise block as a measurement to take, not a WP.

### F-387 🟡 — the executor's step summary carries its own polling narration

The step summary opens with 14 lines of `I will wait for the live test task to complete.` /
`Waiting for task-146...` — **487 of 9,719 bytes (5.0%)** of the summary that rides into the next
step's prompt and the pacing estimate. Same family as F-306 (measured at 3.8% of summary bytes);
different source — not CLI telemetry but the agent's own turn-by-turn narration while polling a
background task. **Disposition: track-B note**, folded into WP-606 (executor summary hygiene).
Still not headline-sized at 5%.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-384 | 🔴 | joined-then-clamped feedback drops the whole concerns section whenever any criterion fails (justifications measured 2,851–6,532 B vs a 2,000-char budget) | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/remediation.ts:127`, 3 tests at `packages/sdk-ts/test/runner/remediation.test.ts:175` (2 verified RED pre-fix); suite 1,571 → **1,574 passed** |
| F-385 | 🟡 | `??` at `packages/sdk-ts/src/workflow/agent-loop.ts:1422` displaces the verdict rationale instead of composing, on a zero-criteria completion milestone | **→ WP-635 (queued)** |
| F-386 | 🟡 | judge raised 0 concerns, so WP-548's live `concernSeverities` population is still unproven after 2 runs | **track-B note** — carried into the next spec's premise block |
| F-387 | 🟡 | 487 B / 14 lines (5.0%) of the step summary is the executor's own polling narration | **track-B note** — folded into WP-606 |

## Verdict on the thesis

- **The judge gated nothing it should have.** Two passes, 6 rubric rows each, both clean, 3/3
  criteria — and the delivery shipped a defect that voided the feature in its primary case. The
  judge read a diff that was *correct in structure* (right policy, right seam, right traps
  rejected) and had no way to see that a 2,000-char budget meets 6,532-char justifications,
  because that fact lives in the judge's **own previous output**, not in the diff. This is a new
  altitude of "judge detects but does not gate": there was nothing to detect *in the diff*.
- **The ACs inherited the same blind spot.** AC-1 even asserts "failing-criterion evidence is
  still carried, not replaced" — with a 24-character justification. The oracle was owned; the
  **size family** of its inputs was not. That extends the F-187/F-196/F-198 rule (drive every
  input family) to a dimension no previous run has named: input *magnitude*, taken from live
  telemetry rather than from a plausible-looking literal.
- **What worked.** Every designed trap was rejected — the run did not widen rule 4, did not move
  the concern off the seal, did not grow the healthy-path prompt, did not invent a second severity
  notion, and wrote genuine live-loop tests instead of copying the grading checks. The spec's
  re-measured premise (which corrected a stale `plan.md` row before a dollar was spent) is the
  reason.
- **Standing caution unchanged:** a green seal is not evidence the concerns were wrong; here it is
  not even evidence the feature works.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 7m 21s | 2 steps (trailing-3) vs 3 (prior-3) |
| kill → resume count | 0 | 0 (trailing-3) |
| judge true-positives pre-land | **0** (human review found 2) | 3 catches over the last 8 runs |
| meta:product headline ratio | 0:1 (product) | **0/3 harness-meta** — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | rung 0 (trailing-3); P3 exit gate needs rung-5, operator-run |
