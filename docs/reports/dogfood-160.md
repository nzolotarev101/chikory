# dogfood-160 — a run that keeps finding NEW problems keeps working (WP-640)

**WP:** WP-640 (the completion-review repair grant must scale with the run's remaining headroom) ·
**Date:** 2026-08-20 ·
**Spec:** `examples/dogfood/dogfood-160-wp640-repair-grant-scales-with-headroom.yaml` ·
**Run:** `run-de555224-1de9-491b-b809-6c063e621f86` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3's rung-5 remainder is WP-304, operator-run, not expressible as a spec)

## Plain lead

The loop used to give up after one attempt at fixing a design problem the final review
found, even with most of its time and money unspent. It now keeps going while it is finding
*different* problems, and still stops fast when it keeps hitting the same wall. The run that
built this **failed its own final review — correctly**: the reviewer proved the delivery had
left the safety bound switched off, said so twice in different words, and the run sealed
FAILED rather than ship it. Human review confirmed the reviewer was right on both counts and
hand-fixed them before landing.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 4 steps · 30m 36s |
| cost | **$0.2995** of $20 budget (**1.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ unpriced; the trace header reads `cost meter blind (unpriced tokens)` and every step bills $0.0000 against 7.3k–10.4k real tokens |
| judge | `openai-compat` (`gpt-5.6-sol xhigh`) · 6 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 4 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.9k/1.7k | $0.0000 | 8m 23s | ✓ PROCEED (2/3 criteria) |
| 2 | 6.0k/1.3k | $0.0000 | 4m 57s | ✓ PROCEED (3/3 criteria) |
| 3 | 7.0k/1.6k | $0.0000 | 3m 7s | ✓ PROCEED (2/3 criteria) |
| 4 | 8.7k/1.7k | $0.0000 | 2m 25s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Terminal reason**, verbatim:

```
completion review: unresolved finding on a converged step — design_serves_overall_goal,
cumulative_design_coherent, escalation_concerns_adjudicated
(last checkpoint run-de555224-1de9-491b-b809-6c063e621f86@22) — resumable
```

## Delivery quality (human review, post-landing)

**Landed files** (all 5 byte-identical to the run workspace):

| file | Δ | what |
|---|---|---|
| `packages/sdk-ts/src/workflow/completion-review.ts` | +82/−6 | `areMateriallySameObjections`, `hasRepeatedObjection`, headroom + objection fields on the state, restructured `decideCompletionReview` |
| `packages/sdk-ts/src/workflow/agent-loop.ts` | +43 | objection history at the seal site, headroom read at all three call sites |
| `packages/sdk-ts/test/runner/completion-review.test.ts` | +205 | unit tests over the pure decision |
| `packages/sdk-ts/test/runner/completion-review-live.test.ts` | +199 | real-loop tests |
| `packages/sdk-ts/test/runner/helpers.ts` | +9/−1 | fake judge wire can script per-pass review forms |

**The goal, line by line.** All four numbered outcomes are *structurally* present and the
three named traps were rejected — the constant was not raised, the fix reaches
`agent-loop.ts` and not only the pure function, and "same" is not keyed on the rubric id.
Scope was clean: five files, all named or trivially entailed by the goal; no new deps; the
declared not-in-scope surfaces (`heal/gate-repair.ts`, `mergeDesignFindings`,
`buildCompletionReviewBrief`, the chain mirror, the judge prompt, the Python mirror,
`src/judge/hermeticity.ts`) are untouched — AC-3's seven trap greps confirm it.

**But the safety half was not delivered**, and the completion review said so. Two defects,
both reproduced here against the harvested tree before any edit:

- The bound was live only until the first repair grant (F-413 below).
- "Materially the same objection" was byte-exact string equality on LLM-authored prose
  (F-412 below) — inert against any real judge.

**What the judge did, and why it was right.** The judge caught the first defect at step 1
by *running the declared suite*: `test/runner/sealing-design-repair-live.test.ts`'s
`expect(wire.reviewHits).toBe(2)` measured 3, and the verdict named the cause —
"an existing repair test receiving three review hits instead of the expected bounded two".
Step 2 turned that test green by gating the cap check behind `attempted.length === 0` —
which fixed the *test* and left the loop's real call shape (always-defined array) bypassing
the cap entirely. Completion review #1 (journal idx 12) named exactly that:

> The integration passes `attemptedFindings` as an always-defined array, while the original
> cap is enforced only when `attempted === undefined`. Consequently the normal agent-loop
> path bypasses `MAX_COMPLETION_REVIEWS` …

Completion review #2 (idx 24), after two more steps, upheld it in different words. The run
sealed FAILED. **Both objections were true.** Probed against the harvested tree
(`decideCompletionReview` driven directly with the loop's own call shape):

| probe | input | result |
|---|---|---|
| first call-site shape, `reviewAttemptsUsed: 99`, no `currentFindings`, one attempted finding | the exact shape of `agent-loop.ts:1352` | `{"action":"review"}` — **cap never consulted** |
| this run's own review #1 vs #2 justifications | same rubric id, same complaint, different words | `areMateriallySameObjections → false`, decision `review` at `reviewAttemptsUsed: 7` |

The second probe is the sharp one: the loop's own judge produced a textbook repeat, and the
delivered comparator read it as progress. Under the delivered code an oscillating judge
would have burned every remaining step — the exact F-223…F-226 failure the goal's trap 1
forbids. Both graded ACs and the committed guard miss it because all three script a fake
judge that emits **byte-identical** text on every pass.

**Not a defect, worth recording.** Judge pass #2 (per-step, over the 2,069-byte step diff)
passed `design_serves_overall_goal` and praised the design that judge pass #3 (completion
review, over the 28,737-byte cumulative diff) failed on the same rubric id four minutes
later. That is the designed altitude split, not a contradiction — but a per-step ✓ on a
cumulative rubric carries no information, and the executor treated it as reassurance.

## New friction

### F-412 🔴 — "materially the same objection" was byte-exact equality on LLM prose

`areMateriallySameObjections` returned true only when `a.justification.trim() ===
b.justification.trim()` (`packages/sdk-ts/src/workflow/completion-review.ts:127`). A judge
never restates an objection verbatim. **This run is its own counterexample**: reviews #1 and
#2 raised the same complaint — the empty-`attemptedFindings` cap bypass — in different
words, and the comparator read them as two different findings. Combined with F-413 that is
unbounded oscillation.

Measured at this review, normalised content-word Jaccard over the real justifications:

| pair | same complaint? | score |
|---|---|---|
| `run-de555224` review #1 vs #2 | **yes**, reworded | 0.109 |
| `run-ec5c4bb8` (dogfood-159) review #1 vs #2 | **no**, two different complaints | 0.077 |

The two populations overlap. **No prose threshold separates them**, so the comparator cannot
be made complete by a cheap string metric — that is a design question, not a patch (→ WP-643).

**Hand-fixed** by containing the incompleteness instead of pretending to solve it: the
comparator keeps exact-match (sound, incomplete, now documented as such at
`packages/sdk-ts/src/workflow/completion-review.ts:117`), and a new ceiling
`MAX_PROGRESS_GRANTS = 2` (`:34`) bounds how many extra passes "progress" can ever buy. A
judge that rewords forever now gets at most 4 review passes, not the run's whole headroom.

### F-413 🔴 — the review bound was switched off by its own repair history

`decideCompletionReview` gated the `reviewAttemptsUsed >= MAX_COMPLETION_REVIEWS` skip behind
`attempted === undefined || attempted.length === 0`. Every `agent-loop.ts` call site passes
`attemptedReviewFindings`, a `const` array that is non-empty from the first grant onward — so
the cap was consulted only until the first repair, then never again. Probe: the first call
site's shape returns `review` at `reviewAttemptsUsed: 99`.

**Hand-fixed** — the bound is now unconditional and progress raises it by exactly one pass per
grant, clamped by `MAX_PROGRESS_GRANTS` (`packages/sdk-ts/src/workflow/completion-review.ts:191`,
`packages/sdk-ts/src/workflow/agent-loop.ts:267`).

### F-414 🟡 — `??` made the second objection history unreachable

`const attempted = state.attemptedFindings ?? state.lastAttemptedFindings` — with the
always-defined array on the left, the right operand was dead code from production. The judge
named this too. **Hand-fixed**: the two histories are unioned
(`packages/sdk-ts/src/workflow/completion-review.ts:172`).

### F-415 🟢 — the executor's cost meter is blind on this executor family

Every step billed **$0.0000** against 7.3k–10.4k metered tokens; the trace header prints
`⚠ cost meter blind (unpriced tokens)`. `gemini-cli` bills through CLI OAuth, so there is no
per-token price to apply and the budget gate is inert for executor spend — only judge spend
(100% of the $0.2995) is governed. Known and benign at this budget; recorded because every
`cost_usd` in the ledger for a gemini-executed run is judge-only. **track-B note.**

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-412 | 🔴 | "materially the same objection" was byte-exact string equality on LLM prose — inert against any real judge; measured non-separable by prose metrics | **HAND-FIXED THIS SITTING** — `completion-review.ts:34,117`; contained by `MAX_PROGRESS_GRANTS`; 4 new tests, suite 1745 → **1767** |
| F-413 | 🔴 | the `MAX_COMPLETION_REVIEWS` bound was gated on an empty attempted-findings list, so the loop stopped consulting it after the first repair grant | **HAND-FIXED THIS SITTING** — `completion-review.ts:191`, `agent-loop.ts:267,1403`; pinned by `F-413: the cap is consulted even once a repair history exists` |
| F-414 | 🟡 | `attemptedFindings ?? lastAttemptedFindings` left the second history unreachable from every production call site | **HAND-FIXED THIS SITTING** — `completion-review.ts:172`; pinned by `F-414: lastAttemptedFindings is read even when attemptedFindings is an empty array` |
| F-415 | 🟢 | executor steps bill $0.0000 against real metered tokens (`gemini-cli` is unpriced); budget gate governs judge spend only | **track-B note** — recorded in DOGFOODING §8 |
| — | — | deciding "same objection" from LLM prose needs an instrument that is not a string metric | **→ WP-643 (queued)** |

## Verdict on the thesis

**The judge earned its place, at the altitude that matters.** Everything cheap was green —
3/3 acceptance criteria, 1,763 suite tests, typecheck, lint, seven trap greps — and the
delivery still had its safety bound switched off. The only thing that saw it was an
LLM reviewer reading the cumulative diff, and it saw it twice, in a run where a *rubric-id*
comparison would have shipped. This is the clearest evidence to date for the core claim that
Agent-as-a-Judge belongs in the inner loop: a deterministic gate cannot ask "is this bound
still reachable from the caller?".

**The standing caution is sharper than usual.** The judge *detected* and *gated* — the run
sealed FAILED rather than ship — but it did not *heal*: four steps and $0.30 produced a
delivery that a human then had to correct. And the run's own final review is the case study
for why F-412 matters: an LLM restating an objection is the normal case, not the edge case.

**F-197 note (behaviour WP proven by the next run).** This run could not exercise its own
fix — the workflow bundle is frozen at launch. Signature to look for in dogfood-161's
journal: a completion review that raises a **new** objection after a grant is already spent
must produce another `step` entry rather than a `terminal`, and the run must still seal
FAILED after at most **4** completion-review passes when the objections repeat.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 4 steps / 30m 36s | 4 (159: 3, 158: 2) — **first increase in 8 runs** |
| kill → resume count | 0 | 0 over the trailing 3 |
| judge true-positives pre-land | **2** (cap bypass, both reviews) | 4 / 1 / 2 over 159 / 158 / this |
| meta:product headline ratio | 0:1 (product) | **0:3** over the trailing 3 — cap ≤1:3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | 0 (off-ladder) | P3 rung-4 published; rung-5 half done (WP-303), remainder WP-304 is operator-run |

## NEXT RUN

**Make the loop tell "you already said that" from "that's a new problem" by what the objection is about, instead of by whether the reviewer happened to type the same sentence twice.**

- **Spec:** `examples/dogfood/dogfood-161-wp643-same-objection-instrument.yaml`
- **Advances:** WP-643 (deciding "is this the same objection?" needs an instrument that is not a string metric) — a real open `plan.md` §6 product WP on the durable-execution pillar, and the direct residue of this review.
- **Why THIS and not the ladder rung:** the §0 progression gate now reads ✅ **PROGRESSING** (max steps 4 vs 3 — the first horizon movement in eight runs), so the rung does not bind. It would not have mattered: P3's rung-5 (WP-530) is WP-304's operator-run, quota-bound benchmark arm and **cannot be expressed as a spec** — dogfood-139 delivered rung-5's other half (WP-303) and the remainder has had no agent-runnable form since. WP-643 wins on thesis value: WP-640 just shipped the headroom-scaled grant, and the only thing now stopping it oscillating is a constant this review added by hand.
- **The designed trap:** tuning a similarity threshold on the justification text. It is the obvious fix and it is **arithmetically impossible** — measured content-word Jaccard is **0.109** for the reworded-repeat pair and **0.077** for the genuinely-different pair, so any cutoff that catches the first collapses the second. AC-1 grades both real pairs at once. Two more are graded: keying on the rubric id (both pairs are `design_serves_overall_goal`), and improving the comparator while `MAX_PROGRESS_GRANTS` still does the stopping (AC-2 requires the reworded oscillation to stop **with `max_steps` headroom left**, which a constant cannot produce).

**Gate verdicts:**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ PROGRESSING | max steps 4 vs 3 over the trailing three; rung does not bind, and P3 rung-5's remainder (WP-304) is operator-run and not spec-expressible |
| §1.1 failure surface | ✅ | a competent agent can plausibly fail this — the natural fix is provably impossible and the instrument has to come out of the objection itself; 2 source files + tests |
| §1.2 product progress | ✅ | landed diff is feature code in `packages/sdk-ts/src/workflow/` serving a real open §6 WP; no scaffolding, no invented utility |
| §1.3 mission-critical | ✅ PROCEED | 🟢 real product WP on a thesis pillar — not busy work, not scaffold-hosted |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1:3 not busted |

**AC arming evidence** — all three were classed **VERIFY-SUITE** by the preflight (they shell into `pnpm exec vitest`), so none dry-ran; each was hand-verified in BOTH directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s judge cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **2s** | ✅ exit 0, **2s** | 2 % |
| AC-2 | ✅ exit **1**, **5s** | ✅ exit 0, **7s** | 6 % |
| AC-3 | ✅ exit **1**, **90s** | ✅ exit 0, **91s** | **76 %** |

Both REDs print the check's own assertion text, not a died-before-judging signature: AC-1 reports `reworded=false distinct=false` (the shipped string equality answers "new" to *both* real pairs), and AC-2's live loop ran the reworded oscillation to **5 steps** — stopped only by `MAX_PROGRESS_GRANTS`, against a required ≤3. The GREEN reference was a review-altitude subject-overlap instrument (the union of code entities each review's failing rows NAME, gated on a shared rubric id), which separates both real pairs cleanly; it was reverted by name, not with `--discard`. **AC-1 was re-scoped during arming**: its first draft compared row-to-row and was *unsatisfiable* — the reworded pair shares no signal at that altitude — so it now grades `hasRepeatedObjection`, the predicate `decideCompletionReview` actually calls.

Preflight green at $0; the spec-pick glob resolves to this file.

```sh
devbox run run-dogfood
```
