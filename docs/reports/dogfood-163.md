# dogfood-163 — a crashed step can no longer overwrite finished work (WP-645 + WP-646)

**WP:** WP-645 (a crashed step is an infra failure) + WP-646 (a failed run hands back its best tree) · **Date:** 2026-08-20 ·
**Spec:** `examples/dogfood/dogfood-163-wp645-wp646-crash-cannot-overwrite-delivery.yaml` ·
**Run:** `run-12dfe421-7633-4199-9e3c-18bc32a410c5` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3's moat ladder `WP-530` has no agent-runnable rung left; its rung-5 remainder is `WP-304`, an operator-run quota-bound benchmark arm)

## Plain lead

The fix works, and the loop failed the run anyway. dogfood-162 lost a finished,
fully-green delivery when its last step crashed mid-write; this run built the
protection for that — a crash is now recognised as broken infrastructure rather
than bad work, the half-written files get thrown away instead of shipped, and a
failed run hands back the best tree it reached. Every acceptance check passes,
the whole test suite is green and larger, and the harvested files are
byte-identical to what the run produced.

The run was still sealed **FAILED**, on an architecture complaint that the run's
own final review had already re-measured and cleared 1.7 seconds earlier. Two
harness defects caused it, both reproduced here from the run's own artifacts:
a stale finding cannot be retracted once raised (F-429), and the architecture
scanner counts a line that was merely *restored* as a line that was *introduced*
(F-430). 11 lines across 6 committed files on `main` are loaded guns for the
second one.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 2 steps · 21m 52s |
| cost | **$0.2189** of $20 budget (**1.1%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ **cost meter blind**: 9,902 metered tokens are unpriced (subscription-linked adapter), so every per-step cost reads $0.0000 |
| judge | `openai-compat` (`gpt-5.6-sol`, effort `xhigh`) · 4 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 (`@5` lastGood **false**, `@12` lastGood **true**) · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 10/10 files byte-**IDENTICAL** to the run workspace |
| seal reason | `completion review: deterministic rubric failure — no_architecture_violations` |
| headroom left | **4 of 6 steps** and **98.9% of budget** unspent at the seal |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.8k/129 | $0.0000 | 10m 7s | ✓ PROCEED (3/3 criteria) — but the step itself **FAILED**: `step exceeded maxSeconds=600; killed after 606.7s (1.01× cap)` |
| 2 | 4.4k/1.6k | $0.0000 | 3m 37s | ✓ PROCEED (3/3 criteria) — step SUCCESS |

**Judge passes** (all four PROCEED; the `no_architecture_violations` column is the whole story):

| # | at step | scope | cost | wall | `no_architecture_violations` |
|---|---|---|---|---|---|
| 1 | 1 | step diff (24,712 B) | $0.0621 | 2m 7s | ✗ `workflow→runner` — **true positive** |
| 2 | 1 | completion review, cumulative | $0.0525 | 2m 3s | ✗ `workflow→runner` — **true positive**; bought the one repair grant |
| 3 | 2 | step diff (4,745 B) | $0.0598 | 2m 10s | ✗ `workflow→runner` — **FALSE positive (F-430)** |
| 4 | 2 | completion review, cumulative (27,211 B) | $0.0445 | 1m 46s | ✓ *"deterministic architecture scan found no layering violations"* — all 5 rubric rows green |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (10 changed, +425/−24):

| file | what |
|---|---|
| `packages/sdk-ts/src/executors/infra-failure.ts` (new, 23 lines) | the structural classifier, in a pure workflow-bundle-safe module |
| `packages/sdk-ts/src/executors/step.ts` | sets `infraFailed` when a failed step metered **0 output tokens** |
| `packages/sdk-ts/src/executors/index.ts` | re-exports the classifier |
| `packages/sdk-ts/src/runner/strike-accounting.ts` | `isInfraStepFailure` delegates to the new module (symbol + signature preserved) |
| `packages/sdk-ts/src/workflow/agent-loop.ts` | restores the workspace after an infra-failed step; a FAILED seal names `lastGood` |
| `packages/sdk-ts/src/runner/activities.ts` | a resume targets the terminal entry's `lastCheckpoint`, and moves its diff baseline with it |
| `packages/sdk-ts/test/runner/crash-delivery-protection.test.ts` (new, 296 lines) | 3 live workflow tests |
| 3 existing test files | +60/−4, assertions re-pointed at `lastGood` |

**The goal, line by line — all four requirements met:**

1. **A crash is an infra failure, recognised structurally.**
   `isInfraStepFailure` (`packages/sdk-ts/src/executors/infra-failure.ts:17`) returns
   true when a FAILED step metered `tokens.output === 0` — "produced no answer" —
   and `runCliStep` sets the flag at the seam
   (`packages/sdk-ts/src/executors/step.ts:284`), inside the `!parsed.ok` branch that
   already means *the adapter never completed a valid turn*. Adapter-independent: a
   new executor inherits it without touching this code. ✅
2. **A crashed step's partial writes are not the delivery.**
   `packages/sdk-ts/src/workflow/agent-loop.ts:943` restores the workspace to
   `lastGoodCheckpointId` immediately after `executeStep` — **before** the judge runs
   — and moves `sinceCommit` with it, so the judge grades the restored tree rather
   than the half-written one. ✅
3. **A FAILED seal names `lastGood`.** `packages/sdk-ts/src/workflow/agent-loop.ts:327`
   prefers `lastGoodCheckpointId` on a FAILED terminal, and restores to it. ✅
4. **A delivered final step survives a FAILED run.** The restore is a no-op when the
   last checkpoint *is* `lastGood`, which is the delivered-final-step case. AC-2's
   Scenario B drives exactly that live and asserts the file survives. ✅

**The three designed traps — all rejected:**

| trap | rejected? | evidence |
|---|---|---|
| Add the crash string to a keyword list | ✅ | the classifier keys on `tokens.output === 0`, and `LEGACY_CAP_KILL_PREFIX` (`infra-failure.ts:9`) is unchanged legacy-journal support. The committed test at `packages/sdk-ts/test/runner/strike-accounting.test.ts:232` drives two failures whose reason text contains *"segmentation fault"* and *"killed"* and asserts **false** |
| Flag the crash but leave the tree | ✅ | `agent-loop.ts:943` restores the workspace, not just the strike count |
| Disturb `lastGood`, `gate-repair` routing, `completion-review.ts`, the judge prompt/form/rubric, the chain or Python mirrors, `judge/hermeticity.ts` | ✅ | AC-3's seven trap greps all green; `git status` shows none of those files touched |

**Independently verified beyond the ACs:**

- **Suite measured, not transcribed** (F-342): the declared `regression_suite`
  re-run in the harvested tree gives **1,788 passed / 23 skipped across 205 files**
  — floor 1,786, spec baseline 1,782. The flaky F-420 test did not fire.
- **Harvest** byte-IDENTICAL 10/10 — nothing diverged between the run workspace and
  the reviewed tree.
- **Scope discipline**: 10 files, every one named by or trivially entailed from the
  goal. No new dependencies. Strict ESM, named exports, no `any`.
- **The "unnamed crash shape" requirement** is met but thinly: the new cases
  (`v8 heap out of memory`, `SIGSEGV`, `syntax error in CLI output parsing`) are new
  *reason strings* that all reach the classifier through the same
  `tokens.output === 0` predicate the ACs already drive. Noted, not a defect.

**⚠️ None of the four behaviours was live-exercised by this run.** `scripts/dogfood.sh:330`
runs `pnpm -r build` at launch HEAD and then `pnpm chikory run`, so the harness that
executed is `71e32a6`'s build; the delivery lived only in the run's workspace clone.
The standing F-197 rule applies — the journal signature to look for **next run** is a
FAILED terminal whose `lastCheckpoint` names a checkpoint with `lastGood: true` *while
a later checkpoint exists*. This run cannot distinguish the two implementations,
because its `@12` was simultaneously the last checkpoint and the `lastGood` one.

## New friction

### F-429 🔴 — a deterministic rubric row cannot be retracted once raised

The completion review re-ran the architecture scan on the **cumulative** diff and
reported *"deterministic architecture scan found no layering violations"* (judge pass
#4, journal idx 13, all 5 rubric rows green). 17 ms later the run sealed FAILED on
`no_architecture_violations`.

`mergeDesignFindings` (`packages/sdk-ts/src/workflow/completion-review.ts:665`) unions
the failing rows of the sealing pass with those of the review, and its filter
(`:672`) is `if (result.pass || seen.has(result.id)) continue;` — a **passing** row is
skipped outright, so it can never clear the failing row of the same id. That union is
deliberate and correct for LLM-judged design rows: the doc comment names the trap it
exists for ("a second, independent review came back clean — drop the original
objection and seal, having paid an extra judge pass to change nothing").

It is wrong for the three **deterministic** rows in `DETERMINISTIC_RUBRIC_IDS`
(`packages/sdk-ts/src/judge/rubric.ts:28`). Those are not opinions that drift; they are
programs re-measured on a strictly wider diff, and the wider measurement is the more
authoritative one. Worse, they are the rows with no appeal:
`sealFromRubricFails` (`packages/sdk-ts/src/workflow/agent-loop.ts:375`) filters for
exactly this set (`:378`) and seals FAILED unconditionally.

**Probe (reproduced against the shipped function):**

```
mergeDesignFindings(
  [{ id: "no_architecture_violations", pass: false, … }],   // sealing pass
  [{ id: "no_architecture_violations", pass: true,  … }],   // completion review
) === ["no_architecture_violations"]
```

**Second-order cost.** The stale row also fed the oscillation guard: it was materially
the same objection as the one already attempted at step 1, so `decideCompletionReview`
(`packages/sdk-ts/src/workflow/completion-review.ts:613`) returned
`skip — "completion review: repeated objection on a converged step"`, no second grant
was issued, and control fell to `sealFromRubricFails(designFails)` (`:1438`). The
anti-oscillation bound (F-223…F-226) fired on a finding that had been **fixed**. The
run died with 4 of 6 steps and 98.9% of budget unspent.

→ **WP-648.**

### F-430 🔴 — the architecture scanner cannot tell a restored edge from a new one

`scanDiffForLayeringViolations` (`packages/sdk-ts/src/judge/scan-layering.ts:93`)
inspects **added lines only** (`:100`). It has no baseline, so a `+` line that
restores text already present on HEAD is scored identically to one that introduces a
forbidden edge.

That is precisely what happened. Step 1 widened one import; step 2 narrowed it back to
HEAD's exact text and moved the new symbol to a lower layer:

```diff
-import { advanceStrikeCount, isInfraStepFailure } from "../runner/strike-accounting.js";
+import { advanceStrikeCount } from "../runner/strike-accounting.js";
+import { isInfraStepFailure } from "../executors/infra-failure.js";
```

The `+` line is byte-identical to `packages/sdk-ts/src/workflow/agent-loop.ts:47`, which
has been on `main` throughout. **Probe, both diffs from the run's own artifacts:**

| diff | scanner output |
|---|---|
| step-2 scoped (`99816e9865e4`, 4,745 B) | `["workflow→runner"]` |
| cumulative vs `71e32a6` (`13118e14b21f`, 27,211 B) | `[]` |

**Blast radius — measured, not estimated.** Synthesising an all-added diff for each of
the 146 committed `packages/sdk-ts/src/**/*.ts` files and scanning it finds **11
pre-existing forbidden lines in 6 files**. Any step that rewrites one of these import
blocks manufactures a deterministic FAILED:

| edge | line |
|---|---|
| `workflow→runner` | `packages/sdk-ts/src/workflow/agent-loop.ts:47` (also `:20`, `:45`, `:69`, `:98`) |
| `workflow→runner` | `packages/sdk-ts/src/workflow/index.ts:8` |
| `judge→runner` | `packages/sdk-ts/src/judge/harness.ts:10` |
| `executors→runner` | `packages/sdk-ts/src/executors/prompt.ts:8` (also `:7`) |
| `planner→runner` | `packages/sdk-ts/src/planner/plan-repair.ts:26` |
| `runner→cli` | `packages/sdk-ts/src/runner/branch.ts:9` |

`agent-loop.ts` is the most-edited file of the entire campaign, which is why this
surfaced now and will surface again. Note `src/chain/` is folded into the `runner`
layer (`packages/sdk-ts/src/judge/scan-layering.ts:22`), which is what makes
`../chain/write-boundary.js` a `workflow→runner` edge.

The edges are real — the codebase does violate its own declared layer order — but the
scanner's claim is that the **diff introduced** them, and that claim is false. A gate
that condemns a step for not deleting a pre-existing violation is unsatisfiable by any
step that touches the file.

→ **WP-649.**

### F-428 🟡 — a verbatim goal prohibition still did not bind (3rd recurrence, now with a measured cost)

The goal said, in bold: *"Do NOT run the full vitest suite inside a step, and do NOT
background one and wait for it — dogfood-162 ended 2 of its 6 steps on 'I have started
running … and will report the results upon completion' (F-421/F-345/F-428)."*

Step 1's **entire** summary is three such lines, including
`pnpm --filter @chikory/sdk exec vitest run` — the full declared suite — and it was
killed at `606.7s` of a `600s` cap having produced 129 output tokens. Step 2 repeats
the pattern six times ("Waiting for task-110 to complete", "Continuing to wait for
task-110") but finishes inside the cap.

Cost: **10m 7s of the run's 21m 52s**, and it is what forced the step-1 → step-2
import churn that F-430 then converted into a fatal seal. Prohibition-in-prose has now
failed on three consecutive runs; the next attempt should be a mechanism, not stronger
wording.

→ **track-B note**, folded into F-421. Recorded in DOGFOODING §8.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-429 | 🔴 | `mergeDesignFindings` cannot clear a deterministic rubric row the completion review re-measured as PASS; `sealFromRubricFails` then seals FAILED with no appeal | **→ WP-648 (queued, NEXT HEADLINE)** |
| F-430 | 🔴 | the layering scanner has no baseline, so a restored pre-existing edge reads as a new violation — 11 such lines in 6 files on `main` | **→ WP-649 (queued, same headline)** |
| F-428 | 🟡 | a verbatim goal-level prohibition on backgrounding suites did not bind the executor for the 3rd consecutive run; cost a 606.7s cap kill | **track-B note** — folded into F-421, recorded in DOGFOODING §8 |

## Verdict on the thesis

**Durable execution: the strongest evidence yet, from the failure itself.** Step 1 was
killed at its wall-clock cap having written 24,712 bytes. Under `71e32a6`'s harness
that work was checkpointed, carried forward, and step 2 built on it — the run lost ten
minutes and zero bytes. The delivery this run produced closes the remaining hole
(a crash, unlike a cap kill, was not recognised) and the harvest is byte-identical.
That is the pillar working.

**Real-time judging: a true positive, a real repair, and then a gate that could not
take yes for an answer.** The judge caught a genuine architecture violation at step 1
that no acceptance check tested for — all 3 ACs were green on the violating code. It
spent one repair grant, the executor produced a *better* design than the one asked for
(a new pure module rather than a moved import), and the review confirmed the fix in
its own words. The gate then sealed FAILED on the superseded complaint.

**The caution, stated plainly:** this is the fourth consecutive FAILED seal
(160, 161, 162, 163), and it is the first where the seal is not defensible. 160, 161
and 162 failed on findings that were real and unfixed. 163 failed on a finding the run
had already fixed and re-measured. A gate that cannot retract is not a stricter gate —
it converts every true positive into a permanent one, and that is a *compounding
error* mechanism inside the very loop built to eliminate them. WP-648 and WP-649 are
the fix, and they are product code on the Agent-as-a-Judge pillar, not harness plumbing.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 2 steps / 21m 52s | 6 steps (dogfood-162) over trailing-3 |
| kill → resume count | 0 resumes; **1 cap-kill survived in-loop** (step 1, 606.7s / 600s cap, 24,712 B carried forward) | 0 resumes across trailing-3 |
| judge true-positives pre-land | **1** (`workflow→runner`, step 1 — caught what 3/3 green ACs missed, and the loop REPAIRED it) | 2 (161) · 4 (161) · 2 (162) |
| meta:product headline ratio | product | **0/3 harness-meta** — cap ≤1/3 not busted ✅ |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.9%** — 9 rollbacks / 176 steps over 22 runs (target 99%+) |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 `WP-530` moat ladder: rung 5 reached; remainder is `WP-304`, operator-run and quota-bound — no agent-runnable rung left |
