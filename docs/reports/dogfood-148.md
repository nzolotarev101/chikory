# dogfood-148 — a second, different complaint under the same heading no longer erases the first (WP-630)

**WP:** WP-630 (a second, DIFFERENT objection on the same rubric id must not silently replace the first) · **Date:** 2026-08-16 ·
**Spec:** `examples/dogfood/dogfood-148-wp630-standing-finding-overwrite.yaml` ·
**Run:** `run-2213aec1-9683-4c6a-a496-b74f968975c1` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3 rung-5, the phase exit gate, stays operator-by-hand)

## Plain lead

The reviewer inside Chikory used to keep only one note per topic: if it complained about
architecture at one point and complained about something *else* architectural later, the
second complaint quietly overwrote the first, and nobody ever saw the first one again. It
now keeps every distinct complaint under a heading, collapses exact repeats, and wipes the
whole heading clean when a machine check proves the topic settled. The run delivered this
in one step for 8 cents and its judge approved everything — but the judge missed two things
this review caught: the delivery's own test file advertised a guarantee it never tested, and
the fix quietly turned a bounded channel into an unbounded one.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 6m 15s |
| cost | **$0.0808** of $20 budget (**0.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠ **cost meter blind**: $0.0000 priced on 5,905 metered tokens, and `0 tool calls` recorded against 6 self-reported command launches. Documented `gemini-cli` false alarm (`docs/DOGFOODING.md`), subscription-linked auth — not F-9, not new friction |
| judge | `openai-compat` / `gpt-5.6-sol` xhigh · 2 passes ($0.0475 + $0.0333) |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 (`run-…@5` · commit `213fb0bc788b` · `lastGood true`) · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 2/2 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.2k/1.7k | $0.0000 (unpriced) | 3m 27s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Judge passes.** Pass #1 is the per-step judge: both judge-executed checks exited 0, all 6
`STANDING_RUBRIC` rows ✓, `PROCEED (2/2 criteria)`. Pass #2 is `regressionGateBeforeSuccess`
(the pre-seal gate): 4 rows ✓ including `pre_existing_suite_still_green` (the declared
`regression_suite` exited 0) and `cumulative_design_coherent`, `PROCEED (0/0 criteria)` —
"work in progress, no regressions — no criteria evaluated". **Zero objections raised, so no
completion review fired and F-197 (a behavior WP cannot be proven by the run that ships it)
went unexercised at the orchestration altitude** — but AC-1 proved the fix live anyway, by
driving a real 3-step Temporal run inside the check (see below).

## Delivery quality (human review, post-landing)

**Landed files (2, both named or trivially entailed by the goal):**

| file | change |
|---|---|
| `packages/sdk-ts/src/workflow/agent-loop.ts` | +9/−5: map value `string` → `string[]`, read-before-write accumulation with exact-string dedup, accessor flattens |
| `packages/sdk-ts/test/runner/standing-findings-overwrite-live.test.ts` | new, 211 lines, 2 live Temporal tests |

**The mechanism.** `standingRubricFindings` became `Map<string, string[]>`
(`packages/sdk-ts/src/workflow/agent-loop.ts:272`); `getStandingFindings()` flattens it
(`:274`); the fail branch reads before writing and appends only a justification the id does
not already hold (`:1149`, `:1154`); the settled branch still deletes the whole id
(`:1157`). One accumulator, one accessor, both consumers unchanged — the executor named both
re-verifications in its step summary as the goal demanded.

**The goal, line by line — all six constraints held:**

| goal constraint | verdict | evidence |
|---|---|---|
| both distinct objections survive to the adjudicating pass | ✅ | AC-1's live run: both `OBJECTION-ALPHA`/`OBJECTION-BETA` reach the completion-review prompt on separate bullet lines |
| identical justification collapses to one | ✅ | `existing.includes(finding)` guard (`agent-loop.ts:1154`); pinned by the delivery's own live test |
| settling rule untouched, still fires on the same condition | ✅ | `src/judge/rubric.ts:134-147` byte-unchanged; the 4 pre-existing settled-live tests green, unmodified |
| a settled id clears **every** accumulated justification | ✅ (but was **unpinned** — see F-366) | `delete(fail.id)` at `:1157` drops the whole array |
| free-text `standingConcerns` untouched | ✅ | trap-E grep in AC-2; diff shows zero lines in `:1158-1162` |
| exactly one rubric-finding channel, no parallel accumulator | ✅ | one `Map`, one accessor; whole-file grep finds no second store |

**All five designed traps rejected.** (A) never-clear — rejected, `delete` survives and the 4
WP-629 settled-live tests stay green. (B) coalesce two objections into one string — rejected,
AC-1 counts rendered prompt lines, not substrings. (C) fix only one consumer — rejected by
construction, both read the one accessor. (D) clear only the latest justification — rejected
by `delete`, though **nothing tested it until this review** (F-366). (E) touch the free-text
concerns array — rejected, byte-unchanged.

**Independent verification (not taken on the run's word):**

- Declared regression suite re-measured by hand at this tree (F-342 rule — never transcribe):
  **191 files (189 passed | 2 skipped) / 1,526 tests (1,503 passed | 23 skipped), 62.14 s.**
- `test/runner/` tree: **56 files / 397 tests** (394 at launch → 396 delivered → 397 after this
  review's hand-fix). AC-2's durability floor of 395 was genuinely met, not gamed.
- Harvest byte-IDENTICAL 2/2; `git status` clean apart from the delivery (**F-192 workspace
  escape did not recur**).
- The new trap-D test added by this review was **probe-verified both ways**: against a
  `clear-only-the-latest` mutation of `:1157` it fails and prints the leaked pass-1 text
  (`- tests_pass: 2/2 judge-executed checks failed: AC-A, AC-B`) sitting in the completion
  review prompt; the mutation was reverted from a byte copy, not `git checkout`.

**Scope discipline: clean**, with one nit — the delivery deleted two explanatory comment lines
it did not need to (F-368).

## New friction

### F-365 🟠 — the fix turns a bounded finding channel into an unbounded one

`standingRubricFindings` used to hold **at most one string per rubric id** (≤6 total, one per
`STANDING_RUBRIC` row). It now holds every *distinct* justification an id ever accrued, and only
`tests_pass` is ever cleared — the other 5 rows are model-judged and
`isRubricItemSettledAgainstWholeDelivery` returns `false` for all of them
(`packages/sdk-ts/src/judge/rubric.ts:134-147`). Each accumulated string is rendered as its own
bullet into the completion-review prompt with **no cap, no truncation and no near-duplicate
collapse** — `packages/sdk-ts/src/judge/prompt.ts:227` maps one-to-one, and the only other
narrowing is an exact-set dedup at `packages/sdk-ts/src/workflow/agent-loop.ts:416`.

An LLM judge rarely repeats itself *byte-for-byte*: two passes objecting to the same thing in
slightly different words are two entries. At cadence 1 over a 30-step run, one model-judged id
can contribute 30 bullets of full justification prose (~200–400 chars each) — **8–12 KB from a
single rubric row**, growing linearly with horizon, injected into the one prompt whose job is
holistic judgement. This is the same defect family as F-328 (an unbounded raw-output field
regressing the CM-3 context discipline it exists to protect) and it lands squarely on the
long-horizon pillar. The run did not fail from it and no AC probed it.

**→ WP-631 (queued).** Fix shape: bound the per-id accumulation (keep the first and the last N
distinct justifications, or collapse near-duplicates) and state the cap where the prompt is
rendered.

### F-366 🟡 — the delivery's test file advertised a guarantee it never tested

`standing-findings-overwrite-live.test.ts`'s header comment listed three behaviours, the third
being "Whole-delivery settlement clears all accumulated justifications for that rubric id" —
the goal's trap-D line. The file shipped **two** tests, neither touching settlement. The
pre-existing `standing-findings-settled-live.test.ts` cannot cover it either: those 4 tests were
written when the map held one string per id, so no scenario in the repo ever gave a settled id
**more than one** accumulated entry to clear. Trap D was the one goal guarantee with zero
coverage, and the false comment would have told the next reader otherwise.

The judge passed `scope_matches_instruction` and `design_serves_overall_goal` with justifications
that recite the settlement behaviour as verified ("`delete(id)` clears the entire accumulated set
on settlement") — reading it off the diff, not off a test. **Judge miss, altitude: coverage
claims** (a rubric that reads the implementation cannot notice that nothing exercises it).

**HAND-FIXED THIS SITTING.** Added the third live test at
`packages/sdk-ts/test/runner/standing-findings-overwrite-live.test.ts:213`: a 3-pass run whose
failing-check set *changes* between passes, so the machine-derived `tests_pass` justification
differs (`2/2 … failed: AC-A, AC-B` then `1/2 … failed: AC-B`) and the id genuinely accumulates
two entries — asserted non-vacuously at `:264` — then settles at pass 3 and must leave the
completion review carrying neither. `test/runner/` 396 → **397 tests, all green**; probe-verified
RED against a clear-only-the-latest mutation.

### F-367 🟢 — the spec's full-suite baseline was 6 tests stale at launch

The spec declared "MEASURED at the launch commit … 190 files / 1,517 tests (1,494 passed | 23
skipped)". That figure was measured at HEAD `71f9987` (the dogfood-146 landing), **not** at the
launch commit `d7b5d53`, where WP-594 had already added 6 tests: the true launch baseline was
190 files / 1,523 tests. The `test/runner/` figure in the same paragraph (55 files / 394 tests)
*was* current, so the spec mixed two measurement points in one block. Harmless here — no AC
keyed a floor on the full-suite count — but an AC that had would have mis-gated. F-342
recurrence in a new shape: not a transcribed *count*, a transcribed *commit*.

**track-B note:** when a spec states a suite baseline, both numbers must come from one run at
the launch commit; `scripts/dogfood-arm.sh` already runs at HEAD and is the natural place to
emit them together.

### F-368 🟢 — two explanatory comment lines deleted against a "nothing else changes" goal

The delivery removed the two-line comment above the accumulator explaining *why* findings are
keyed by rubric id (machine-settled items can be cleared; model-judged ones persist) — the
rationale a reader needs before touching the settling rule. `no_unrelated_deletions` passed
correctly: its charter covers "code, tests, or configuration", not comments.

**HAND-FIXED THIS SITTING.** Restored and extended at
`packages/sdk-ts/src/workflow/agent-loop.ts:268` to describe the new array semantics.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-365 | 🟠 | per-id finding accumulation is unbounded; every distinct justification renders as its own completion-review bullet with no cap | → **WP-631 (queued)** |
| F-366 | 🟡 | new test file's header claimed settlement-clears-all coverage that no test in the repo provided (trap D unpinned) | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/test/runner/standing-findings-overwrite-live.test.ts:213`, `test/runner/` 396 → 397 tests green, probe-verified RED against a clear-only-latest mutation |
| F-367 | 🟢 | spec's full-suite baseline transcribed from the previous review's HEAD, 6 tests stale at launch | **track-B note** — emit both counts from one arming run |
| F-368 | 🟢 | delivery deleted 2 rationale comment lines under a "nothing else changes" goal | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/agent-loop.ts:268` |

## Verdict on the thesis

**Durable execution: uneventful, which is the point.** One step, one checkpoint (`lastGood
true`), zero resumes, zero rollbacks, 6m 15s, 0.4% of budget. Nothing to report is the
correct result for a 1-step run.

**Agent-as-a-Judge: the gate held, the reviewer did not.** Both passes approved, and the ACs
they executed were right to approve — the code is correct. But this review found two real
defects the judge's 10 rubric evaluations did not: an unbounded channel it created (F-365) and
a coverage claim it repeated instead of checking (F-366). That is now **five consecutive
headline runs where the judge's `judge_catches` is 0 or 1 and the human review is what finds the
residual defect** — consistent with the standing "judge detects but doesn't gate" family, one
altitude further out: here the judge did not even *detect*. The rubric reads the diff; nothing
in it asks "is this claim tested?" or "what is the growth bound of this structure?".

**The run's own value as a proof.** AC-1 is the strongest AC shape this loop has produced: it
drives a real Temporal server, a real workflow bundle and real judge-pass sequencing, and reads
the *rendered prompt* the completion review received. It owns its oracle end to end, and it
caught trap B by counting lines rather than substrings. That AC — not the judge — is what makes
this delivery trustworthy.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 6m 15s | 2 steps (dogfood-147) over the trailing 3 — **flat** |
| kill → resume count | 0 | 0 over the trailing 8 runs |
| judge true-positives pre-land | **0** | 0 · 0 · 0 over dogfood-146/147/148; 5 over the trailing 8 |
| meta:product headline ratio | 0:1 (product) | **0:3** over the trailing 3 — cap ≤1 per 3 not approached |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | 0 (off-ladder) | P3 rung **4** of 5; rung-5 = `brownfield-001`/WP-304, operator-by-hand |

**Progression gate: ⛔ STALLED** — no thesis axis (horizon, ladder rung, resume, spec
looseness) moved across dogfood-146/147/148. Binding consequence for the next run is recorded
in `## NEXT RUN`.

## NEXT RUN

**Nothing the reviewer writes down about a run can grow without limit any more — a failing test suite's raw log stops being copied whole into the permanent record, the pile of earlier complaints handed to the final review is capped, and whatever gets left out is said out loud with a count instead of quietly vanishing.**

- **Spec:** `examples/dogfood/dogfood-149-wp616-wp631-bounded-judge-strings.yaml`
- **Advances:** WP-616 (unbounding an excerpt for ONE consumer must not unbound the consumers that were never budgeted, F-328) **+** WP-631 (per-rubric-id standing-finding accumulation must be BOUNDED, F-365) — two open `plan.md` §6 product rows, one design principle.
- **Why THIS and not the ladder rung:** §0 reads **⛔ STALLED**, which binds the next headline to the P3 ladder rung (WP-530 §7). That rung is **rung-5**, whose only remaining half is `brownfield-001`/WP-304 — a quota-bound, multi-hour suite the operator runs by hand (dogfood-122: an LLM executor may not supervise it). No spec can headline it, unchanged since dogfood-139. Among runnable candidates this pairing wins because one of its two sites **was created by the run this review just landed**: dogfood-148 closed F-364 by making the finding channel unbounded, and leaving that in place trades one judge failure mode for another.
- **The designed trap:** a delivery that bounds the suite output **at the source** — shrinking `bound(output, 64 * 1024)` at `packages/sdk-ts/src/judge/evidence.ts:203` or dropping the append at `packages/sdk-ts/src/judge/harness.ts:205-208`. It makes the rationale small and every naive check green, while silently reverting WP-614: the remediation brief loses the raw log it budgets its own excerpt from. AC-2's third assertion is the guard, and it is **verified GREEN on HEAD** so a RED there means the delivery broke it. Second trap: bounding the accumulation by dropping entries **silently**, which is F-364 all over again — AC-1 requires the oldest and newest findings intact at both ends and an elision notice carrying the count.

**Gate verdicts:**

| gate | verdict | one line |
|---|---|---|
| §0 progression | 🟡 ALLOW (documented exception) | ⛔ STALLED binds the headline to the P3 ladder rung; rung-5's remaining half is operator-by-hand and cannot be a spec. Spec-format lint 🟢 LOOSE, `# Ladder-rung:` and `# Thesis-KPI:` present. |
| §1.1 failure surface | ✅ | 2–6 steps, five modules (`agent-loop.ts`, `verdict.ts`, `harness.ts`, `prompt.ts`, `completion-review.ts`), a real design call, and a trap that reverts a landed WP if taken. |
| §1.2 product progress | ✅ | Both halves are real open `plan.md` §6 product WPs on the judge path — no scaffolding, no invented utility. |
| §1.3 mission-critical | ✅ PROCEED | Not busy work, not scaffold-hosted: the CM-3 context discipline failing inside the judge's own prompt and journal. |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1 per 3 not approached. |

**AC arming evidence** — the preflight classed **all three ACs VERIFY-SUITE**, so it dry-ran none of them ("the challenge is UNVERIFIABLE pre-launch"). All three were therefore hand-verified in BOTH directions with `dogfood-arm.sh`, and the RED output was read, not just the exit code:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **7s** | ✅ exit 0, **7s** | 6 % |
| AC-2 | ✅ exit **1**, **1s** | ✅ exit 0, **1s** | 1 % |
| AC-3 | ✅ exit **1**, **49s** | ✅ exit 0, **49s** | 41 % |

Worst case **49 s = 41 % of the 120 s judge cap**. The REDs are genuine assertions, not deaths: AC-1 printed `the out-of-rubric concerns section is UNBOUNDED — six accumulated findings rendered one bullet each is **5932 chars**` after its run sealed SUCCESS and its completion review fired; AC-2 printed `the verdict rationale is UNBOUNDED — describe() inlined the raw suite log verbatim (**45190 chars**)`. AC-2's trap-A guard was **re-armed after the first pass showed it RED for the wrong reason** (the brief excerpts the log's tail, so a head-anchored marker never survived) — it is now green on HEAD. Reference implementation (bound the accumulation at the accessor keeping first+last+count; clamp each justification inside `describe()`) reverted **by name from a byte copy**, never `--discard`.

Launch preflight at $0: 🟢 spec lint, env contract, window sizing, disk (13 GiB free), and all 6 agent-class members answered. The spec-pick glob resolved to `dogfood-149-wp616-wp631-bounded-judge-strings.yaml` — the file above.

```sh
devbox run run-dogfood
```
