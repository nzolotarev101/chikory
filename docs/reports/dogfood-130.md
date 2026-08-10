# dogfood-130 — the benchmark corpus finally got probed, and the answer was zero (WP-600)

**WP:** WP-600 (consume the rung-5 machinery — first real discrimination ledger) · **Date:** 2026-08-09 ·
**Spec:** `examples/dogfood/dogfood-130-wp600-real-discrimination-ledger.yaml` ·
**Run:** `branch-run-838ae110-4d12-49cb-ad41-5f98a31828e7-step-5-2f201f9a`
(branched from the dead `run-838ae110-4d12-49cb-ad41-5f98a31828e7`) · **Landed:** this review's commit ·
**Ladder:** P3-rung-4 held; **rung 5 (P3 exit gate) NOT climbed** — this run is the sixth consecutive rung-5 prerequisite

## Plain lead

We finally ran the benchmark's own quality check against the real corpus instead
of building more machinery for it, and it says the published head-to-head numbers
currently rest on **zero verified evidence** — 0 of 19 requirements, for both
arms. That is the honest answer and the run reported it instead of dressing it up.
Getting there cost two dead ends: the first run was killed by the operator over
eight junk git pointers, and the delivery's "durable evidence" turned out to be
un-committable on any machine but the one that produced it.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 3 steps · 1h 02m |
| cost | **$0.1447** of $20 budget (**0.7%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **$0 by design**, keyless OAuth (`gemini-cli.ts:58-60`); every step reads UNPRICED |
| judge | `openai-compat` (codex `gpt-5.6-sol xhigh`) · 3 passes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 3 · injections **0** (see F-298) |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree — **AC-2 only passes after the F-293 hand-fix**) |
| harvest | ⚠ DIFFERS: `benchmarks/results/.gitignore` — **intentional**, the F-293 hand-fix |

**Per-step:**

