# dogfood-116 — WP-537 (a design finding must gate the seal on a one-step run) — delivered, half-wired, completed by hand

- **WP:** WP-537 (wire the design-fix retry loop into first-verdict seals — the F-180 fix)
- **Date:** 2026-07-27
- **Spec:** [`examples/dogfood/dogfood-116-wp537-design-finding-gates-the-seal.yaml`](../../examples/dogfood/dogfood-116-wp537-design-finding-gates-the-seal.yaml)
- **Run-id:** `run-688134b0-f6f0-41ed-a831-cab9dc9a8c38`
- **Base HEAD at launch:** `cc1b19f`
- **Outcome:** SUCCESS · 1 step · $0.0591 / $30.00 · 2m 58s · executor `gemini-cli` (gemini) · judge `openai-compat` (`gpt-5.6-sol xhigh`)
- **Landed:** harvested + hand-completed in this review sitting (commit cited in the status block below)

## Plain lead (vibe check)

The run built the thing it was asked to build: a design objection raised at the
moment a one-step run would seal now actually triggers the bounded fix path
instead of being written to the journal and ignored. All four acceptance
criteria passed, and they were real criteria — one of them probed the decision
across its whole input matrix against the real built module.

But the judge, in the same pass, wrote down a defect the four criteria could not
see: the objection **starts** the review and then gets **dropped** if the second,
independent review comes back clean. So on that path the run pays an extra judge
pass and changes nothing — the exact trap the goal named and forbade. The judge
was right; the defect is real; it is fixed by hand in this sitting with a live
test that goes red without the fix.

Two things follow. First, WP-537 is now genuinely done. Second, and more
uncomfortable: this run **could not** exercise its own delivery. The worker runs
the code that was on HEAD when it started, so the run that fixes "a rubric ✗ must
gate the seal" itself sealed SUCCESS on a rubric ✗ with nothing gating it. The
live proof has to come from the next run.

## Glossary (IDs used here)

- **WP-537** — the work package this run delivered: make a design finding reach a consumer on a one-step run.
- **F-180** — the defect WP-537 repairs: a verdict whose acceptance criteria all pass but whose design rubric fails returns PROCEED, and on a one-step run nothing reads the failure.
- **F-n** — global sequential friction id. This report adds **F-196** and **F-197**.
- **AC-n** — acceptance criterion: a shell check the judge executes against the delivered tree.
- **rubric** — the judge's standing design checklist (`design_serves_overall_goal`, `tests_pass`, …), scored alongside the acceptance criteria but *advisory* by design.
- **first-verdict seal** — a run that seals on its very first judge pass, so that pass's diff base equals the run's base commit. Every `gemini-cli` run is this shape (F-190).
- **completion review** — one extra judge pass over the run's cumulative diff at the seal moment; capped at `MAX_COMPLETION_REVIEWS = 2`.
- **trap C** — the goal's third named trap: fire the review, then drop the finding. "The bug is intact behind a greener test."
- **P3-rung-4** — the P3 proof ladder's 4th rung: ≥5 runnable brownfield tasks scored against a baseline.
- **oracle-owned AC** — an AC whose check states its own inputs and expected outputs, rather than running tests the executor authored.

## Trace excerpt (journal = ground truth)

```
run run-688134b0-f6f0-41ed-a831-cab9dc9a8c38 · SUCCESS · 1 steps · $0.06 / $30.00 · 2m 58s
  executor gemini-cli(gemini) · judge openai-compat · ⚠ cost meter blind (unpriced tokens)
 #   step                              tokens(in/out)   cost     verdict
 1   ### Executive Summary We repair…   4.9k/1.5k       $0.00    ✓ PROCEED (4/4 criteria)
totals: decisions 1 · judge passes 1 ($0.0591, 100.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 75% (compact 0 · park 0)
        issues found 1 · changes made 1 (issues:changes 1:1)
        endpoints plan openai-compat · code gemini-cli(gemini) · review/judge openai-compat

step 1 · diff 85a728c60c1d · 14,386 bytes · 0 tool calls journaled · 1m 45s
judge pass #1 · gpt-5.6-sol xhigh · $0.0591 · 17,658 evidence bytes · 1m 09s
  criteria: AC-1 ✓ AC-2 ✓ AC-3 ✓ AC-4 ✓   (all judge-executed, all exited 0)
  rubric:   tests_pass ✓ · no_unrelated_deletions ✓ · no_secrets_introduced ✓
            no_architecture_violations ✓ · scope_matches_instruction ✓
            design_serves_overall_goal ✗
verdict:    ✓ PROCEED (4/4 criteria) — "non-destructive rubric failures"
checkpoint: run-688134b0…@5 · commit ec4e7f71b4b6 · lastGood true
```

