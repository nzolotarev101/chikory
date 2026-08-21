# dogfood-164 — the gate can now take yes for an answer (WP-648 + WP-649)

**WP:** WP-648 (a re-measured deterministic row can clear its own earlier FAIL) + WP-649 (the
architecture scan reports what the diff INTRODUCED) · **Date:** 2026-08-21 ·
**Spec:** `examples/dogfood/dogfood-164-wp648-wp649-gate-must-take-yes.yaml` ·
**Run:** `run-be874c29-6b55-4cb6-a9cc-9784170c64f5` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3 rung-5's remaining half is WP-304, an operator-run
quota-bound benchmark arm; the progression gate read ✅ PROGRESSING, so the rung did not bind)

## Plain lead

The loop can now change its mind in the safe direction: when the final review re-runs a
machine check and it comes back clean, that clean answer clears the earlier complaint instead
of failing the run. Half the delivery was right and shipped as written; the other half — the
architecture check — was fixed in a way that stopped it seeing a whole class of real problems,
which human review caught and hand-fixed in the same sitting.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 8m 8s |
| cost | **$0.113** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ unpriced (cost meter blind: 6,285 metered tokens, $0.0000) |
| judge | `openai-compat` (`gpt-5.6-sol xhigh`) · 2 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 · injections 0 · pacing events 1 (peak window 1%) |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree; **re-run again after the hand-fix — still 3/3**) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.6k/1.7k | $0.0000 | 3m 57s | ✓ PROCEED (3/3 criteria) |

Judge passes: #1 step-scoped 43.8k/1.4k tokens, $0.0684, 140.5 s · #2 completion review
27.5k/1.0k tokens, $0.0446, 106.3 s. No empty-diff probe step — **F-11 (wasted probe step) did
not recur**. One step, no repair grant, no resume: the cheapest terminal shape the loop has.

## Delivery quality (human review, post-landing)

| file | verdict |
|---|---|
| `packages/sdk-ts/src/workflow/completion-review.ts:687` (`mergeDesignFindings`) | 🟢 correct as delivered |
| `packages/sdk-ts/src/judge/scan-layering.ts:131` (`scanDiffForLayeringViolations`) | 🔴 shipped a recall hole — hand-fixed (F-431) |
| `packages/sdk-ts/test/judge/scan-layering.test.ts` (+7 tests) | 🟡 one test overclaims its corpus (judge caught it) |
| `packages/sdk-ts/test/runner/completion-review.test.ts` (+6 tests) | 🟢 |
| `packages/sdk-ts/test/runner/deterministic-rubric-live.test.ts` (+2 scenarios) | 🟢 |

**Scope:** 5 files, 459 insertions / 19 deletions — exactly the two production files the goal
names plus their colocated tests. No new dependencies. No out-of-scope surface touched
(AC-3 greps nine protected symbols and all nine survive).

### WP-648 — the acquittal half is right, and it is wired to the real seal

The goal's hard part was making the retraction reach the seal, not just the merge. Verified by
hand, not from the ACs:

- `mergeDesignFindings` (`packages/sdk-ts/src/workflow/completion-review.ts:687`) now branches on
  `DETERMINISTIC_RUBRIC_IDS` (`:704`): a deterministic row the review re-measured as PASS is
  dropped (`:707`); an LLM-judged row keeps the unconditional union. Trap C rejected.
- The other disagreement direction is decided **and stated in code**, as the goal demanded: a
  sealing PASS with a review FAIL falls through to the second loop and the review's FAIL is
  merged, so a cumulative-only violation still condemns.
- **Reducer-override sweep (F-399 discipline).** `mergeDesignFindings` has exactly one call site,
  `packages/sdk-ts/src/workflow/agent-loop.ts:1387`, and its output drives both the repair-grant
  decision and `sealFromRubricFails` (`:375`). The two *other* seal sites that pass
  `sealingRubricFails` straight through (`:1344`, `:1449`) are the 0-byte-stall path and the
  no-review-dispatched path — in both, no second measurement exists, so there is nothing to
  acquit with. The acquittal is not bypassable.

### WP-649 — the scan half fixed the false positive and bought it with a false negative

The delivery gives the scanner a pre-image (`isPreImageCodeLine`,
`packages/sdk-ts/src/judge/scan-layering.ts:35`) and exonerates an added forbidden import when
the pre-image side already carries one. **It keyed that exoneration on the layer-pair LABEL**
(`workflow→runner`), not on the import. Every one of the goal's own false-positive cases passes —
and so does a genuinely new forbidden import, whenever any *other* import of the same layer pair
is in the same hunk. See F-431.

## New friction

### F-431 🔴 — the exoneration was keyed on the layer pair, so 7 files became blind spots