| # | tokens in/out | cost | wall | diff bytes | verdict |
|---|---|---|---|---|---|
| 1 | 3.6k/189 | $0.0000 | 11m 12s | 12,739 | ✓ PROCEED (1/2 criteria) |
| 2 | 3.8k/**0** | $0.0000 | 10m 54s | 3,129 | ✓ PROCEED (1/2 criteria) |
| 3 | 4.3k/953 | $0.0000 | 1m 57s | 9,297 | ⚠ ESCALATE → approved |

**Steps 1 and 2 were both killed by the step cap** — `maxSeconds=600`, killed at
671.7 s (1.12×) and 653.6 s (1.09×). Step 2 produced **zero output tokens**.
No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

### The two-run shape

| | original `run-838ae110` | branch `…-step-5-2f201f9a` |
|---|---|---|
| outcome | 🔴 FAILED (dead, non-resumable) | 🟢 SUCCESS |
| steps / cost | 2 / $0.11 | 3 / $0.1447 |
| why it ended | operator **rejected** the escalation: 8 orphan mode-160000 gitlinks committed under `benchmarks/results/*/{base,fix}-workspace`, no `.gitmodules` | operator approved an out-of-rubric escalation after hand-verifying the suite |
| carried forward | step-1 checkpoint `@5` (commit `81b680e`) | replayed the parent journal to the cutoff, redid step 2 clean |

The operator's reject text was a precise, actionable fix (*"git rm --cached them,
keep discrimination.json + probe.json as-is"*). The runner discarded it and sealed
dead — see **F-296**, the highest-value finding of this review.

## Delivery quality (human review, post-landing)

**Landed files (12):**

| file | what |
|---|---|
| `benchmarks/harness/src/main.ts` (+178) | `resummarize` command — re-derive a stored suite through a ledger |
| `benchmarks/harness/src/results.ts` (+50/−15) | distinct "no scored ref" reason; Wilson CI/range on `SuiteSummary`; `publishableRepoPath` rewrite |
| `benchmarks/harness/src/probe.ts` (+3) | `ProbeVerificationReport.command` — the check that actually ran |
| `benchmarks/results/discrimination.json` (+102) | **the first real ledger** — 4 tasks, real verdicts |
| `benchmarks/results/brownfield-00{2,3,4,5}/probe.json` (+48 ea.) | per-task probe artifacts |
| `benchmarks/publications/p3-rung-4-corrected/` (3 files) | corrected bundle, both arms |
| `benchmarks/results/.gitignore` (+7) | re-include rule (**defective as shipped — F-293**) |

**The goal, line by line.** Both halves were met.

- 🟢 *Real probe evidence.* `brownfield-002…005` were genuinely probed — each
  `probe.json` carries `baseRef` matching the task's pinned `repo.ref`, both
  `baseVerification` and `fixVerification`, and the real
  `base_verification_command`. AC-2's trap A (transcribed-not-invented) checks
  every ledger `baseRef`/`fixRef`/requirement-id against the task files.
- 🟢 *`brownfield-001` named, never fabricated.* Absent from the ledger; named
  `unverified` with reason `"Task brownfield-001 was never probed"`.
- 🟢 *Re-derivation with no arm re-run, no clone, no LLM.* Verified independently:
  the stored per-task files (`…/20260806-203753-chikory/brownfield-00N.json`)
  carry real `grades` with real `requirementId`/`detail` payloads and
  `repoRef: undefined` — so the honest exclusion reason fired on real data.
- 🟢 *Publication of record untouched.* `git status --porcelain -- publications/p3-rung-4` clean (AC-2 trap F).

**The published finding, verified against the artifacts:**

| arm | scored | verified | requirements | I-SR | 95% range |
|---|---|---|---|---|---|
| p3-rung-4 (historical) | 5 | 5 | 19/19 | 100.0% | [83.2%, 100.0%] |
| p3-rung-4-corrected — Chikory | 5 | **0** | **0**/19 | 0.0% | [0.0%, 0.0%] |
| p3-rung-4-corrected — raw Claude Code | 5 | **0** | **0**/19 | 0.0% | [0.0%, 0.0%] |

Every excluded task is retained and named: `brownfield-001` never probed; the
other four *"Stored result recorded no scored ref"* — the distinct reason
trap G demanded, correct because those suites predate WP-595.

**Scope discipline:** 🟢 — every file is one the goal names or trivially entails.
No new dependency, no provider SDK, no task-definition edit.

**What the ACs took on trust, and what I re-ran myself:**

- The step-3 summary's *"15/15 test files, 205/205 tests, eslint clean"* was
  executor prose. The judge refused to accept it (correctly — that is what it
  escalated on). Re-run here against the landed tree: **sdk-ts 1,304 passed ·
  harness 205 passed · eslint clean**. The claim was accurate.
- AC-2's `git ls-files -- results` passed **inside the run workspace only**. On
  the host it was structurally unsatisfiable until F-293 was fixed.

## New friction

### 🔴 F-293 — the delivery's "durable evidence" could not be committed anywhere but the workspace that made it

The spec's central demand was that per-task `probe.json` artifacts be
**COMMITTED** ("a verdict whose evidence lives only in a scratch directory is not
durable proof"). The delivery added to `benchmarks/results/.gitignore`:

```
*
!.gitignore
!discrimination.json
!**/probe.json
```

Git never descends into an ignored **directory**, so `*` excludes
`brownfield-002/` and the `!**/probe.json` negation is inert. The evidence:

- `git check-ignore -v benchmarks/results/brownfield-002/probe.json` →
  `benchmarks/results/.gitignore:3:*` — matched by the **ignore** rule, not the negation.
- `scripts/dogfood-open.sh` **aborted the harvest**: *"The following paths are
  ignored by one of your .gitignore files: benchmarks/results/brownfield-002"*.
- AC-2 checks `git ls-files -- results`, which passed only because the executor
  had force-added the files inside its own workspace, where a tracked path
  bypasses ignore rules entirely.

So the run's own acceptance oracle certified durability that no fresh clone could
reproduce — the `published-evidence-must-be-durable` lesson at the *ignore-rule*
altitude. **HAND-FIXED** (`benchmarks/results/.gitignore:6-11`): re-include at
depth 1 only (`!/*/` + `!/*/probe.json`). Depth-1 matters — a recursive `!*/`
re-exposes the nested suite `workspace/` git repos, which is precisely the orphan
gitlink defect that killed the original run. Pinned by 2 new tests
(`benchmarks/harness/test/probe.test.ts:460-496`), proven RED against the shipped
rule and GREEN against the fix.

### 🔴 F-294 — the run-workspace publication guard was rewritten into a no-op for the only shape it exists for

`publishableRepoPath` (`benchmarks/harness/src/results.ts:410`) refuses to publish
a pointer into an ephemeral run workspace (F-261/F-267, WP-588/WP-591). The
delivery moved the `.chikory/runs` check from the **absolute** path to the path
**relative to the target's own git root**. A real run workspace *is* a git
worktree — so it becomes its own repo root, and the marker vanishes from the
relative path. Measured against the built artifact:

```
OK    -> "benchmarks/results/foo"
      for …/.chikory/runs/branch-run-838ae110-…/workspace/benchmarks/results/foo
