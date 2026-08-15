# dogfood-141 — a judge finding now outlives its diff window (WP-601)

**WP:** WP-601 (standing findings survive to the seal) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-141-wp601-standing-findings.yaml` ·
**Run:** `run-5ab10621-fd38-420d-aff2-176486cf9f9a` · **Landed:** this review's commit ·
**Ladder:** off-ladder (rung stays 4; rung-5 residue is operator-by-hand)

## Plain lead

The run built exactly what was asked — a judge objection now follows the run to
the end and must be answered before the run may seal — and the delivery is good:
every acceptance check passes, the full test suite is green, and the work landed.
But the run itself was **condemned by the very gate the previous run shipped**: the
judge raised a concern that no code diff could ever answer ("the executor never
showed me it ran its own verification commands"), the new adjudication honestly
upheld it, and a correct delivery sealed FAILED. The gate asked the wrong
question; that question is now fixed (F-344), and the spec boilerplate that
manufactures this concern class is retired (F-345).

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED (resumable) · 1 step · 13m 12s · reason: `completion review: unresolved finding on a converged step — escalation_concerns_adjudicated` |
| cost | **$0.1036** of $20 budget (**0.5%**) — judge share **100.0%** (executor is keyless Antigravity OAuth, $0 wire cost by design) |
| executor | `gemini-cli(gemini)` · `gemini-3.7-flash-high` — tokens ESTIMATED (chars/4), not a cost-meter defect |
| judge | `openai-compat` (`gpt-5.6-sol xhigh`) · 2 passes ($0.0573 step + $0.0463 completion review) |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 1 (`@5`, workspace commit `a4542c8`) · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree, harvested delivery) |
| harvest | 6/6 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.3k/133 (estimated) | $0.0000 (keyless) | 10m 1s — **killed at the 600 s step cap** (601.4 s, retriable) | ⚠ ESCALATE (all criteria/rubric pass; 1 out-of-rubric concern) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## What actually happened (the condemnation chain)

1. The spec's **VERIFY YOUR OWN WORK** boilerplate ordered the executor to run
   the SDK's build, lint, typecheck AND full vitest suite in-step and report the
   counts. The executor finished the 34 KB diff, launched the suite, and spent
   the rest of the step waiting on it — its step summary is twelve variants of
   "Waiting for tests to complete".
2. `runCliStep` killed the step at the 600 s cap (601.4 s). The verification
   report the boilerplate demanded was never written.
3. Judge pass #1: **every criterion and rubric item passed** (AC-1 exercised the
   delivered standing-findings machinery), but the judge ESCALATEd with one
   concern: *"The evidence does not show the executor completing and reporting
   the four separately required SDK pnpm commands…"* — which is TRUE, and also
   not a defect in the delivery.
4. The WP-619 adjudication (built one run earlier) put that concern to the
   completion review. The reviewer passed `design_serves_overall_goal` and
   `cumulative_design_coherent`, ran the declared regression suite itself
   (green, exit 0), **and still upheld the concern** — because the rubric asked
   "is the concern cleared by the cumulative diff?", and a diff can never prove
   process compliance. Honest judge, un-answerable question.
5. Under `unattended: seal_resumable_failed` the run sealed resumable FAILED
   naming `escalation_concerns_adjudicated`. Total cost of the false
   condemnation: $0.10 and one run slot.

Note the WP-619 mechanics themselves worked exactly as designed — one extra
judge pass, terminal-or-nothing, outcome followed the answer, reason named the
item. This run is WP-619's live proof (the F-197 shape: a run cannot exercise
the gate fix it ships; the NEXT run does). The defect was the adjudication
standard, not the machinery.

## Delivery quality (human review, post-landing)

| file | what it does |
|---|---|
| `packages/sdk-ts/src/workflow/agent-loop.ts` | `standingFindings` accumulator (`agent-loop.ts:266`); every judge pass's failed rubric items + free-text concerns are collected (`agent-loop.ts:1086`, `agent-loop.ts:1092`), deduped, and carried to the seal; the completion review receives the full set; adjudication is one-pass terminal-or-nothing |
| `packages/sdk-ts/src/workflow/completion-review.ts` | `hasStandingFindings` input; the skip-fast-path now also yields to standing findings |
| `packages/sdk-ts/test/runner/standing-findings-live.test.ts` | NEW — 406-line live Temporal proof: findings survive clean windows, both families (rubric + concern) reach the review verbatim, cleared→SUCCESS / upheld→resumable FAILED naming the item, finding-less run untouched |
| `packages/sdk-ts/test/runner/completion-review-live.test.ts` · `completion-review.test.ts` · `deterministic-rubric-live.test.ts` | expectations updated from the old repair-loop shape to one-pass adjudication, plus 2 new `decideCompletionReview` matrix rows |

- Goal line-by-line: all seven "make these true" bullets delivered; the per-step
  judge window is untouched; terminal statuses stay the frozen SUCCESS/FAILED
  pair; no new dependency; Temporal-replay-safe (workflow-local accumulator,
  no clock).
- The test rewrites are **spec-mandated, not weakening**: "exactly one extra
  judge pass, and never a return to the loop" deliberately supersedes the
  WP-611-era one-fix-step repair for standing findings (the bounded repair
  path survives only for review-fresh findings). The run's own completion
  review confirmed no leftover repair scaffolding.
- Independent verification on the harvested tree: build ✅ · lint ✅ ·
  `tsc --noEmit` ✅ · full vitest **1462 passed | 23 skipped**, with the one red
  being `test/chain/fan-in-handoff.test.ts` under full-suite parallel load —
  re-run in isolation per the DOGFOODING §7 recipe: **2/2 green in 7 s**
  (**F-276, known load flake**, not a regression).
- Scope discipline: 6 files, all inside the goal's surface. Nothing out of
  scope, no new dependencies.

## New friction

### F-344 🔴 — the adjudication asks a question no diff can answer, so an honest judge condemns a correct delivery

The `escalation_concerns_adjudicated` rubric row asked whether the concern is
"cleared by the cumulative diff". A concern about **missing process evidence**
("the executor never showed it ran its verification commands") is structurally
un-clearable by any diff — upholding it is the only honest answer, every time,
even while the same pass holds green trusted evidence (judge-executed AC checks,
the declared regression suite it ran itself). Any spec that mandates
self-verification reporting + any cap-killed or terse executor = automatic
condemnation. The runner must not filter concern text (the WP-619 invariant), so
the fix belongs in the question. **→ HAND-FIXED THIS SITTING**: adjudication
standard written into the charter (`packages/sdk-ts/src/judge/prompt.ts:202`)
and the rubric item (`packages/sdk-ts/src/judge/rubric.ts:110`): uphold only a
finding that names a real defect/regression/unfulfilled requirement in the
DELIVERED work; a missing-process-evidence finding is settled by this pass's
trusted evidence. 2 new tests
(`packages/sdk-ts/test/judge/completion-review-rubric.test.ts:93`) pin the
standard present-with-concerns / absent-without; tsc + eslint clean; the 3
affected test files 21/21 green.

### F-345 🟠 — the VERIFY-YOUR-OWN-WORK spec boilerplate is a concern factory and a step-cap collision

The boilerplate demands the executor run build+lint+typecheck+**full vitest**
in-step and report counts. Three compounding harms, all observed this run:
(a) the judging rules refuse to trust executor self-reports, so the demanded
evidence is worthless when present and its absence reads as a violation — the
concern is manufactured by the spec itself (the same concern text rode
dogfood-140's seal as F-229/F-271); (b) the full suite inside a 600 s step cap
killed the step at 601.4 s mid-wait — twelve "Waiting for tests…" summary lines,
zero verification report; (c) the suite the executor burned the step on is the
SAME suite the harness runs as trusted evidence anyway (declared
`regression_suite` + judge-executed ACs). **→ RETIRED FROM SPEC PRACTICE THIS
SITTING** (DOGFOODING §3 authoring rule): a spec tells the executor to run only
fast per-package checks (typecheck/lint); full-suite verification belongs
exclusively to the declared `regression_suite` and judge-executed checks.
Applied to `dogfood-142`.

### F-346 🟡 — the DOGFOODING status-block script accretes one stale header per review

`dogfood-docs.mjs block --target dogfooding` anchored the block start on the
🟢/🔴/🟡 body line, not the `**Status (…)**` header above it — so each review's
replacement (which carries its own dated header) landed BELOW every prior
header. By this review three stacked headers (08-12 / 08-14 / 08-15) sat on the
living doc, the exact "never stack LATEST/Earlier paragraphs" drift the block
discipline exists to prevent. **→ HAND-FIXED THIS SITTING**: anchor moved to
the header (`scripts/dogfood-docs.mjs:57`), stale headers removed from
`docs/DOGFOODING.md`.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-344 | 🔴 | adjudication upholds a concern no diff can clear → converged, all-green run condemned | **HAND-FIXED THIS SITTING** — `prompt.ts:202` + `rubric.ts:110`, 2 new tests (`completion-review-rubric.test.ts:93`), 21/21 affected tests green |
| F-345 | 🟠 | VERIFY-boilerplate demands untrusted evidence + full suite in-step → cap-kill + manufactured concern | **RETIRED THIS SITTING** — DOGFOODING §3 authoring rule; dogfood-142 authored without it |
| F-346 | 🟡 | `block --target dogfooding` anchors on the body line → one stale Status header stacked per review (3 deep) | **HAND-FIXED THIS SITTING** — `scripts/dogfood-docs.mjs:57` anchor on the header; stale headers removed |
| F-276 | 🟡 | `fan-in-handoff` full-suite load flake (recurrence) | track-B note — already documented in DOGFOODING §7; 2/2 in isolation |
| F-306 | ℹ️ | executor summary = 12 lines of waiting narration (recurrence, cap-kill variant) | track-B note — summary content was harmless here; the cap-kill is F-345's harm |

## Verdict on the thesis

- **For the thesis:** the judge-detects-but-does-not-gate family is now CLOSED —
  all six altitudes gate (F-180/F-288/F-310/F-334/F-335/F-295·WP-601). A judge
  objection can no longer expire by window, be dropped by a rubric failure, or
  ride a green seal unanswered. The WP-619 gate demonstrably decides outcomes
  in both directions — this run IS its live proof.
- **The standing caution, upgraded:** a gate is only as good as the question it
  asks. dogfood-140 shipped a gate that condemned when there was *nothing* to
  adjudicate (F-340); one run later the same gate condemned on a concern that
  was *un-answerable by construction* (F-344). New gates must ship with their
  question adversarially tested against the concern classes the judge actually
  emits — the judge's historical concern corpus is sitting in the journals.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 13m 12s | trailing-3 max steps 1 (vs prior-3: 4) |
| kill → resume count | 0 resumes (1 step-cap kill, work preserved) | 0 |
| judge true-positives pre-land | 0 (the sole concern was a false positive on the delivery) | 139: 2 · 140: 1 · 141: 0 |
| meta:product headline ratio | product (WP-601 is runner/judge core) | 0/3 harness-meta — cap ≤1/3 respected |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs ≥5) — target 99%+ |
| ladder rung vs exit gate | 0 (off-ladder) | rung 4 climbed; rung-5 = leaderboard live ✅ half + corpus half (operator-by-hand) |