**The judge's ✗, verbatim (it is the most valuable artifact this run produced):**

> The decision now starts a completion review for a first-verdict rubric failure,
> but the sealing verdict's actual failing items are not carried into the executor
> brief. A second, independent completion-review verdict must also fail before
> `buildCompletionReviewBrief` is called; if that review is clean, the original
> sealing objection is dropped and no fix step runs. The live test masks this gap
> by deliberately making both the sealing verdict and the subsequent completion
> review fail, so the design does not guarantee the stated requirement that every
> sealing objection becomes the next executor instruction.

## Delivery quality (human review, post-landing)

### What landed (4 files, all inside `packages/sdk-ts/` — scope perfect)

| File | Change | Verdict |
|---|---|---|
| `src/workflow/completion-review.ts` | `decideCompletionReview` gains a rubric-outcome input; skip now requires first-verdict seal **AND** clean rubric | 🟢 correct, pure, in the module that owns the decision |
| `src/workflow/agent-loop.ts` | derives the sealing verdict's rubric outcome and passes it across the boundary | 🟡 wiring present, but the finding itself was not carried through |
| `test/runner/completion-review.test.ts` | 5 → 15 tests; the 2×2×3 matrix enumerated, each case asserting what must **not** happen too | 🟢 genuinely covers the matrix |
| `test/runner/completion-review-live.test.ts` | +1 live case: first-verdict seal with a failing rubric → brief issued → fix step → SUCCESS | 🟡 real proof, but only of the both-fail path |

Traps A and B were both honored and independently confirmed: a clean
first-verdict seal still skips (zero extra judge passes — no cost regression),
and a rubric-only failure still seals SUCCESS rather than parking or failing the
run (the F-107 discipline). The bound holds: exhaustion wins over a failing
rubric in every combination.

### What was wrong — the judge's finding, confirmed

`agent-loop.ts` built the brief from `reviewVerdict.form` alone
(`agent-loop.ts:896` on the harvested tree). The control flow was:

```
sealing verdict rubric ✗  →  decideCompletionReview → "review"  →  extra judge pass
   └─ review clean?  →  fall through to seal("SUCCESS")   ← objection discarded, pass wasted
```

That is trap C exactly, and no acceptance criterion could see it: AC-1 owns the
oracle for the **decision** (does the review fire?) and nothing owned the oracle
for the **consequence** (does the finding reach the executor?). AC-2 is a grep.
This is 🔴 **F-196**.

### Hand-fix applied this sitting

- `src/workflow/completion-review.ts` — net-new pure `mergeDesignFindings(sealingRubric, reviewRubric)`: unions both sides' failing items, deduped by rubric id, sealing-verdict-first. Exported `RubricResult` type alias.
- `src/workflow/agent-loop.ts:895-906` — the brief is now built from the merged findings, so the sealing objection survives a clean completion review; `canRetry` no longer re-derives the flag from the review alone.
- `test/runner/completion-review.test.ts` — +5 `mergeDesignFindings` cases (clean review keeps the sealing objection, union order, dedupe by id, empty case, brief carries the justification verbatim).
- `test/runner/completion-review-live.test.ts` — +1 live case: sealing verdict ✗, completion review **clean** → the brief must still issue and must name the *sealing* verdict's rubric id.
- Also collapsed the six-spelling rubric input (F-194 recurrence, below) to the two spellings that are actually wired.

**Both directions proven.** With the merge reverted, the new live test fails
`expected undefined to be defined` (no brief was ever issued); with it restored,
27 completion-review tests pass. Full sdk-ts suite **1007 passed / 23 skipped**,
`tsc --noEmit` and `eslint src test` clean.

### Independent verification (evidence pack §3, re-run post-hand-fix)

