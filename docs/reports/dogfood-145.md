# dogfood-145 — the grader now hands a design problem back for one fix attempt (WP-627)

**WP:** WP-627 (a design finding raised at the sealing pass must buy the one bounded repair
attempt the same finding earns at completion review, F-359) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-145-wp627-standing-finding-repair.yaml` ·
**Run:** `run-1f2a02e0-4615-47fa-8847-ea37c4164cfb` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3-rung-5 (phase exit gate) is WP-304, an operator-run suite no spec can headline)

## Plain lead

The agent fixed the bug it was asked to fix: when the grader finds a design problem in
finished work, the problem is now handed back to the agent for one repair attempt instead of
the run being failed on the spot. The delivery is correct and complete — but the run itself was
failed by the grader for a problem that had already been fixed one step earlier, which is a
**new, separate bug in how the grader remembers old complaints**, and it will fail almost every
multi-step run until it is fixed.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 2 steps · 17m 11s |
| cost | **$0.1651** of $20 budget (**0.9%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced, so `⚠ cost meter blind` is the documented false alarm (DOGFOODING.md:1056) |
| judge | `openai-compat` (gpt-5.6-sol xhigh) · 3 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 6/6 files byte-**IDENTICAL** to the run workspace |
| seal reason | `completion review: unresolved finding on a converged step — escalation_concerns_adjudicated` |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.4k/1.5k | $0.0000 | 8m 50s | ✓ PROCEED (1/2 criteria) — AC-1 ✓, AC-2 ✗ (committed runner tree RED) |
| 2 | 5.4k/1.3k | $0.0000 | 2m 55s | ✓ PROCEED (2/2 criteria) — AC-1 ✓, AC-2 ✓ |
| — | — | $0.0711 | 2m 30s | judge pass #3, completion review: `escalation_concerns_adjudicated` ✗ → seal FAILED |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files**

| file | Δ | what |
|---|---|---|
| `packages/sdk-ts/src/workflow/agent-loop.ts` | +18 / −17 | the whole fix |
| `packages/sdk-ts/test/runner/sealing-design-repair-live.test.ts` | +431 (new) | 6 live tests |
| `packages/sdk-ts/test/runner/completion-review-live.test.ts` | 3 tests re-pinned | |
| `packages/sdk-ts/test/runner/deterministic-rubric-live.test.ts` | 2 tests re-pinned | |
| `packages/sdk-ts/test/runner/standing-findings-live.test.ts` | 2 tests re-pinned | |
| `packages/sdk-ts/test/runner/regression-suite-repair-live.test.ts` | 1 test re-pinned | |

**The goal, line by line**

| goal clause | evidence | 🟢/🔴 |
|---|---|---|
| the finding reaches the executor as a **step** | `agent-loop.ts:1295-1303` — `canRetry` → `judgeFeedback = buildCompletionReviewBrief(...)`, `remediationPending = true`, `continue` — reached for standing findings now that the `hasStanding` early-seal is gone | 🟢 |
| **exactly one** repair | `decideCompletionReview` re-consulted at `agent-loop.ts:1286-1294` with `reviewAttemptsUsed: completionReviewAttempts` against `MAX_COMPLETION_REVIEWS = 2` (`completion-review.ts:16`), plus `stepIndex < maxSteps` | 🟢 |
| an unrepaired finding still **FAILS** (resumable, item named) | `agent-loop.ts:1307-1313` seals `FAILED` `{resumable:true}` naming `designFails` — the old `seal("SUCCESS", "design findings recorded")` is gone from BOTH arms (`:1307`, `:1318`) | 🟢 |
| a run that raised nothing is unaffected | `sealing-design-repair-live.test.ts:241` NEGATIVE — 1 step, `reviewHits` 0, SUCCESS | 🟢 |
| `regressionGateBeforeSuccess` untouched | `agent-loop.ts:402` outside the diff hunks entirely | 🟢 |
| rubric set / judge prompt / TaskSpec untouched | diff touches one `src/` file | 🟢 |
| strict ESM, no `any`, no new dependency | AC-2 ran `pnpm run typecheck` + eslint, exit 0 | 🟢 |

**The designed traps — every one rejected**

| trap | the plausible-but-wrong delivery | what actually landed |
|---|---|---|
| A | delete `hasStanding` and fall through to the fresh path, which sealed **SUCCESS** with findings "recorded" | both SUCCESS-with-findings seals were **converted to `FAILED` resumable** (`agent-loop.ts:1307`, `:1318`) — the trap's exact bait was removed rather than stepped in |
| B | unbounded repair until steps/budget run out | `sealing-design-repair-live.test.ts:174` UNREPAIRED pins `stepEntries.length === 2` with `maxSteps: 4`, so 3 was reachable and not taken |
| C | stop collecting sealing rows into `standingFindings` to make the retry reachable | `agent-loop.ts:1134-1146` untouched; the NEGATIVE test keeps `reviewHits` at 0 for a clean run |
| D | prove it by asserting the brief was *built* | the test reads the **journal's step entries** and asserts `steps[1].record.summary` contains `DESIGN REVIEW BRIEF` — the executor received it |
| E | a repo test that is a transcription of AC-1 (F-360) | the new file adds **3 scenarios AC-1 does not have**: `BOUNDED` (`maxSteps: 1` — no repair possible), `MULTI-STEP REPAIRED` (4 steps), `CUMULATIVE DESIGN REPAIRED` (fresh review finding). AC-2's count floor (381) was met at **384** |

**Independent verification (mine, not the run's)**

- Declared regression suite, run by hand at review time (F-342 — never transcribe):
  `pnpm --filter @chikory/sdk exec vitest run` → **189 files / 1510 tests (1487 passed | 23 skipped) in 60.40 s**.
  Baseline at the launch commit was 188 / 1504 — the delivery adds **1 file, +6 tests**, and nothing went red.
- `test/runner/` alone: **54 files / 384 tests** (baseline 53 / 378).
- No test deleted, skipped, or weakened. All 8 re-pinned expectations are genuine strengthenings —
  `reviewHits` 1→2 (the re-review the repair buys) and `SUCCESS`→`FAILED (resumable)` on unresolved
  findings. `deterministic-rubric-live.test.ts:218` now additionally asserts `terminal.resumable`,
  which the old expectation did not check at all.
- **`mergeDesignFindings` name-vs-behavior check**: the name says "design", but
  `completion-review.ts:110-122` merges *every* failing row from both forms, so
  `escalation_concerns_adjudicated` and `tests_pass` are still gated. Trap C's un-gating fear
  (F-340's adjudication row going dark) does **not** materialize.

**Scope discipline** — 🟢. Six files, all named or trivially entailed by the goal. One `src/` file.
No dependency manifest, no provider code, no spec or AC edits.

**Two behavior changes the summary did not name**

1. A **clean** completion review no longer discharges a sealing-pass objection. `designFails` is the
   union (`agent-loop.ts:1276`), so a sealing row survives a clean review and buys a repair step +
   a re-review. This is what `mergeDesignFindings`' own docstring (`completion-review.ts:100-108`)
   says should happen, so it is correct — but it changes the meaning of a test that used to be named
   "a CLEAN completion review discharges the earlier objection", and the run's "what it does NOT
   cover" paragraph did not mention it.
2. The two new arguments at `agent-loop.ts:1292-1293` (`hasEscalationConcerns`, `hasStandingFindings`)
   are **inert on that call site** — `decideCompletionReview` only reads them inside the
   `!failingRubric` skip branch (`completion-review.ts:85-91`), and the same call hard-codes
   `sealingVerdictHasRubricFailures: true`. Harmless, but dead.

Neither rises to friction. Both are recorded so the next reader of that call site is not misled.

## New friction

### F-361 · 🔴 loop-integrity · a rubric row that fails at step N and passes at step N+1 still condemns the seal

`standingFindings` is **append-only**. `agent-loop.ts:1134-1141` pushes every failing rubric row's
`id: justification` and never removes an entry when a later pass passes that same id — the array is
declared at `:268` and the only operations on it anywhere in the file are `.push` and reads
(`:406`, `:1253`, `:1273`).

What that did to this run:

| pass | row | result |
|---|---|---|
| #1 (step 1) | `tests_pass` | ✗ — "1/2 judge-executed checks failed: AC-2" → **pushed to `standingFindings`** |
| #2 (step 2) | `tests_pass` | ✓ — "all 2 judge-executed checks exited 0" → **standing entry not removed** |
| #3 (completion review) | `escalation_concerns_adjudicated` | ✗ — "The standing concern states that one of two judge-executed checks failed for AC-2. This pass supplies no check-command results … so there is no trusted green rerun that clears that reported failure" |

The run sealed `FAILED` on a defect that had been fixed 3 minutes earlier, with both ACs green on
disk and the full suite green.

The judge is not merely wrong — it is **structurally unable to be right**, and that is the second
half of the defect. The completion review is dispatched with `criteria: []`
(`agent-loop.ts:1269`), so the pass executes **zero acceptance checks** and receives **no
`test_results` evidence** (judge pass #3 carries one evidence ref: the 31,653-byte diff; passes #1
and #2 each carried a `test_results` ref). The charter added by F-344 promises exactly the clearing
rule the judge refused to apply — "when the judge-executed checks and the declared regression suite
are green, that concern is CLEARED" (`judge/prompt.ts:206-209`) — but the evidence it names is
absent from the pass. The judge said so in as many words.

This also contradicts the same form's own row: `pre_existing_suite_still_green` ✓ with
"regression suite command `pnpm --filter @chikory/sdk exec vitest run` exited 0" sits three lines
above the justification claiming no "passing regression-suite result" exists.

**Blast radius.** Red-then-green on an acceptance check is the *normal* shape of a multi-step run.
Any such run now carries a permanently standing `tests_pass` entry into the seal, which (a) forces
the `escalation_concerns_adjudicated` row to be added at all (`activities.ts:1699-1704`) and
(b) hands the judge a stale complaint it has no evidence to clear. Five of the last six headline
runs sealed FAILED; only single-step runs with a clean first pass are sealing SUCCESS.

**Not fixed by WP-627.** With this delivery on the tree the same run would have bought one repair
step and then hit an identical second review — the executor cannot repair a stale memory.

**The fix is narrower than "prune what a later pass passed"** — established by hand while arming
dogfood-146, not assumed. A reference implementation that drops any standing row whose id a later
pass passes turns **2 committed tests RED**, including
`packages/sdk-ts/test/runner/standing-findings-live.test.ts:165` — WP-601/F-295's guarantee that a
design objection at pass #1 followed by two clean passes still reaches the completion review. The
two row kinds are not alike:

| row kind | how a later pass answers it | may a later PASS settle it? |
|---|---|---|
| `tests_pass` **with declared `check` commands** | the commands are re-run against the **whole current tree** every pass (`src/judge/evidence.ts:189-199`) | **yes** — authoritative |
| every model-judged row (`design_serves_overall_goal`, …) | answered from **that pass's incremental diff**, which no longer contains the code the objection was about | **no** — it never looked |

So WP-629 settles machine-settled rows only. Scoped out on purpose: the second half — the review's
`criteria: []` leaving it no check evidence — is correct once settling lands, because a
genuinely-standing concern *should* be adjudicated against the cumulative diff, and re-running every
check in the review would double run cost and re-open F-349-class interference.

→ **WP-629 (queued as the dogfood-146 headline).**

### F-362 · 🟡 the trace step table shows the completion review's `0/0 criteria` as the step's own verdict

`chikory trace <run-id>` renders step 2 as `✓ PROCEED (0/0 criteria)`. Step 2's actual sealing
verdict was `✓ PROCEED (2/2 criteria)` (judge pass #2); the `0/0` belongs to judge pass #3, the
completion review, which evaluates no criteria by construction. The per-step table takes the last
pass attached to the step, so the operator's first view of a FAILED run reports its final step as
having had no criteria evaluated. `.chikory/review/<run>.facts.json` records `2/2` for the same
step, so the two surfaces disagree.

Cosmetic for the ledger, misleading for triage — this review had to open two step traces to
establish that both ACs passed before the seal.

→ **track-B note** (no WP; fold into the next trace-rendering change).

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-361 | 🔴 loop-integrity | `standingFindings` is append-only, so a rubric row cleared by a later pass still condemns the seal — and the completion review runs with `criteria: []`, so it holds no check evidence to clear it with | **→ WP-629 (queued)** — dogfood-146 headline |
| F-362 | 🟡 | `chikory trace` shows the completion review's `0/0 criteria` as the final step's own verdict, disagreeing with the facts blob | **track-B note** |

## Verdict on the thesis

🟢 **The judge worked, twice, in the inner loop.** Pass #1 caught a genuinely incomplete delivery —
the committed `test/runner/` tree was RED because four tests pinned the old no-repair shape — and
sent it back; step 2 fixed it for $0.04 and 2m55s. That is one real true-positive, pre-land, on a
defect a symbol-grep AC would have missed entirely.

🔴 **The seal is now the least trustworthy signal in the loop.** This is the third consecutive
review in which the terminal state and the delivery disagree (dogfood-141 F-344, dogfood-144 F-359,
dogfood-145 F-361) and the human lands the work by hand. Each was a different mechanism, but the
family is one: **the sealing pass judges from an evidence pack that is missing what it is being
asked about.** F-344 fixed the question, WP-627 fixed the response to the answer, and F-361 shows
the evidence itself is still absent. Until a run whose AC goes red-then-green can seal SUCCESS, the
per-run pass/fail number in the ledger is measuring the harness, not the agent.

⚠️ **Standing caution (unchanged, F-197):** the Temporal worker is built from HEAD at launch, so
this run executed the OLD loop. WP-627's first live datum is dogfood-146.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 2 steps / 17m 11s | 4 steps (dogfood-142) over the trailing 3 |
| kill → resume count | 0 | 0 across dogfood-143…145 |
| judge true-positives pre-land | **1** (AC-2 RED at pass #1 → repaired at step 2) | 1 (143) + 1 (144) + 1 (145) = 3 |
| meta:product headline ratio | 0:1 (product) | **0:3** — cap ≤1 meta per 3 not approached |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% — 9 rollbacks / 170 steps, 21 runs ≥5 steps (target 99%+) |
| ladder rung vs exit gate | 0 (off-ladder) | P3-rung-5 = WP-303 ✅ + WP-304 ⏳ (operator-run suite; unchanged since dogfood-139) |
| judge false-positives at seal | **1** (F-361) | 3 consecutive reviews (F-344, F-359, F-361) |
