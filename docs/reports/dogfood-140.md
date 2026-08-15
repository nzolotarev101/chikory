# dogfood-140 — the judge's off-checklist objections now have to be answered before a run may finish green (WP-619)

**WP:** WP-619 (adjudicate escalation concerns before the converged seal) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-140-wp619-adjudicate-escalation-concerns.yaml` ·
**Run:** `run-cd11c095-754c-42b5-b57c-d712710d9612` · **Landed:** this review's commit ·
**Ladder:** rung 4 unchanged (off-ladder run; P3 exit gate = rung 5 = WP-303 ✅ + WP-304, and WP-304 is operator-run)

## Plain lead

When our reviewer flagged something outside its checklist and everything else looked
fine, we used to write the flag into the outcome text and ship anyway — that is how
two real defects reached a published page last run. The run makes the flag a question
the reviewer must answer first: cleared, the run finishes green exactly as before;
upheld, the run fails and says which objection killed it. It works, and the delivery
is small and clean.

The catch, found by hand after landing: the new question is asked on **every**
end-of-run review, including the overwhelmingly common case where nobody raised an
objection at all — and a reviewer answering "can't tell" to a question with no
subject would have failed a perfectly good run. Fixed in this sitting, with a live
test that reads the actual prompt off the wire.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 9m 40s |
| cost | **$0.1326** of $20 budget (**0.7%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **cost meter blind**: 4,985 metered tokens priced at $0.00 (subscription-linked auth, declared `costEstimated: true` in the run's capability record) |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 2 passes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 11/11 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.1k/1.8k | $0.0000 | 5m 27s | ⚠ ESCALATE |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Judge passes:**

| # | source | in/out | cost | wall | verdict |
|---|---|---|---|---|---|
| 1 | per-step | 34,742 / 5,033 | $0.0938 | 2m 53s | ⚠ ESCALATE · `escalateClass: out_of_rubric` · 6/6 rubric ✓ · 2/2 criteria ✓ · 1 concern |
| 2 | completion-review | 24,710 / 790 | $0.0388 | 1m 16s | ✓ PROCEED · 4/4 rubric ✓ incl. `pre_existing_suite_still_green` (real `exit 0`) |

## Delivery quality (human review, post-landing)

**Landed diff — 11 files, +124/−24.** Every file is one the goal implies; nothing else moved.

| file | what it does |
|---|---|
| `src/judge/rubric.ts:87,109` | new `RUBRIC_ESCALATION_CONCERNS_ADJUDICATED` row on `COMPLETION_REVIEW_RUBRIC`, `destructive: false` |
| `src/judge/prompt.ts:187` | `renderCompletionReviewScope()` renders the concern text verbatim into the review prompt |
| `src/judge/harness.ts:277`, `src/runner/activities.ts:1639` | `escalationConcerns?: string[]` threaded through the typed inputs |
| `src/workflow/completion-review.ts:52,85` | `hasEscalationConcerns` — a first-verdict seal no longer skips the review when concerns exist |
| `src/workflow/agent-loop.ts:397,444,1191` | both converged-escalate seal sites pass `verdict.form.concerns` into the gate; a surviving finding condemns |
| 4 test files | the two pinned-shape expectations updated, 2 new `decideCompletionReview` cases, Scenario 7 flipped `reviewHits 0 → 1` |

**Goal, line by line — all six clauses satisfied:**

- *concerns become a question answered once* — ✅ the review carries a named rubric row; `completionReviewAttempts` still caps it at one pass.
- *outcome follows the answer both ways* — ✅ cleared → SUCCESS with the F-229/F-271 wording; upheld → resumable FAILED naming the item (`agent-loop.ts:444`).
- *the decision is the judge's, never the text's* — ✅ nothing reads the concern string; AC-1 drives both directions with byte-identical text.
- *the judge is actually shown the concerns* — ✅ AC-2 reads the raw request off the wire; I re-confirmed it independently in the F-340 RED output below, which prints the whole prompt.
- *happens with or without a regression suite* — ✅ `regressionGateBeforeSuccess` now fires on `hasRegressionSuite || hasConcerns` (`agent-loop.ts:397`).
- *exactly one extra pass, never back to the loop* — ✅ terminal-or-nothing preserved; Scenario 7 pins `reviewHits === 1`.

**All 8 designed traps rejected** (A condemning on presence · B string-matching · C never sealing green · D re-entering the loop · E ignoring the answer · F not showing the judge · G riding only `regression_suite` · H weakening the F-334 guard). The updated Scenario 7 expectation is an honest change, not a weakened one — it flipped because the behavior it pinned was the hole being closed, and the step summary said so plainly.

**Independent verification (not delegated to the ACs):**

- **The executor's reported suite counts are exact.** It claimed `183 passed | 2 skipped (185 files), 1454 passed | 23 skipped (1477 tests)`. I measured it: identical. I then measured HEAD (`dc31d52`) by stash: **1452 passed | 23 skipped (1475)** — the diff adds exactly 2 tests, which is exactly what it adds. No fabrication.
- **The judge's one concern was a true positive about *provenance*, not accuracy** — see F-343.
- **Scope discipline** — `git status --short` and the harvest byte-diff agree: 11 files, all named by the goal, no new dependency, no `any`, no wall-clock branch.

## New friction

### F-340 🔴 — the adjudication question is asked when there is nothing to adjudicate

`escalation_concerns_adjudicated` was added unconditionally to `COMPLETION_REVIEW_RUBRIC`
(`rubric.ts:109`), and `activities.ts` builds the completion-review rubric from that
constant. So the row — plus a scope sentence claiming the pass "adjudicates any
out-of-rubric concerns raised by earlier passes" (`prompt.ts:187`) — is put in front of
the judge on **every** completion review, including the far more common concern-less
one that any run declaring a `regression_suite` buys. Nothing renders a concern list in
that case, because there are none.

A ✗ on that row now **condemns the run**, through the `fails.length > 0` catch-all this
same delivery relies on (`agent-loop.ts:444`). So a judge answering "cannot determine"
to a question with no subject flips a correct SUCCESS to FAILED — the dogfood-121 death
shape, and the exact inverse of trap C.

Not theory. Driving an ordinary suite-declaring run through the real Temporal path, the
raw wire request contained both the claim and the row with zero concerns anywhere in the
prompt:

```
## REVIEW SCOPE — run-completion architecture review
… This pass judges whether the run's cumulative changes form a coherent
design in service of the goal, and adjudicates any out-of-rubric concerns
raised by earlier passes. …