| AC | What it proves | Result |
|---|---|---|
| AC-1 | decision correct over the 2×2×3 matrix, asserted by the check itself against `dist/` | 🟢 PASS |
| AC-2 | the sealing verdict's rubric outcome crosses the call-site boundary | 🟢 PASS |
| AC-3 | ≥12 completion-review tests pass, none failing | 🟢 PASS — **27** |
| AC-4 | `tsc --noEmit` + `eslint src` + `test/judge` (119 passed / 12 skipped, 4.05 s) | 🟢 PASS |

Scope (§4) 4 files, all in `packages/sdk-ts/`. Harvest byte-diff (§5) clean.
**No workspace escape** — `git status --short` was empty before harvest, so
🔴 F-192 did not recur and the new detector was never armed in anger.

## New friction

### 🔴 F-196 — an AC that owns the decision oracle can still miss the consequence oracle

**Evidence.** Four acceptance criteria passed, one of them a 12-assertion
behavioral probe over the real built module across a 2×2×3 input matrix — the
strongest AC shape this loop has produced. It proved `decideCompletionReview`
returns `"review"`. It could not prove that returning `"review"` **does anything**,
because the consequence lives in `agent-loop.ts`, one layer up, behind a live
Temporal run. The goal *named* the failure mode in prose (trap C, with the
sentence "the bug is intact behind a greener test") and no check tested it. The
judge's design rubric caught it; the acceptance oracle did not.

**Why it matters.** This is the F-187 lesson at the next altitude. F-187 said an
oracle-owned AC must enumerate every input family. F-196 says it must also pin
the **output's consumer**: for any change whose value is "X now causes Y", one AC
must assert Y, not X. A pure-decision probe is necessary and not sufficient.

**Disposition.** HAND-FIXED THIS SITTING (`completion-review.ts` `mergeDesignFindings`,
`agent-loop.ts:895-906`, 6 net-new tests incl. a live one proven red-without-fix).
The AC-authoring rule goes to `docs/DOGFOODING.md` §3.4.

### 🟡 F-197 — a run that delivers a harness-behavior fix cannot exercise that fix

**Evidence.** The spec asserted "this run will very likely seal in one step —
which is exactly the shape it is fixing, so the delivery gets to gate itself on
the way in." That is structurally false. The Temporal worker is built from the
repo state at launch (`cc1b19f`), so the loop governing this run was **pre-fix**
code. The trace shows it: `judge passes 1`, no `completion-review` entry, rubric
✗ recorded and PROCEED returned — textbook F-180, on the run that fixes F-180.

**Why it matters.** Every WP that changes runner/judge behavior has this shape,
and there have now been four in a row (WP-534, WP-535, WP-538, WP-537). The proof
of such a WP is never the run that delivers it; it is the *first subsequent run on
the new HEAD*. Reviews must say so explicitly and check for the mechanism's
journal signature on the next run, or a behavior WP can land, be marked ✅, and
never actually fire in the wild.

**Disposition.** track-B note — recorded as a standing review rule in
`docs/DOGFOODING.md` §7 and made binding on the next run's review (the NEXT RUN
section names the journal signature to look for). No WP: this is a review
procedure, not code.

### 🔴 F-194 recurrence — a prose warning does not counteract an AC's incentive

dogfood-115 recorded F-194 (an oracle-owned AC probing 7 field spellings taught
the executor to implement all 7, 6 of them dead public API) and the dogfood-116
spec carried an explicit ⚠️ warning: *"learn from it, do not copy it… One field,
wired for real, is better."* The executor shipped **six** spellings anyway
(`sealingVerdictHasRubricFailures`, `hasRubricFailures`, `rubricFails`,
`sealingRubricClean`, `rubricClean`, `rubricResults`), four of them reachable by
nothing, plus a unit test asserting the dead aliases work.

The lesson upgrades: an AC is an incentive, prose in a comment block is not. The
only fix is to change the AC. **HAND-FIXED THIS SITTING** — trimmed to the two
spellings that are wired (the explicit boolean the call site passes, and the raw
`rubricResults` array AC-1 actually exercises), with the precedence documented
and three tests pinning it. No new id.

### Recurrences, no new id

