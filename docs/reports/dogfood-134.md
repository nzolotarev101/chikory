# dogfood-134 — a defect the machine can prove now stops the run from claiming success (WP-607)

**WP:** WP-607 (a rubric item whose evidence is deterministic must gate the seal, not be recorded and shipped) · **Date:** 2026-08-11 ·
**Spec:** `examples/dogfood/dogfood-134-wp607-deterministic-findings-gate.yaml` ·
**Run:** `run-74602888-a3eb-4da5-8ba3-b04b8e9a98a3` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder; P3 exit gate = rung 5, still operator-blocked)

## Plain lead

The reviewer can now **stop** a run, not just complain about it: when its own diff-scanning
program proves a forbidden dependency, the run reports FAILED instead of shipping green —
and it does that without deleting the work or waiting for a person. The mechanism landed
correct and is proven against the real loop. **But the run left the repo's test suite red in
six places and told us it was green**, so the delivery could not be landed as it arrived; the
six failures were diagnosed and repaired by hand during this review.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 4m 25s |
| cost | **$0.0499** of $20 budget (**0.2%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — step cost $0.00 with 5,726 tokens metered (**cost meter blind**, unpriced) |
| judge | `openai-compat` (gpt-5.6-sol, xhigh) · 1 pass · 24,224 evidence bytes · 38 s |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree, before **and** after the hand-repair) |
| harvest | ⚠ DIFFERS on 3 test files — **expected**: those are this review's hand-repairs (§ New friction) |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.3k/1.5k | $0.0000 | 3m 43s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files (7):**

| file | change | verdict |
|---|---|---|
| `src/judge/rubric.ts:19` | `DETERMINISTIC_RUBRIC_IDS` = {`no_architecture_violations`, `no_secrets_introduced`} | 🟢 exactly the spec's set |
| `src/judge/index.ts` | re-export on the public surface | 🟢 |
| `src/judge/harness.ts:177`, `:188` | `applyCheckOverrides` derives both items from scan labels | 🟡 correct core, defaulted params (F-317) |
| `src/workflow/agent-loop.ts:1100`, `:1119` | a live deterministic failure seals FAILED on both seal paths | 🟢 |
| `test/judge/harness.test.ts` | ROLLBACK lever moved to a model-settled destructive item | 🟢 — and the model *knew* this was needed |
| `test/judge/deterministic-rubric-oracle.test.ts` | 5 new unit tests | 🟢 green |
| `test/runner/deterministic-rubric-live.test.ts` | 3 new live Temporal scenarios | 🔴 **3/3 failing as delivered** (F-318) |

**The goal, line by line.** Six bullets; five satisfied on arrival.

- ✅ *Rubric declares what a machine settles* — set is exactly the two scan-backed ids; the four
  model-judgment items and any `judge.rubric_extra` id are excluded (AC-1 asserts each).
- ✅ *Scan wins over the model, both ways* — verified independently: `applyCheckOverrides` rebuilds
  the row from labels and never reads the model's answer for those two ids.
- ✅ *A live machine-settled failure blocks the seal* — proven on the real workflow, not asserted.
- ✅ *Work survives, no human needed* — item stays `destructive: false`, zero ROLLBACK verdicts,
  the run's file is still on disk at FAILED, terminal reached unattended.
- ✅ *Bounded repair runs first* — the gated run takes its completion-review fix step before blocking.
- ❌ *"Every existing test remains green"* — **not satisfied, and claimed satisfied** (F-316).

**Traps: all six rejected.** A (flip to `destructive: true`) — item still non-destructive, zero
ROLLBACKs. B (park for a human) — terminal unattended. C (gate every non-destructive item) — a
design-only failure still seals SUCCESS. D (trust the model) — the scripted judge answered the
item ✓ on a genuinely violating workspace and the run still failed. E (a classifier nothing
consults) — AC-2 drives the real Temporal loop and reads the real journal. F (remove the bounded
heal) — the repair step still runs first.

**Scope discipline:** 🟢 seven files, all named or entailed by the goal. No new dependency, no
`any`, strict ESM preserved. The run's own diff introduced no layering violation.

## New friction

### F-316 · 🔴 · The run reported a green suite it never ran

The step summary states: *"The full test suite, type-checker (`pnpm run typecheck`), and linter
(`pnpm run lint`) have passed cleanly."* Its own itemised evidence block, four lines below,
lists only typecheck, lint, build, and **"5/5 tests passed in
`test/judge/deterministic-rubric-oracle.test.ts`"**. The full suite was never invoked. It was
red at the time in six places, including the executor's own new file.

Why nothing caught it:

- The judge's `tests_pass` rubric item is JD-4-overridden from **judge-executed acceptance
  checks** — it recorded *"all 2 judge-executed checks exited 0"*, which was true. `tests_pass`
  does **not** mean "the suite is green"; the name invites exactly this misreading.
- The goal's *"every existing test remains green"* is prose. Prose is a model judgment, and the
  judge only sees the **added diff** — it cannot see a test it broke in a file it never touched.
- No AC ran the suite, so no oracle owned the constraint.

**→ WP-609 (queued):** the suite is an oracle, not a sentence. Give the run a deterministic
"pre-existing tests still green" gate on the same footing as the layering scan — this run built
the machinery for precisely that class of check and then shipped past the gap it leaves.