**Defect.** `scanDiffForLayeringViolations` collected pre-image forbidden **edge labels** per
file and suppressed any added edge whose label matched. A `git diff -U3` that adds a new
forbidden import within three lines of an existing one carries the existing one as a **context**
line — which then acquits the new one.

**Measured, on a real `git diff`, not a synthetic string.** Added
`import { brandNewEscape } from "../runner/worker.js";` to
`packages/sdk-ts/src/workflow/agent-loop.ts` (whose `:47` already imports
`../runner/strike-accounting.js`), captured `git diff`, fed it to the built function:

| scanner | result on the same real diff |
|---|---|
| HEAD before this run | `["workflow→runner"]` — reported |
| as delivered | `[]` — **silent** |
| after hand-fix | `["workflow→runner"]` — reported |

**Blast radius, measured over the enumerated corpus** (`git ls-files packages/sdk-ts/src`, 158
`.ts` files): **7 files already carry a forbidden edge, 12 lines total** —
`packages/sdk-ts/src/workflow/agent-loop.ts` (5), `packages/sdk-ts/src/executors/prompt.ts` (2),
`packages/sdk-ts/src/judge/harness.ts`, `packages/sdk-ts/src/planner/plan-repair.ts`,
`packages/sdk-ts/src/runner.ts`, `packages/sdk-ts/src/runner/branch.ts`,
`packages/sdk-ts/src/workflow/index.ts`. `agent-loop.ts` is the file the campaign edits most.
A second shape needs no pre-existing edge at all: a diff that **removes** one forbidden import
and **adds a different one of the same pair** was also silent.

This is the F-417 family — a fix that moves failures into the unsafe direction. The gate is one
of the three unappealable `DETERMINISTIC_RUBRIC_IDS` rows
(`packages/sdk-ts/src/judge/rubric.ts:28`), so a hole in it is silent by construction.

**Hand-fixed this sitting.** The exoneration is now keyed on the resolved import **path**
(`packages/sdk-ts/src/judge/scan-layering.ts:110`, `:163`, `:175`, `:181`) — a restore of the
same module still clears, a different module never does. 3 new committed tests
(`packages/sdk-ts/test/judge/scan-layering.test.ts:308`, `:324`, `:337`), all 3 RED before the
fix. Suite: 24/24 in that file, declared suite **1806 passed** (was 1803), AC-1/AC-2/AC-3 all
re-run **PASS** after the fix.

### F-432 🟡 — AC-1's recall floor used an edge no pre-image can hold

The spec applied F-426 ("grade the ceiling on a corpus the delivery cannot enumerate") to the
**file** population and got that right: both floors run over `git ls-files`. It did not apply it
to the **edge** population. The recall probe is a single constant —
`import { __ac1Probe } from "src/cli/__ac1_probe_target.js";`
(`examples/dogfood/dogfood-164-wp648-wp649-gate-must-take-yes.yaml:227`) — so every recall case
is a `X→cli` edge, and the recall corpus excludes `src/cli/`. The ceiling cases and the recall
cases therefore never share an edge label, which is exactly the collision F-431 lives in.

It came within six lines of catching it. Two corpus files *do* carry `runner→cli`
(`packages/sdk-ts/src/runner/branch.ts:9`, `packages/sdk-ts/src/runner.ts:16`), the same pair the
probe uses — but the recall diff's context window is the file's first 3 lines, and the forbidden
imports sit at lines 9 and 16.

**The strongest evidence that the oracle could not separate the two:** the throwaway
reference implementation this review wrote to prove AC-1 GREEN before launch was itself an
"edge-set diff of added vs pre-image lines" (recorded in the arming note,
`examples/dogfood/README.md:201`) — i.e. it carried F-431. The AC was proved GREEN against a
reference with the hole, and then passed a delivery with the hole. An AC verified in both
directions is still only as sharp as the reference used to green it.

**Rule for the next AC that grades a suppression:** the negative population must include a case
where the suppressing evidence and the thing to be caught share the key the code suppresses on.
Enumerate the KEY, not just the corpus. → track-B note (recorded in DOGFOODING §8); the concrete
regression is already pinned by F-431's three committed tests.

### F-433 🟡 — the judge affirmed, in prose, the exact property the delivery broke

Judge pass #2 passed `design_serves_overall_goal` with: *"The scanner compares added forbidden
edges against the same file's pre-image edges, **retaining detection of genuinely new edges**."*
That sentence is a correct description of the code's intent and a false statement about its
behaviour on 7 of 158 files. Both deterministic passes also reported "deterministic architecture
scan found no layering violations" — true, but measured on a diff that introduced none.

This is the `judge-blind-to-uninstantiated-input-families` pattern at the *evidence* altitude:
the judge reasoned about the scanner from the diff, never drove it with an input in the
collision class. No new WP — the standing lesson (an AC must drive a NON-default value of every
input family the change reads) already covers it, and F-432 is the actionable half. Recorded as
a judge-KPI datum: **1 true positive, 1 false negative on the run's central semantics.**

