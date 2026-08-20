# dogfood-161 — the loop now recognises a complaint it has already heard (WP-643)

**WP:** WP-643 (recognise a reworded repeat without a string metric) · **Date:** 2026-08-20 ·
**Spec:** `examples/dogfood/dogfood-161-wp643-same-objection-instrument.yaml` ·
**Run:** `run-eef8a03d-c6b6-4165-9738-d002cef3d56d` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3's rung-5 remainder is WP-304, operator-run)

## Plain lead

The loop used to decide "have I already been told this?" by checking whether the
reviewer had typed the same sentence twice — which reviewers never do — so it kept
handing out fresh repair attempts for one complaint reworded. It now decides on what
the complaint is *about*, and the proof is this run's own transcript: had the new code
been running, the run would have stopped after its second review instead of its fourth.

The run itself sealed **FAILED**, and correctly: the reviewer found a real hole in the
delivered comparator on the last pass, this review reproduced it, and the loop refused
to ship over it. The delivery is a clear improvement and it is **not finished** — it
recognises 2 of 6 restatements of one complaint, and it has given up the one guarantee
the old code had (a "same" answer used to always be right).

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 4 steps · 48m 13s |
| cost | **$0.4229** of $20 budget (**2.1%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced, so every step bills $0.0000 against real metered tokens (F-415, standing) |
| judge | `openai-compat` (`gpt-5.6-sol xhigh`) · 8 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 4 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 **FAIL → re-measured PASS** (a flaky suite test, F-420) |
| harvest | 2/2 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.2k/1.9k | $0.0000 | 9m 16s | ✓ PROCEED (3/3 criteria) |
| 2 | 6.3k/2.2k | $0.0000 | 4m 57s | ✓ PROCEED (3/3 criteria) |
| 3 | 8.2k/2.1k | $0.0000 | 7m 39s | ✓ PROCEED (3/3 criteria) |
| 4 | 10k/0 | $0.0000 | 10m 0s | 🔴 `step killed: exceeded maxSeconds` (F-421) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** — 2, both named by the goal; every out-of-scope surface untouched.

| file | change |
|---|---|
| `packages/sdk-ts/src/workflow/completion-review.ts` | +443/−13: `areMateriallySameObjections` (`:478`) replaced by a profile-extraction comparator; nine hand-authored lexicons; a stemmer at `:147` |
| `packages/sdk-ts/test/runner/completion-review.test.ts` | +254: 13 new cases, incl. five objection pairs the ACs do not name |

Verified untouched by name, as the goal required: the chain mirror
(`src/chain/completion-review.ts`), `src/judge/hermeticity.ts`, `src/heal/gate-repair.ts`,
`src/types.ts`, `src/judge/rubric.ts`. No `any`, no default export, strict ESM. Harvest
byte-identical 2/2.

### The three designed traps were all rejected

| trap | rejected? | evidence |
|---|---|---|
| tune a similarity threshold | ✅ | AC-1 grades both real pairs (Jaccard 0.109 "same" vs 0.077 "different" — overlapping populations); the final comparator carries no scalar cutoff |
| key on the rubric id | ✅ | both AC-1 pairs are `design_serves_overall_goal`; the negative answers `false` |
| leave `MAX_PROGRESS_GRANTS` doing the stopping | ✅ | AC-2's reworded oscillation seals FAILED (resumable) in **3 steps of `max_steps: 6`** — headroom left, so the constant is not what stopped it |

### The independent verification the ACs could not do

The ACs grade the delivery on the two pairs the spec names. That is exactly the fixture
the executor could fit to, and the code reads like fitting: nine keyword sets, a stemmer
with `if (w === "utf8")` special cases, and `FOCUS_SUBJECTS` (`:222`) / `SPECIFIC_ATTRIBUTES`
(`:268`) containing `avatar`, `photo`, `hmac`, `jwt` — vocabulary drawn from the
executor's own invented test cases, not from any real judge. So the question this review
had to answer is whether it works on prose nobody fitted it to.

**It does, at the seam that matters.** This very run produced the ideal unseen fixture:
its four completion reviews (journal `idx` 7, 14, 21, 28) all raise ONE complaint — *the
comparator uses broad lexical shortcuts that can collapse distinct objections* — restated
against different code each pass. Driving them through the real accumulating history
(`packages/sdk-ts/src/workflow/agent-loop.ts:263`, pushed at `:1406`):

| comparator | review #1 | #2 | #3 | #4 |
|---|---|---|---|---|
| shipped byte-equality (what actually ran) | grant | grant | grant | grant → 4 steps, $0.42 |
| delivered instrument (WP-643) | grant | **STOP** | — | — |

That is the F-412 defect measured on a real run and then measured away. It is pinned as a
committed regression test at `packages/sdk-ts/test/runner/completion-review.test.ts:940`,
because a behaviour proved only in a review is not pinned at all (F-356).

**Two real gaps came out of the same probe**, and both are below.

## New friction

### F-416 🟡 — the instrument recognises 2 of 6 restatements of one complaint

Pairwise over this run's four reviews — one complaint, four wordings, ground truth "same"
on all six pairs — `areMateriallySameObjections` answers:

```
#1~#2 true   #1~#3 false  #1~#4 false
#2~#3 true   #2~#4 false  #3~#4 false
```

Review #4's wording matches **none** of its three predecessors. The accumulating history
rescued this particular run (it stops at #2), but recognition is wording-order dependent:
had #4's wording arrived second, nothing would have stopped the run except
`MAX_PROGRESS_GRANTS`, which is the constant WP-643 existed to demote. → **WP-644**.

### F-417 🟡 — soundness is gone: a "same" answer is no longer always right

The comparator WP-643 replaced was *sound* — a `true` was always a genuine repeat. The new
one is not. The judge named a falsifiable counterexample on its final pass, and this review
reproduced it verbatim: two objections on `flushBatchWriter`, one saying it *"drops metadata
on retry"* and one saying it *"loses the checksum on retry"*, share a code entity, the
`LOSS_OR_OMISSION` category and the `retry` condition. Neither `metadata` nor `checksum` is
represented as a distinguishing focus, so `hasSharedFocus && hasSharedMechanism`
(`packages/sdk-ts/src/workflow/completion-review.ts:560`) returns **`true`** on two different
defects.

Measured blast radius on real prose — every `design_serves_overall_goal` failing row across
all 13 journals that have one (26 rows), comparing only pairs from **different runs**, where
the ground truth is unambiguously "different":

| population | pairs | answered "same" | rate |
|---|---|---|---|
| cross-run (ground truth: DIFFERENT) | 298 | 4 | **1.3%** |
| shipped byte-equality, same population | 298 | 0 | 0% |

1.3% is small but it is a *new* failure mode: calling a genuinely new finding a repeat
strands a run that could have healed itself — the spec's own precedence rule 2. → **WP-644**
(same WP: the two gaps pull in opposite directions and must be settled together).

### F-418 🟡 — the loop cannot tell "same wall, new code" from "no progress"

Reviews #1→#4 each named a *different concrete shortcut* in the *then-current* code
(entity-shortcut + 0.30/0.60 cutoffs → shared bigram + 2-token overlap → shared target +
3-token/50% cutoff → shared focus + shared condition). The executor removed each in turn;
the judge confirmed on pass #4 that *"the earlier immediate shared-entity return and numeric
overlap thresholds are absent … clearing those portions of the findings."* The run was
converging.

Yet at the "is this the same objection?" altitude those four are one complaint, and the new
instrument stops at #2. Stopping there would have discarded two passes of genuine repair.
The progress model has no notion of *the objection is the same but the code changed*, so
anti-oscillation and convergence are in direct tension. Recorded, not yet costed. → track-B
note; folded into **WP-644**'s framing.

### F-419 🟡 — a failing acceptance check printed 8 lines and kept none — HAND-FIXED

The phase-0 evidence pack reported `AC-3 FAIL: the DECLARED regression suite is RED (vitest
exited 1)` with `Test Files 1 failed | 203 passed`. **Which** test failed was unrecoverable:
`scripts/dogfood-verify.sh` piped the check's output through `tail -n 8` and persisted
nothing, and vitest prints the failing test's name hundreds of lines above its summary. The
reviewer got the count and not the evidence — on the one gate that decides whether a
delivery lands.

`dogfood-arm.sh` already solved this (`.chikory/review/arm-<spec>-<pass>-<AC>.log`); the
verifier had not. **HAND-FIXED** at `scripts/dogfood-verify.sh:218` — every check's full
output is now written to `.chikory/review/ac-<run-id>-<AC>.log`, the path is printed, and a
red check additionally prints its hoisted failure lines.

### F-420 🟡 — a test in the declared regression suite is flaky

`pnpm --filter @chikory/sdk exec vitest run`, four observations at the same tree:

| observation | result |
|---|---|
| phase-0 pack (12:33) | 🔴 1 failed \| 1778 passed \| 23 skipped |
| re-run 1 (12:35) | 🟢 1779 passed \| 23 skipped |
| re-run 2 (12:37) | 🟢 1779 passed \| 23 skipped |
| re-run 3 (12:38) | 🟢 1779 passed \| 23 skipped |

Same 1802-test total, so it is one flaky test, not a missing file. The name is lost to
F-419; the fix landed this sitting means the next occurrence names itself. The failing
observation is also the only one that ran immediately after two live-Temporal acceptance
checks, which points at a timing-sensitive live test under load. → track-B note.

### F-421 🟡 — step 4 burned the whole 10-minute cap and produced nothing

Step 3's summary opens *"I have initiated the live Temporal runner test suite … in the
background and am waiting for the results."* Step 4 then recorded 10k input tokens, **0
output tokens**, and `step killed: exceeded maxSeconds` after **10m 0s** — 21% of the run's
wall-clock spent waiting on a suite the goal explicitly forbade running inside a step
(*"Do NOT run the full vitest suite inside a step — it does not fit the step time cap"*,
F-345). The instruction is in the goal and the executor crossed it anyway. → track-B note;
the durable fix is F-345's, which remains open.

### F-422 ℹ️ — the constant's docstring still described the code WP-643 replaced — HAND-FIXED

`MAX_PROGRESS_GRANTS` (`packages/sdk-ts/src/workflow/completion-review.ts:38`) carried a
docstring asserting that `areMateriallySameObjections` *"recognises a repeat only when the
judge restates the objection verbatim"* and pointing at WP-643 as future work — in the same
file that now delivers it. **HAND-FIXED**: the comment now states what the constant is
(a backstop, not the bound), cites the measured 2-of-6 and the seam that rescues it, and
points at WP-644.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-416 | 🟡 | recognises 2 of 6 restatements of one complaint; review #4's wording matches none of its predecessors | **→ WP-644 (queued)** |
| F-417 | 🟡 | soundness lost — `flushBatchWriter` metadata-vs-checksum answers "same"; 1.3% false-positive rate on 298 real cross-run pairs (was 0%) | **→ WP-644 (queued)** |
| F-418 | 🟡 | the progress model cannot separate "same wall, new code" from "no progress"; stopping at #2 would have discarded 2 converging passes | **track-B note** (framing folded into WP-644) |
| F-419 | 🟡 | a failing acceptance check printed 8 lines and persisted none — the failing test's name was unrecoverable | **HAND-FIXED THIS SITTING** — `scripts/dogfood-verify.sh:218`, full output to `.chikory/review/ac-<run-id>-<AC>.log` + hoisted failure lines |
| F-420 | 🟡 | one flaky test in the declared suite (1 fail in 4 observations of 1802); name lost to F-419 | **track-B note** |
| F-421 | 🟡 | step 4 killed at the 10m cap with 0 output tokens, waiting on a backgrounded full suite the goal forbade | **track-B note** (durable fix is F-345, open) |
| F-422 | ℹ️ | `MAX_PROGRESS_GRANTS` docstring described the comparator WP-643 replaced | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/completion-review.ts:38` |

Suite after the hand-fixes: **1782 passed / 23 skipped** (was 1767 at the launch commit,
1779 as delivered, +3 from the F-416 regression pin at
`packages/sdk-ts/test/runner/completion-review.test.ts:922`).

## Verdict on the thesis

**The gate worked, end to end, and this is the cleanest instance so far.** The judge did not
merely dislike the design — on its final pass it stated a *falsifiable counterexample* with
concrete inputs (`flushBatchWriter`, metadata vs checksum, on retry), the run refused to seal
over it, and this review ran that exact input through the delivered function and got the
wrong answer back. A model-family-diverse reviewer (executor `gemini`, judge `codex`) found a
defect that three green acceptance checks and thirteen executor-authored tests did not.

**And the delivery is real, proven on data it never saw.** The strongest evidence in this
review is not an acceptance check: it is that the run's own four completion reviews — prose
that did not exist when the code was written — stop the accumulating loop at pass #2 where
the shipped comparator granted all four attempts. That is F-197's "a run cannot exercise the
fix it delivers" answered inside the same review, using the run as its own fixture.

**Standing caution.** The instrument is nine hand-authored keyword lists. It generalised
better than its construction suggests (1.3% false positives on 298 real pairs), but 2-of-6
recall and the loss of soundness say the same thing the judge said four times: lexical
profiling approximates the question rather than answering it. WP-644 should settle both
directions at once, and F-418 says the target is not "better recall" — it is a progress model
that can tell a restated wall from an unmoved one.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 4 steps / 48m 13s | 4 (159–161: 3 · 4 · 4) — held, not advanced |
| kill → resume count | 0 | 0 across 159–161 |
| judge true-positives pre-land | **4** (3 repaired in-run, 1 probe-confirmed unrepaired) | 4 · 2 · 4 over 159–161 |
| meta:product headline ratio | `product` | **0 meta : 3 product** — cap ≤1:3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 exit gate = WP-530 rung-5 (WP-304, operator-run) |

## NEXT RUN

**Make the loop's "I've heard this before" answer one it can defend — right in both directions,
on complaints nobody wrote it for, instead of right on the two examples it was built against.**

- **Spec:** `examples/dogfood/dogfood-162-wp644-defensible-repeat-decision.yaml`
- **WP:** WP-644 (a repeat decision defensible in both directions on prose it was not fitted to) —
  the direct residue of F-416 + F-417, framed by F-418.
- **Why this and not the ladder rung:** §0 reads ✅ PROGRESSING, so the rung does not bind. P3's
  ladder (WP-530, plan.md §7) has rung-5's remaining half = WP-304's OpenHands arm plus a corpus
  wide enough to separate 19 requirements at 95% confidence — a quota-bound, multi-hour benchmark
  the **operator** runs by hand, not expressible as a spec, unchanged since dogfood-139 delivered
  rung-5's other half (WP-303).
- **The designed trap:** widening the lexicons. Adding `metadata` and `checksum` to
  `SPECIFIC_ATTRIBUTES` fixes the judge's counterexample and nothing else. AC-1's negatives use
  **invented identifiers** (`zqflooberWriter`, `wibbleTag`, `frobnitzSeal`) that no keyword list can
  contain, then re-grade every case under a consistent rename to a second invented set and require
  byte-identical answers. Two more graded traps: buying recall with soundness (the 5/6 recall floor
  and the must-stay-different pair are asserted in the same check), and fixing the arrival order
  rather than the recognition (AC-2 permutes the four real wordings so review #4 comes first).

**Gate verdicts:**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ PROGRESSING | max steps 4 vs 2 over the trailing three; rung does not bind, and P3 rung-5's remainder (WP-304) is operator-run and not spec-expressible |
| §1.1 failure surface | ✅ | a competent agent can plausibly fail this — the obvious fix (more words in a list) is rejected by construction, and the recall and soundness floors pull against each other; 1 source file + tests |
| §1.2 product progress | ✅ | landed diff is feature code in `packages/sdk-ts/src/workflow/` serving a real open §6 WP; no scaffolding, no invented utility |
| §1.3 mission-critical | ✅ PROCEED | 🟢 real product WP on the durable-execution pillar — the bound every self-heal budget rests on |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1:3 not busted |

**AC arming evidence** — all three were classed **VERIFY-SUITE** by the preflight (they shell into
`pnpm exec vitest`), so none dry-ran; each was hand-verified in BOTH directions with
`dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s judge cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **3s** | ✅ exit 0, **2s** | 3 % |
| AC-2 | ✅ exit **1**, **6s** | ✅ exit 0, **7s** | 6 % |
| AC-3 | ✅ exit **1**, **90s** | ✅ exit 0, **91s** | **76 %** |

Both REDs print the check's own assertion text, not a died-before-judging signature. AC-1 reports
`#1~#2=true #1~#3=false #1~#4=false #2~#3=true #2~#4=false #3~#4=false: expected 2 to be greater
than or equal to 5`, and the invented-identifier negative merges (`expected true to be false`).
AC-2's live loop ran the **permuted** oscillation to **5 steps** against a required ≤3 — only
`MAX_PROGRESS_GRANTS` stopped it. AC-3 reds on the durability floor at the measured baseline
(`committed suite tests passing: 1782 (floor 1786)`).

The GREEN reference replaced the comparator with a structural rule: align the two word sequences,
and when they share most of their frame while the words they do **not** share are disjoint, they are
one template about two different things — which separates `wibbleTag`/`frobnitzSeal` and email/phone
alike — plus a content-overlap floor for everything else. **Arming caught a real spec hazard**: the
first reference used only a ratio and broke 7 committed tests, all by merging objections that must
stay apart; that is the same trade the spec forbids, found at $0 instead of in a run. The reference
was reverted **by name** from a copy, never with `--discard`.

Preflight green at $0, all 6 agent-class members answered, and the spec-pick glob resolves to this
file.

```sh
devbox run run-dogfood
```