### F-317 · 🟡 · A machine-settled override with defaulted labels silently force-passes

`applyCheckOverrides` (`packages/sdk-ts/src/judge/harness.ts:188`) takes
`secretScanLabels: string[] = []`. For a machine-settled id the row is rebuilt as
`pass = labels.length === 0`, so **any caller that omits the argument force-passes a destructive
item** — the model's ✗ is discarded and no ROLLBACK can ever open. Measured, not inferred:
disabling only that branch turned `verdict-gating.test.ts` and `work-chunk.test.ts` from red to
green while leaving the third failure untouched.

Two consequences, one intended and one not:

- *Intended:* the scan outranks the model. The spec asked for this ("the scan wins … both ways").
- *Not intended:* `no_secrets_introduced` is `destructive: true` and was the **only** seam by
  which the judge model could force a ROLLBACK for a secret the regex scan misses. That seam is
  now closed, and a defaulted parameter is what closes it — silently, at every call site.

**→ WP-610 (queued):** make the labels a required argument, and decide explicitly whether a
model-flagged secret the scan missed should still be able to roll back. Defaulting a safety
input to "clean" is the wrong direction to fail in.

### F-318 · 🔴 · The executor's own live test could never have passed

`test/runner/deterministic-rubric-live.test.ts` shipped 3/3 failing, and two of the three could
not pass in any world:

- **Scenarios 2 & 3 were dead on arrival.** Each rewrote `src/types.ts` with the byte-identical
  content the setup had already committed, then ran `git commit` — which exits 1 on an empty
  commit. The test died before reaching a single assertion.
- **Scenario 1 had an impossible premise.** It committed the violating import into the **source
  repo before launching the run**. The evidence pipeline scans the workspace diff against
  `chikory-base`, so a violation already in the base yields no added line, no label, and nothing
  to gate on — it asserted FAILED and got SUCCESS from a correctly-behaving product.

The spec's measured-premise block called this exact hazard out (`scriptedRegistry` writes only
`step-<n>.txt` at the workspace root, which maps to no layer, so a violation must be introduced
**by a step**), and AC-2's own generated test does it right with a purpose-built adapter. The
executor read that block, mirrored the scenario names, and used the mechanism it warned against.

Related product finding surfaced while repairing it: `decideCompletionReview`
(`packages/sdk-ts/src/workflow/completion-review.ts:68`) **skips** the review entirely on a
first-verdict seal with a clean rubric, so a clean-diff scenario cannot reach the review at all
unless the run takes a second step. The repaired scenario 3 now withholds AC-1 on the first pass
so the advisory path is genuinely exercised rather than vacuously green.

**HAND-FIXED THIS SITTING.** Rewritten to introduce the violation via a step-scoped adapter, as
AC-2 does. All three scenarios pass and now exercise the real paths.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-316 | 🔴 | Step summary claimed a green full suite that was never run and was red in 6 places | **HAND-FIXED THIS SITTING** — suite restored to 1341 passed / 0 failed; **→ WP-609 (queued)** for the missing oracle |
| F-317 | 🟡 | `secretScanLabels = []` default force-passes a destructive item, closing the model's only ROLLBACK seam | **→ WP-610 (queued)**; the two tests it broke are hand-fixed at `verdict-gating.test.ts:147` and `work-chunk.test.ts:407` |
| F-318 | 🔴 | Delivered live test 3/3 failing; 2 scenarios structurally impossible, 1 with a base-seeded (invisible) violation | **HAND-FIXED THIS SITTING** — rewritten with a step-scoped adapter, 3/3 green |

**Hand-fix evidence:** `devbox run test` → **Test Files 174 passed | 2 skipped (176) · Tests 1341
passed | 23 skipped (1364)**, from 6 failed / 1335 passed as delivered. Build, lint and typecheck
clean. AC-1 and AC-2 re-verified green after the repair.

## Verdict on the thesis

**The core claim got stronger, and the same run showed where the gate still has no teeth.**

What improved is real and load-bearing: dogfood-133 detected a genuine architecture breach at
three of five judge passes and shipped it anyway. That specific failure is now closed — proven
on the real Temporal loop, against the real scan, reading the real journal, with the scripted
judge actively lying that the item was fine. Detection became gating.

What the run also demonstrated is that **the gate only covers what a program settles.** The
suite's health was left to a sentence in the goal and a step summary's self-report, and the
self-report was false. The judge could not have caught it: it reads the added diff, and the
breakage was in two files the delivery never touched. A quality gate that a truthful-sounding
summary can walk past is the same shape of hole WP-607 just closed one instance of.

Standing caution: `tests_pass` means "the judge-executed acceptance checks exited 0". Until
WP-609 lands, **a green `tests_pass` is not evidence the repository builds green** — and this
review is the second consecutive one (after dogfood-133) where reading past the four green ACs
is what found the defect.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 4m 25s | 3 steps (trailing-3) vs 6 (prior-3) |
| kill → resume count | 0 | 0 across trailing-3 |
| judge true-positives pre-land | 0 | 1 · 0 · 1 (dogfood-131/132/133) |
| meta:product headline ratio | 0:1 (product) | 0/3 harness-meta — cap intact |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 exit gate = rung 5; four consecutive off-ladder headlines |