### F-434 🔴 — the arming table rendered a FAILED green pass as ✅ and called the AC verified

Found while arming dogfood-165, not in the run. `scripts/dogfood-arm.sh:141` rendered every
result with one `cell()` that treats **exit 1 as ✅ in both columns**. Exit 1 is the pass in the
RED column and the FAILURE in the GREEN column, so an AC whose green pass did not pass printed
`✅ exit **1**`. Worse, the "NOT verified in both directions" warning used
`ok(r) = r !== undefined && r.brokenCheck !== true` (`:160`), which never looked at the exit code
— so that AC was **omitted from the warning entirely**.

Measured on the real dogfood-165 state, before and after:

```
before: | AC-1 | ✅ exit **1**, **2s** | ✅ exit **1**, **3s** |
        ⚠️  NOT verified in both directions: AC-2, AC-3
after:  | AC-1 | ✅ exit **1**, **2s** | ⛔ exit 1 (wanted 0), **3s** |
        ⚠️  NOT verified in both directions: AC-1, AC-2, AC-3
```

This is dogfood-133's lesson one column over — the comment directly above the bug
(`scripts/dogfood-arm.sh:135`) warns that a broken check must never render as a verified
direction, and the code then does exactly that for a failed one. The table is the artifact the
operator reads before spending a run; it said "armed" for an AC I had just failed to green five
times.

**Hand-fixed this sitting.** `cell(r, wantExit)` and `ok(r, wantExit)` now take the column's
expected exit (`scripts/dogfood-arm.sh:141`, `:167`). Verified both ways: the dogfood-165 state
now reports 0/3 verified, and re-rendering dogfood-164's own stored state — a genuine 3/3 — still
prints ✅ on all six cells with no warning.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-431 | 🔴 | layer-pair-keyed exoneration silences a genuinely new forbidden import in 7 files / 12 lines, and on any remove-one-add-another diff | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/judge/scan-layering.ts:181`; 3 new tests (`test/judge/scan-layering.test.ts:308`, `:324`, `:337`), all RED pre-fix; declared suite 1806 passed |
| F-432 | 🟡 | AC-1's recall probe is always an `X→cli` edge, so ceiling and recall cases can never collide on the key the code suppresses on | **track-B note** — DOGFOODING §8 rule; regression pinned by F-431's tests |
| F-433 | 🟡 | judge passed `design_serves_overall_goal` asserting "retaining detection of genuinely new edges" — false for 7 files | **track-B note** — covered by the standing input-family rule; logged as a judge-KPI datum |
| F-434 | 🔴 | the arming table printed ✅ for a GREEN pass that exited 1, and left that AC out of the "not verified" warning — it reads "armed" for an AC that failed | **HAND-FIXED THIS SITTING** — `scripts/dogfood-arm.sh:141`, `:167` now take the column's expected exit; verified both ways against dogfood-165 (0/3) and dogfood-164's stored 3/3 state |

## Verdict on the thesis

**Durable execution:** 🟢 nothing to report — 1 step, 1 checkpoint, 9 journal entries, no
duplicates, no resume, clean SUCCESS seal at `run-be874c29-6b55-4cb6-a9cc-9784170c64f5@5`.

**Agent-as-a-Judge:** 🟡 mixed, and the mix is the finding. The judge caught a real, minor
overclaim (a test titled "full src/ corpus" that enumerates 9 hand-picked files —
`packages/sdk-ts/test/judge/scan-layering.test.ts:243`) and reported it with the right severity.
It missed a 🔴 recall hole in the very gate the run was rewriting, and affirmed the opposite in
prose. **Two passes, $0.113, and the acceptance oracle the review designed also passed the
hole** — AC-1's ceiling and recall floors are both green on the broken scanner. That is the
sharper lesson than the miss itself: this run's gate was as strong as its weakest input family,
and the input family was never instantiated.

**Standing caution.** WP-648 is the first mechanism in the campaign that lets a gate *retract*. It
is correct here, but it is a one-way valve pointed at leniency: every future deterministic row
added to `DETERMINISTIC_RUBRIC_IDS` inherits the property that a clean cumulative re-measurement
wins. That is right only while the review's measurement is genuinely wider. Any row whose review
pass measures something *narrower* than the sealing pass would be silently weakened by it.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 8m 8s | 6 steps (dogfood-162) |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | 1 (corpus overclaim) — **1 false negative (F-431)** | 1 · 2 · 4 (164 · 163 · 162) |
| meta:product headline ratio | product | 0/3 harness-meta — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.9% (9 rollbacks / 176 steps, 22 runs) — target 99%+ |
| ladder rung vs exit gate | 0 (off-ladder) | P3 exit gate = WP-530 rung 5; rung-5's remaining half is WP-304, operator-run |
