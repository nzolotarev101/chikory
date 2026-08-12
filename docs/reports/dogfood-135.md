# dogfood-135 — the repository's own test suite is now a program the run must pass, not a sentence in the goal (WP-609)

**WP:** WP-609 (the suite is an oracle, not a sentence) · **Date:** 2026-08-12 ·
**Spec:** `examples/dogfood/dogfood-135-wp609-regression-suite-gate.yaml` ·
**Run:** `run-908510d8-d90d-4711-a88f-39ea7bf6482e` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder by declaration — P3 rung 5 is the phase exit gate, blocked on operator work; **fifth** consecutive off-ladder headline)

## Plain lead

A spec can now name the command that runs the repository's existing tests, and the
run executes it once before it is allowed to declare success — if those tests are
red, the run cannot report success. Last run (dogfood-134) shipped six broken tests
while writing "the full suite passed"; that specific lie is no longer possible to
tell. The run itself ended one command short of sealing: the judge stopped it at
step 4 because the executor's claim of a green repository existed only in the
executor's own prose, and this reviewer had to run `build`, `lint`, `typecheck` and
the full suite by hand to confirm the claim was, this time, true.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 4 steps · 18m 47s active (02:22:33Z → 02:41:20Z) + **11h 59m** parked awaiting a human, sealed 14:40:51Z |
| cost | **$0.2512** of $20 budget (**1.2%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **unpriced**: every step reports $0.0000 against real tokens, so the cost meter sees only the judge |
| judge | `openai-compat` (codex `gpt-5.6-sol`) · 5 passes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 4 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 14/14 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.6k/0 | $0.0000 | 3m 12s | ✓ PROCEED (0/2 criteria) |
| 2 | 5.1k/1.4k | $0.0000 | 5m 11s | ✓ PROCEED (2/2 criteria) |
| 3 | 6.2k/897 | $0.0000 | 2m 43s | ✓ PROCEED (0/2 criteria) |
| 4 | 7.4k/982 | $0.0000 | 2m 33s | ⚠ ESCALATE |

⚠️ Empty-diff probe step 1 — $0 (F-11 recurrence): `agy produced no response (empty
print output)` (`packages/sdk-ts/src/executors/gemini-cli.ts:86`), 3m 12s and 4.6k
input tokens spent for zero output. No quota signal in stderr, unlike the F-228
wall; the loop simply re-issued the step and step 2 delivered the whole feature.

## Delivery quality (human review, post-landing)

**Landed — 14 files, +117/−6.**

| piece | file:line | what it does |
|---|---|---|
| YAML → spec | `packages/sdk-ts/src/taskspec.ts:194`, `:468` | `regression_suite` (and camel alias) parses, optional |
| workflow round-trip | `packages/sdk-ts/src/schemas.ts:258` | `z.string().min(1).optional()` — survives into the workflow, not only the parser |
| core type | `packages/sdk-ts/src/types.ts:93` | `regressionSuite?: string`, no new import into the CORE layer |
| chain inheritance | `packages/sdk-ts/src/chain/node-spec.ts:118`, `:170` | a chain node inherits the repository verification command |
| machine-settled item | `packages/sdk-ts/src/judge/rubric.ts:19-32`, `:64`, `:96` | `pre_existing_suite_still_green`, `destructive: false`, in `DETERMINISTIC_RUBRIC_IDS`, in both rubrics |
| seal-time execution | `packages/sdk-ts/src/judge/evidence.ts:331-341` | `runCheck` inside the snapshot block → `regressionSuiteRun` |
| exit-code override | `packages/sdk-ts/src/judge/harness.ts:200-217` | `pass = exit 0 && !infraFailed`, justification names the command, carries `infraFailed` |
| seal-only wiring | `packages/sdk-ts/src/runner/activities.ts:1782` | the command is passed **only** when `completionReview: true` |
| forces the review | `packages/sdk-ts/src/workflow/completion-review.ts:74` | a 1-step seal no longer skips the review when a suite is declared |

**The goal, line by line.** Spec-named command ✅ · schema round-trip ✅
(`TaskSpecSchema` proven in AC-1, not only `parseTaskSpec`) · optional ✅ · rubric id
in `DETERMINISTIC_RUBRIC_IDS` ✅ · answer from the exit code, justification names the
command ✅ · never on a per-step pass ✅ (`activities.ts:1782`) · exactly once on a
clean run, at most twice with the repair ✅ (AC-2 counts executions with an external
marker file) · red suite blocks SUCCESS without ROLLBACK ✅ · bounded repair still
runs first ✅ · cap kill is neither green nor a plain code red ⚠️ — recorded
correctly, but see **F-320**.

**Designed traps — all seven rejected.** A (an ordinary AC instead of a rubric item)
· B (running per-step; AC-2's two-step green scenario demands exactly one execution)
· C (laundering an infra kill into green) · D (treating one as a code red at the
record level) · E (rolling back on a red suite — item stays non-destructive, zero
ROLLBACK verdicts) · F (a field nothing consults — AC-2 drives the real Temporal
workflow and reads the real journal) · G (blocking with no repair attempt).

**Independent verification (this reviewer, in the run workspace, not the run's own
green).** The escalation was precisely about unverified claims, so all four were
re-run by hand: `pnpm run build` = 0 · `pnpm run lint` = 0 · `pnpm run typecheck` = 0
· `pnpm exec vitest run` = 0 → **174 passed | 2 skipped** files, **1342 passed | 23
skipped** tests, 50.73s. The executor's claimed 1342 matches exactly. **The
escalation's premise was true (no judge-side evidence existed) and its conclusion
was false (the work had been done).**

**Scope discipline.** Only files the goal names or trivially entails; no new
dependency; `tests_pass` and its JD-4 override untouched; the three pre-existing
machine-settled guarantees WP-607 landed are unchanged (asserted by AC-1).

**The loop's own shape is the interesting part.** Step 2 delivered the whole feature
and passed both ACs, but the judge failed `design_serves_overall_goal` on a real
defect (see F-319 lineage below). Step 3 took the granted repair, over-corrected into
dynamic rubric injection, and **turned both acceptance criteria red**. Step 4
recovered to a correct static shape with the defect fixed. A judge catch, a failed
repair, and an unattended self-recovery inside one run — with no rollback and no
human — is the clearest per-run self-heal evidence since dogfood-105.

## New friction

### 🟡 F-319 — the one bounded repair a red suite grants is briefed as a *design* review, and blind

`buildCompletionReviewBrief` (`packages/sdk-ts/src/workflow/completion-review.ts:113-126`)
opens with *"do NOT change behavior, only design"* and then lists each failing item
as `id: justification`. For this item the justification is
``regression suite command `X` exited 1`` — **no failing test names, no output**. So
the single repair step WP-609 grants is told not to change behavior (which is exactly
what a regression fix must do) and is given no evidence of what broke. The gate is
fail-closed (a still-red suite seals FAILED), so nothing ships broken — but the
repair will usually be wasted. AC-2 could not catch this: it asserts the repair step
*happened*, not that it *could succeed*. → **WP-611**.

### 🟡 F-320 — a suite killed at its cap seals the run FAILED, which is the WP-263(b) error it was supposed to avoid

The record is right and the outcome is wrong. `applyCheckOverrides` marks a cap kill
`pass: false, infraFailed: true` (`packages/sdk-ts/src/judge/harness.ts:206-210`), but
the WP-263(b) infra-skip in `computeVerdict` applies to **criterion** results only
(`packages/sdk-ts/src/judge/verdict.ts:101`). A rubric row with `infraFailed: true`
still lands in `deterministicFails` and seals FAILED
(`packages/sdk-ts/src/workflow/agent-loop.ts:1108`, `:1127`). Compounding it, the cap
is not spec-settable: `checkTimeoutMs` exists only on `RunJudgePassInput`
(`packages/sdk-ts/src/judge/harness.ts:271`), so a declared suite is fixed at
`DEFAULT_CHECK_TIMEOUT_MS = 120_000` (`packages/sdk-ts/src/judge/evidence.ts:37`)
while this repo's own suite already burns 50.73s of it. A loaded machine turns an
infra death into a failed run. → **WP-612**.

### 🟡 F-321 — with no suite declared, every run now records a green it never measured

When no `regressionSuite` is present, the override records
`pass: true, "no regression suite command executed for this pass"`
(`packages/sdk-ts/src/judge/harness.ts:211-216`) — and the item sits in
`STANDING_RUBRIC` (`packages/sdk-ts/src/judge/rubric.ts:64`), so **every judge pass of
every run** now carries a ✓ row reading *"The pre-existing suite is still green."*
with nothing having run. It is not model-settled (that defect was caught and fixed
mid-run) and it gates nothing, but a self-reported green is the exact shape WP-609
exists to abolish, and it now appears in the artifact by construction. The right fix
is conditional membership — include the item only when the spec declares a suite —
which is what step 3 attempted and **AC-1 forbade** by asserting static rubric-array
membership. → **WP-613**.

### 🟡 F-322 — a converged run parked 12 hours on a human because the spec omitted four words

`agent-loop.ts:1213-1224` auto-seals SUCCESS for exactly this case — an out-of-rubric
escalation with every criterion and every rubric item passing — but only under
`unattended: escalation: seal_resumable_failed`. dogfood-126 and dogfood-128 carry
that block; dogfood-135 did not, so the run sat in `AWAITING_APPROVAL` from 02:41:20Z
to 14:40:51Z (**11h 59m 31s**) and sealed on `chikory approve` with zero further
spend. Hand-fixed for the next run (the block is in dogfood-136); the launcher
precheck that would make the omission impossible is track-B.

### ℹ️ F-11 recurrence (no new id) — the empty-response probe step

Step 1 cost 3m 12s and 4.6k input tokens for an empty print output, with no quota
signature (so not F-228). The loop absorbed it. Recorded as a data point for
WP-221, not a new item.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-319 | 🟡 | the bounded repair for a red suite is briefed "design only" and carries no failing-test evidence | → **WP-611** (queued) |
| F-320 | 🟡 | a cap-killed suite seals FAILED (infra-skip covers criteria, not rubric rows); cap not spec-settable | → **WP-612** (queued) |
| F-321 | 🟡 | with no suite declared the item records an unmeasured ✓ on every pass of every run | → **WP-613** (queued) |
| F-322 | 🟡 | converged run parked 11h 59m awaiting approval — spec omitted the `unattended:` block | **HAND-FIXED THIS SITTING** — block added to `examples/dogfood/dogfood-136-*.yaml`; precheck = track-B note |

## Verdict on the thesis

**Real-time judging.** The judge earned its keep twice and misfired once. It caught a
genuine defect at pass #2 that no acceptance criterion covered (a machine-settled item
silently falling through to the model's answer), and the executor fixed it before
landing — one true positive, pre-land. Its step-4 escalation was formally correct and
practically wrong: it refused to credit repository-wide verification it could not see,
which is *the right instinct*, and cost 12 hours of wall-clock plus a human because
nothing in the loop could turn that instinct into evidence. **That is precisely the
hole WP-609 fills — and by F-197 this run could not benefit from its own fix**, since
the judge ran the launch-time build. dogfood-136 must be the first run to declare
`regression_suite:` and show `pre_existing_suite_still_green` settled from an exit
code in its own journal.

**Durable execution.** Four steps, no resume, no rollback, and a self-corrected
regression in the middle: step 3 broke both ACs chasing a design note and step 4
recovered unattended. The checkpoint chain is consistent (4 checkpoints, `lastGood`
advanced at steps 2 and 3).

**Standing caution (replaces dogfood-134's).** `tests_pass` still means "the
judge-executed acceptance checks exited 0". `pre_existing_suite_still_green` is the
row that means the repository is green — **but only on a run whose spec declares
`regression_suite:`**. On every other run it is a placeholder ✓ (F-321). Read the
justification, not the checkmark.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 4 steps / 18m 47s active | 6 steps (dogfood-129) over the last 9 runs |
| kill → resume count | 0 | 0 across the trailing 3 |
| judge true-positives pre-land | **1** (model-fallthrough on a machine-settled item, pass #2) | 1 · 0 · 1 · 0 over dogfood-132…135 |
| meta:product headline ratio | 0:1 (product) | **0:3** — cap intact (≤1 per 3) |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps) — target 99%+ |
| ladder rung vs exit gate | rung 0 — off-ladder, **5th consecutive** | P3 exit gate = rung 5 (WP-530), still blocked on two operator tasks |

## NEXT RUN

**When the run's own test gate stops a delivery, the fix step must be shown the tests
that failed and told to fix them — and on every run that never declared a suite, the
gate must stop writing down that the tests passed.**

- **Spec:** `examples/dogfood/dogfood-136-wp611-wp613-repair-brief-and-honest-rubric.yaml`
- **WP:** WP-611 (a gate that blocks on a red suite must brief its one repair with the
  failing tests) + WP-613 (a gate must not record a green it never measured) — the two
  measured defects in the gate WP-609 landed one run earlier.
- **It also closes F-197 for WP-609:** this is the FIRST spec to declare
  `regression_suite:` itself (`pnpm --filter @chikory/sdk exec vitest run test/judge
  test/workflow`, timed **3.97 s** at HEAD against the fixed 120 s cap), so the gate is
  finally exercised on a real run and its journal is the live proof.

**Why THIS and not the ladder rung.** The §0 progression gate now reads ✅ **PROGRESSING**
(dogfood-135's 4-step horizon moved the trailing-3 max from 3 to 4), so the STALLED bind
that governed the last five specs is lifted and the rung is a default rather than a rule.
The default rung — P3-rung-5, the phase exit gate — still cannot run: both blockers were
re-measured this review and are operator work, not product gaps (`find benchmarks/tasks
-name '*brownfield-001*'` returns only the task YAML, no `fix_ref`; `grep -rl repoRef
benchmarks/results/` returns nothing). Against that, a gate that cannot brief its own
repair and records unmeasured greens is upstream of publishing any reliability number.

**The designed trap.** Append the suite output to the brief and keep the standing
*"do NOT change behavior, only design"* instruction — the repair now knows what broke and
is still forbidden from fixing it. AC-2 scenario 1 reads the brief off the context the
executor is handed and requires both the output AND the absence of that instruction; six
more traps (framing rewritten for every brief, runner-only membership, dropping the item,
starving the findings, delivering to the judge prompt, executor-authored proof) are in the
spec header.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ PROGRESSING | horizon axis moved (3 → 4 steps); rung is a default, not a bind — and it is still operator-blocked |
| §1.1 failure surface | ✅ | 2–6 steps across judge + workflow + runner; the membership half has a hard constraint (a form missing a declared item is an error) that the obvious implementation violates |
| §1.2 product progress | ✅ | lands in `src/judge/` + `src/workflow/` on two real open plan.md §6 WPs — no scaffolding |
| §1.3 mission-critical | ✅ PROCEED | not busy work: F-319 makes WP-609's repair path useless and F-321 reintroduces self-reported green into the gate that abolished it |
| §1.5 friction budget | ✅ | `class=product`, harness-meta headlines 0/3 — cap intact |

**AC arming evidence** (`devbox run -- bash scripts/dogfood-arm.sh <spec>`): both ACs are
VERIFY-SUITE, so the launcher preflight did NOT dry-run them; both were hand-verified in
BOTH directions.

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **8s** | ✅ exit 0, **9s** | 8 % |
| AC-2 | ✅ exit **1**, **13s** | ✅ exit 0, **14s** | 12 % |

Both REDs print their own assertion text, not a crash: AC-1 fails on
`F-321: STANDING_RUBRIC must NOT carry pre_existing_suite_still_green`; AC-2's three live
scenarios fail on `expected 0 to be greater than 0` (no output reached the brief),
`expected […] to have a length of 1 but got 3` (the row is scored on every per-step pass),
and `expected '…' not to contain 'pre_existing_suite_still_green'` (a run with no suite
records it anyway). **An oracle hole was found and closed while arming:** the first draft
echoed its sentinel from inside the command string, which the justification already quotes
verbatim — so a delivery carrying zero bytes of output would have passed. The failing text
is now `cat`-ed from a file the command only names. The reference implementation was
reverted BY NAME (four files, verified byte-IDENTICAL to the run workspace), never with
`--discard`.

**Launch:**

```sh
devbox run run-dogfood
```
