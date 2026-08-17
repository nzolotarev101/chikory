# dogfood-149 — nothing the reviewer writes down can grow without a limit (WP-616 + WP-631)

**WP:** WP-616 (bound the verdict rationale) + WP-631 (bound the standing-finding list) · **Date:** 2026-08-17 ·
**Spec:** `examples/dogfood/dogfood-149-wp616-wp631-bounded-judge-strings.yaml` ·
**Run:** `branch-run-f57c3f17-a3d7-4273-b62f-82beb8c63a03-step-5-770afe4b` (a resume-fork of `run-f57c3f17-a3d7-4273-b62f-82beb8c63a03`) · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3's rung-5 remainder is operator-by-hand) vs the P3 exit gate

## Plain lead

The agent fixed both places where Chikory's reviewer could write itself an
essay: a failing test suite's whole 44 KB log no longer rides into the durable
verdict note, and the list of standing objections handed to the final review is
now capped with the oldest and newest kept in full and the number left out
stated out loud. **The run still sealed FAILED — and it failed on a sentence in
its own goal that no program can satisfy.** The goal demanded both "this text is
always under the cap" and "the first and last objections always survive
untruncated"; when those two objections alone are bigger than the cap, one of
them has to give. The judge upheld each half in turn against two successive
deliveries and the executor flipped between them until the budget for repair ran
out. The code is correct, verified independently, and landed; the defect was in
the specification, and this review writes down which half wins.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED — *"completion review: unresolved finding on a converged step — design_serves_overall_goal, escalation_concerns_adjudicated"*, `resumable: true` |
| steps / wall | 3 steps · 10m 48s (fork onward) · **20m 23s** counting the parent's step 0 (19:04:12Z → 19:13:47Z) |
| cost | **$0.2759** of $20 budget (**1.4%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — ⚠️ **cost meter blind**: 19.8k in / 8.1k out across 3 steps metered at $0.00 (subscription-linked, `costEstimated: true`) |
| judge | `openai-compat` → codex `gpt-5.6-sol xhigh` · **5 passes** (3 per-step + 2 completion-review) |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 · all 5 passes PROCEED |
| checkpoints | 3 · injections 0 · pacing peak window **2%** |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS — **all three re-run green by this review against the harvested tree** |
| harvest | **6/6 files byte-IDENTICAL** to the run workspace |
| suite | `pnpm --filter @chikory/sdk exec vitest run` — **191 files / 1,540 tests (1,517 passed \| 23 skipped), 65.12s** after this review's hand-fix, measured by hand (F-342); the harvested delivery alone measured 1,538 (1,515 passed) |

**Per-step:**

| # | journal idx | tokens in/out | cost | wall | diff | verdict |
|---|---|---|---|---|---|---|
| 1 | 1 | 3.9k/2.4k | $0.0000 | 7m 30s | 24,874 B | ✓ PROCEED (3/3 criteria) · `design_serves_overall_goal` ✗ |
| 2 | 7 | 6.3k/3.1k | $0.0000 | 1m 40s | **0 B** | ✓ PROCEED (3/3) then ✓ PROCEED (0/0) · `design_serves_overall_goal` ✓ then ✗ |
| 3 | 14 | 9.6k/2.6k | $0.0000 | 2m 33s | 7,763 B | ✓ PROCEED (3/3) then ✓ PROCEED (0/0) · `design_serves_overall_goal` ✗ + `escalation_concerns_adjudicated` ✗ |

⚠️ **Step 2 is an empty-diff step that claimed completion** — see F-369/F-355 below.
It bought 2 judge passes for **$0.09997 = 36.2% of run spend** and changed nothing.

**Lineage (an operator recovery, not a clean single run):**

| when (UTC) | what |
|---|---|
| 19:04:12 | `run-f57c3f17…` starts (host-read spec, **uncommitted** — see F-372) |
| 19:13:47 | step 0 judged, checkpoint `@5` written — **then the process dies; journal never seals, status stays `RUNNING` to this day** |
| 00:15:10 | `chikory branch …@5` → child `…-step-5-0de6d414`; replays 0–5, logs `branch_fork`, **dies 60s later, also left `RUNNING`** |
| 00:16:13 | `chikory branch …@5` again → child `…-step-5-770afe4b`; steps 1–2 run |
| 00:27:01 | child seals **FAILED** — the only terminal journal of the three |

## Delivery quality (human review, post-landing)

**Landed files** (`git show --stat` equivalent, 6 files, +565/−10 vs `ffd59b6`):

| file | ± | what |
|---|---|---|
| `packages/sdk-ts/src/judge/verdict.ts` | +44/−10 | **Site 1.** `MAX_RATIONALE_ITEM_CHARS` = 512, `MAX_VERDICT_RATIONALE_CHARS` = 4096; `renderRubricItemSummary` (`:48`) takes the status prefix before `:\n` and clamps it; every one of the five `computeVerdict` return sites is wrapped in `clampRationale` (`:62`) |
| `packages/sdk-ts/src/judge/prompt.ts` | +131 | **Site 2.** `MAX_COMPLETION_REVIEW_CONCERNS_CHARS` = 3072 and `renderCompletionReviewConcerns` (`:243`), wired into `renderCompletionReviewScope` (`:348`) |
| `packages/sdk-ts/src/judge/index.ts` | +4 | exports the two constants + the renderer |
| `packages/sdk-ts/test/judge/verdict.test.ts` | +46 | Site-1 unit pins |
| `packages/sdk-ts/test/judge/completion-review-rubric.test.ts` | +94 | Site-2 unit pins (10 → 13 as delivered) |
| `packages/sdk-ts/test/runner/standing-findings-overwrite-live.test.ts` | +256, **−0** | 3 live Temporal tests; the 7 pre-existing settle/overwrite tests untouched |

**Goal, line by line:**

- 🟢 *"the rationale `computeVerdict` returns is BOUNDED regardless of how large a
  justification it was handed, and still names the failing rubric id"* — met.
  Verified independently: a 45,190-char justification yields a rationale ≤ 4096
  that still contains `pre_existing_suite_still_green`.
- 🟢 *"`buildCompletionReviewBrief` must STILL be able to reach the suite's raw
  output"* — met. `describe()` reads the form; the form is untouched. **Trap A
  (bound at the source, a WP-614 revert) rejected.**
- 🟢 *"drives `computeVerdict` itself, the real entry point"* — met; all five
  return branches wrapped, not a helper. **Trap B rejected.**
- 🟢 *"the accumulation handed to the completion review is BOUNDED"* — met, and I
  did not take the ACs' word for it. I wrote a throwaway property test over
  **4,000 randomised shapes** (0–8 findings, 0–6,000 chars each, budgets from 0
  to 4,199 including budgets smaller than the 69-char header) asserting
  `join("\n").length <= maxChars`: **zero violations**. At the real 3072 cap with
  200 findings of ~925 chars, the oldest and newest survive with **both** HEAD
  and TAIL markers and the omission count is printed. Test deleted after use.
- 🟢 *"the prompt says plainly HOW MANY were left out"* — met (`- … [N findings
  omitted]`). **Trap C (silent drop, F-364 again) rejected.**
- 🟡 *"the oldest and the newest findings survive INTACT — both, in full, not
  truncated"* — met in every case where the two endpoints fit the budget;
  **cannot** be met when they do not. This is F-370. **Trap D (per-entry
  truncation that keeps prefixes) rejected for all realistic inputs.**
- 🟢 *"do not invent a parallel second accumulator"* — met; one channel,
  `standingRubricFindings`, bounded at the render site.
- 🟢 *"`standingConcerns` untouched"* / *"settling rule untouched"* — met, and
  AC-3's byte-greps plus the 7 untouched live tests prove it. **Traps E and F
  rejected.**
- 🟢 *"pin your work with tests that live in the repo … cover something the
  grading checks do not"* — met. `test/runner/` **397 → 400**; the added live
  tests cover the two shapes the spec named as deliberately un-graded (an
  under-budget run keeps everything and emits NO notice; a settled id still
  clears completely after the bound is applied).
- 🟢 Scope: 6 files, all named or trivially entailed by the goal. No new
  dependencies. Strict ESM, named exports, no `any`, no clocks or I/O added to
  the workflow path.

**The judge's two objections, adjudicated:**

| pass | objection | true? |
|---|---|---|
| step 0 (idx 3) | *"a single concern is returned intact without any length check, and the overflow path always returns the oldest and newest intact even when those entries alone exceed `maxChars`"* | ✅ **TRUE POSITIVE.** The step-0 code genuinely did not bound those two shapes. The executor's own step-2 diff confirms it. |
| step 2 (idx 17, 20) | *"the oversized-endpoint fallback calls `clampText` on the oldest and newest findings … violating the requirement that omitted-middle cases retain those findings intact and in full"* | ⚠️ **Literally true, and unsatisfiable.** No implementation can be both bounded and endpoint-intact when the endpoints alone exceed the budget. The judge read the goal correctly; the goal was wrong. |

## New friction

### 🔴 F-369 — an empty-diff step launders a live rubric FAILURE into a PASS

**Evidence.** Step 2 (journal idx 7) produced a **0-byte diff**. The per-step
judge is shown that step's diff, so at idx 10 it answered
`design_serves_overall_goal` **PASS** — *"There are no design changes in the
supplied diff to judge adversely"* — and `scope_matches_instruction` PASS —
*"There are no changes in the supplied workspace diff"*. That same rubric row
had **FAILED** one pass earlier (idx 3) and **FAILED** again one pass later (idx
17), for the same function, over the same defect.

**Why it matters.** The per-step rubric history is the loop's only view of
whether an objection is being answered. A step that does nothing writes a PASS
into it. Nothing was lost *this* run — WP-630's `standingRubricFindings` never
clears a model-judged id, so the completion review at idx 13 re-raised the
objection — but the safety came entirely from the accumulator, not from the
judge history. Two live consequences: (a) the FAIL/PASS/FAIL shape is one flip
away from `computeVerdict`'s Rule 5 flip-flop guard reading judge drift where
there was none; (b) an operator reading `chikory trace` sees the objection
apparently resolved at step 2 and re-raised at step 3 with no diff between them.

**Fix shape.** A judge pass over an empty diff should carry forward the previous
pass's answer for model-judged rubric rows rather than scoring them vacuously
green, or be skipped entirely once F-355's classifier exists. → **WP-632**.

### 🔴 F-370 — the goal's own two invariants are mutually exclusive, and no AC probed the boundary

**Evidence.** The goal states, as an absolute: *"No string on the judge evidence
path may be unbounded at the point something renders it"* and *"the accumulation
handed to the completion review is BOUNDED"*. It also states: *"When entries are
left out, the oldest and the newest findings survive INTACT — both, in full, not
truncated"*. When `oldest.length + newest.length + overhead > maxChars`, no
program satisfies both. The run's terminal reason is exactly this collision:
`design_serves_overall_goal, escalation_concerns_adjudicated`.

**Why the oracle did not catch it.** AC-1 — the check that *owns its oracle* and
drives a real 7-pass Temporal run — uses **six findings of ~950 chars against a
3072-char cap**. The two endpoints total ≈1,900 chars, so the base
representation always fits and only the greedy-expansion path is exercised. The
clamp path the judge condemned is **never reached by any acceptance criterion**.
Result: **3/3 ACs green, declared suite green, run FAILED.** This is the
`[[ac-must-enumerate-input-families]]` rule at a new altitude — the ACs
enumerated finding *counts* but not the *size relation between one finding and
the budget*, which is the only variable the contested clause depends on.

**Settled here, not deferred.** The character bound is absolute; the
intact-endpoints rule is conditional on there being room for it. An unbounded
prompt is the defect the function exists to close, so **bounded wins**. Recorded
in the function's docstring (`packages/sdk-ts/src/judge/prompt.ts:236-241`) and
pinned by the F-371 tests below.

**Authoring rule this earns (DOGFOODING §8).** A goal that asserts an absolute
invariant *and* a preservation invariant must state which one wins at their
boundary, and one AC must drive an input where they actually collide. → track-B
note; no WP (the code is right, the specification was not).

### 🟠 F-371 — a clamped finding was silent — HAND-FIXED THIS SITTING

**Evidence.** In the oversized-endpoint fallback the delivery called `clampText`,
which appends a bare `…`. The elision notice reports only how many *whole*
findings were omitted, so a finding whose substance was cut left no trace — the
same harm as F-364 (an objection disappearing before anything adjudicates it),
one level down. The delivered test even encoded the silence:
`expect(lines[1]).toMatch(/^- a+…$/)`.

**Fix.** `clampFinding` (`packages/sdk-ts/src/judge/prompt.ts:200-224`) appends
` … [truncated, N chars omitted]` and falls back to the bare clamp only when the
budget has no room for the notice — the character bound always wins. Used at
both clamp sites (`:262`, `:331-332`).

**Proof.** `packages/sdk-ts/test/judge/completion-review-rubric.test.ts`
**13 → 15 tests**: the announced cut plus the surviving prefix must reconcile to
the whole finding; both clamped endpoints must each announce themselves *and*
keep the omitted-finding notice; a finding that fits is never annotated.
**Probe-verified:** reverting `clampFinding` to `clampText` turns exactly those
2 tests RED and leaves the other 13 green. The 4,000-shape property test still
passes with the notice added.

### 🟡 F-372 — the launch ran an uncommitted spec, and the parent run never sealed

Two halves of one operator-recovery story:

- **Uncommitted spec.** `examples/dogfood/dogfood-149-….yaml` was edited at
  15:03 local — `wp: WP-616+WP-631` → `wp: WP-616` — and launched at 15:04
  without a commit. The persisted `task_json` carries `WP-616`, so the edit is
  what ran, while the spec's own header, goal and README row all still describe
  both WPs. The workspace clones HEAD, so **the run is not reproducible from any
  commit**. DOGFOODING already forbids editing a plan row to appease the
  stale-spec guard; editing the spec's `wp:` field is the same move.
- **Two phantom `RUNNING` journals.** `chikory branch` writes a new child
  journal and leaves the parent's status at `RUNNING` forever; an abandoned
  child does the same. `chikory status` now lists
  `run-f57c3f17…` **RUNNING** and `…-step-5-0de6d414` **RUNNING** — two dead
  runs presented as live — alongside the one that actually sealed. Nothing is
  lost (the audit trail is intact and `branch_fork` records the parentage) but
  the operator's liveness view is wrong.

→ track-B note; the launch discipline half is a rule, not code.

### ℹ️ WP-606 / F-306 recurrence — CLI self-narration still opens every step summary

All three step summaries open with 1–3 lines of *"I have launched the vitest run
for … in the background and will wait for it to complete."* before any content.
That text rides into the next step's prompt, the pacing governor's token
estimate, and the `chikory trace` step title (all three rows of the per-step
table above are titled with it). Already tracked as WP-606 — no new F-n, but
this is the third consecutive run exhibiting it.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-369 | 🔴 | An empty-diff step scores model-judged rubric rows vacuously green, overwriting a live FAIL in the per-step history | **→ WP-632 (queued)** |
| F-370 | 🔴 | The goal demanded a hard bound AND untruncated endpoints — unsatisfiable when the endpoints alone exceed the budget; no AC probed that shape, so 3/3 green sealed FAILED | **track-B note** (precedence settled in-code at `packages/sdk-ts/src/judge/prompt.ts:236-241`; authoring rule → DOGFOODING §8) |
| F-371 | 🟠 | A clamped finding was truncated silently — evidence cut with no notice | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/judge/prompt.ts:200-224`, `completion-review-rubric.test.ts` 13 → **15 tests**, probe-verified RED against a `clampText` revert |
| F-372 | 🟡 | Launched from an uncommitted spec (`wp:` narrowed 1 min before launch); `chikory branch` leaves parent + abandoned child at `RUNNING` forever | **track-B note** |

## Verdict on the thesis

**The judge did its job, and that is the headline.** Its step-0 objection was a
genuine true positive that no acceptance criterion could have caught — the ACs
were 3/3 green on a delivery whose central function did not bound two of its
five input shapes, and the judge named both, by shape, from the diff alone. The
executor then fixed exactly what it named. That is Agent-as-a-Judge working in
the inner loop, on real product code, against an oracle that had already said
yes.

**And the gate held.** Unlike dogfood-148, where the judge caught nothing and
two defects shipped, here an unresolved objection on a converged step produced a
FAILED seal rather than a green one. `escalation_concerns_adjudicated` refused
the delivery, `unattended: seal_resumable_failed` turned that into a terminal
state instead of an overnight park (F-322 honoured), and the work stayed
recoverable. The mechanism this project exists to build behaved correctly.

**The standing caution is now about specifications, not judges.** A judge this
literal is only as good as the goal it is handed. Twice in three runs the
decisive event has been an oracle problem — dogfood-148's ACs passed a defect,
dogfood-149's ACs passed while the goal was self-contradictory. `[[ac-must-not-
contradict-its-goal]]` said a wrong AC beats a correct judge finding; F-370 adds
the sharper case: **a goal that contradicts itself beats both.** The failure is
cheap ($0.28, 1.4% of budget) and the work is intact, but the run is still a
run spent proving that a sentence I wrote could not be satisfied.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | **3 steps / 10m 48s** (20m 23s incl. the parent's step 0) | 3 vs 2 over the prior 3 — first movement in 4 runs |
| kill → resume count | **0 resumes, 2 branch-forks** (the parent died un-sealed; recovered from checkpoint `@5`) | 0 resumes over the trailing 3 |
| judge true-positives pre-land | **1** (the unbounded single/oversized shapes at step 0) + 1 literal-but-unsatisfiable upheld objection | 0 · 0 · 0 over dogfood-146/147/148 |
| meta:product headline ratio | **0:1** (product) | **0/3 harness-meta** over the trailing 3 — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | **rung 0** (off-ladder) | rung 0 over the trailing 3; P3 exit gate needs rung-5, whose remaining half (WP-304 OpenHands arm) is operator-by-hand |

## NEXT RUN

**Make the loop stop scoring a step that changed nothing as if it had proved
something — a step with no diff must not hand the reviewer a fresh clean bill of
health on questions it never looked at, and must not spend the run's repair
attempt.**

- **Spec:** `examples/dogfood/dogfood-150-wp632-empty-step-rubric-carryover.yaml`
- **WP:** WP-632 (an empty-diff step must not vacuously green a rubric row) —
  new row, opened by this review; absorbs the residue of WP-608 (question-step
  classifier) tracked as F-355.
- **Why THIS and not the ladder rung:** §0 reads ⛔ **STALLED**, which binds the
  next headline to the current phase ladder rung. P3's ladder (WP-530) is at
  rung 4; **rung 5's remaining half is `brownfield-001`/WP-304 — a quota-bound,
  multi-hour OpenHands suite the operator runs by hand** (dogfood-122: an LLM
  executor may not supervise it). No spec can headline it, unchanged since
  dogfood-139. Among runnable candidates WP-632 wins because it is 🔴
  loop-integrity found live this run, it sits on the judge-reliability pillar,
  and its two halves (rubric carry-over + not spending the repair attempt) are
  one design decision.
- **The designed trap:** the plausible-but-wrong delivery is *"skip the judge
  pass entirely when the diff is empty."* That silently drops the ACs too — the
  acceptance criteria are re-derived from check exit codes against the **whole
  tree**, not the step diff, so they are still meaningful on an empty step, and
  suppressing them would hide a criterion that went red for reasons outside the
  step. The ACs must be built to reject a delivery that skips the pass, and to
  reject one that carries forward a *machine-settled* row (`tests_pass`) instead
  of only the model-judged ones.

**Gate verdicts** — these are provisional; the spec is not yet written and is
the first task of the next sitting.

| gate | verdict | one line |
|---|---|---|
| §0 progression | ⛔ **STALLED** → 🟡 **ALLOW** | The rung cannot run (operator-by-hand); the candidate is 🔴 loop-integrity found live this run, which §0 permits as the alternative to the rung. |
| §1.1 failure surface | ✅ | 2–4 steps, judge-reliability pillar, cross-file (`agent-loop.ts` + `verdict.ts` + the judge pass dispatch); an agent can plausibly get the carry-over rule backwards. |
| §1.2 product progress | ✅ | Lands in real judge/workflow code on an open plan.md row (WP-632), not scaffolding. |
| §1.3 mission-critical | ✅ **PROCEED** | Not busy work, not scaffold-hosted; hosted by a real WP. |
| §1.5 friction budget | ✅ | `class=product` (primary surface is `packages/sdk-ts/src/`), harness-meta 0/3 over the trailing window — cap not busted. |

**AC arming evidence:** none yet — dogfood-150's spec has not been written, so
no AC has been dry-run in either direction. Arming is the first action of the
next sitting and no launch may precede it. For the record, **dogfood-149's own
arming was clean and is not the reason it failed**: AC-1 RED 7s / GREEN 4s
(genuine RED — it printed its own assertion `5932 > 3072`, and its
anti-vacuity Temporal-substrate test ran and passed, so no dogfood-133-class
dead check), AC-2 RED 1s / GREEN 1s, AC-3 RED 49s / GREEN 49s. **Worst case 49s
= 41% of the 120s judge cap.** All three re-ran green against the harvested
tree during this review. What the arming could not catch was F-370: an AC
verified in both directions still proves nothing about an input family it never
constructs.

```sh
# 1. write examples/dogfood/dogfood-150-wp632-empty-step-rubric-carryover.yaml
# 2. arm it BOTH ways (commit first — a dirty tree makes RED-on-HEAD meaningless):
devbox run -- bash scripts/dogfood-arm.sh examples/dogfood/dogfood-150-wp632-empty-step-rubric-carryover.yaml
devbox run -- bash scripts/dogfood-arm.sh examples/dogfood/dogfood-150-wp632-empty-step-rubric-carryover.yaml --green
devbox run -- bash scripts/dogfood-arm.sh examples/dogfood/dogfood-150-wp632-empty-step-rubric-carryover.yaml --table
# 3. preflight at $0, and confirm the glob resolves to THAT file:
devbox run -- bash -c 'CHIKORY_PREFLIGHT_ONLY=1 bash scripts/dogfood.sh --run'
# 4. launch:
devbox run run-dogfood
```
