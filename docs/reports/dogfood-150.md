# dogfood-150 — a step that changed nothing no longer hands the reviewer a clean bill of health (WP-632)

**WP:** WP-632 (an empty-diff step must not vacuously green a model-judged rubric row, nor spend the one bounded repair attempt) · **Date:** 2026-08-17 ·
**Spec:** `examples/dogfood/dogfood-150-wp632-empty-step-rubric-carryover.yaml` ·
**Run:** `run-17010886-9ade-4937-8d9f-db0a67b143a7` · **Landed:** this review's commit ·
**Ladder:** rung-0 (off-ladder; P3-rung-5 — the last rung of the moat ladder — is operator-by-hand and cannot headline)

## Plain lead

When the agent takes a turn and changes nothing, the reviewer used to re-score the
open design questions from a blank page, write "looks fine, nothing here to object
to", and burn one of the two chances the run gets to fix what it had already
complained about. That is fixed: an empty turn now keeps the previous answer to
every question that can only be answered by looking at changed code, keeps the
freshly measured answer to the machine-checked ones, and costs no repair chance.

The run delivered all of that in **one step for $0.10**, and the judge passed it
3/3 twice. Human review then found **three defects the judge did not see**, all in
the new code that decides what happens when the agent stalls — including one that
would hand a stalled agent a repair brief naming **no finding at all**, and one
that replaced a 2-attempt budget with one bounded only by the step cap. All three
were probe-confirmed both ways and **hand-fixed this sitting**.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 12m 16s |
| cost | **$0.1019** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **unpriced** (keyless CLI OAuth; `$0.0000` with 5,263 tokens metered, annotated `UNPRICED` by `packages/sdk-ts/src/cli/trace.ts:464`) |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 2 passes · $0.0617 + $0.0402 |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.8k/1.5k | $0.0000 | 9m 0s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Judge share is 100.0% by construction, not by waste** — the gemini executor is
keyless (CLI OAuth), so its wire cost is structurally $0 (F-230). The two judge
passes are the run's entire measured spend.

## Delivery quality (human review, post-landing)

### Landed files

| file | Δ | what |
|---|---|---|
| `packages/sdk-ts/src/judge/rubric.ts` | +32 | `reconcileEmptyStepRubric` (`:158`) — the pure precedence rule |
| `packages/sdk-ts/src/judge/index.ts` | +1 | re-export |
| `packages/sdk-ts/src/runner/activities.ts` | +40 | empty-step detection, previous-answer map, rubric reconciliation + verdict rebuild inside `judgeStep` |
| `packages/sdk-ts/src/workflow/agent-loop.ts` | +41 | the zero-byte stall branch: grant the repair, spend no completion-review grant |
| `packages/sdk-ts/test/runner/empty-step-rubric-carryover-live.test.ts` | +391 | 7 tests (4 pure + 3 live-runner) |

**505 insertions, 0 deletions, 5 files.** Scope is exactly the goal's surface — no
unrelated file, no new dependency, no deletion. Every out-of-scope item the goal
named (`decideQuestionStep`, `STANDING_APPROVAL_ANSWER`, the settling rule,
`MAX_COMPLETION_REVIEWS`, `standingConcerns`, the rubric item set, the charter, the
TaskSpec contract, the WP-616/WP-631 render caps) is byte-unchanged.

### The goal, line by line

- **Site 1 (the vacuous green) — met.** `reconcileEmptyStepRubric`
  (`packages/sdk-ts/src/judge/rubric.ts:158`) reuses
  `isRubricItemSettledAgainstWholeDelivery` rather than inventing a second
  classification, exactly as the spec demanded, and implements all three
  precedence rules including "no previous answer → this pass's answer stands".