| id | What recurred |
|---|---|
| ℹ️ F-167 / F-9 | cost meter blind — step cost $0.0000 over 6,419 metered tokens; `gemini-cli` model absent from `pricing.ts`. Judge share reads 100% only because the executor half is unpriced. |
| 🟡 F-190 | one Chikory step for the whole agent session → every run is a first-verdict seal. |
| ℹ️ F-176 | `0 tool calls` journaled for a 14,386-byte 4-file diff. |
| ℹ️ F-168 | the progression gate's ⛔ message still cites the retired P2/WP-265 ladder. |
| 🔴 F-180 | rubric ✗ → PROCEED → SUCCESS with no consumer. **Fifth consecutive run.** Fixed by this delivery; unproven in the wild until dogfood-117. |

### Closed

- ✅ **F-195 CLOSED** — dogfood-115 saw 3 pacing `compact` events with 0 folds and this review was asked to re-check. This run: `pacing events 1 · peak window 75% (compact 0 · park 0)`. Confirmed an F-192 artifact (compaction pressure computed over a context that never received work). No further action.

## Friction disposition

| F-n | Sev | Defect | Disposition |
|---|---|---|---|
| F-196 | 🔴 | an AC matrix owning the decision oracle proved the review fires, not that the finding reaches the executor; trap C shipped green | **HAND-FIXED THIS SITTING** — `completion-review.ts` `mergeDesignFindings` + `agent-loop.ts:895-906`; 6 net-new tests (5 unit + 1 live), live test proven RED with the fix reverted; 27 completion-review / 1007 sdk-ts green |
| F-197 | 🟡 | the run delivering a runner-behavior fix runs on pre-fix code, so it cannot prove its own delivery | **track-B note** — DOGFOODING §7 review rule; binding on the dogfood-117 review (named journal signature) |
| F-194 (rec.) | 🔴 | a spec-preamble warning failed to stop the multi-spelling AC from teaching 6 dead public fields | **HAND-FIXED THIS SITTING** — trimmed to 2 wired spellings, `completion-review.ts:27-40`, 3 precedence tests; DOGFOODING §3.4 rule strengthened (change the AC, not the prose) |

## KPI table (DOGFOODING §1.4)