## RUBRIC (fill `rubricResults`, one entry per id)
… - escalation_concerns_adjudicated: Any free-text concerns or objections raised
  outside the rubric during previous passes are cleared by the cumulative diff …
```

Neither AC covers it: AC-2's trap C drives the concern-less case with a **scripted**
judge told to pass, so it can never observe a vacuous question being asked. This is the
`ac-must-enumerate-input-families` shape (F-187/F-196/F-198) — the ACs own both
directions of the concerns-PRESENT family and never probe the concerns-ABSENT one
against the rubric the judge actually receives.

**→ HAND-FIXED THIS SITTING.**

### F-341 🟢 — an unreachable second rendering path for the same concerns

`buildJudgeMessages` gained a per-step branch rendering `## OUT-OF-RUBRIC CONCERNS TO
ADJUDICATE`, guarded on `reviewScope !== "cumulative"`. No caller can reach it:
`escalationConcerns` is only ever set on a `completionReview: true` judge pass
(`agent-loop.ts:422`, `agent-loop.ts:1203`), and that always sets
`reviewScope: "cumulative"` (`activities.ts:1801`). Dead code with a second, untested
rendering of the same data. **→ HAND-FIXED THIS SITTING** (removed, `prompt.ts:284`).

### F-342 🟡 — the spec's "measured premise" suite baseline was copied forward, not measured

The spec asserted, twice and precisely: *"the suite this run must not break … timed at
HEAD 2026-08-14: **175 files / 1357 passed | 23 skipped (1380)** in ~52 s"*. HEAD was
actually **185 files / 1452 passed | 23 skipped (1475)** — off by 10 files and 95 passing
tests. The *duration* was fresh (51.8 s measured); the counts were carried from the
dogfood-139 review, which itself carried them from dogfood-138 (`1376 → 1379 → 1380` is
a hand-incremented counter, not a measurement).

Cause: **HEAD moved between the review and the launch.** Commits `bb12a47`, `217eee3`,
`6ac5f34`, `43a55c5` (PRs #19–#30, all 2026-08-14) added 10 test files to
`packages/sdk-ts/test/` after dogfood-139's number was written down. It cost nothing this
time only because the executor reported its own real counts instead of trusting the
premise — but the premise is fed to the executor AND used by me to sanity-check its
claims, so a judge or reviewer comparing "claimed vs stated baseline" would have read a
97-test discrepancy as fabrication. This is the `verify-friction-list-against-code` rule
(re-measure before spending) applied to a *number* rather than a `blocked_reason`.
**→ WP-622 (queued, track-B sized): `dogfood-arm.sh` should measure the spec's declared
`regression_suite` and print the counts, so the premise is machine-supplied.**

### F-343 ℹ️ — premise confirmed live: this run's own concern was recorded, never answered

The run reproduced the defect it was fixing, one code generation too early (the F-197
shape — a run cannot exercise the runner fix it delivers, because its workflow bundle is
frozen at launch). Judge pass #1 ESCALATEd `out_of_rubric` with:

> *"The trusted check evidence does not show the executor's mandated standalone build,
> lint, and full Vitest commands or their counts; those executions appear only in
> executor-authored step summaries, which the judging rules prohibit treating as proof.
> AC-2 does independently prove the typecheck command."*

That concern is **correct and it is evidence-shaped, not defect-shaped** — I verified the
counts myself and they are exact, so the judge was right that the claim was unproven and
right not to call it a defect. The run copied the text into the terminal reason and
sealed 🟢 SUCCESS with nothing having adjudicated it. Under the delivered code the
adjudicating pass would be asked this exact question and should clear it → SUCCESS,
unchanged. **No WP — this is WP-619's premise, and the next run is its proof (per the
`behavior-wp-proven-by-next-run` rule, the journal signature to look for is a
`completion-review` verdict carrying an `escalation_concerns_adjudicated` row).**

### Recurrences (no new F-n)

- **F-306** (step summary is raw stdout) recurred: the first 7 lines of step 1's summary
  are CLI narration — *"Running … in background"*, *"Waiting for … to finish"* — before
  the real summary begins. Already **WP-606** (queued).
- **Cost meter blind** is working as designed, not friction: the trace prints
  `⚠ cost meter blind (unpriced tokens)` and the capability record declares
  `pricing: subscription-linked`, `costEstimated: true`.
- `lastGood: false` on the run's only checkpoint is correct — `lastGood` is
  `verdict?.kind === "PROCEED" && stepDelivered` (`agent-loop.ts:1099`) and this verdict
  was ESCALATE.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-340 | 🔴 | adjudication row + scope claim shown on every concern-LESS completion review; a ✗ on a subject-less question condemns a correct SUCCESS | **HAND-FIXED THIS SITTING** — `activities.ts:1699` (row dropped when no concerns) + `prompt.ts:189` (claim dropped with it); Scenario 9 `regression-suite-repair-live.test.ts:510` proven RED→GREEN; sdk suite 1454 → **1455** green, lint + typecheck clean |
| F-341 | 🟢 | unreachable per-step rendering branch for the same concerns | **HAND-FIXED THIS SITTING** — removed at `prompt.ts:284`; covered by the same 1455-green suite |
| F-342 | 🟡 | spec's "timed at HEAD" suite baseline was 95 tests stale; HEAD moved under it via PRs #19–#30 | **→ WP-622 (queued)** — measure the declared suite in `dogfood-arm.sh` instead of transcribing it |
| F-343 | ℹ️ | this run's own out-of-rubric concern was recorded and shipped unanswered | **track-B note** — the premise WP-619 fixes; verify the signature next run (F-197) |

## Verdict on the thesis

**The judge caught something true, and for the fifth altitude in this family it still
did not gate.** dogfood-140 delivers the gate for that altitude cleanly — small, typed,
replay-safe, reusing the completion-review pass rather than adding a parallel one — and
its own run is the last recorded instance of the old behavior.

The standing caution is now sharper, not softer: **every gate this campaign adds is a
new way to fail a correct run.** F-334 (last review) taught that a finding must condemn;
F-340 (this review) is the immediate cost of that lesson — a condemning row asked when
there is nothing to condemn. Two reviews, two halves of the same trade. The ACs that
proved the gate works in both directions could not see it, because both directions were
scripted. **A gate needs a probe of the input family where it must stay silent, driven
against the real prompt, not a scripted verdict.**

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 9m 40s | 4 steps (dogfood-135) over the last 8 runs |
| kill → resume count | 0 | 0 across dogfood-133…140 |
| judge true-positives pre-land | 1 (correct, non-gating — F-343) | 4 over dogfood-133…140 |
| meta:product headline ratio | product | **0 : 3** harness-meta over the trailing 3 (cap ≤1/3 — not busted) |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs ≥5) — target 99%+ |
| ladder rung vs exit gate | rung 4 (off-ladder run) | P3 exit gate = rung 5 = WP-303 ✅ + WP-304 (operator-run, never launched) |

## NEXT RUN

**An objection the reviewer raised about early work will follow the run to the end and have to be answered, instead of quietly expiring the moment the reviewer's next look no longer includes that code.**

- **Spec:** `examples/dogfood/dogfood-141-wp601-standing-findings.yaml`
- **WP:** WP-601 (an unresolved judge finding must outlive the diff window it was raised in) — the **last open member** of the judge-detects-but-does-not-gate family.
- **Why THIS and not the ladder rung:** §0 reads ✅ PROGRESSING, so the default candidate is the P3 ladder's next rung — rung 5, the exit gate. Its WP-303 half closed in dogfood-139; its WP-304 half needs the OpenHands arm plus a corpus wide enough to separate 19 requirements, a quota-bound multi-hour benchmark suite the operator runs BY HAND (dogfood-122 proved an LLM executor must not supervise one). **The rung has no agent-runnable work left**, so a non-ladder candidate is required, and this one is the highest-thesis-value open WP.
- **The designed trap:** carrying findings forward *forever*, so a converged step re-raises the same objection and the run can never seal — the failure that killed a five-node chain in dogfood-121. The inverse is equally tempting: **discharging on silence**, treating "a later pass didn't fail it" as "it was fixed", which is the defect itself. AC-1 puts **two clean passes** between the objection and the seal and still demands the objection arrive at the review. The cheapest wrong fix — **widening the per-step window** so nothing is ever out of view — settles nothing and inflates every run; AC-2 pins the step-2 request to step 2 and NOT step 1.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ PROGRESSING | ladder rung 5 has no agent-runnable half; non-ladder candidate must beat it and does |
| §1.1 failure surface | ✅ | 3+ steps, workflow/judge core, a thesis pillar (judge-catching); a competent agent can plausibly fail it — 8 designed traps, 2 of them mutually opposed |
| §1.2 product progress | ✅ | WP-601 is a real open `plan.md` §7 product WP; the mechanism is seeded into `src/workflow` + `src/judge`, no scaffolding |
| §1.3 mission-critical | ✅ PROCEED | neither busy work nor scaffold-hosted; it is the last unclosed altitude of the family the campaign has been closing one run at a time |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1/3 not busted |

**AC arming evidence** — both ACs are VERIFY-SUITE, so `dogfood.sh` does NOT dry-run them (the preflight says so explicitly); both were hand-verified in **both directions** with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **9s** | ✅ exit 0, **9s** | 8 % |
| AC-2 | ✅ exit **1**, **21s** | ✅ exit 0, **21s** | 18 % |

Worst case **21 s = 18 % of the 120 s judge cap**. The RED output was read, not just its exit code: on HEAD the **non-regression halves already pass** (AC-1 2✓/2✗, AC-2 5✓/2✗ — the cleared direction already seals SUCCESS at one review pass, the per-step window is already incremental, a finding-less run already gets no adjudication row, and WP-537 / WP-619 / the F-334 guard all already hold), so the ACs cannot be satisfied by breaking what works. The throwaway reference was reverted **by name** and the sdk suite is back to **1455 passed | 23 skipped (1478)**. Launch preflight green at $0, and the spec-pick glob resolved to this file.

```sh
devbox run run-dogfood
```
