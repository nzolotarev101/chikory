# dogfood-154 — the executor is handed what a failing check SAID, not the script that ran (WP-635)

**WP:** WP-635 (the handover to the next step must carry insight, not bulk; F-384/F-385) · **Date:** 2026-08-18 ·
**Spec:** `examples/dogfood/dogfood-154-wp635-feedback-fits-payload.yaml` ·
**Run:** `run-f7735f50-5c99-4d5a-8cb8-74f84a48f964` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder) — P3 (moat phase) rung-5's remaining half is operator-run, not agent-runnable

## Plain lead

When a check failed, the note handed to the worker was the check's own script
quoted back — thousands of bytes of the question it had already asked — and none
of what the check actually printed. This run fixed that: the worker now gets the
failed assertion and the check author's own one-line explanation. It fixed it in
the right place and then lost it one step later: the 2,000-character channel that
carries the note trims from the **front**, so everything the run had just worked
to put at the **end** was thrown away again. Measured, any check printing 1,890
bytes or more delivered zero diagnosis — and this project's own test suite prints
17,403 bytes when it is entirely green. Fixed by hand here, with five tests, three
of which fail without the fix.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 9m 36s |
| cost | **$0.1335** of $20 budget (**0.7%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — step cost **$0.00 on 7,956 metered tokens**, `costEstimated: true` (CLI-OAuth executor, no price table — known, the WP-218 cost gate working as designed) |
| judge | `openai-compat` · 2 passes · $0.1335 total |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 1 (`@5`, `lastGood: true`) · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 7/7 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 6.3k/1.7k | $0.0000 | 4m 59s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

**Loop integrity:** 1 step · 1 checkpoint (`lastGood`) · 2 judge passes · 1 terminal ·
no duplicate journal entries · no re-executed steps · `git status` clean of workspace
escape (F-192 did not recur).

## Delivery quality (human review, post-landing)

**Landed files** (all 7 byte-identical to the run workspace):

| file | what changed |
|---|---|
| `packages/sdk-ts/src/judge/harness.ts:130` | a check-backed criterion's justification now names the **criterion id** and appends the check's **output**, tail-preserved at `MAX_CHECK_OUTPUT_CHARS`; the command body is gone |
| `packages/sdk-ts/src/workflow/remediation.ts:183` | `withCriterionFeedback` hoisted out of the Temporal workflow module and **exported**, so the composition is finally testable |
| `packages/sdk-ts/src/workflow/agent-loop.ts:1409` | the completion-milestone site **composes** rationale + criteria instead of displacing with `??` |
| `packages/sdk-ts/src/index.ts:389` | `withCriterionFeedback` re-exported |
| `packages/sdk-ts/test/judge/harness.test.ts:462` | 4 unit tests: output-not-command, tail-survives-marked, passing stays compact, killed stays infra |
| `packages/sdk-ts/test/runner/remediation.test.ts:224` | 4 unit tests over the newly-exported composer |
| `packages/sdk-ts/test/runner/agent-loop.test.ts:825` | the **live-loop** Temporal test the goal demanded — a real failing check, its diagnosis asserted in step 2's summary |

**The goal, line by line — what the run got right:**

- ✅ **Part 1 — the payload changed.** `applyCheckOverrides`
  (`packages/sdk-ts/src/judge/harness.ts:130-146`) emits ``judge-executed check `AC-1` exited 1``
  plus the output. The criterion stays identifiable and the exit code stays readable, so
  `test/runner/verdict-gating.test.ts:629`'s `toContain("exited 1")` still holds.
- ✅ **Part 3 — the milestone site composes.** The `??` at the old line 1420 is gone. I checked
  the three non-milestone branches for a silent behaviour change: with `completionMilestone`
  false the new expression is `buildCriterionFeedback(form)`, byte-identical to the old
  `buildCriterionFeedback(form) ?? undefined`. No regression smuggled in.
- ✅ **Trap 1 rejected — silence stays cheap.** A passing check yields exactly
  ``judge-executed check `AC-1` exited 0``; the `!pass` guard means a green check never dumps
  output. Pinned at `test/judge/harness.test.ts:526`.
- ✅ **Trap 2 rejected — a killed check still reads differently.** The `infraFailed` branch keeps
  `DID NOT COMPLETE … infra failure, not a code red` and dumps no partial output, so
  WP-263(b)/F-76/F-79's stuck-criterion classification is intact.
- ✅ **Trap 3 rejected — the `tests_pass` rubric wording did not move.**
  `N/M judge-executed checks failed: <ids>` (`packages/sdk-ts/src/judge/harness.ts:172`)
  is untouched; all four tests pinning it stayed green.
- ✅ **Trap 4 rejected — nothing prints twice.** The composition appends; it does not restate
  the rubric rows the rationale already names.
- ✅ **The bound stayed a named exported constant.** `REMEDIATION_BRIEF_MAX_CHARS = 2000`
  (`packages/sdk-ts/src/workflow/remediation.ts:21`) was not raised — the delivery correctly
  read the spec's warning that a delivery raising it has taken a wrong turn.
- ✅ **The live-loop test exists.** The goal explicitly demanded one case the grading checks
  leave open, and the run wrote it (`test/runner/agent-loop.test.ts:825`), driving
  `echoJudgeFeedback` + `claimsCompleteSteps` over a check that really fails. It is **not**
  confounded by its own fixture (F-383): the asserted marker can only reach step 2's summary
  through the behaviour under test.
- ✅ **Scope discipline.** 7 files, all named or trivially entailed by the goal. No new deps,
  no `any`, no Python mirror touched, no rubric/verdict/pacing/TaskSpec change.

**What the run got wrong — see F-388.** The payload was fixed at the harness and then
destroyed at the channel. Verified independently by driving the real
`applyCheckOverrides` → `buildCriterionFeedback` chain at measured magnitudes; the ACs
never crossed that seam.

**A note on the run's own trace.** This run's three criterion justifications are still
6,494 / 5,392 / 2,462 bytes of quoted command — the run cannot exercise the judge fix it
delivers (F-197). The signature to check next run: a **passing** criterion's justification
should read ``judge-executed check `AC-1` exited 0`` at roughly **40 bytes**, down from 6,494.

## New friction

### F-388 🔴 — the two clamps disagree about which end is the signal, so the diagnosis is deleted anyway

**Defect.** `applyCheckOverrides` deliberately keeps the check output's **tail**
(`packages/sdk-ts/src/judge/harness.ts:137-140`), because the assertion and the author's
`AC-n FAIL: …` sentence are at the end. The channel that actually carries it to the next
step then keeps the **head**: `buildCriterionFeedback` → `clampSections` → `clampBrief`
(`packages/sdk-ts/src/workflow/remediation.ts:46-50`) slices `(0, maxChars - 1)`. The WP's
goal 1 — "the executor's next step must be told what the check SAW" — is therefore not met
in the live loop for any realistic input.

**Evidence** (probe over the real `applyCheckOverrides` + `buildCriterionFeedback`, no mocks):

| check output bytes | justification bytes | justification has the diagnosis | feedback bytes | **feedback has the diagnosis** |
|---|---|---|---|---|
| 1,500 | 1,537 | ✅ assertion + author sentence | 1,614 | ✅ |
| **1,890** | — | ✅ | 2,000 | 🔴 **neither** |
| 3,000 | 3,037 | ✅ | 2,000 | 🔴 **neither** |
| 6,000 | 4,077 | ✅ | 2,000 | 🔴 **neither** |
| 20,000 | 4,078 | ✅ | 2,000 | 🔴 **neither** |

At and above **1,890 bytes** of check output the feedback tail reads
`"…noisy build line that a real check prints\ns…"` — build-banner noise, no assertion, no
author sentence. This is the common case, not a corner: a **fully green**
`pnpm --filter @chikory/sdk exec vitest run` over this suite prints **17,403 bytes**, 9×
past the cliff.

**Why nothing caught it.** The delivery's own live-loop test uses a ~110-byte check output
(`packages/sdk-ts/test/runner/agent-loop.test.ts:828`), 17× below the cliff — the exact
F-384 sizing mistake the spec wrote down as a warning, repeated one seam later. AC-1 owned
its oracle at the harness boundary and stopped there; no AC drove harness → channel. The
judge scored `design_serves_overall_goal` green on "preserves tail diagnostics with an
explicit truncation marker" — true of the changed file, blind to the unchanged consumer
(the F-376/F-380 family: an UNCHANGED file never appears in a diff).

**Disposition: HAND-FIXED THIS SITTING.** `clampSectionKeepingTail`
(`packages/sdk-ts/src/workflow/remediation.ts:166-175`) keeps each section's header line
verbatim and tail-clamps its body behind the same `… [head truncated]` marker the harness
and the judge prompt already use (`packages/sdk-ts/src/judge/prompt.ts:87`), so the executor
can still tell the note is partial. 5 tests at `packages/sdk-ts/test/runner/remediation.test.ts:267`;
**3 fail without the fix**, and the 2 TRAP tests (a section that fits is not marked; the
remediation brief still clamps head-first because its header is its signal) stay green in
both directions. Declared suite: **1588 passed | 23 skipped, 193 files** (1583 before).

**Residual, recorded not fixed:** with several failing criteria at once, tail-clamping the
criteria section keeps the last criterion's diagnosis whole and drops earlier ones. Head-first
kept the first and dropped the last. Per the spec's own precedence rule ("SIGNAL beats
brevity… the END survives") tail is the right default, but per-justification clamping would
beat both. Track-B.

### F-389 🟡 — the 64 KiB collection bound also keeps the head, so a very loud check loses its true tail before the harness sees it

**Defect.** `runCheck` stores `bound(output, 64 * 1024)`
(`packages/sdk-ts/src/judge/evidence.ts:205`), and `bound`
(`packages/sdk-ts/src/judge/evidence.ts:109-112`) slices `(0, maxChars)`. So for a check
printing over 64 KiB, the assertion and the author's sentence are deleted at **collection**
time; the harness then tail-slices a head-slice, and F-388's fix cannot recover what was
never stored. Same defect shape as F-388, one seam earlier.

**Measured reach:** a green full-suite run is 17,403 bytes, so 64 KiB needs roughly 20+
failing test blocks. Real but uncommon — which is why this is 🟡 and not 🔴.

**Disposition: track-B note.** One-line change (`bound` gains a keep-tail mode, or `runCheck`
tail-bounds), but it touches the shared `bound` helper used for diff excerpts where the head
is the signal — the same head-vs-tail judgement F-388 just made, and it deserves its own
diff rather than being smuggled into a review hand-fix.

### F-390 🟠 — 35.2% of the step summary is `file://` URLs into the run's own throwaway workspace

**Defect.** Step 1's summary is 6,634 bytes, of which **2,333 (35.2%)** are 15 absolute
`file:///…/.chikory/runs/run-f7735f50-…/workspace/…` URLs — averaging 155 bytes each to say
what `packages/sdk-ts/src/judge/harness.ts:106-147` says in 42. Every one points into a
directory that is deleted after the run. The summary rides into the next step's prompt **and**
into the pacing governor's token estimate (`packages/sdk-ts/src/workflow/agent-loop.ts:982`),
so this is paid on every step of every multi-step run and then again by any reader of the seal.

**Why it matters now.** dogfood-154's spec rejected WP-606 as "re-measured this review at
5.0% of summary bytes — not headline-sized". That re-measurement counted **CLI telemetry
only** and missed the dominant class. At 35.2% the premise is restored and WP-606 is
headline-sized again. (Self-narration — "I will wait for the test execution to complete" —
is a further 148 bytes / 2.2%, down from F-306's 16%. 3 mojibake bytes where the executor's
`…` was mangled: cosmetic, not tracked.)

**Disposition: → WP-606 (queued, re-premised).** Strip absolute workspace paths from the
summary to repo-relative `file:line` before it is journaled.

### F-391 ℹ️ — `concernSeverities` still has zero live observations, three runs after landing

WP-548 landed the field two runs ago. dogfood-152, dogfood-153 and now dogfood-154 all had
judges that raised **0 concerns** (`concerns: []`, `concernSeverities: []` on both passes),
so the field WP-599 and F-384 were built around has never been populated by a real judge.
F-386 stands unchanged; no new WP. Keep checking each run — this is the F-197 pattern
(a behaviour WP proven only by a later run).

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-388 | 🔴 | the harness keeps the diagnosis tail, the 2,000-char channel then keeps the head — ≥1,890-byte check outputs deliver zero diagnosis | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/remediation.ts:166`, 5 tests at `packages/sdk-ts/test/runner/remediation.test.ts:267` (3 RED without it); suite 1588 passed / 193 files |
| F-389 | 🟡 | the 64 KiB collection bound also keeps the head, deleting the tail before the harness can preserve it | **track-B note** — shared `bound` helper, wants its own diff |
| F-390 | 🟠 | 35.2% of the step summary is absolute run-workspace `file://` URLs, paid into the next prompt and the pacing estimate | **→ WP-606 (queued)** — premise re-measured from 5.0% to 35.2% |
| F-391 | ℹ️ | `concernSeverities` unpopulated by a real judge for a 3rd consecutive run | **track-B note** — F-386 stands, watch next run |

## Verdict on the thesis

- 🟢 **Durable execution held.** 1 step, 1 `lastGood` checkpoint, 2 judge passes, clean seal,
  no resumes, no workspace escape, harvest byte-identical 7/7. The substrate is not the risk.
- 🔴 **Real-time judging missed again — 0 true-positives, 1 shipped defect.** The judge scored
  `design_serves_overall_goal` green on the delivery's tail-preservation without checking the
  consumer of the value it praised. This is now the dominant recorded failure shape
  (F-376 unchanged readers, F-380 reconstructors, and now F-388 an unchanged **clamp**): the
  judge reasons over the diff, and a diff cannot show you the file that did not change.
  Three of the last five reviews found the shipped defect by hand, not by judge.
- 🟡 **The self-correction pillar is the right target and is still not proven end-to-end.**
  WP-635 is the second consecutive WP whose whole value is what the executor is told after a
  failure, and the second consecutive one to ship inert-at-realistic-magnitude before human
  review. The standing caution: **an AC that owns its oracle at one boundary proves nothing
  about the next boundary.** F-384 said "measure the input"; F-388 says "measure the input
  *at every seam it crosses*."
- ℹ️ **Cost stayed trivial** — $0.1335 (0.7% of budget), 100% judge. The executor remains
  unpriced (`costEstimated: true`); the WP-218 gate correctly flags it rather than reporting a
  false $0.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 9m 36s | 3 steps (dogfood-149) over the trailing 8 |
| kill → resume count | 0 | 0 over the trailing 8 |
| judge true-positives pre-land | **0** | 3 over the trailing 8 (149, 151, 152) |
| meta:product headline ratio | 0:1 (product) | **0:3** over the trailing 3 — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | **94.7%** (9 rollbacks / 170 steps, 21 runs ≥5 steps) — target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 (moat phase) stuck at rung 4; rung 5's remaining half is WP-304, operator-run |

## Next run (dogfood-155)

**Target:** WP-606 (a step summary must carry refs that outlive the run; F-390) —
`examples/dogfood/dogfood-155-wp606-summary-carries-usable-refs.yaml`.

**Gate verdicts:** §0 ⛔ STALLED → the rung is binding but unrunnable (P3 rung-5's
remaining half is WP-304's OpenHands arm plus a wider corpus, re-checked against
`plan.md` §7 this review and still operator-run) → 🟡 ALLOW · §1.1 ✅ (cross-file:
the shared executor site plus two consumers in the durable loop) · §1.2 ✅ (real
open `plan.md` §6 WP-606, feature code on the context-rot pillar) · §1.3 ✅ PROCEED
(neither busy work nor scaffold-hosted) · §1.5 ✅ (`class=product`, harness-meta 0/3).

**Arming** — all three ACs are VERIFY-SUITE, so `scripts/dogfood.sh` does not dry-run
them; `scripts/dogfood-arm.sh` ran every one in both directions:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **3s** | ✅ exit 0, **2s** | 3 % |
| AC-2 | ✅ exit **1**, **2s** | ✅ exit 0, **2s** | 2 % |
| AC-3 | ✅ exit **1**, **78s** | ✅ exit 0, **79s** | 66 % |

Every RED printed the check's own assertion text, not a crash. The GREEN pass also
measured the win on the real payload: `run-f7735f50`'s 6,634-byte summary becomes
**4,980 bytes (−1,654, −24.9%)** with **0** absolute paths left. The reference
implementation and its 4 throwaway tests were reverted by name.
