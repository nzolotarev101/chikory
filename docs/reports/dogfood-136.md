# dogfood-136 — the blocking gate now names what broke, and stops recording greens it never measured

**WP:** WP-611 (brief the repair with the failing tests) + WP-613 (no unmeasured green row) · **Date:** 2026-08-12 ·
**Spec:** `examples/dogfood/dogfood-136-wp611-wp613-repair-brief-and-honest-rubric.yaml` ·
**Run:** `run-44abed04-fa4e-465b-8fd1-9c0de732c1a3` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder by declaration) — P3 exit gate is rung 5 (WP-530 moat ladder), still operator-blocked

## Plain lead

Last run taught the system to stop a delivery that breaks the repository's own tests. This run fixed
two things that gate got wrong: when it blocks, the one repair attempt it grants is now handed the
actual failing test output instead of a "change the design, not the behavior" note; and a run that
never declared a test command no longer writes down that the tests are still passing. Both landed and
the whole suite stayed green (1348 tests). One real gap survived: when the test failure happens
*alongside* two design complaints, the failing-test text gets cut off by the brief's overall size
limit — the exact squeeze the goal said must never happen.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 6m 38s |
| cost | **$0.105** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ **cost meter blind**: 7022 tokens metered, $0.0000 priced (model id `gemini` absent from `packages/sdk-ts/src/pricing.ts:32` `PRICE_TABLE`) |
| judge | `openai-compat` / `gpt-5.6-sol` xhigh · 2 passes ($0.0597 + $0.0453) |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 (`@5` · commit `d2304e7e3e1e` · `lastGood true`) · injections 0 · pacing events 1 · peak window 1% |
| acceptance | AC-1 PASS (exit 0) · AC-2 PASS (exit 0) — re-run in the working tree (brownfield — harvested delivery) |
| harvest | 9/9 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.0k/3.0k | $0.0000 (unpriced) | 4m 53s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed diff — 9 files, +415/−27:**

| file | what changed | verdict |
|---|---|---|
| `src/judge/rubric.ts:34`, `:93` | suite item removed from **both** `STANDING_RUBRIC` and `COMPLETION_REVIEW_RUBRIC`; the `STANDING_RUBRIC.find(...)!` lookup line deleted rather than left dangling | 🟢 the spec's named `undefined!` hazard was handled |
| `src/runner/activities.ts:1688-1692` | `effectiveRubric` appends the item iff `input.completionReview && spec.regressionSuite` — the existing `rubric_extra` seam, as the goal directed | 🟢 |
| `src/judge/harness.ts:218-220` | no-evidence branch now **returns an error**, not a passing row | 🟢 F-321 fix |
| `src/judge/harness.ts:206-210` | red suite appends a 1000-char tail excerpt of the command's own output to the justification | 🟡 see F-323 |
| `src/workflow/completion-review.ts:114-127` | branches to a `REPAIR BRIEF` (behavior fix) when the suite row fails; keeps the exact `DESIGN REVIEW BRIEF` wording otherwise | 🟢 |
| `test/judge/completion-review-rubric.test.ts:19-24` | the pinned rubric-shape test was **updated**, not deleted, not tautologized | 🟢 exactly what the goal demanded |
| `test/runner/helpers.ts:362-374` | `completionReviewForm` extended **additively** with `hasRegressionSuite` | 🟢 |
| `test/judge/deterministic-rubric-oracle.test.ts` | +105 lines: trap-C error, RED-with-excerpt, GREEN, cap-killed | 🟢 |
| `test/runner/regression-suite-repair-live.test.ts` | new, 241 lines, 3 live Temporal scenarios | 🟢 |

**Independently verified, not taken on trust:**