```

That path must throw. The existing regression test
(`results.test.ts:369`, "refuses to publish a raw-results pointer into an
ephemeral run workspace") stayed green because its path is **fictional** — with
no `.git` anywhere on disk the walk finds no repo root and the marker survives.
The test proved the guard on a shape the guard never meets.

The change was not gratuitous: `probe.ts:263` calls the helper on the sweep's
output dir, and inside a dogfood workspace the old guard threw on every legitimate
path, making the sweep unrunnable. **HAND-FIXED** (`results.ts:432-447`) to serve
both: re-check the discovered repo root itself, and refuse unless the caller is
running *inside* that same workspace (realpath-compared — macOS reports
`/private/var` for a `/var` cwd). Publishing your own tree is fine, harvest
carries it out; citing someone else's workspace is the dangling pointer F-261 was
opened for. +2 tests (`results.test.ts:327-367`), one per direction.

### 🔴 F-295 — a judge design concern expires when the diff window moves past the code

At **judge pass #1**, `design_serves_overall_goal` failed with a precise
objection to the `resummarize` fallback:

> *"it explicitly falls back to synthesizing TaskResult records from an existing
> aggregate summary … That conflicts with the overall requirement that stored
> per-task files are the evidence and the aggregate under suspicion must not be
> trusted as input. It also reconstructs requirement identities and satisfaction
> positions rather than preserving actual per-requirement evidence."*

The objection is correct: `main.ts:684-717` and `main.ts:728-768` fabricate
requirement ids (`R${i+1}`) and assign satisfaction **by position**
(`main.ts:702`, `main.ts:746`). That code is **still in the delivery**, unchanged,
and the run sealed SUCCESS with `design_serves_overall_goal ✓`.

The mechanism is the judge's evidence window, which is incremental:

| pass | diff evidence | contains `main.ts`? | design verdict |
|---|---|---|---|
| #1 | since `f272e5d` (HEAD), 12,739 B | ✅ yes | ✗ (the objection above) |
| #2 | since `81b680e` (step 0), 3,129 B | ❌ no | ✗ (a *different* concern — missing probe.json) |
| #3 | since `70421e8` (step 1), 16,817 B | ❌ no | ✓ |

The final ✓ was rendered over a window that excludes the objectionable code
entirely. Nothing carries an unresolved design objection forward, so **a run can
outrun a design concern simply by committing more steps.** This is WP-599's
disease (a concern silently dropped) at the *diff-window* altitude rather than the
rubric-interaction altitude. Not hand-fixed — judge-path blast radius on every
run, same reasoning that deferred WP-599. **→ WP-601 (queued).**

Mitigating, and worth stating plainly: the fabricating branch **did not fire** on
this delivery. It is guarded by `taskResults.length === 0`, and the stored suite
directory does contain per-task files, so the published 0/19 came from real
per-task evidence. The defect is a live trap, not a corrupted number.

### 🔴 F-296 — rejecting an escalation kills the run and throws the human's fix away

`packages/sdk-ts/src/workflow/agent-loop.ts:1148-1153`: a rejected escalation
seals `FAILED` immediately and non-resumably. Approving resumes to `RUNNING`
(:1167). The reject **reason** is interpolated into the seal message and then
never used again.

This run is the cost. The operator's reject was a complete work order — *"Untrack
the 8 mode-160000 gitlinks under `benchmarks/results/*/{base,fix}-workspace` …
`git rm --cached` them … keep discrimination.json + probe.json as-is"* — a
one-command fix the executor could have applied in a single step. Instead the run
died, and the operator hand-branched from checkpoint `@5` and re-drove it.

This is **designed** behavior with a passing test (`verdict gating (WP-132) >
ESCALATE + reject seals FAILED with the judge's reason`), so it is the design
that is the gap, not an implementation slip. It also stands in direct tension with
two landed invariants: WP-542/F-207 ("no LLM-verdict gate may exit — route through
`heal/gate-repair.ts`") and WP-543/F-208 ("no incarnation ends un-sealed"), both of
which cover **chain nodes** and leave plain runs with no self-heal on reject. The
richest correction signal in the whole system — a human writing down exactly what
is wrong — is the one signal the loop cannot act on. **→ WP-602 (queued, the next
headline).**

### 🟠 F-297 — the real corpus sweep does not fit in a step

Steps 1 and 2 were both killed at `maxSeconds=600` (671.7 s and 653.6 s). The
sweep installs dependencies and runs verification at **two refs for four tasks**;
that is inherently a multi-ten-minute job. The executor coped by backgrounding the
sweep and writing *"I will resume once the sweep completes"* — which worked (the
checkpointer commits the workspace, so both killed steps still landed progress),
but it cost **2 of 3 steps** and produced a step with **zero output tokens**.
Two of three steps being kill-recovered is exactly the horizon problem the thesis
is about, and the harness has a bounded-exec facility that was not applied here.
**track-B note** (DOGFOODING §8) — a sweep should declare its own budget rather
than ride the default step cap.

### 🟡 F-298 — there is no way to hand guidance to a branched run

The operator's account of the branch was that guidance about the nested-git
gitlink trap was injected before resuming. The journal does not support it:
`kind` counts are `capability 1 · checkpoint 3 · control_event 1 · judge 3 ·
pacing 3 · step 3 · terminal 1 · verdict 3` — **no `injection` entry**, trace
totals read `injections 0`, and the string `gitlink` appears nowhere in the branch
journal. The clean second attempt was non-determinism, not steering.

The cause is structural: `chikory branch` (`cli/main.ts:278-282`) takes a target
and nothing else, while `chikory inject` (`cli/commands.ts:819-822`) needs a live
Temporal handle — and a freshly branched child is not running until `chikory
resume`. So there is no supported moment at which corrective guidance can be
attached to a branch. **→ WP-603 (queued, track-B sized: `chikory branch
--guidance <text>` journaled as an `injection` the first step reads).**

### ℹ️ F-299 — `⚠ cost meter blind` is a false alarm on a keyless executor

Every step reads `$0.0000 (estimated — UNPRICED)` and the header carries
`⚠ cost meter blind (unpriced tokens)`. `isUnpricedStep` (`cli/trace.ts:194-200`)
infers "unpriced" from `costEstimated && costUsd === 0 && tokens > 0`, but the
gemini-cli adapter sets `costUsd: 0` **deliberately** — keyless Antigravity OAuth
has no wire cost (`executors/gemini-cli.ts:57-60`). `gemini-3.6-flash` is present
in `pricing.ts:51`; nothing is missing. The real consequence is narrower and worth
recording: with a keyless executor the `$20` budget gate bounds **judge spend
only**, so a run's executor horizon is bounded by `maxSeconds` alone.
**track-B note** — distinguish "no price row" from "priced at zero" in the warning.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-293 | 🔴 | Shipped `.gitignore` cannot re-include nested `probe.json` — evidence uncommittable outside the run workspace; harvest aborted | **HAND-FIXED THIS SITTING** — `benchmarks/results/.gitignore:6-11`; +2 tests `probe.test.ts:460-496`, proven RED-then-GREEN; harness 205 → 207 |
| F-294 | 🔴 | `publishableRepoPath` rewrite made the F-261/F-267 run-workspace guard a no-op for real on-disk worktrees; test blind (fictional path) | **HAND-FIXED THIS SITTING** — `results.ts:432-447`; +2 tests `results.test.ts:327-367`; harness 207 → 209 |
| F-295 | 🔴 | An unresolved `design_serves_overall_goal` objection expires once the incremental diff window moves past the code | **→ WP-601 (queued)** — judge-path blast radius, same deferral as WP-599 |
| F-296 | 🔴 | Rejecting an escalation seals a plain run dead and discards the operator's fix instruction | **→ WP-602 (queued — NEXT HEADLINE)** |
| F-297 | 🟠 | The real corpus sweep exceeds `maxSeconds=600`; 2 of 3 steps kill-recovered, one with zero output tokens | **track-B note** (DOGFOODING §8) |
| F-298 | 🟡 | No supported channel to attach guidance to a branched run; `branch` takes none, `inject` needs a live handle | **→ WP-603 (queued, track-B sized)** |
| F-299 | ℹ️ | `⚠ cost meter blind` fires on a deliberately zero-cost keyless executor | **track-B note** (DOGFOODING §8) |

## Verdict on the thesis

**The judge earned its place again, and the loop still cannot use what it learns.**

Three judge behaviors were genuinely right this run. Pass #2 named the exact
durability hole later confirmed at harvest (*"the diff adds a probe.json allow-rule
without committing any probe.json files, and the judge confirmed zero such tracked
artifacts"*) — F-293, caught pre-land by the judge and missed by both ACs. Pass #3
refused to treat an executor-written *"205/205 tests"* table as evidence, which is
exactly the discipline the AC layer keeps failing to enforce. Pass #1's design
objection was correct too, and is still live in the tree.

Against that: **two of the three findings this review hand-fixed were introduced by
the delivery itself**, both in evidence-durability code, and both certified green
by acceptance criteria that asked the wrong question — `git ls-files` inside the
workspace that force-added the files (F-293), and a guard test built on a path
that cannot exist (F-294). The standing caution stands and sharpened: **an AC must
run where the artifact will actually live.** An oracle evaluated inside the run's
own workspace measures the workspace, not the repo.

And the loop-integrity picture regressed. F-295 and F-296 are the same shape from
opposite ends: a **judge** objection expires when the diff window slides past it,
and a **human** objection is discarded the moment it is issued. The system's two
correction channels both leak, which is why this run needed a human to notice,
kill, branch, re-drive and then hand-verify — the ceremony F-10 has been tracking
since dogfood-002.

On the product: the run did exactly what WP-600 asked and the answer is
uncomfortable and correct. **0 of 19 published requirements can currently be
verified.** The P3 rung-4 publication is not withdrawn, but it now has a
timestamped, artifact-backed sibling saying what it can and cannot support.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 3 steps / 1h 02m (2 steps kill-recovered) | 6 steps (dogfood-129) |
| kill → resume count | 0 resumes; **2 in-step `maxSeconds` kills recovered**; 1 operator branch-from-checkpoint | 0 resumes across trailing 3 |
| judge true-positives pre-land | **2** (F-293 durability at pass #2; F-295 design objection at pass #1 — still unfixed) | 3 (129) · 0 (128) · 0 (127) |
| meta:product headline ratio | product (`benchmarks/` + `packages/sdk-ts` surface) | **0/3 harness-meta** — cap not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | **rung 4** — rung 5 (P3 exit) not climbed | rung 4 across trailing 3 · ⚠️ LADDER PACE flagged |

**Why rung 5 was not climbed, sixth run running.** Rung 5 needs published,
verifiable numbers. This run established that the published numbers are currently
unverifiable — a necessary precondition, not the rung. What now stands between here
and the rung is **not a product gap**: it is (a) `brownfield-001`'s zod v3→v4 gold
patch, a 3–6 h operator authoring lift now expressible thanks to WP-598, and
(b) a re-run of both arms so stored results carry `repoRef` — hours of quota that
dogfood-122 proved an LLM executor must not supervise. Both are operator work.

## NEXT RUN

**When a human stops a run and writes down what is wrong, the run fixes that and keeps
going — instead of dying and leaving the human to redo the work by hand.**

- **Spec:** `examples/dogfood/dogfood-131-wp602-reject-routes-to-heal.yaml`
- **WP:** WP-602 (a rejected escalation routes the operator's correction into the loop)

**Why this and not the ladder rung.** §0 progression reads ✅ PROGRESSING with ⚠️ LADDER
PACE still at rung 4, so the default candidate is P3-rung-5, the exit gate. **It cannot run
as a dogfood, and this review is what established that:** rung 5 needs verifiable published
numbers, and dogfood-130 measured 0 of 19 as verifiable. Closing that needs (a)
`brownfield-001`'s zod v3→v4 gold patch — a 3–6 h operator authoring lift, the task's own
horizon — and (b) an arm re-run so stored results carry `repoRef`, hours of quota that
dogfood-122 proved an LLM executor must not supervise. **Neither is a product gap.** A
seventh rung-5 "prerequisite" would be exactly the §1.2 failure of greening the dashboard
while the backlog stands still.

**The designed trap.** The cheapest plausible-but-wrong delivery is to make the dead seal
**resumable** — `seal("FAILED", …, { resumable: true })` — and call it done. The run still
stops, the reason is still discarded, and a human must still type `chikory resume`: the
status quo with extra steps. AC-2 rejects it by requiring the run to execute another step and
reach its own terminal state with **no further operator command**. Four more are armed: an
unbounded heal loop (B), healing a reason-less or whitespace-only reject (C), a brief that
drops the operator's words (D), and a pure `decideRejection` the loop never calls (E) — the
F-274 shape that AC-1 alone structurally cannot detect.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | 🟡 **ALLOW (off-ladder, recorded)** | ✅ PROGRESSING; rung 5 is operator-gated after this review's finding — recorded here as §0 requires |
| §1.1 failure surface | ✅ | a runner-loop seam on durable execution + self-correction; 2–6 steps; a plausible wrong answer exists and is armed against |
| §1.2 product progress | ✅ | lands in `packages/sdk-ts/src/workflow/` + `agent-loop.ts` — core runner, real open WP-602, no scaffolding |
| §1.3 mission-critical | ✅ **PROCEED** | neither busy work nor scaffold-hosted; it is the pillar this very review had to substitute a human for |
| §1.5 friction budget | ✅ | `class=product`; harness-meta headlines 0/3, cap not busted |

**AC arming evidence.** The preflight classes **both** ACs VERIFY-SUITE, so neither dry-ran —
both were hand-verified in both directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **3s** | ✅ exit 0, **3s** | 3 % |
| AC-2 | ✅ exit **1**, **9s** | ✅ exit 0, **10s** | 8 % |

Worst case **10 s = 8% of the 120 s judge cap**. The throwaway reference (a pure
`decideRejection`, a `maxRejectStrikes` spec field, and the `agent-loop.ts` reject-branch
wiring) was reverted surgically after the GREEN pass — `--discard` was NOT used, because it
runs `git checkout -- .` across the whole tree and would have destroyed this review's
uncommitted hand-fixes. Arming also caught two defects in the checks themselves before they
could burn a run: AC-2 leaked its generated test file (`A()` calls `process.exit`, which
skips `finally`), and a `\n` inside the generated source was interpolated by the JS template
literal. Both fixed, and RED was re-proven against the final text.

```sh
devbox run run-dogfood
```
