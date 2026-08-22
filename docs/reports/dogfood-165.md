# dogfood-165 — the loop now spots a reworded complaint 7 times out of 8 (WP-644 + WP-647)

**WP:** WP-644 (the repeat decision must hold on judge prose it was not tuned for) + WP-647 (an acceptance oracle's negative population must be able to collide with its positive one) · **Date:** 2026-08-22 ·
**Spec:** `examples/dogfood/dogfood-165-wp644-wp647-repeat-decision-on-untuned-prose.yaml` ·
**Run:** `run-99c6aad9-fee6-47cb-abcb-80737959032e` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder) — P3's exit gate (rung-5, published ranges + leaderboard) has no agent-runnable half left; what remains is WP-304's operator-run benchmark arm

## Plain lead

When the judge complains about the same thing twice in different words, the loop is
supposed to notice and stop paying for another repair attempt. It used to notice 4 times
out of 8 on real complaints from this campaign's own runs; it now notices **7 of 8** — and
it still keeps apart all 3 pairs where the same run raised two genuinely different
complaints. One clean step, $0.0954, nothing for the judge to catch. The delivery is
correct, and I re-measured every number myself rather than taking the run's word for it.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 11m 45s |
| cost | **$0.0954** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ **cost meter blind**: 6,829 metered tokens are unpriced (subscription-linked adapter), so the step reads $0.0000. Known false alarm, `docs/DOGFOODING.md:1476` |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 2 passes ($0.0575 + $0.0379) |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree — brownfield, harvested delivery) |
| harvest | 2/2 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.4k/2.4k | $0.0000 | 8m 7s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files (15,753 diff bytes):**

| file | what changed |
|---|---|
| `packages/sdk-ts/src/workflow/completion-review.ts` | `matchProfiles` extracted from the comparator body (`:460`); shared-focus / shared-mechanism now also satisfied by token counts (`:529`); new `splitIntoSentences` (`:539`) drives a clause-level second pass (`:590`); the superset policy is stated in the doc block (`:563`); acceptance-criterion words added to `BOILERPLATE` (`:140`) |
| `packages/sdk-ts/test/runner/completion-review.test.ts` | +4 tests: superset restatement (`:664`), an un-named corpus pair (`:679`), and both `decideCompletionReview` directions (`:777`, `:804`) |

**The goal, line by line — every number re-measured against the landed tree, not transcribed:**

| goal clause | required | measured (independent) | |
|---|---|---|---|
| recall on the 8 labelled restatements | ≥ 6/8 (incumbent 4) | **7/8** | 🟢 beats the floor |
| broad ceiling, 1501 cross-family pairs | ≤ 25 (1.67%); incumbent 23 | **25 (1.67%)** | 🟢 at the budget, zero headroom (F-439) |
| hard ceiling, 3 same-run same-rubric-id negatives | 0/3 | **0/3** | 🟢 |
| the decision holds where it SPENDS a grant | `skip` on a restatement, `review` on a genuinely different second objection | both driven through the real `decideCompletionReview` | 🟢 |
| the superset policy is decided in code | stated explicitly | doc block item 7, `completion-review.ts:563` | 🟢 |
| pure + replay-safe, two-arg shape, `MAX_PROGRESS_GRANTS` stays | unchanged | no I/O, no clock, no randomness; `MAX_PROGRESS_GRANTS` at `:38` | 🟢 |
| a committed test drives a pair the ACs do not name | at least one | present, but **paraphrased** rather than read from the corpus | 🟡 F-436 |

**The three designed traps were all rejected:**

- **Buying recall with soundness** (what killed dogfood-162 at 44.06% cross-run false
  positives) — rejected. The delivery bought its recall for **+2 cross-family pairs**, and
  both are semantically defensible: `73845f54fc82`/`cc4c6bb4b88e` both fault missing
  `probe.json` evidence, and `af9a7595e61c`/`d757d18dd1b2` both fault *this very
  comparator* for depending on hand-authored vocabulary.
- **Hard-coding the fixture** — rejected. No committed file under `packages/sdk-ts/src/`
  contains a 48-character substring of any corpus justification, and every labelled pair
  re-asserted swapped and whitespace-renormalised.
- **Grading the pure function and calling it done** — rejected. AC-2 drives
  `decideCompletionReview`, the seam that turns the answer into a repair grant.

**Ablation — I took the delivery apart to find out what actually bought the recall:**

| variant | recall | hard neg | cross-family FPs |
|---|---|---|---|
| incumbent (`main` at launch) | 4/8 | 0/3 | 23 |
| **as delivered** | **7/8** | **0/3** | **25** |
| delivered − the acceptance-criterion `BOILERPLATE` words | 7/8 | 0/3 | **28 ⛔ over budget** |
| delivered − the clause-level pass | 4/8 | 0/3 | 24 |
| delivered − the loosened focus/mechanism counts | 4/8 | 0/3 | 24 |

