# dogfood-117 — WP-540 (base-green verification) — the module is right, the call site verifies an empty directory

- **WP:** WP-540 (prove a benchmark task's untouched base is green before anyone scores it)
- **Date:** 2026-07-28
- **Spec:** [`examples/dogfood/dogfood-117-wp540-base-green-verification.yaml`](../../examples/dogfood/dogfood-117-wp540-base-green-verification.yaml)
- **Run-id:** `run-80af3eb7-02ab-41fe-9077-fe13251933a3`
- **Base HEAD at launch:** `560ea45`
- **Outcome:** SUCCESS · 2 steps · $0.1268 / $30.00 · 4m 9s · executor `gemini-cli` (gemini) · judge `openai-compat` (`gpt-5.6-sol xhigh`)
- **Landed:** harvested (byte-IDENTICAL) + F-199 hand-fixed in this sitting; commit cited in the status block below

## Plain lead (vibe check)

The run built a correct little machine and then plugged it into a wall socket
with no wires behind it. `verifyBaseGreen` answers "is this test suite green?"
correctly for every input we could throw at it — all three traps held, all four
acceptance criteria pass, 92 tests green. But the one line that *calls* it in
the benchmark suite runner points it at the per-task workspace **before anything
has been cloned into it** — an empty directory. So in production every task will
record the same verdict: `green:false · "Unparseable suite output"`. The
capability is real; the answer it will actually produce is a constant, and a
constant is not a verification.

Nothing scores on it yet, so no published number is wrong today. But WP-540 was
queued to unblock `brownfield-002` and grow the corpus to the five tasks
P3-rung-4 needs, and it does not do that. WP-540 stays open; the next run is the
same WP, finishing the consumer half.

Two smaller things: the base suite would have run with the harness host's
provider credentials in its environment (dead scrub) — **fixed by hand here** —
and the design judge, reviewing the cumulative diff, explicitly praised the
inert wiring as a design virtue. It read structure and did not follow the data.

## Glossary (IDs used here)

- **WP-540** — the work package: give the harness a mechanical answer to "is this task's untouched base ref green?".
- **P3-rung-4** — the current phase ladder rung: ≥5 brownfield tasks scored against a baseline, producing a score range. Blocked on corpus size; WP-540 is its named unblock.
- **AC-n** — acceptance criterion: a shell check the judge executes against the delivered tree.
- **rubric** — the judge's standing design checklist (`design_serves_overall_goal`, `tests_pass`, …), scored alongside the criteria, advisory by design.
- **completion review** — one extra judge pass over the run's cumulative diff at the seal moment (WP-537); a design finding there grants one bounded fix step.
- **trap A/B/C** — the three wrong answers the spec named: exit code ≠ suite result; zero tests collected ≠ green; ignore the provisioning decision.
- **F-n** — global sequential friction id. This report adds **F-198 … F-201**.
- **provisioning decision** — `ambient` / `provision` / `unavailable`, the per-target Node choice WP-538 landed.

## Trace

```
run run-80af3eb7-02ab-41fe-9077-fe13251933a3 · SUCCESS · 2 steps · $0.13 / $30.00 · 4m 9s
  executor gemini-cli(gemini) · judge openai-compat · ⚠ cost meter blind (unpriced tokens)
 #   step                          tokens(in/out)   cost     verdict
 1   High-Level Summary | Metric…  4.3k/656         $0.00    ✓ PROCEED (1/4 criteria)
 2   Summary of Work Done…         5.5k/467         $0.00    ✓ PROCEED (0/0 criteria)
totals: judge passes 3 ($0.1268, 100.0%) · rollbacks 0 · escalations 0 · injections 0
        checkpoints 2 · pacing events 2 · peak window 89% · pressure-steps 1 (unfolded 1)
        issues found 4 · changes made 1
```

| Metric | Value |
|---|---|
| Terminal state | SUCCESS (sealed after completion review) |
| Steps | 2 (step 1 = plan/probe, empty diff; step 2 = the whole delivery, 16,101 bytes) |
| Cost (exact) | **$0.1268** / $30.00 budget = **0.4%** — 100% judge, executor unpriced |
| Judge passes | 3 — step-1 verdict $0.0388 · step-2 verdict $0.0483 · completion review $0.0397 |
| Duration | 4m 9s (step 1 54s, step 2 1m 36s, judge 26+38+30s) |
| Checkpoints | 2 (`@5` `3fcfc37c`, `@10` `e14d2fe5`), both `lastGood` |
| Probe step | step 1, empty diff, $0.0000 → **0.0% of run cost** (F-11 / WP-221 data point) |
| Harvest | byte-**IDENTICAL** on all 5 files |
| Workspace escape (F-192) | none — `git status` clean before harvest |

## Delivery quality (human review, post-landing)

**Landed:** `benchmarks/harness/src/base-verify.ts` (+184), `test/base-verify.test.ts`
(+160), and three-line integrations in `suite.ts`, `results.ts`, `index.ts`.
Scope discipline was perfect: nothing outside `benchmarks/harness/`, no new
dependency, no `packages/` or `benchmarks/tasks/` edit.

**Acceptance checks re-run against the working tree after harvest — 4/4 PASS**
(AC-3 reports 92 tests; 94 after this sitting's hand-fix).

### What is right

- **All three traps hold.** Nonzero exit is never green (`base-verify.ts:150-158`);
  zero tests collected is never green (`:160-172`); `unavailable` returns
  non-green naming the version **without invoking the runner even once**
  (`:123-131`); `provision` prepends `binDir` to the runner's `PATH` (`:134-146`).
- **Injected runner honored**, so the whole decision is testable with no network
  and no multi-gigabyte clone — the spec's hermeticity requirement.
- **Summary parsing** covers the three shapes the corpus produces plus Jest's
  `Tests: 1 failed, 2 passed, 3 total`, strips ANSI, and returns `null` (→ not
  green) on anything unrecognized. It does not guess.
- **No dead API (F-194 held).** Every exported symbol has a caller:
  `verifyBaseGreen` and `findBaseVerificationCommand` from `suite.ts`,
  `parseTestSummary` from the tests. The spec's one-shape rule was obeyed.

### What is wrong — the call site (F-198)

`suite.ts:123-129` calls the verification with `cwd: workspaceDir`. Three lines
above, `suite.ts:95-96` creates that directory with `mkdirSync(…, {recursive:true})`
and **nothing populates it**: the comment at `suite.ts:120-121` states the
contract in the code's own words — *"Brownfield repos are cloned by the system
under test … for baselines the workspace starts empty."* The clone happens
inside `opts.adapter.run` (`adapter.ts:178`, `:265`), which runs *after* the
verification. WP-538's own engine loader proves the pattern by counter-example:
it cannot read the target's `package.json` from the workspace either, so it
clones a throwaway temp checkout to get it (`engine.ts:206-234`).

Measured, not inferred — `verifyBaseGreen` against an empty directory:

```
EMPTY-WORKSPACE VERDICT: {"green":false,"reason":"Unparseable suite output: could not find test summary","testsPassed":0,"testsFailed":0}
```

So `TaskResult.baseVerification` will read `green:false` for every task in every
suite run, whatever the base actually is. AC-2 could not see this: it greps for
the symbol in `suite.ts` and for `provision` within 8 lines. Both are present.
The wiring exists; it points nowhere.

### What is wrong — the environment (F-199, fixed here)

`defaultRun` falls back to `scrubExecutorEnv(process.env, [])`, but
`verifyBaseGreen` always built and passed its own env, so the scrub was
unreachable and the target's own test command would have run with
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` in scope. Fixed in
this sitting at `base-verify.ts:133-139` with two new tests (94 pass, up from 92).

## WP-537 live datum (the F-197 debt from dogfood-116)

dogfood-116 could not exercise its own delivery; this run is the first carried by
a HEAD that has it. Signature observed, per the spec's instruction to state which:

- The seal was **not** a first-verdict seal (`sealingDiffBase 3fcfc37c` ≠
  `baseCommit 560ea45`), so `decideCompletionReview` returned `review` and a
  **third judge pass ran** — `completion-review`, cumulative diff, $0.0397, 30s.
- The sealing verdict's rubric was **fully clean**, the review came back clean,
  `mergeDesignFindings` merged nothing, and the run sealed SUCCESS. No
  `DESIGN REVIEW BRIEF` in the journal — correct, since there was no finding.
- **Therefore WP-537's no-finding path is live-proven; its carry-the-objection
  path (trap C) is still not.** The step-1 rubric ✗ (`tests_pass`) was not a
  *sealing* verdict, so it never fed `sealingRubricFails`. F-197 stays open,
  narrowed: a run whose SEALING verdict carries a rubric ✗ is still owed.
- Cost of the mechanism on a clean run: **$0.0397 = 31% of total run cost.**

## New friction

**F-198 — 🔴 the base verification is wired to a directory that is empty by
contract, so its verdict is a constant.**

- **Evidence:** `suite.ts:123-129` passes `cwd: workspaceDir`; `suite.ts:95-96`
  creates it empty; `suite.ts:120-121` documents that it stays empty until the
  adapter clones (`adapter.ts:178`/`:265`). Probe against an empty dir returns
  `green:false · "Unparseable suite output"` for any command. AC-2 (grep) and the
  design rubric both passed over it.
- **Why it matters:** WP-540 exists to make base scorability mechanical so the
  corpus can reach the five tasks P3-rung-4 needs. A verdict that is always
  `false` unblocks nothing, and if anyone ever gates on it the whole corpus
  becomes unscorable.
- **Disposition:** **→ WP-540 (headline, dogfood-118)** — not hand-fixed, because
  it is the substance of the next run and a genuinely fail-able slice.

**F-199 — 🟡 the base suite would inherit the harness host's provider credentials
(dead scrub).**

- **Evidence:** `defaultRun` scrubbed only when `input.env` was undefined, but
  `verifyBaseGreen` always supplied `{...process.env}` — so `scrubExecutorEnv`
  was imported and never reached. Target-authored code running with
  `*_API_KEY` in scope is the exact leak `scrubExecutorEnv` exists to prevent.
- **Disposition:** **HAND-FIXED THIS SITTING** — `benchmarks/harness/src/base-verify.ts:133-139`,
  plus 2 new tests (`test/base-verify.test.ts:98-129`); harness suite **94 passed**
  (was 92), tsc + eslint clean.

**F-200 — 🟡 the base verification command is inferred by keyword match and
falls back to a literal guess.**

- **Evidence:** `findBaseVerificationCommand` (`base-verify.ts:96-114`) scans the
  task's *grading* requirements for a description containing `"test"`/`"suite"`,
  else takes any check, else returns the string `"pnpm test"`. In a capability
  whose stated rule is *"do not guess"*, the base command is guessed — and the
  grading checks describe the *delivery*, not the base.
- **Disposition:** **→ WP-540 (dogfood-118)** — the base command must come from
  the task's own declaration and fail loudly when absent, never a default string.

**F-201 — 🟡 the design judge validated structure, not data flow.**

- **Evidence:** completion review (judge pass #3) passed `design_serves_overall_goal`
  with the rationale *"invokes it from the suite before adapter execution and
  grading"* — which is precisely the defect. It confirmed the call exists and
  never asked what is in the directory the call points at. `cumulative_design_coherent`
  agreed. Same blind spot as AC-2, at a higher altitude.
- **Disposition:** **track-B note against WP-311 / WP-537** — the design rubric
  prompt should require naming, for each new call site, what state the callee
  observes at that point. Not a headline (harness-meta, and §1.5 cap logic aside,
  the product WP is the live wound).

**Recurrences (no new id):** F-167/F-9 — cost meter blind, 10,880 metered
executor tokens at $0.00 (`routing.stages.code.model: default` is mandated by
F-170, so this is structural for `gemini-cli` runs). F-123 — `pressure fired for
1 step(s), but no pacing folds were recorded`. F-190 — the whole delivery
collapsed into one step, so `judge.cadence: 2` never fired twice.

## KPI table (DOGFOODING §1.4)

| KPI | This run | Trailing window |
|---|---|---|
| Max horizon survived | 2 steps · 4m 9s | 4 steps (dogfood-115) |
| kill→resume count | 0 | 0 across 112–117 |
| Judge true-positives pre-land | **0** — the judge missed F-198 | 1 (116), 1 (115), 0 (114) |
| Trailing-3 meta:product headline ratio | 0:3 (this run `class=product`) | cap ≤1/3 intact |
| Per-step reliability (runs ≥5 steps) | n/a | 93.8% (8 rollbacks / 128 steps) — target 99%+ |
| Current-phase ladder rung | **0** (off-ladder; WP-540 is rung-4's unblock, not the rung) | rung 3 climbed (dogfood-108); rung 4 ⏳; exit gate = rung 5 |

## Friction disposition table

| F-n | Sev | Defect | Disposition |
|---|---|---|---|
| F-198 | 🔴 | Base verification runs against the per-task workspace, which is empty by contract → verdict is a constant `green:false` | **→ WP-540 (headline, dogfood-118)** |
| F-199 | 🟡 | `scrubExecutorEnv` unreachable; base suite would run with host provider keys | **HAND-FIXED THIS SITTING** — `base-verify.ts:133-139`, +2 tests, 94 pass |
| F-200 | 🟡 | Base command keyword-guessed from grading checks, literal `"pnpm test"` fallback | **→ WP-540 (dogfood-118)** |
| F-201 | 🟡 | Design judge praised the inert call site; rubric checks structure, not observed state | **track-B note** against WP-311 / WP-537 |

## Verdict on the thesis

Mixed, and instructive. The Agent-as-a-Judge loop did what it is for at the
*criteria* altitude — four judge-executed checks, one of them an oracle-owning
behavioral probe over seven input families, all genuinely satisfied. It failed at
the *integration* altitude: three independent gates (AC-2's grep, the sealing
rubric, the WP-537 completion review) all inspected the same three lines and all
concluded the capability was wired, because each asked "is there a call?" and
none asked "what does the callee see?".

That is the sharper form of the standing lesson. Owning the oracle is necessary
(F-187) and the oracle must probe every input family (F-187 again) — but if the
oracle probes the *module* while the defect lives at the *call site*, the run
still ships inert code with four green checks. dogfood-118's AC-1 is therefore
written against `runSuite` itself, with a local git fixture whose base is green
and a stub adapter that makes the workspace red: the only way to pass it is to
verify the real base ref, in a checkout that is not the agent's workspace.