- **Full suite, run by this review**: `pnpm --filter @chikory/sdk exec vitest run` → **175 passed | 2 skipped (177 files) · 1348 passed | 23 skipped (1371 tests) · 49.75 s**. The executor's summary claimed exactly `1348 passed | 23 skipped (1371)` — **the counts are real**, contradicting the first read of its transcript (see F-325). dogfood-134's lesson (`tests_pass` ≠ suite green) did not recur.
- **The error path is routed, not swallowed**: `applyCheckOverrides` → `{error}` → `escalate(...)` at `packages/sdk-ts/src/judge/harness.ts:364-369`. A missing-evidence wiring error becomes an ESCALATE verdict, never a silent pass. The two call sites are symmetric (`activities.ts:1689` declares the item, `activities.ts:1785` supplies the command) so no live path can declare it without evidence.
- **WP-609 live-proven — the spec's Thesis-KPI, met.** This run's own completion review carries
  `✓ pre_existing_suite_still_green — regression suite command \`pnpm --filter @chikory/sdk exec vitest run test/judge test/workflow\` exited 0`. That row was settled by a real exit code in this run's real journal. dogfood-135 could not produce it (F-197).

**Designed traps — all seven rejected:**

| trap | rejected by |
|---|---|
| A output appended but design-only framing kept | `completion-review.ts:116-121` branches the header; AC-2 scenario 1 green |
| B framing rewritten for every brief | `completion-review.ts:122-126` keeps the WP-537/F-196 wording; AC-2 scenario 3 green |
| C runner-only conditional, override still permissive | `harness.ts:218-220` errors; AC-1 §4 green |
| D item dropped entirely | AC-2 scenarios 1–2 still require the full WP-609 block/seal behavior |
| E findings starved to fit the log | 🟡 **only partly** — see F-323 |
| F fix delivered to the judge prompt | AC-2 reads `input.context.judgeFeedback` off the adapter |
| G membership proven by an executor-authored unit test | AC-1 owns its oracle against `dist/index.js` |

**Scope discipline:** 🟢 exactly the surfaces the goal named. No new dependency, no `any`, no provider
SDK, no key. `src/types.ts` untouched. The one file not named by the goal
(`test/runner/regression-suite-repair-live.test.ts`) is added regression coverage for the delivered
behavior — trivially entailed, and the judge scored `scope_matches_instruction` ✓.

**Not proven by this run (F-197, expected):** the worker process was started from `b503517` before
the delivery existed, so both judge passes ran the OLD judge code. Judge pass #1 (per-step) therefore
still shows `✓ pre_existing_suite_still_green — no regression suite command executed for this pass` —
the exact unmeasured green F-321 names. That is the pre-fix behavior on a pre-fix worker, not a defect
in the delivery. **The signature to check next run:** per-step judge passes must carry **no** suite row
at all, and the completion review must carry it only when the spec declares `regression_suite`.

## New friction

### F-323 🟡 — the suite excerpt is squeezed out by the whole-brief clamp, the exact failure the goal forbade

The goal required: *"The excerpt is bounded before the existing whole-brief clamp, **so the findings
can never be squeezed out**."* The delivery bounds the excerpt to 1000 chars
(`packages/sdk-ts/src/judge/harness.ts:208`) but `COMPLETION_BRIEF_MAX_CHARS` is 2000
(`packages/sdk-ts/src/workflow/completion-review.ts:19`), and the clamp truncates the **tail**
(`completion-review.ts:137-139`). Because `effectiveRubric` appends the suite item **last**
(`activities.ts:1690`), the suite row is last in `rubricResults` and therefore first against the cut.

**Measured** (probe against the built `dist/`, realistic vitest tail, ~353-char design justifications):

| co-occurring design findings | brief length | clamped | failing-test names | vitest summary line | closing instruction |
|---|---|---|---|---|---|
| 0 | 1491 | no | 🟢 | 🟢 | 🟢 |
| 1 | 1844 | no | 🟢 | 🟢 | 🟢 |
| **2** | **2000** | **yes** | 🟡 truncated mid-name (`…F…`) | 🔴 **lost** | 🔴 **lost** |

At two design findings the repair loses the `Test Files 2 failed | 173 passed` summary **and** the
line telling it to keep every acceptance criterion passing. Bounding the excerpt at half the brief cap
is not the same as reserving room for it. → **WP-614** (queued).

### F-324 🟡 — the AC and the delivery's own test both pin the bound, neither pins the goal

Two oracles looked at this and both missed F-323:

- `packages/sdk-ts/test/runner/completion-review.test.ts:282-292` — "clamps an oversized brief"
  asserts only `brief.length <= 2000`. It proves the clamp *fires*; it never asserts a finding
  *survives* it. A brief clamped down to the header alone passes this test.