| KPI | This run | Trailing window |
|---|---|---|
| Max horizon survived | 1 step · 2m 58s | 4 steps (dogfood-115) over trailing-3 |
| Kill → resume count | 0 | 0 over trailing-3 |
| Judge true-positives pre-land | **1** (`design_serves_overall_goal` ✗ — confirmed, hand-fixed) | 3 of last 5 runs |
| Trailing-3 meta:product headline ratio | product | **0 : 3** — cap intact |
| Per-step reliability (runs ≥5 steps) | n/a (1 step) | 93.8% (8 rollbacks / 128 steps, 17 runs) — target 99%+ |
| Current-phase ladder rung | **0** (off-ladder — WP-537 is rung-4's *unblock*, not the rung) | P3 high-water **3**; exit gate = **P3-5** (published ranges + leaderboard) |
| Cost | $0.0591 / $30.00 (0.2%) · judge share 100% (executor unpriced) | — |

## Verdict on the thesis

The strongest evidence this campaign has produced for Agent-as-a-Judge, and it
arrived by accident. Four acceptance criteria — including the most carefully
armed oracle this loop has ever shipped — passed a delivery that was **half
wired**. The only artifact that caught it was the judge's design rubric, in
prose, naming the precise control-flow path where the finding is dropped and
naming the test that masks it. A human confirmed it in under ten minutes by
reading the diff the judge pointed at.

That is the pillar working: acceptance criteria answer *did you do what I asked*,
and the design rubric answers *is what you did actually coherent* — and the second
question caught what the first could not, on the run whose entire purpose was to
give the second question teeth.

It also, in the same breath, shows the cost of the gap being closed. The judge
found the defect and the run sealed 🟢 SUCCESS anyway, for the fifth consecutive
time, because the delivery that fixes exactly that was not yet running. WP-537 is
done now. Whether it *works* is the next run's question, and the review of that
run must go look.

## NEXT RUN

**Make the benchmark harness able to prove, by itself, that a task's untouched
base is green — so a task can be moved from "we can't score this" to "scorable"
on evidence instead of on assertion.**

- **Spec:** [`examples/dogfood/dogfood-117-wp540-base-green-verification.yaml`](../../examples/dogfood/dogfood-117-wp540-base-green-verification.yaml)
- **WP:** WP-540 (base-green verification for benchmark tasks) — serving WP-302 (brownfield task authoring) and WP-304 (baseline runs & publication).
- **Why this and not the ladder rung:** §0 reads ⛔ STALLED, which binds the next headline to the current phase's ladder rung **or its named unblock**. P3-rung-4 (≥5 runnable tasks vs a baseline) still cannot run: the runnable corpus is **2** (`brownfield-001`, `brownfield-003`), and `brownfield-002` carries `status: blocked` whose `blocked_reason` names its own unblock condition — *"the flip needs a green-base verification suite"*. That capability does not exist. This run builds it; the flip and the corpus growth follow it.
- **Free second proof (F-197, binding on the next review):** this is the first run on a HEAD carrying WP-537. If the judge records any `design_serves_overall_goal ✗`, the journal **must** show a `completion-review` judge pass and a step whose summary contains `DESIGN REVIEW BRIEF`. If the rubric is clean, the journal must show **exactly one** judge pass — no completion review, no cost regression (trap A). Either outcome is a real live datum on WP-537; the review must state which it saw.
- **The designed trap:** a `verifyBaseGreen` that reports green because the verification **command ran**, rather than because the suite **passed** — i.e. it conflates "the process exited" or "we produced a report" with "0 tests failed". Its siblings, all equally plausible and all rejected by the ACs: running the suite under **ambient** node instead of the node the target's `engines` field demands (the exact F-163/F-181 lineage that blocked `brownfield-002` in the first place), and treating a run that collected **zero** tests as green.

### Gate verdicts

| Gate | Verdict | One line |
|---|---|---|
| §0 progression | ⛔ **STALLED** → honored | the headline is P3-rung-4's *named* unblock, quoted from `brownfield-002`'s own `blocked_reason`; the rung itself is unrunnable at corpus 2/5. |
| §1.1 failure-surface | ✅ | cross-file (`benchmarks/harness/src/`), three plausible-and-wrong deliveries, a real bug surface (a wrong answer here silently publishes bad benchmark numbers). |
| §1.2 product-progress | ✅ | real open `plan.md` §7 WP-302/WP-304 on real product code — the same `benchmarks/harness/src/` surface as WP-534/535/536/538, all class=product. |
| §1.3 mission-critical | ✅ PROCEED | it is the named blocker on rung-4 and therefore on the P3 exit gate; nothing is scaffold-hosted. |
| §1.5 friction-budget | ✅ | class=product; trailing-3 harness-meta headlines **0/3**, cap intact. F-196/F-194 were hand-fixed this sitting and do not headline. |

### AC arming evidence

| AC | Preflight class | Arming |
|---|---|---|
| AC-1 | VERIFY-SUITE (**not** dry-run — shells to `tsc`/`node`) | Hand-verified **both directions** 2026-07-27. **RED on HEAD**, exit 1: `Cannot find module …/benchmarks/harness/dist/base-verify.js` — the module does not exist (wall **1.45 s**). **GREEN** against a throwaway reference implementation compiled into `dist/`, running the AC's script **verbatim**: `AC-1 OK: base-green verdict correct across 7 input families`, exit 0, wall **1.47 s** vs the 120 s judge cap. Reference impl deleted after arming (`git status` clean of `benchmarks/`). |
| AC-2 | dry-run ✅ | **RED on HEAD** — `grep -q 'verifyBaseGreen' benchmarks/harness/src/suite.ts` finds nothing. Satisfiability proven separately against a synthetic call site carrying `provisioning` within 8 lines: green. |
| AC-3 | VERIFY-SUITE (**not** dry-run — `pnpm exec vitest`) | **RED on HEAD** on the count: the harness suite is **78 passed / 0 failed**, so the check prints `FAIL: only 78 harness tests pass; the seven input families each with a negative need at least 90`. Wall **2.05 s** for the whole harness suite vs the 120 s cap — F-141-safe with three orders of headroom. |
| AC-4 | VERIFY-SUITE | `tsc --noEmit` + `eslint src` over `benchmarks/harness` — exit 0, measured **3.19 s**. Green on HEAD by construction (it is the no-regression criterion). |

```
devbox run run-dogfood
```