- **One form, not two — met and independently checked.** The reconciled form is
  rebuilt through `buildVerdict` *before* the `judge` and `verdict` payloads are
  written, so the journaled verdict, `standingRubricFindings`, `computeVerdict`
  and `chikory trace` all read the same object. The rebuild passes the same
  `criteriaHistory`, `rubric` and `workChunkInProgress` the original pass used
  (`packages/sdk-ts/src/judge/harness.ts:328` vs the rebuild) — so it is a faithful
  recompute, not a second opinion.
- **Replay-safe — met.** `computeVerdict` copies `criteriaHistory` rather than
  mutating it (`packages/sdk-ts/src/judge/verdict.ts:126`), so running it twice on
  one pass is inert; and the crash-window path rebuilds from the **already
  reconciled** journaled form, so a crash between the `judge` and `verdict` writes
  recovers the same answer.
- **Site 2 (the spent repair grant) — met, but by a mechanism with three holes.**
  `MAX_COMPLETION_REVIEWS` is still literally 2 and the empty step is still judged;
  the new branch grants the repair without incrementing the counter. What the goal
  did not pin — and no AC probed — is what that branch does when there is nothing
  to brief, when the executor stalls *again*, and when the pass covered real work.
  See F-373/F-374/F-375.
- **Repo tests — met.** 7 tests land under `test/runner/`, and they cover both
  candidates the spec left open (a run with no empty step; an ASKING empty step
  taking WP-608's classifier path). Suite grew 1,540 → **1,547 tests** (+7).

### The designed traps

| trap | rejected? | evidence |
|---|---|---|
| A — skip the judge pass on an empty diff | ✅ | the pass is still run and journaled; AC-1 reads its verdict |
| B — carry EVERYTHING forward | ✅ | `isRubricItemSettledAgainstWholeDelivery` keeps `tests_pass` fresh |
| C — make the model-judged row sticky forever | ⚠️ **partly** | rejected at cadence 1 (AC-3); **evaded at cadence ≥2** — F-375 |
| D — invent an answer when there is none | ✅ | rule 3; AC-3 drives an empty FIRST step |
| E — buy the repair by raising the budget | ⚠️ **in letter** | `MAX_COMPLETION_REVIEWS` is still 2 — but the stall path is bounded only by `maxSteps`, which is the same purchase by another route — F-374 |
| F — touch WP-608's ask path | ✅ | classifier lines byte-unchanged; AC-3 greps them |

### Independent verification

The acceptance checks took three things on trust that this review measured itself:

- **Suite baseline, measured by hand (F-342).** At the launch commit the spec
  claimed 191 files / 1,540 tests. Re-run here: **as landed, 192 files / 1,547
  tests (1,524 passed | 23 skipped), 66.52s**; after the hand-fixes, **193 files /
  1,551 tests (1,528 passed | 23 skipped), 65.60s**. Green throughout.
- **Harvest fidelity.** 5/5 byte-IDENTICAL before this review touched anything.
- **The three defects below**, each proved with a live-runner probe run **both
  against the delivery as landed and against `HEAD` without it**.

## New friction

### 🔴 F-373 — a stalled step with a standing finding gets a repair brief that names nothing — HAND-FIXED THIS SITTING

The new stall branch fired on `record.diffRef.bytes === 0 && (sealingVerdictHasRubricFailures || hasStanding)`.
The `|| hasStanding` half is reachable with an **empty** sealing rubric — that is
precisely the shape WP-630 built, where a model-judged finding survives an
intervening clean pass. In that state the branch briefs the executor with
`rubricResults: []`, and `buildCompletionReviewBrief`
(`packages/sdk-ts/src/workflow/completion-review.ts:130`) emits its header and its
closing line with **nothing between them** (`:140` guards the findings list on
`rubricFails.length > 0`):

```
DESIGN REVIEW BRIEF — every acceptance criterion passes; a completion review
of the run's CUMULATIVE changes found design findings. One bounded fix
attempt is granted; do NOT change behavior, only design.
a fix must resolve these findings while keeping every acceptance criterion passing.
```

Two harms. The brief **names no finding**, and it **asserts a completion review
ran** when the branch's whole purpose is to skip it. And skipping it skips the
adjudication: `escalation_concerns_adjudicated` is the row WP-619 added to answer
standing findings, and it is never asked.

**Probe (live runner, scripted judge, real Temporal).** Pass 1 raises a design
objection; pass 2 is clean against a real diff; step 3 stalls at 0 bytes.

| | steps | judge passes | completion reviews | brief handed to the executor |
|---|---|---|---|---|
| `HEAD` (before the delivery) | 3 | 3 | 1 | — (sealed at step 3) |
| delivery as landed | **4** | **4** | 1 | **DESIGN REVIEW BRIEF with 0 findings** |

**Hand-fix:** gate on the failing rubric alone
(`packages/sdk-ts/src/workflow/agent-loop.ts:1300`); the standing-only case falls
through to the completion review that exists to adjudicate it. Site 1's
carry-forward is what makes this sufficient — the empty-step shape F-369 measured
now re-raises the previous pass's **failing** row at this gate.

### 🔴 F-374 — the bounded repair budget was replaced with one bounded only by `maxSteps` — HAND-FIXED THIS SITTING

The branch grants a repair **without any counter of its own**. Its only bound is
`stepIndex < maxSteps`. WP-632 asked that a stall not *spend* a grant; the delivery
removed the ceiling instead. A persistently stalling executor re-enters the branch
every step and buys a judge pass each time — at this run's own measured rate,
~$0.05 per pass.

**Probe (same harness, 5 consecutive 0-byte stalls, `maxSteps: 8`):** the delivery
granted the repair on **all 5**, journaling 8 judge passes and handing the same
brief each time. `MAX_COMPLETION_REVIEWS` is 2.

This is [[bounded-channel-made-unbounded]] (F-365) again, in a different module:
a fix that stops a budget being *spent wrongly* removed the budget.

**Hand-fix:** a separate `stallRepairGrants` counter capped at the same ceiling
(`packages/sdk-ts/src/workflow/agent-loop.ts:271`, checked at `:1302`). It is a
workflow local and resets on `chikory resume` — deliberate, and stated in the
comment: a resume is operator-initiated and its worst case is two further grants.
`MAX_COMPLETION_REVIEWS` is untouched, so AC-2's trap-E guard still holds.

### 🔴 F-375 — a judge pass that read a REAL diff was classified empty, and its fresh answer discarded — HAND-FIXED THIS SITTING

The delivery classified the pass from **the last step's byte count**. But an empty
step fires an off-cadence milestone pass whose evidence spans **every step since
the last verdict** (`repoDiffBasesSinceLastVerdict`). At cadence ≥ 2 — the
`makeSpec` default and a real configuration — the judge reads earlier steps' real
diffs, answers them, and the delivery then overwrites that answer with a stale one.

**Probe.** Cadence 2, `maxSteps: 6`. Steps 1–3 deliver real 24-byte diffs; only
step 4 stalls. Pass 1 objects; pass 2 reads step 3's real diff and clears it.

| verdict at | delivery as landed | after hand-fix |
|---|---|---|
| step 2 | `design ✗ "STALE-OBJECTION…"` | `design ✗ "STALE-OBJECTION…"` |
| step 4 (the stall) | `design ✗ "STALE-OBJECTION…"` — **fresh answer discarded** | `design ✓ "FRESH-ASSESSMENT…"` |

This is the goal's own **trap C** — "a later non-empty step that genuinely fixes
the design must be able to turn the row green" — one altitude up: AC-3 drove it at
cadence 1 only, so the trap was armed for the wrong altitude.
[[ac-must-enumerate-input-families]] again: the AC owned its oracle but probed one
value of `cadence`.

**Hand-fix:** `everyStepSinceLastVerdictIsEmpty`
(`packages/sdk-ts/src/runner/activities.ts:853`) asks whether **every step the pass
covers** delivered nothing, over the same window the diff base uses; an empty
window returns `false`, so nothing is carried when nothing can be characterised.
Wired at `packages/sdk-ts/src/runner/activities.ts:1713` and read at `:1852`.

⚠️ **A first attempt at this fix — `AND`-ing the collected evidence bytes — turned
AC-1 red**, because the scripted test adapter still writes `step-<n>.txt` into the
workspace on an "empty diff" step, so the git evidence is non-empty while the
reported `diffRef` is zero. The AC caught it. Keying on the **journaled step
records** instead is both correct in production and independent of that harness
divergence. Recorded because it is a live example of a test-double whose two
notions of "empty" disagree.

### Pins

`packages/sdk-ts/test/runner/empty-step-stall-boundaries-live.test.ts` — 4 live
tests (`:178`, `:235`, `:273` plus a substrate guard), each verified **RED against
the delivery as landed** and **GREEN after the fix**. Suite 1,547 → **1,551**.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-373 | 🔴 | The stall branch fires on a standing finding with a clean sealing rubric, briefing the executor with zero findings and skipping the adjudication review | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/agent-loop.ts:1300`; pinned by `empty-step-stall-boundaries-live.test.ts:178`, probe-verified RED against the as-landed delivery |
| F-374 | 🔴 | A stall's repair grant is bounded only by `maxSteps`, not by `MAX_COMPLETION_REVIEWS` — 5 consecutive stalls all granted, 8 judge passes | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/agent-loop.ts:271` + `:1302`; pinned by `empty-step-stall-boundaries-live.test.ts:235` |
| F-375 | 🔴 | At cadence ≥2 a milestone pass that read earlier REAL diffs is classified empty and its fresh answer discarded (the goal's trap C, one altitude up) | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/runner/activities.ts:853`; pinned by `empty-step-stall-boundaries-live.test.ts:273` |

Suite after all three: **193 files / 1,551 tests (1,528 passed | 23 skipped)**,
65.60s, and AC-1/AC-2/AC-3 re-run **PASS**.

## Verdict on the thesis

- **The durable-execution half is uneventful and that is the point.** 1 step,
  1 checkpoint, 0 resumes, 0 rollbacks, harvest byte-identical, journal clean.
- **The judge half caught nothing, again, and shipped three defects.** Two passes,
  both PROCEED, `design_serves_overall_goal` PASS with a confident and specific
  justification ("one consistent mechanism… replay-safe workflow branch… focused
  repository tests cover precedence, non-empty behavior, the approval-question
  path, and stalled repair"). Every one of those clauses is true; none of them is
  the question. The three defects live in **input families the delivered tests
  never instantiate** — a clean sealing rubric with a standing finding, a second
  consecutive stall, `cadence: 2`. This is the standing shape of
  [[ac-must-enumerate-input-families]]: a judge reading a diff plus the tests the
  executor wrote for it inherits that suite's blind spots exactly.
- **`judge_catches` = 0 this run**, and the run sealed 🟢 SUCCESS with three 🔴
  loop-integrity defects in it. A green seal is not evidence there was nothing to
  find — the third consecutive run where human review is the gate that held.
- **The specific lesson is narrower and worth keeping:** a WP that *removes* a
  spend (WP-632: "a stall must not spend a grant") is a budget change. Ask what
  the new ceiling is. Twice now — F-365, F-374 — the answer has been "there isn't
  one".

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 12m 16s | 3 steps (dogfood-149) over trailing-3 |
| kill → resume count | 0 | 0 over trailing-3 |
| judge true-positives pre-land | **0** | 1 (149) · 0 (148) · 0 (147) |
| meta:product headline ratio | product | **0:3** harness-meta over trailing-3 (cap ≤1:3 ✅) |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung-0 (off-ladder) | P3 exit gate = rung-5; its remaining half (WP-304 / `brownfield-001`) is operator-by-hand |
