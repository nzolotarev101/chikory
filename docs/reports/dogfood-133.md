# dogfood-133 — a spec can now state its own quality rule, and the judge is actually asked it (WP-604)

**WP:** WP-604 (a spec must be able to state a run-scoped judge rubric item, and losing one must be loud) · **Date:** 2026-08-11 ·
**Spec:** `examples/dogfood/dogfood-133-wp604-rubric-channel.yaml` ·
**Run:** `run-83bf691d-75b5-4848-a182-6e66dcb6b857` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder by declaration) vs the P3 exit gate = rung 5

## Plain lead

A task spec can now write down a quality rule for its own run — "this run must not
touch the gate-repair path" — and the reviewer model is genuinely asked that rule on
every pass and has to answer it. The channel that only *looked* like it did this was
deleted, so declaring it now fails loudly instead of silently doing nothing.

The run delivered that in one working step and both acceptance checks pass. But the
reviewer model **also found a real architecture defect in the delivery, said so three
times including at the very last check, and the run shipped green anyway** — the one
repair attempt the system grants was spent by the coding agent writing a plan and
asking for permission instead of making the change. The defect is fixed by hand in
this review; the reason a proven-true finding could not stop the seal is now queued
as work.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 3 steps · 9m 24s |
| cost | **$0.1887** of $20 budget (**0.9%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — keyless OAuth, so **$0.00 by design**; `chikory trace` prints `⚠ cost meter blind (unpriced tokens)` (17,540 tokens metered, unpriced) |
| judge | `openai-compat` / `gpt-5.6-sol` xhigh · 5 passes (3 per-step + 2 completion review) |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 3 (`@5`, `@10`, `@17`) · all `lastGood true` · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | diff | verdict |
|---|---|---|---|---|---|
| 1 | 3.7k/556 | $0.0000 | 2m 24s | **0 B** | ✓ PROCEED (0/2 criteria) |
| 2 | 4.8k/1.7k | $0.0000 | 4m 9s | 8,113 B | ✓ PROCEED (2/2 criteria) |
| 3 | 6.4k/387 | $0.0000 | 16s | **0 B** | ✓ PROCEED (2/2 criteria) |

⚠️ **Two of three steps produced a 0-byte diff** (F-311). Both ended with the
executor asking *"Would you like me to proceed?"*. The phase-0 pack reports
"probe share 0.0%" because it meters executor cost, which is structurally $0 here —
the real number is **$0.1071 of $0.1887 (56.8%) of run cost spent judging empty
steps** (passes #1, #4, #5). See F-313.

**Judge cost per pass:** #1 $0.0386 · #2 $0.0501 · #3 $0.0315 · #4 $0.0374 · #5 $0.0311.

**Context growth:** input tokens per step 3.7k → 4.8k → 6.4k (**+73% over 3 steps**).
Step 2's 6,917-byte summary rides into step 3's prompt; 48% of it was stale CLI
telemetry (F-312), i.e. **~830 of step 3's 6.4k input tokens (13%) were harness noise**.

## Delivery quality (human review, post-landing)

**Landed files** (5, all named or trivially entailed by the goal — scope clean):

| file | change |
|---|---|
| `packages/sdk-ts/src/taskspec.ts:237-246,431-451,515` | `rubric_extra` in the `.strict()` raw YAML block ({id, description} only); collision + duplicate validation; mapped with `destructive: false` |
| `packages/sdk-ts/src/schemas.ts:152-158,168` | `RubricItemSchema`; `rubricExtra` on `JudgePolicySchema`; `rubricPacks` removed |
| `packages/sdk-ts/src/types.ts:259` | `JudgePolicy.rubricExtra?: RubricItem[]` replaces `rubricPacks` |
| `packages/sdk-ts/src/runner/activities.ts:1687-1691,1705,1780` | `effectiveRubric` threaded to `buildVerdict` **and** `runJudgePass` |
| `packages/sdk-py/src/chikory/types.py:142-146,155` | Python contract mirror |

**The goal, line by line — five bullets, all met:**

| goal bullet | verdict | evidence |
|---|---|---|
| a spec states a rubric item and the judge is asked it | ✅ | AC-2 drove the real Temporal workflow and read the real journaled verdict for `spec_rule` |
| the verdict counts it | ✅ | `computeVerdict` given a failing spec item names it in the rationale (AC-1 §5) |
| non-destructive by construction | ✅ | `taskspec.ts:448` forces `destructive: false`; a YAML `destructive` key is refused by `.strict()` |
| a rule that cannot be honoured is refused out loud | ✅ | collision + duplicate name the id (`taskspec.ts:438,442`); unknown key names itself |
| `rubric_packs` stops pretending | ✅ | removed from the raw schema — declaring it is now an unknown-key error |

**All six designed traps rejected.** Trap A (parse-and-drop) is the one that mattered:
AC-2 reads the *journaled* verdict, which a stored-and-ignored field cannot reach.

**Independent verification of what the ACs took on trust:**

- ✅ Contract-parity assertion `AssertAccepts<JudgePolicy, z.infer<typeof JudgePolicySchema>>`
  (`schemas.ts:683`) still holds — TS interface and zod schema agree on the new shape.
- ✅ No fixture under `fixtures/contracts/` referenced `rubricPacks`, so none needed updating.
- ✅ `COMPLETION_REVIEW_RUBRIC` untouched; `activities.ts:1687` keeps the completion
  review on its own list, as the spec's NOT-IN-SCOPE required.
- ❌ **`docs/spec/CONTRACTS.md:103` still declared `rubricPacks?: string[]`** — the
  frozen interface set drifted from `types.ts`. Nothing in the suite pins it (F-314).
- ❌ **Zero repo tests** covered the new channel; AC-2 deletes its own generated test,
  so nothing durable pinned it once the spec's checks stop running (F-315).
- ❌ **A forbidden `core→judge` layer dependency** — `types.ts` imported `RubricItem`
  from `./judge/rubric.js`. The judge said so; the run shipped anyway (F-309).

## New friction

### 🔴 F-309 — the delivery introduced a forbidden layer dependency, the deterministic scan proved it three times, and the run sealed SUCCESS

`src/types.ts` (layer `core`, index 0) imported `RubricItem` from `./judge/rubric.js`
(layer `judge`, index 5) — a lower→higher edge that `scanDiffForLayeringViolations`
(`packages/sdk-ts/src/judge/scan-layering.ts:93`) is built to reject.

**Re-measured by hand, not taken from the judge:** running the scan over the harvested
diff returned `["core→judge"]`. This is a deterministic evidence primitive, not a model
opinion.

The judge flagged it at **three of five passes**, including the last one before the seal:

| pass | scope | `no_architecture_violations` |
|---|---|---|
| #2 | step 2 diff | ✗ "The deterministic architecture scan explicitly reports a new core→judge dependency" |
| #3 | completion review (cumulative) | ✗ + `cumulative_design_coherent` ✗ |
| #4 | step 3 diff (**empty**) | ✓ "there are no added diff lines in this review interval" |
| #5 | completion review (cumulative) | ✗ + `design_serves_overall_goal` ✗ + `cumulative_design_coherent` ✗ |

The run sealed `SUCCESS` with the finding recorded.

**HAND-FIXED THIS SITTING.** `RubricItem` now lives in the core contract layer
(`packages/sdk-ts/src/types.ts:237-243`) and `packages/sdk-ts/src/judge/rubric.ts:8-10`
imports and re-exports it, so every existing `./rubric.js` importer is unchanged;
`taskspec.ts` takes the type from `./types.js`. Scan re-run over the fixed diff: `[]`.
Both typecheck projects clean, `eslint` clean, **1,333 sdk-ts tests green**. This is
exactly the repair step 3 wrote down and did not perform.

### 🔴 F-310 — a rubric item backed by a deterministic scan is discharged as advisory

`no_architecture_violations` is scored from a deterministic scan, but it sits in
`STANDING_RUBRIC` as `destructive: false` (`packages/sdk-ts/src/judge/rubric.ts:42-47`).
The completion-review gate treats every non-destructive failure identically
(`packages/sdk-ts/src/workflow/agent-loop.ts:1054-1105`): one bounded fix step, then

```
return seal("SUCCESS", `completion review: design findings recorded — …`)
```

(`agent-loop.ts:1099-1105`) **regardless of whether the retry cleared anything**. The
F-107 discipline is right for a model's design opinion. It is wrong for a fact a
deterministic scan can settle: a proven layering breach is not an opinion to record.

**Compounding mechanism:** the per-step pass scans only that step's own diff interval,
so an empty-diff step scores the item ✓ (pass #4 above). A standing violation is
laundered clean by a step that does nothing.

**→ WP-607 (queued).** Split the standing rubric by evidence provenance: an item whose
answer comes from a deterministic primitive must gate the seal (or drive a heal that
must actually clear) and must be re-evaluated against the CUMULATIVE diff, never an
empty per-step interval.

### 🔴 F-311 — the executor spends steps asking permission, and the one repair step the gate buys was spent on a question

Steps 1 and 3 both ended in a request for approval, with a 0-byte diff:

- **Step 1** (2m 24s, 0 tool calls): *"### Summary of Proposed Implementation … Please
  review this plan. Would you like me to proceed with executing these changes?"*
- **Step 3** (16s, 0 tool calls): *"### Summary & Remediation Plan … 1. Move `RubricItem`
  definition to `src/types.ts` … Please review this plan. Would you like me to proceed
  with these changes?"*

Step 3's plan was **correct** — it is the fix applied by hand in F-309 — and it was the
single bounded remediation step the WP-537/F-180 gate granted. It bought a question.

The loop has no notion of a step that ends in a question: it journals the summary,
the judge sees an empty diff, scores it clean and PROCEEDs. Measured cost: 2m 40s of
wall clock and **$0.1071 of $0.1887 (56.8%)** of run spend judging steps that changed
nothing.

**→ WP-608 (queued).** A step whose diff is empty **and** whose summary ends in a
request for approval is a distinct, named outcome — it must not consume a bounded
remediation attempt, and the step prompt must state that no approver exists.

### 🔴 F-312 — the step summary carried a stale task log from another session, and the executor transcribed its numbers as this run's verification

48.0% of step 2's summary (**3,320 of 6,917 bytes**) is two `<gmsg name="task_notification">`
blocks — `agy` background-task logs carrying a full `vitest` listing. The executor then
wrote them into its own verification table:

> | **Unit & Integration Suite** | 🟢 PASS | `pnpm run test` — 558/558 tests passed across 46 test files. |

**That output cannot have come from this workspace.** Of the 46 test files it names,
**17 do not exist** — not in the run workspace, not in the repo: `test/chain/e2e.test.ts`,
`test/runner/e2e.test.ts`, `test/chain/activities.test.ts`, `test/runner/activities.test.ts`,
`test/judge/prompt.test.ts`, `test/util/deep-equal.test.ts` and 11 more. The workspace
holds **174** test files; the same command in this tree collects 174 files / 1,356 tests.
The pasted log is from an older repo state, replayed by the CLI as `task-170`/`task-175`.

Nothing in the loop noticed. The run survived only because JD-4 makes judge-executed
checks override the model's `tests_pass` opinion, so the *acceptance* evidence was real.

**HAND-FIXED THIS SITTING** (envelope half). dogfood-132's F-306 fix strips
`<notification>…</notification>`; this telemetry ships under a second tag it never
matched. `packages/sdk-ts/src/executors/gemini-cli.ts:61,66-69` now also strips
`<gmsg name="task_notification" …>…</gmsg>` — the notification-named form only, so an
agent-authored `gmsg` is left alone. 4 new tests in
`packages/sdk-ts/test/executors/gemini-cli.test.ts:91-131`, including the negative
(output that is nothing but an envelope must still FAIL as "no response") and the
non-notification `gmsg` that must survive. **Residue → WP-606**: stripping the envelope
does not stop the executor transcribing stale numbers into prose no gate checks.

### 🟡 F-313 — the F-11 probe-share metric is structurally blind under a keyless CLI executor

`dogfood-verify.sh --facts` computes probe share from the empty-diff step's **executor**
cost. Under `gemini-cli` (keyless OAuth) executor cost is $0.00 by design, so the metric
prints `probe share: 0.0%` for a run where 56.8% of spend went to judging empty steps.
The number that carries information is judge cost attributable to zero-diff steps.

**track-B note** — a metric change in `scripts/`, not product code, and the friction
budget (§1.5) does not admit a harness-meta headline here.

### 🟡 F-314 — the frozen contract doc drifted from `types.ts`

`docs/spec/CONTRACTS.md` is declared "the frozen interface set for
`packages/sdk-ts/src/types.ts` … this document **is** the WP-002 spec". The delivery
renamed `rubricPacks` → `rubricExtra` in `types.ts`, `schemas.ts` and the Python mirror,
and left `docs/spec/CONTRACTS.md:103` declaring the retired field. Nothing in the suite
pins the doc against the interface, so the drift was silent.

**HAND-FIXED THIS SITTING** — `docs/spec/CONTRACTS.md:103-114` now carries `rubricExtra`
plus the `RubricItem` interface with the §4-rule-1 note.

### 🟡 F-315 — a new public contract field shipped with no test in the repo

The delivery added a public spec field, its parse-time validation and its judge
threading, and added **zero** tests under `packages/sdk-ts/test/`. Correctness was
carried entirely by the spec's own acceptance checks — and AC-2 deletes its generated
test by design. Once dogfood-133's checks stop running, nothing pinned the channel.

**HAND-FIXED THIS SITTING** — 6 tests in
`packages/sdk-ts/test/taskspec.test.ts:326-393`: the item is carried and forced
non-destructive, the key is absent when undeclared, and a `destructive` key, a standing-id
collision, an in-list duplicate and the retired `rubric_packs` are each refused by name.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-309 | 🔴 | delivery introduced a forbidden `core→judge` layer dependency; the deterministic scan flagged it at 3 of 5 judge passes including the final one, and the run sealed SUCCESS | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/types.ts:237-243` + `packages/sdk-ts/src/judge/rubric.ts:8-10`; scan re-run returns `[]`, 1,333 sdk-ts tests green |
| F-310 | 🔴 | `no_architecture_violations` carries deterministic evidence but is non-destructive, so a proven violation buys one advisory retry and then seals SUCCESS whether or not it cleared; an empty-diff step scores it ✓ | **→ WP-607 (queued)** |
| F-311 | 🔴 | executor spent 2 of 3 steps asking "Would you like me to proceed?" with 0-byte diffs; the one bounded remediation step was consumed by a question that named the correct fix | **→ WP-608 (queued)** |
| F-312 | 🔴 | step summary carried stale `<gmsg>` task logs from another session (17 of 46 named test files do not exist) and the executor transcribed "558/558" as this run's suite gate | **HAND-FIXED THIS SITTING** (envelope) — `packages/sdk-ts/src/executors/gemini-cli.ts:61,66-69`, 4 new tests at `packages/sdk-ts/test/executors/gemini-cli.test.ts:91-131`; transcription residue → WP-606 |
| F-313 | 🟡 | F-11 probe-share reads 0.0% because it meters executor cost, structurally $0 under a keyless CLI executor; real figure is 56.8% of spend judging empty steps | **track-B note** |
| F-314 | 🟡 | `docs/spec/CONTRACTS.md` still declared the retired `rubricPacks` after `types.ts` renamed it | **HAND-FIXED THIS SITTING** — `docs/spec/CONTRACTS.md:103-114` |
| F-315 | 🟡 | new public spec field + validation + judge threading shipped with zero repo tests; AC-2 deletes its own generated test | **HAND-FIXED THIS SITTING** — 6 tests at `packages/sdk-ts/test/taskspec.test.ts:326-393` |

## Verdict on the thesis

**The judge earned its keep, and then could not act on what it found.** This is the
sharpest data point the campaign has produced on the difference between *detection* and
*gating*. The reviewer model, running a structurally different family from the executor
(`openai-compat/gpt-5.6-sol` vs `gemini-cli(gemini)`), found a real defect that four
green acceptance checks, a clean typecheck of both projects, a clean lint and a
1,333-test suite all miss — because none of them encode layer direction. It stated the
finding precisely, three times, and cited the deterministic scan each time. That is the
Agent-as-a-Judge thesis working.

What failed is downstream of the judgment. The gate treats a settled fact and a model's
taste as the same severity class, and the single repair it grants can be silently
consumed by an executor that asks a question. F-180 (WP-537) closed "the judge detects
but does not gate" for *acceptance criteria*; F-310 is the same shape one level up, for
*deterministic rubric evidence*. **Standing caution: a `SUCCESS` seal whose rationale
reads `completion review: design findings recorded — …` is not a clean run.** Read the
rationale, every time.

Secondary, and worse than it looks: F-312 means an executor's own verification prose can
carry numbers from a different session entirely. Only JD-4 — judge-executed checks
overriding the model's `tests_pass` — kept that out of the acceptance path. Never let a
gate rest on what the executor says it ran.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 3 steps / 9m 24s | 3 steps (dogfood-131/133) — max 6 in the prior 3 |
| kill → resume count | 0 | 0 across the trailing 3 |
| judge true-positives pre-land | **1** (the `core→judge` layering breach) — detected, **not gated** | 1 · 0 · 1 (dogfood-131/132/133) |
| meta:product headline ratio | 0:1 (`class=product`) | **0:3** — cap ≤1 harness-meta per 3, not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs ≥5) — target 99%+ |
| ladder rung vs exit gate | **0** (off-ladder by declaration) vs P3 exit gate = **rung 5** | rung 4 · 0 · 0 · 0 — ⛔ STALLED, third consecutive off-ladder headline |

## NEXT RUN

**Make a quality rule that a machine can settle actually stop the run from shipping —
today a proven architecture breach is written into the seal message and the run still
reports success.**

- **Spec:** `examples/dogfood/dogfood-134-wp607-deterministic-findings-gate.yaml`
- **WP:** WP-607 (a rubric item backed by deterministic evidence must gate the seal, not be recorded and shipped)
- **Why THIS and not the ladder rung:** the §0 progression gate returned **⛔ STALLED**,
  which binds the next headline to the current phase ladder rung — P3-rung-5, the phase
  exit gate. Its two blockers were re-measured **again** this review and both still
  stand: `find benchmarks -path '*brownfield-001*'` still returns only the task YAML with
  no gold patch (3–6 h of operator research on an upstream migration that was never
  performed), and `grep -rl repoRef benchmarks/results/` still returns nothing, so both
  arms need a multi-hour quota-bound re-run that dogfood-122 proved an LLM executor must
  not supervise. Neither is a product gap. Against that, F-310 is a 🔴 loop-integrity
  defect this very run demonstrated live, on the exact mechanism the thesis rests on.
- **The designed trap:** flipping `no_architecture_violations` to `destructive: true`.
  That is the plausible-and-wrong delivery — it makes a layering breach fire CONTRACTS.md
  §4 rule 1 and **restore the workspace**, destroying the good work along with the bad
  import, and it parks a run whose acceptance criteria all pass (the F-107 violation).
  The ACs require the seal to be *blocked* while the work is *kept*, and require the
  cumulative-diff re-evaluation so an empty-diff step can no longer score the item clean.

**Gate verdicts:**

- **§0 progression:** ⛔ STALLED → binds to the ladder rung; rung 5 re-measured blocked
  on operator work (above). Recorded exception, `# Ladder-rung: 0`.
- **§1.1 failure surface:** ✅ 2–6 steps, cross-file, on the judge/workflow seam — a
  competent agent can plausibly get the severity split wrong in either direction.
- **§1.2 product progress:** ✅ WP-607 is a real open `plan.md` §6 product WP; the
  mechanism is seeded into `src/judge/rubric.ts` + `src/workflow/agent-loop.ts`, not a
  throwaway utility.
- **§1.3 mission-critical:** ✅ PROCEED — 🟢 Mission-critical / real-WP-hosted. This run
  is the live proof the defect costs something.
- **§1.5 friction budget:** ✅ `class=product`; trailing-3 harness-meta headlines **0/3**,
  cap not busted.

**AC arming evidence** — both ACs are VERIFY-SUITE (they shell out to `tsc`/`vitest`,
so `dogfood.sh` will NOT dry-run them); `dogfood-arm.sh` ran each in BOTH directions
by hand:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **8s** | ✅ exit 0, **8s** | 7 % |
| AC-2 | ✅ exit **1**, **11s** | ✅ exit 0, **12s** | 10 % |

Worst case **12 s = 10% of the 120 s judge cap**. AC-2's RED is a REAL red, not a
broken check: scenario 1 fails on HEAD with `expected 'SUCCESS' not to be 'SUCCESS'`
while control scenarios 2 and 3 already pass, so the check discriminates the defect
rather than the environment. The first arming pass caught its own F-119-class bug —
an over-escaped backtick made AC-2 exit 1 from a `SyntaxError` rather than a failing
assertion — which is exactly why the RED direction is run and read, not assumed. The
throwaway reference (`DETERMINISTIC_RUBRIC_IDS` + a scan override in
`applyCheckOverrides` + a seal guard in `agent-loop.ts`) was reverted **by name from a
backup**, never with `dogfood-arm.sh --discard`, which would have `git checkout -- .`'d
this entire uncommitted review.

```sh
CHIKORY_PREFLIGHT_ONLY=1 devbox run run-dogfood   # $0 preflight, confirm the glob picks dogfood-134
devbox run run-dogfood
```