Nothing in the diff is decoration: the clause-level pass and the loosened counts each buy
**nothing alone** and 7/8 together, and the `BOILERPLATE` addition is what keeps the
ceiling inside its budget. Latency is unchanged (0.28 ms/call on the longest real pair vs
the incumbent's 0.36 ms; 2.0 ms on a synthetic 4.3 KB 40-sentence pair).

**A measured floor is a lower bound on what is reachable, not a ceiling.** The spec set
recall at 6, not 7, because nine reference variants at the arming pass reached 7/8 only by
merging hard negative `5be9cc13e184`/`95e2cad7f49d`. The delivery reached 7/8 **without**
merging it. The floor was honest about what I could reach; it was not evidence about what
the executor could.

**Scope discipline:** exactly the 2 files the goal names. No dependencies, no config, no
out-of-scope surface touched — AC-3's six guard greps (`mergeDesignFindings`,
`scanDiffForLayeringViolations`, `MAX_GATE_REPAIR_ATTEMPTS`, `isInfraStepFailure`,
`MAX_PROGRESS_GRANTS`, the comparator's own export) all held. Declared suite **1,810
passed** (baseline 1,806; AC-3's floor 1,810 — met exactly, by the 4 tests added).

**Judge behaviour:** 2 passes, 3/3 criteria + 6/6 rubric on the step pass, 4/4 rubric on
the completion review, **0 rollbacks, 0 escalations, 0 true positives, 0 false positives**.
Nothing was there to catch — the first clean-catch-free run since dogfood-159 that also had
no defect worth catching. Family diversity real: `gemini-cli` executor vs `openai-compat`
judge.

## New friction

Continuing the global sequence from **F-435**.

### F-436 🟡 — "a committed test reads the corpus" was satisfied by a JSON fixture

AC-3 tried to force the delivery to pin its behaviour in the repo rather than only in the
run's grading checks (F-356). Its clause was
`grep -rlqE 'objection-corpus\.json' test/` (spec line 517). That matches
`packages/sdk-ts/test/fixtures/objection-labels.json:4` — the labels file's own `meta.how`
prose names the corpus file. **The clause was already GREEN on HEAD**, and the arming pass
could not see it because AC-3 as a whole was RED on the suite-count floor.

What the delivery actually did: it **paraphrased** three corpus rows into
`packages/sdk-ts/test/runner/completion-review.test.ts:679` instead of reading them. I drove
the REAL rows (`8cbdc6ffdb60` / `c7d2b3b72287` / `cc4c6bb4b88e`) through the landed
comparator and they behave exactly as the paraphrase asserts (`true` / `false` / `false`),
so nothing is wrong today — but the check cannot enforce the requirement it names, and a
paraphrase does not pin the prose.

**Rule:** a grep that must find a TEST is scoped to test files, never to a `test/` tree
that also holds fixtures.

### F-437 🟡 — the loosened counts merge two objections that fault DIFFERENT things

`hasSharedFocus` now also accepts `sharedSubTokens.length >= 3` and `hasSharedMechanism`
accepts `sharedEntities.length >= 2 || sharedSubTokens.length >= 4`
(`packages/sdk-ts/src/workflow/completion-review.ts:529`). Two objections that are
word-for-word identical except for the identifier naming *which* thing is faulted now
compare "same" where the incumbent said "different":

```
A: "The delivery's `AC-1` check writes a generated test into `test/runner` and never
    asserts the recall floor, so the criterion passes without grading the behaviour it names."
B: … identical, `AC-2` …
      incumbent = false      delivered = true
```

Pinned to the counts by ablation: reverting only them restores `false`; reverting the
`BOILERPLATE` words or the clause-level pass does not. **Not manifest on the measured
population** — the corpus holds only 4 AC-citing rows and no real pair flips. It matters
because "AC-1 is not graded" and "AC-2 is not graded" are two findings, and merging them
silences the second one.

**The wider hole this exposed is NOT this run's doing, and it is much bigger.** I built a
negative population the ACs never had: for each of the **40 corpus rows** that name a
lowerCamelCase locus, substitute every such identifier for an exported SDK function drawn
from `git grep '^export function' -- src` (322 symbols, 3 deterministic rounds → **120
pairs**). Each twin is the same complaint about a *different* piece of code, so every pair
is a negative. Both comparators merge **60 of 120 — 50.0%, identical**:

| comparator | locus-substitution pairs merged |
|---|---|
| incumbent (`main` at launch) | 60/120 (50.0%) |
| as delivered | 60/120 (50.0%) |

So the "same prose, different target" hole predates WP-643 and WP-644; what dogfood-165
added is the narrower AC-1/AC-2 case above. **This 50% is WP-650's premise** — a
repo-enumerated population no delivery can hand-fit, colliding with the 8 recall positives
on exactly the predicate WP-644 loosened. It cannot be closed by reverting the counts:
that drops recall from 7/8 back to 4/8 and does not move the 50% at all.

### F-438 ℹ️ — the corpus overstated its own uniqueness

`objection-corpus.json`'s `meta.what` claimed 86 unique deduped justifications. There are
**83** unique justifications across 86 rows: 3 rows are branch-run replays of a parent row,
carrying identical text under an identical `key`. Harmless to every graded number (the
`runFamily` collapse removes branch/parent pairs from all negative populations before they
are counted) but the claim was quoted into the spec and into `DOGFOODING.md`.

### F-439 🟡 — the broad ceiling is saturated at exactly its budget

The landed comparator sits at **25/1501, the budget's exact value**. The next WP on this
surface inherits a ceiling with zero headroom: any change that merges one more cross-family
pair fails AC-1 before it is even read. The budget must be re-measured from the LANDED
comparator (25, 1.67%) before the next spec on this seam sets one, not copied from the
incumbent-plus-tolerance arithmetic that produced 25.

### F-440 ℹ️ — the README index updater grew the row from 4 columns to 8

`dogfood-docs.mjs index <nnn> --outcome` splits the row on `" | "`, writes `cols[2]`/`cols[3]`
and joins — but never truncates. The dogfood-165 row's pre-run outcome cell held the ARMING
TABLE (which the skill tells you to paste there), whose own `" | "` separators made the split
return 8 fields, so the update left four dangling cells and three copies of the report link.
Caught by eye, not by a gate.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-436 | 🟡 | AC-3's "a COMMITTED test reads the corpus" clause matched a JSON fixture and was green on HEAD; the delivery paraphrased corpus rows instead of reading them | **HAND-FIXED THIS SITTING** — new `packages/sdk-ts/test/runner/objection-corpus-floors.test.ts` reads both fixtures and pins the recall floor (`:61`), the 25/1501 ceiling (`:77`) and the un-named real rows (`:98`); 5 tests, suite 1,810 → 1,815 |
| F-437 | 🟠 | "same prose, different target" objections merge — **60/120 (50.0%)** of a repo-enumerated locus-substitution population, IDENTICAL on the incumbent, plus a narrower AC-1/AC-2 case this run newly introduced | **→ WP-650 (queued, next headline)** — the 50% is the premise and the 120-pair population is the oracle; it cannot be bought back by reverting the counts (recall 7/8 → 4/8, the 50% unmoved) |
| F-438 | ℹ️ | corpus `meta.what` claimed 86 unique justifications; there are 83 across 86 rows | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/test/fixtures/objection-corpus.json` meta now states 86 rows / 83 unique and names the branch-replay cause |
| F-439 | 🟡 | the cross-family ceiling is saturated at exactly 25/25, leaving the next WP on this seam no headroom | **track-B note** — re-measure the budget from the landed comparator before the next spec on this surface; recorded in `docs/DOGFOODING.md` §8. Already relieved in practice: the dogfood-166 arming reference measures **21/1501** |
| F-440 | ℹ️ | `dogfood-docs.mjs index --outcome` grew the README row from 4 columns to 8 when the outcome cell it replaced contained `" | "` (an arming table) | **HAND-FIXED THIS SITTING** — `scripts/dogfood-docs.mjs:213` now truncates with `cols.length = 4`; the dogfood-165 row repaired by hand |

## Verdict on the thesis

A clean data point for **Agent-as-a-Judge in the inner loop**, from the unglamorous
direction: the loop's ability to tell "you already said that" from "that is a new problem"
got materially better on prose nobody tuned it for, and the acceptance oracle that graded it
held. dogfood-162 failed this exact WP at a 24× soundness collapse while passing every
criterion it had, because its negative population was two hand-picked invented pairs.
dogfood-164 repeated the shape one level down. This time the recall floor and BOTH ceilings
were graded in one check over 1,512 real pairs the delivery could not enumerate — and the
delivery paid a defensible **+2 pairs** for **+3 recall**.

**Standing caution:** the run scored **zero judge catches**, and that is the honest reading
here — there was nothing to catch. The two defects this review found (F-436, F-437) are
invisible from a diff: one is an acceptance check that was green before the run started, and
the other needs an input the corpus does not contain. Neither is a judge failure; both are
oracle-design failures, which is the family WP-647 exists to close.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 11m 45s | 6 steps (dogfood-162) over the trailing 3 |
| kill → resume count | 0 | 0 over the trailing 8 |
| judge true-positives pre-land | 0 (nothing to catch) | 4 over the trailing 3 (164: 1 · 163: 1 · 162: 2) |
| meta:product headline ratio | product | **0/3 harness-meta** — cap (≤1 per 3) intact |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.9%** — 9 rollbacks over 176 steps, 22 runs; target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3-rung-4 climbed; rung-5 (EXIT) blocked on WP-304's operator-run arm, no agent-runnable half |