- AC-2 scenario 1 drove `reviewForm(designPass = true)` — every design item passing — so the red
  suite was the **only** failing row. The input family "red suite **plus** design findings", which is
  the whole co-occurrence case, was never generated.

This is the third recurrence of the AC-input-family class (F-187/F-196/F-198): owning the oracle is not
enough if the oracle only ever sees one input family. → folded into **WP-614**, plus a review rule:
*when a spec's goal says "X can never be squeezed out by Y", an AC must drive X and Y together.*

### F-325 🟢 — four redundant typechecks narrated as a build, and CLI telemetry that misreports the command

Inside step 1 the executor issued four separate tasks (`task-156`, `-169`, `-178`, `-185`, 12–17 s
apart), each narrated as *"Let's run `pnpm run build`"*, and each returning a **typecheck** result.
Worse, the echoed command was `$ tsc --noEmit && tsc -p test/tsconfig.json --noEmit` — which is not the
repo's script; `packages/sdk-ts/package.json:21` defines `typecheck` as
`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`. So the telemetry in the transcript is not a
faithful record of what ran.

Cost was ~1 min of a 4m53s step and $0 (unpriced executor). The material risk is **review-side**: the
bounded transcript made it look as if `build`, `lint` and the full suite had never run, and only an
independent suite run disproved that. F-306 lineage (executor summary is raw stdout). → **track-B
note**; the durable countermeasure is already the standing rule — re-run the suite yourself.

**Checked and cleared, not friction:**

- **Cost meter blind** (`⚠ cost meter blind (unpriced tokens)`, 7022 tokens at $0.0000) is the known
  standing condition for `gemini-cli`, already recorded in dogfood-129/130/131/133/134. No new item.
- **Judge pass #2 rationale** reads `work in progress, no regressions — no criteria evaluated` on a
  run-completion review. Cosmetic: the completion review by design fills no `criterionResults`. Noted,
  no item.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-323 | 🟡 | 1000-char suite excerpt vs a 2000-char tail-truncating brief clamp — at 2 co-occurring design findings the failing-test summary and the closing instruction are both cut | **→ WP-614 (queued)** |
| F-324 | 🟡 | the clamp test asserts only `length <= 2000`, and AC-2 never co-occurred a red suite with a design finding — neither oracle can see F-323 | **→ WP-614 (queued)** (same WP; the fix must ship the missing input family) |
| F-325 | 🟢 | executor ran typecheck 4× narrated as `build`; CLI telemetry echoes a command string the repo does not define | **track-B note** — DOGFOODING §8, F-306 lineage |

## Verdict on the thesis

- **Real-time judging worked as plumbing, not as a catch.** Both acceptance checks executed
  (`exited 0` in the judge pass), the family split was genuine (executor `gemini-cli(gemini)` vs judge
  `openai-compat/gpt-5.6-sol`), and the judge's design rubric was substantive prose about the actual
  seam. But it scored `design_serves_overall_goal` ✓ and `cumulative_design_coherent` ✓ over a delivery
  that misses an explicit, measurable clause of its own goal. **Judge true-positives this run: 0.**
- **Durable execution: clean.** One step, one checkpoint (`@5`, `lastGood true`), zero resumes, zero
  duplicate journal entries, harvest byte-identical 9/9.
- **The gate is now honest about what it measured** — the single most important property for a control
  plane that intends to publish a reliability number. A green it never measured was the one thing it
  could not be allowed to write down, and it no longer does.
- **Standing caution:** two runs in a row (135, 136) shipped a defect inside the very gate they built,
  and in both cases the AC that owned the oracle drove only one input family. The gate is converging,
  but the *oracle design* is the bottleneck, not the implementation.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 6m 38s | 4 steps (dogfood-135), trailing-3 max 4 |
| kill → resume count | 0 | 0 across trailing 3 |
| judge true-positives pre-land | 0 | 1 (134–136: 0, 1, 0) |
| meta:product headline ratio | 0:1 (product) | **0:3** — cap ≤1 meta per 3, not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs ≥5) — target 99%+ |
| ladder rung vs exit gate | 0 (off-ladder, declared) | P3 exit gate = rung 5 (WP-530), operator-blocked on `brownfield-001` gold patch + a both-arms re-run |
