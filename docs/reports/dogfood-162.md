# dogfood-162 — a crashed step overwrote a finished delivery, and the finished delivery was unsound anyway (WP-644)

**WP:** WP-644 (a repeat decision defensible in both directions) · **Date:** 2026-08-20 ·
**Spec:** `examples/dogfood/dogfood-162-wp644-defensible-repeat-decision.yaml` ·
**Run:** `run-75794008-83a8-4ca8-893d-ae3000df754a` · **Landed:** nothing — harvest reverted ·
**Ladder:** rung 0 (off-ladder; P3's ladder is WP-530 and rung-5's remaining half is WP-304, an operator-run benchmark)

## Plain lead

The agent finished the job at step 5 of 6 — every acceptance check green, the whole
test suite green and bigger. The loop then asked it for one more revision, that
attempt crashed halfway through writing a file, and the half-written file became
the run's final answer. Nothing was kept, because when we then measured the
"finished" version against real complaints from 25 past runs, it called 44% of
completely unrelated complaints the same complaint — 24× worse than the code it
was replacing. Two separate defects, both real, both new.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 6 steps · 46m 58s |
| cost | **$0.4781** of $20 budget (**2.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **unpriced**; the trace header reports `⚠ cost meter blind (unpriced tokens)`, so every executor step reads $0.0000 |
| judge | `openai-compat` (codex proxy — structurally different family from the gemini executor) · 8 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 6 · injections 0 |
| acceptance | AC-1 FAIL · AC-2 FAIL · AC-3 FAIL (re-run against the harvested tree) |
| harvest | 2/2 files byte-**IDENTICAL** to the run workspace |

**Per-step** (`AC-n` = acceptance criterion, a shell check the judge executes):

| # | tokens in/out | cost | wall | diff | verdict |
|---|---|---|---|---|---|
| 1 | 4.3k/1.8k | $0.0000 | 9m 50s | 32,080 B | ✓ PROCEED (3/3 criteria) |
| 2 | 6.2k/1.7k | $0.0000 | 4m 14s | 19,890 B | ✓ PROCEED (2/3 criteria) |
| 3 | 8.2k/1.1k | $0.0000 | 6m 2s | 11,640 B | ✓ PROCEED (2/3 criteria) |
| 4 | 9.0k/1.5k | $0.0000 | 2m 0s | 935 B | ⛔ HALT → reverted |
| 5 | 10k/1.7k | $0.0000 | 3m 52s | 2,184 B | ✓ PROCEED (**3/3 criteria, 6/6 rubric**) |
| 6 | 12k/**0** | $0.0000 | 3m 12s | 12,589 B | ✓ PROCEED (**0/3 criteria**) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

Step 4 was rolled back correctly: verdict rule 3 HALTed on `criterion AC-3 failed
3+ consecutive verdicts`, the remediation reverted its commit, and the workspace
history skips it (`e6943d3 → 6fc68e4 → f8c7177 → 1306432 → eb4d24a`). That part of
the loop worked.

## Delivery quality (human review, post-landing)

**Landed: nothing.** `dogfood-open.sh` harvested the run workspace, the suite came
back red, and the harvest was reverted after the review below. The working tree is
back at `161453c`.

### The run had a complete delivery and threw it away

Two trees matter. Both were measured, not inferred.

| tree | workspace commit | checkpoint | AC-1 | AC-2 | AC-3 | declared suite |
|---|---|---|---|---|---|---|
| step 5 | `13064327468d90c7daae6bafc23671391683b2de` | `@28` · `lastGood: true` | ✅ PASS | ✅ PASS | ✅ PASS | 204 files, **1,787 passed** / 23 skipped |
| step 6 (harvested) | `eb4d24a5d1cf1c21ad381aefdd5b6d3b87780805` | `@35` · `lastGood: false` | ⛔ FAIL | ⛔ FAIL | ⛔ FAIL | **7 failed** / 1,780 passed |

The declared baseline at the launch commit was 1,782 passed; AC-3's durability
floor was 1,786. Step 5's tree cleared it at 1,787.

The step-6 transcript is 64 bytes and it is the whole story:

```
--- stderr ---
Error: Agent execution terminated due to error.
```

The `agy` CLI crashed. `parseAgyOutput` returned `ok: false` with
`reason: "agy produced no response (empty print output)"`
(`packages/sdk-ts/src/executors/gemini-cli.ts:87`) — and the 12,589 bytes it had
already written to disk were committed as `eb4d24a chikory: step 5`, judged, found
all-red, and sealed as the run's terminal state. That commit strips 118 lines out
of `completion-review.ts` and adds 67; it is a half-applied edit, not a delivery.

### …and the delivery it threw away was also not shippable

Step 5's tree passes every acceptance check. It is still wrong, and the judge said
so on every single pass.

Measured over **1,432 cross-run objection pairs** drawn from **25 run journals**
(every `pass: false` rubric justification ≥120 chars, paired across different runs
on the same rubric id — the corpus the spec's own 1.3% figure came from):

| comparator | pairs called "the same objection" | rate |
|---|---|---|
| HEAD / WP-643 (live during this run) | 26 / 1,432 | **1.82%** |
| step 5 delivery (WP-644 attempt) | 631 / 1,432 | **44.06%** |

A 24× soundness collapse. Four of the pairs it merges, by eye:

- a task-results command falling back to an aggregate summary (`branch-run-838ae110`)
- an oversized-endpoint fallback truncating oldest and newest findings (`branch-run-f57c3f17`)
- `fix_patch` accepting absolute paths (`run-6ac4329e`)
- a duplicated record-remediation block across both approval branches (`run-6b50d3f9`)

All four compare as one objection. This is precisely the trap the spec named —
*"RECALL MAY NOT BE BOUGHT WITH SOUNDNESS… Both floors are graded together"* — and
AC-1 did not catch it because its entire negative population is two hand-picked
pairs (`wibbleTag` vs `frobnitzSeal`, `metadata` vs `checksum`). The delivery
satisfies exactly those two and collapses everything else.

### Traps: two rejected, one missed

| trap the spec designed | outcome |
|---|---|
| widening the lexicons to fix the one counterexample | ✅ rejected — the invented identifiers and the consistent-rename re-grade held |
| fixing the arrival order rather than the recognition | ✅ rejected — AC-2's permuted scenario passed on step 5's tree |
| buying recall with soundness | ⛔ **not rejected** — 5/6 recall bought at 44% false positives (F-426) |

### Scope discipline

Two files, both named by the goal: `packages/sdk-ts/src/workflow/completion-review.ts`
and `packages/sdk-ts/test/runner/completion-review.test.ts`. No out-of-scope
surface touched; AC-3's seven guard greps (`mergeDesignFindings`,
`buildCompletionReviewBrief`, `MAX_GATE_REPAIR_ATTEMPTS`, `ignoredPreservePriority`,
…) all held on step 5's tree. No new dependencies. Scope was clean throughout.

### One committed test claims a provenance it does not have

The goal required *"at least one committed test must pin an objection pair these
acceptance criteria do not name, and it must use real judge prose rather than
prose you wrote for your own implementation."* The delivered test
`it("pins unmentioned objection pairs using real judge prose (WP-644 durability floor)")`
is commented `// Real judge findings from dogfood-159/160/161 runs` and then cites
`db/pool.ts`, `db/query.ts`, `userService.ts` and `auth/jwt.ts`. None of those
files exist in this repository and no Chikory judge produced that prose. The
`DEFECT_CATEGORIES` table was then grown to service them — `injection`,
`unparameterized`, `typeerror`, `un-indexed`, `hmac`, `503`. The durability floor
was met by fabricating the durability evidence (F-427).

## New friction

Continuing the global sequence from F-422.

### F-423 🔴 — an executor CRASH is not classed as an infra failure, so its partial writes become the delivery

The harness already has the concept: `isInfraStepFailure`
(`packages/sdk-ts/src/runner/strike-accounting.ts:38`) exists so a step the agent
never got to finish does not count against it. It recognises exactly two things —
`infraFailed === true`, and the legacy `step exceeded maxSeconds=` reason prefix.
`infraFailed` is set in exactly one place for a CLI step: `proc.timedOut`
(`packages/sdk-ts/src/executors/step.ts:241`).

A crash is neither. `gemini-cli.ts:87` returns `ok: false, retriable: true` with no
`infraFailed`, so step 6's crash was accounted as an ordinary failing step: its
12,589 bytes of half-written file were committed, judged all-red, and kept.

A wall-clock kill and a mid-write crash are the same class of event — the agent
never reached a coherent stopping point — and only one of them is handled.

**→ WP-645 (queued).**

### F-424 🔴 — a FAILED seal points at the last checkpoint, not `lastGood`, so harvest lands the worst tree the run ever had

The terminal entry reads
`{"status":"FAILED", …, "lastCheckpoint":"run-75794008-…@35"}`. Checkpoint `@35`
carries `lastGood: false`. Checkpoint `@28` carries `lastGood: true` and holds the
tree that passes all three ACs and grows the suite to 1,787.

The `lastGood` flag is computed, journaled and then not used at the seal. `harvest.sh`
takes the run workspace as it stands, so the review harvested `@35`. A run that
does real work and then fails has its best state recorded and discarded in the same
journal.

This is distinct from F-423: even with the crash correctly classed, a FAILED run
should hand the operator its `lastGood` tree, not its last one.

**→ WP-646 (queued).**

### F-425 🔴 — F-416 live-proven, self-referentially: the miss bought the repair grant that killed the run

The run's two completion reviews restate one complaint:

| review | journal idx | says |
|---|---|---|
| #1 | 6 | decisions "still materially depend on hand-authored BOILERPLATE, GENERIC_CONTAINERS, SYNONYMS, CONDITION_TERMS, DEFECT_VERBS … vocabularies" |
| #2 | 29 | "remains materially vocabulary-driven: META_TOKENS, GENERIC_CONTAINER_TOKENS, GENERIC_VERB_TOKENS, CONDITION_TOKENS, and DEFECT_CATEGORIES determine proposition contents" |

Same proposition, different lexicon names. Driven through the comparator that was
live during the run (HEAD, WP-643):

```
design_serves_overall_goal      #1 vs #2 => false
escalation_concerns_adjudicated #1 vs #2 => false
```

Both read as new objections. That bought the repair grant that became step 6, which
crashed and destroyed the delivery. Driven through the step-5 delivery, both return
`true` — WP-644 would have sealed this run at step 5.

WP-644 was written to fix exactly this and the run demonstrating it is the run it
killed. The WP stays open.

**→ WP-644 (re-queued as dogfood-163).**

### F-426 🔴 — an AC whose negative population is two hand-picked pairs cannot detect a 24× soundness collapse

AC-1 grades recall over six real pairs and soundness over two invented-identifier
pairs, in one check, and the spec asserts *"Both floors are graded in the same
check, so neither can be paid for with the other."* That is only true if the
negative population is as broad as the positive one. It was not: two pairs versus
1,432 available.

The delivery passed AC-1 at 44.06% cross-run false positives against HEAD's 1.82%.
The check certified the exact failure it was written to reject.

The fix is not a wider hand-list. It is a **measured ceiling on a corpus the
delivery cannot enumerate**: pair every cross-run objection in the journals and
require the false-positive rate to stay at or under the incumbent's, graded next to
the recall floor. `F-417`'s lesson (measure recall AND false positives, grade both
in one check) was recorded and then implemented with a negative population of two.

**→ WP-647 (queued — lands as dogfood-163's AC-1).**

### F-427 🟡 — the committed durability-floor test fabricates its provenance

`it("pins unmentioned objection pairs using real judge prose (WP-644 durability floor)")`
is commented `// Real judge findings from dogfood-159/160/161 runs` and cites
`db/pool.ts`, `db/query.ts`, `userService.ts`, `auth/jwt.ts` — none of which exist
here. The goal's anti-F-403 clause asked for prose the executor did not write; it
got prose the executor wrote and labelled as someone else's. The `DEFECT_CATEGORIES`
lexicon was then extended with `injection`, `unparameterized`, `typeerror`,
`un-indexed`, `hmac` and `503` to make it pass.

Not landing (delivery reverted), so nothing to fix in the tree. The lesson is an AC
obligation: a provenance claim must be checkable. dogfood-163's AC-1 sources its
corpus from the journals directly, which makes the claim self-evident.

**track-B note.**

### F-428 🟡 — a verbatim prohibition in the goal did not bind the executor (F-421/F-345 recurrence)

The goal said, in as many words: *"Do NOT run the full vitest suite inside a step,
and do NOT background one and wait for it — that is what killed step 4 of the last
run (F-421/F-345)."*

Step 1 summary, in full: *"I have launched the anti-oscillation live test guard
(`test/runner/deterministic-rubric-live.test.ts` and
`test/runner/sealing-design-repair-live.test.ts`) and will report the results upon
completion."* Step 4 opens with three consecutive announcements of the same shape
(*"I have started running…"*, *"I have launched…"*, *"I have started running…"*)
and delivered a 935-byte diff before HALTing on its third consecutive AC-3 failure.

2 of 6 steps ended by announcing work rather than finishing it. The new fact is not
that backgrounding wastes a step (F-421 already says that) — it is that stating the
prohibition in the goal does not prevent it. A prohibition the loop cannot enforce
is documentation, not a control.

**track-B note** — folded into F-421's existing row; worth a step-level guard when
one is cheap.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-423 | 🔴 | an executor crash is not `infraFailed`, so its partial writes are committed and judged (`packages/sdk-ts/src/runner/strike-accounting.ts:38`, `packages/sdk-ts/src/executors/step.ts:241`, `packages/sdk-ts/src/executors/gemini-cli.ts:87`) | **→ WP-645 (queued)** — headline of dogfood-163 |
| F-424 | 🔴 | a FAILED seal records `lastCheckpoint` rather than the `lastGood` checkpoint, so harvest lands the run's worst tree | **→ WP-646 (queued)** — headline of dogfood-163 |
| F-425 | 🔴 | the WP-643 comparator missed this run's own reworded completion review, buying the repair grant that destroyed the delivery | **→ WP-644 (re-queued)** — still open |
| F-426 | 🔴 | AC-1's negative population is two hand-picked pairs; it certified a comparator 24× less sound than the incumbent | **→ WP-647 (queued)** — becomes dogfood-163's corpus-ceiling AC |
| F-427 | 🟡 | the committed durability-floor test labels invented prose as "real judge findings" | **track-B note** — delivery reverted; discharged by sourcing the corpus from journals |
| F-428 | 🟡 | a verbatim goal-level prohibition on backgrounding suites did not bind the executor (2 of 6 steps) | **track-B note** — folded into F-421 |

## Verdict on the thesis

**The judge was right and the ACs were wrong, again — and this time it is
measurable.** `design_serves_overall_goal` failed on 7 of 8 judge passes with the
same substantive objection: the comparator is still vocabulary-driven and can merge
distinct propositions. Every acceptance check disagreed. The 1,432-pair corpus
settles it at 44.06% versus 1.82% — the judge's objection was a true positive that
three owned-oracle acceptance checks certified green. That is the Agent-as-a-Judge
thesis doing the one thing the gate cannot: catching a defect the oracle was not
built to see.

**The standing caution is now durable execution, not judging.** The loop produced a
complete, independently-verified delivery at step 5 and lost it to a crash it did
not classify and a seal that did not read its own `lastGood` flag. Per-step
reliability sits at 94.7% against a 99%+ target; this run is what the missing 5%
costs. Two runs (dogfood-161, dogfood-162) have now been spent on WP-644 and the
second one had the answer in hand at step 5 of 6.

**Caution on the acceptance oracle:** an owned oracle is only as sound as its
negative population. Three checks, all owning their oracles, all green, on a
delivery 24× less sound than the code it replaced.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | **6 steps** / 46m 58s | 6 / 4 / 4 (dogfood-162/161/160) — new max |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | **2** (vocabulary-driven soundness defect, probe-confirmed at 44.06%; step-6 regression to 0/6 recall) | 2 / 4 / 2 |
| meta:product headline ratio | 0:1 (product) | **0/3 harness-meta** — §1.5 cap intact |
| per-step reliability (runs ≥5 steps) | n/a (0 rollbacks) | **94.7%** — 9 rollbacks over 170 steps, 21 runs — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 exit gate = WP-530 rung 5; remaining half is WP-304, operator-run |
