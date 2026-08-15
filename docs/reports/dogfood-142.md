# dogfood-142 — a step that stops to ask is no longer a step (WP-608)

**WP:** WP-608 (an asking step must not spend the loop's one repair attempt) · **Date:** 2026-08-15 ·
**Spec:** `examples/dogfood/dogfood-142-wp608-question-step.yaml` ·
**Run:** `run-c857c058-8358-4fc3-a2bc-3fc94a455636` · **Landed:** this review's commit ·
**Ladder:** rung 0 (off-ladder — P3 rung-5's remaining half, WP-304, is operator-by-hand)

## Plain lead

The coding agent built the whole feature correctly in its first step, and the run
still ended in failure — because one of the two grading checks was sabotaged by the
*other* grading check running at the same time in the same folder. Both checks pass
when run one after another, which is how every check had ever been rehearsed. The
feature is good and is landing; the grading harness has a real isolation bug, and
that bug is now the next run.

## Trace

| field | value |
|---|---|
| terminal | 🔴 FAILED · 4 steps · 9m 19s |
| cost | **$0.1846** of $20 budget (**0.9%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — wire cost $0 by design (subscription-linked, `costEstimated: true`); tokens metered, unpriced. Not an F-9 pricing gap. |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 4 passes ($0.0549 / $0.0433 / $0.0418 / $0.0446) |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 · remediations 1 (granted, exhausted) |
| checkpoints | 4 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS — re-run sequentially against the harvested tree, **the opposite of what the judge saw** |
| harvest | byte-**IDENTICAL 6/6** at harvest time; the tree now differs by this review's hand-fixes (below) |
| regression suite | measured at this review: **187 files (185 passed, 2 skipped) / 1495 tests (1472 passed, 23 skipped), 57.58 s** (was 186 / 1488 at dogfood-141; +1 file, +7 tests = the delivery's 6 plus this review's F-353 test) |

**Per-step:**

| # | tokens in/out | diff | cost | wall | verdict |
|---|---|---|---|---|---|
| 1 | 3.2k/1.9k | **11,628 B** | $0.0000 | 3m 31s | ✓ PROCEED (1/2 criteria) |
| 2 | 5.6k/1.5k | 0 B | $0.0000 | 1m 19s | ✓ PROCEED (1/2 criteria) |
| 3 | 7.1k/1.5k | 0 B | $0.0000 | 59s | ⛔ HALT |
| 4 | 8.6k/1.9k | 0 B | $0.0000 | 1m 6s | ⛔ HALT |

⚠️ Three of four steps produced a 0-byte diff (F-11 recurrence, and see F-355).
`toolCalls` was journaled as **0 on every step — including the 11,628-byte one**.

## Delivery quality (human review, post-landing)

Step 1 delivered the entire work package. Steps 2–4 added nothing.

| file | change | verdict |
|---|---|---|
| `packages/sdk-ts/src/workflow/question-step.ts` | new — pure classifier `decideQuestionStep` + the standing-answer constant | 🟢 correct; constant relocated by this review (F-352) |
| `packages/sdk-ts/src/workflow/agent-loop.ts` | +48 — classify BEFORE judging, journal `control_event`, set feedback, checkpoint, compact, `continue` | 🟢 correct placement |
| `packages/sdk-ts/src/executors/prompt.ts` | +2 — the standing answer becomes permanent prompt text (`:68`) | 🟢 (import path fixed, F-352) |
| `packages/sdk-ts/src/index.ts` | +6 — SDK surface exports | 🟢 |
| `packages/sdk-ts/src/runner/activities.ts` | +18/−7 — widened the `control_event` union; `details` now `number \| string` with narrowing at the soak call site | 🟢 additive, replay-safe |
| `packages/sdk-ts/test/runner/question-step.test.ts` | new — 6 unit tests | 🟢 |

**Goal, line by line — all six clauses met:**

- *Named outcome* — `control_event` with `source: "question_step"`, journaled before the judge. ✅
- *Buys no judge pass* — the classifier runs at `agent-loop.ts:1050`, ahead of the cadence/milestone judge call; AC-1 counts journal `judge` entries and requires exactly 1 across ask-then-work. ✅
- *Answers once, verbatim* — `judgeFeedback = STANDING_APPROVAL_ANSWER` re-drives the step; AC-1 asserts the sentence reaches the next `StepInput`. ✅
- *Never spends a bounded repair* — the `continue` skips the completion-review path entirely, so `completionReviewAttempts` does not increment. AC-1 drives review → ask → real fix → SUCCESS. ✅
- *Bounded* — the re-drive consumes a normal `max_steps` slot; AC-1's ask-only script terminates at `maxSteps: 3`. ✅
- *Negative space* — a question-less empty step is judged as before; a real diff is never a question step. ✅

**Traps, independently checked:** A (prompt-only) rejected — the journal event and judge-pass count are pinned. B (every empty diff) rejected. C (condemning the run) rejected — main path reaches SUCCESS. D (eating the repair grant) rejected — the hardest trap, and the delivery passes it. E (re-driving forever) rejected. F (judging the ask anyway) rejected. G (text-sniffing a diff-bearing step) rejected.

**Scope discipline:** 6 files, all named or trivially entailed by the goal. No new dependency, no frozen-contract change, no `benchmarks/` touch. Workflow bundle rebuilds clean (2.05 MB).

**What the judge got right and the run never acted on.** Judge pass #1 failed two rubric items on real defects — a layering violation (`executors→workflow`) and an over-broad classifier — and both were still in the tree at harvest. The run died on an unrelated check before it could repair either. Both are hand-fixed below; this is the fourth consecutive run in which the judge's *design* findings were correct.

## New friction

Continuing the global sequence from **F-346** (dogfood-141).

### F-349 🔴 — a judge-executed check can be failed by its sibling check

The run's cause of death. `packages/sdk-ts/src/judge/evidence.ts:244` runs every
acceptance check **concurrently, in one shared workspace**:

```
const promises = input.criteria.filter(...).map((criterion) => runCheck(...));
const results = await Promise.all(promises);
```

AC-1 writes a transient file `test/runner/ac1-question-step.generated.test.ts`, runs
vitest on it, deletes it. AC-2 runs `pnpm run typecheck` over the **whole package**.
Overlapping, AC-2 typechecks AC-1's transient file and dies:

```
test/runner/ac1-question-step.generated.test.ts(14,56):
  error TS6133: 'FakeJudgeWire' is declared but its value is never read.
```

Recorded verbatim in the run's `test_results` evidence artifact
(`82070b88…`, line 307). AC-2 `exited 2` — a **died** check, not a judged failure —
on all four passes, so `AC-2 failed 3+ consecutive verdicts` fired the goal-drift
HALT and the run sealed FAILED. Reproduced by hand this review: dropping a file with
one unused type import into `test/runner/` makes `pnpm run typecheck` exit 2 with the
identical TS6133; removing it restores exit 0. Sequentially, both ACs pass — which is
exactly what the phase-0 evidence pack found.

The blast radius is every dogfood spec: any AC that shells a whole-tree tool
(`tsc`, `eslint`, the suite) can be failed by any sibling AC that writes a temp file.
A check's verdict must depend on the delivery, not on what a sibling was doing.
**→ WP-623 (queued — headlines dogfood-143).**

### F-350 🟠 — arming proves ACs one at a time, so this class is invisible to it

`scripts/dogfood-arm.sh` runs each check in turn and reports RED-on-HEAD / GREEN.
Both dogfood-142 ACs were armed in both directions and both were honest — under
serial execution. The judge does not execute them serially. The arming pass therefore
cannot, even in principle, catch an interference defect, and dogfood-142 burned
$0.1846 and 9m 19s discovering it live. **→ WP-624 (queued).**

### F-351 🟡 — nothing typechecks the TypeScript an AC generates

The proximate trigger was one unused `type FakeJudgeWire` import in AC-1's generated
source, written into the spec at the dogfood-141 review and never compiled by
anything before the run. AC-generated TypeScript is real TypeScript in a package with
`noUnusedLocals`; it deserves the same lint as hand-written code.
**→ folded into WP-624** (the arming pass is where it would be caught).

### F-352 🔴 — the delivery imported upward: `executors → workflow`

`executors/prompt.ts` imported `STANDING_APPROVAL_ANSWER` from
`workflow/question-step.ts`. `LAYER_ORDER` puts `executors` at index 4 and `workflow`
at 7 (`packages/sdk-ts/src/judge/scan-layering.ts:13`), so this is a lower→higher
edge and the judge's deterministic scan flagged it on pass #1. Both layers legitimately
need the same sentence, so the constant belongs below both.
**HAND-FIXED:** new core-layer module `packages/sdk-ts/src/util/standing-answer.ts:12`;
`executors/prompt.ts:10` and `workflow/agent-loop.ts` import it downward; `index.ts`
re-exports from the new home. Workflow bundle still builds (`./src/util/*.ts 2 modules`).

### F-353 🟠 — "contains a question mark" is not "is asking permission"

`isAskingSummary` short-circuited `if (text.includes("?")) return true;`. A question
step is *never judged*, so this handed a judge-bypass to any final summary containing
a rhetorical, diagnostic or quoted question. The judge raised exactly this on pass #1
("broader than the stated permission-or-approval classification"). The nine
`ASKING_PATTERNS` already carry the whole decision.
**HAND-FIXED:** `packages/sdk-ts/src/workflow/question-step.ts:41` — the blanket `?`
branch is gone; +1 test (`test/runner/question-step.test.ts:39`) pinning two
question-marked non-asks as *not* question steps and one question-mark-free ask as one.
7 tests green.

### F-354 🟡 — the journal called a question a "resume"

The delivery widened the event union to `"suspend" | "resume" | "question"`
(`packages/sdk-ts/src/runner/activities.ts:2395`) and then journaled `event: "resume"`,
leaving `"question"` dead. Existing consumers all filter on `event === "resume" && source === "…"`,
so nothing miscounted today — but `chikory trace` colours by `event`, and a trace reader
would have seen a resume that never happened.
**HAND-FIXED:** `packages/sdk-ts/src/workflow/agent-loop.ts:1058`.

### F-355 🟠 — executor passivity, second form: "I have launched it and am waiting"

WP-608 closes the *ask-permission* half of executor passivity. This run demonstrated
the sibling half, and lost 3 steps / 3m 24s / 0 bytes to it. Step 2's summary opens
*"I have launched the acceptance criteria suite (including AC-1 and AC-2) and am
waiting for the execution to complete."*; step 3's *"I have launched the typecheck
command and will wait for it to complete."* — with `toolCalls: 0` and
`claimsComplete: true` on both. This is not an ask, so the new classifier does not fire
on it; F-345 (dogfood-141, a step that burned its whole 600 s cap waiting on a suite)
is the same family. **→ track-B note on WP-608** — a summary that announces a launched
command and returns no diff and no tool call is a *stall*, and wants the same
named-outcome treatment as an ask. Not headlined: WP-623 outranks it, and the right
fix probably reuses whatever WP-623 settles about check execution.

### F-347 🔴 — the close-out gate ran one script test and called it "full suite green"

`scripts/dogfood-close.sh` gate 4 documented itself as driving "the same commands
`devbox run test` does". `devbox run test` is
`pnpm -r test && … pytest && bash scripts/test-scripts.sh` — the **aggregator** that
runs every `scripts/test-*.sh`. The gate instead ran `bash scripts/test-harvest-chain.sh`
directly, executing **one** script test and skipping the other three. This is the exact
bug `test-scripts.sh` was created to end ("test-dogfood-ac-preflight.sh and
test-dogfood-landed-scope.sh existed but nothing ever ran them" — `scripts/test-scripts.sh:5`).
Consequence: dogfood-141 landed `aafb762` with a commit trailer reading *"full suite
green"* while `scripts/test-dogfood-review.sh` was red (F-348).
**HAND-FIXED:** `scripts/dogfood-close.sh:77` now calls `scripts/test-scripts.sh`, with
the success grep widened to `script tests: ALL PASS`. Verified: `devbox run test` and the
gate now run the same four script tests, all PASS.

### F-348 🔴 — F-346's fix left its own test fixture behind, and HEAD went red

dogfood-141 moved the DOGFOODING status-block anchor from the 🟢/🔴/🟡 body line to the
`**Status (YYYY-MM-DD` header (`scripts/dogfood-docs.mjs:59`) and did not update the
fixture in `scripts/test-dogfood-review.sh`, whose fake doc used the date-less
`**Status (bounded — …`. Four cases went red on HEAD with
`could not locate the block start in docs/DOGFOODING.md`. This review found it the hard
way: `scripts/dogfood-open.sh` harvests through `harvest.sh`, which *does* run the full
`devbox run test`, so **phase 0 refused to open** until it was fixed.
**HAND-FIXED:** fixture dated (`scripts/test-dogfood-review.sh:67`), the replacement
block now carries its own header (`:103`), plus a new assertion that exactly one
`**Status (` header survives a replacement (`:116`) — the stacking regression F-346
itself fixed now has a test. `test-dogfood-review: ALL PASS`.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-349 | 🔴 | Acceptance checks run concurrently in one workspace; a sibling's temp file failed AC-2's typecheck and condemned the run | **→ WP-623 (queued)** — headlines dogfood-143 |
| F-347 | 🔴 | `dogfood-close.sh` gate 4 ran one script test, then committed "full suite green" | **HAND-FIXED THIS SITTING** — `scripts/dogfood-close.sh:77`; 4/4 script tests now run, all PASS |
| F-348 | 🔴 | F-346's anchor change left a stale test fixture; HEAD's suite was red and blocked harvest | **HAND-FIXED THIS SITTING** — `scripts/test-dogfood-review.sh:67,103` +1 stacking assertion (`:116`); `test-dogfood-review: ALL PASS` |
| F-352 | 🔴 | Delivery imported `executors → workflow` (judge caught it; run died before repairing) | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/util/standing-answer.ts:12`; typecheck + 1495-test suite green |
| F-350 | 🟠 | `dogfood-arm.sh` proves ACs serially, so interference is structurally invisible to arming | **→ WP-624 (queued)** |
| F-353 | 🟠 | Any `?` in a summary made an empty step a judge-bypassing question step | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/question-step.ts:41`; +1 test, 7 pass |
| F-355 | 🟠 | Executor announces a launched command and returns no diff and no tool call (3 of 4 steps) | **track-B note** on WP-608 — the stall half of executor passivity |
| F-351 | 🟡 | AC-generated TypeScript is never compiled before the run pays for it | **→ WP-624 (queued)** — folded in |
| F-354 | 🟡 | A question step was journaled as `event: "resume"`; the `"question"` member it added was dead | **HAND-FIXED THIS SITTING** — `packages/sdk-ts/src/workflow/agent-loop.ts:1058` |

## Verdict on the thesis

- **Durable execution: unshaken.** 4 checkpoints, a clean resumable seal, byte-identical
  harvest 6/6. The loop lost nothing.
- **Judge quality: strong, and once again under-served by the harness.** Pass #1 found
  both real design defects in the delivery (F-352, F-353) and both were true positives.
  What condemned the run was not a judgment at all — it was a check that *died*, counted
  as a judged failure three times in a row.
- **Standing caution, sharpened.** dogfood-141's lesson was "a FAILED seal is not
  evidence the delivery is bad". dogfood-142 narrows it: **an exit code from a check is
  not a verdict until you know the check ran.** `exited 2` is the harness's own
  died-before-judging signature — the same signal `dogfood-arm.sh` already treats as
  `⛔ BROKEN CHECK` at arming time — and the judge accepted it as a criterion failure and
  escalated on repetition. The distinction between "your work is wrong" and "the check
  broke" is the whole difference between a gate and a coin flip.
- **Two consecutive runs now condemned by their own gate on correct deliveries**
  (dogfood-141 F-344, dogfood-142 F-349). Different mechanisms, same shape. The judge's
  *findings* keep proving out; its *plumbing* is where the loop is losing runs.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 4 steps / 9m 19s | 4 steps (trailing-3 max, up from 1) |
| kill → resume count | 0 | 0 across trailing-3 |
| judge true-positives pre-land | **2** (F-352 layering, F-353 over-broad classifier) | 3 over trailing-3 (140: 1 · 141: 0 · 142: 2) |
| meta:product headline ratio | product | **0:3** harness-meta over trailing-3 (cap ≤1:3) ✅ |
| per-step reliability (runs ≥5 steps) | n/a (4 steps) | 94.7% — 9 rollbacks / 170 steps, 21 qualifying runs (target 99%+) |
| ladder rung vs exit gate | rung 0 (off-ladder) | P3 stands at rung 4 of 5; rung-5's remaining half (WP-304) is operator-by-hand, not agent-runnable |

## NEXT RUN

**Make a grading check answer only for the work being graded — one check must never be
able to fail because another check happened to be running in the same folder at the
same time.**

- **Spec:** `examples/dogfood/dogfood-143-wp623-check-isolation.yaml`
- **WP:** WP-623 (a judge-executed check is isolated from its siblings) — new, this review.
- **Why THIS and not the ladder rung:** §0 reads ✅ PROGRESSING, so the default candidate
  is the next P3 ladder rung — but P3-rung-5 (EXIT) = WP-303 + WP-304, WP-303 closed in
  dogfood-139, and WP-304 needs the OpenHands arm plus a quota-bound multi-hour corpus the
  operator runs by hand (dogfood-122). No spec can headline it; unchanged since dogfood-140.
  Among runnable candidates WP-623 wins outright: it is the *measured* cause of this run's
  death, it sits in judge code on a thesis pillar, and until it is fixed every future
  dogfood spec carries a live coin flip.
- **The designed trap:** the plausible-but-wrong delivery is **appeasing the symptom** —
  excluding `*.generated.test.ts` from `tsconfig`, or teaching the judge to treat `exit 2`
  as "broken, skip". Both make this run's failure disappear while leaving a check's verdict
  dependent on its siblings. The ACs must drive the real evidence-collection entry point
  with a check pair engineered to interfere, and must also pin the negative: a check that
  is *genuinely* failing still fails, and the per-check timeout is still per-check.
- **Gate verdicts:**
  - §0 progression — ✅ PROGRESSING; ladder rung not runnable (WP-304 operator-by-hand), non-ladder candidate beats it on thesis value.
  - §1.1 failure surface — ✅ 2–6 steps, cross-file, judge-plumbing pillar; the isolation/latency/timeout trade-off is genuinely failable.
  - §1.2 product progress — ✅ landed diff is `packages/sdk-ts/src/judge/`, real product code on the Agent-as-a-Judge pillar. No scaffolding, no carve-out needed.
  - §1.3 mission-critical — ✅ PROCEED. Not busy work: it killed a good delivery this run and threatens every future one.
  - §1.5 friction budget — ✅ `class=product`; trailing-3 harness-meta headlines 0/3, cap ≤1/3 intact.
- **AC arming evidence:** both ACs are VERIFY-SUITE, so the preflight did **not** dry-run
  either; both were hand-verified with `scripts/dogfood-arm.sh` in both directions.

  | AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
  |---|---|---|---|
  | AC-1 | ✅ exit **1**, **12s** | ✅ exit 0, **21s** | 18 % |
  | AC-2 | ⚠️ exit 0 (green-on-HEAD), 7s | ✅ exit 0, 7s | 6 % |

  AC-1's RED is genuine, not a died check: it prints its own assertion text and the two
  failing cases are `expected 1 to be +0` on the observer criterion at **both** call sites
  (`runCriteriaChecks` and `collectEvidence`), while the trap-D and trap-E cases already pass
  on HEAD — exactly the shape the fix must preserve. The GREEN reference was a throwaway
  serialization of both `Promise.all` sites, reverted **by name** from a saved copy
  (never `--discard` — it would delete this review).
  **AC-2 is a non-gating guard, deliberately:** it is `typecheck && eslint` and passes on HEAD.
  Making it RED would mean generating a second TypeScript file while AC-1 holds one and AC-2
  compiles the tree — F-349 itself. Until WP-623 lands, AC-1 carries the whole challenge.
- **F-351 caught live while arming this spec.** The first draft of AC-1's generated test used a
  narrowed helper type, so `.output` in an assertion message failed to compile
  (`error TS2339: Property 'output' does not exist…`) — invisible to vitest, fatal to a
  concurrent `tsc`. It would have killed dogfood-143 by the identical mechanism that killed
  dogfood-142. Fixed in the spec (the helper is typed `CheckRun`), and the generated source now
  compiles clean alongside the whole package. This is the case for WP-624 in one paragraph.

```sh
devbox run run-dogfood
```
