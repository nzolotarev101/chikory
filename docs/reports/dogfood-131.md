# dogfood-131 — a rejected run now acts on what the human told it (WP-602)

**WP:** WP-602 (a rejected escalation routes the operator's correction into the loop) · **Date:** 2026-08-10 ·
**Spec:** `examples/dogfood/dogfood-131-wp602-reject-routes-to-heal.yaml` ·
**Run:** `run-6b50d3f9-ef17-4ce4-9d45-dbb34422db54` · **Landed:** `d499128` ·
**Ladder:** rung 0 (off-ladder by declaration — P3 rung 5, the phase exit gate, is operator-gated)

## Plain lead

When the quality gate stopped a run and a human answered "no — here is what is wrong",
the system used to throw that sentence away and kill the run. It now hands the sentence
to the agent and lets the run keep going, with a finite number of tries. The delivery is
correct and landed, but the review found the same *class* of hole it just fixed: three
separate channels where a human supplies intent and the system silently drops it.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 3 steps · 40m 15s active (19:43:18 → 20:23:33), then 3h 21m 23s parked awaiting approval |
| cost | **$0.1899** of $20 budget (**0.9%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — unpriced, cost meter blind on the keyless CLI executor (F-299 recurrence, expected) |
| judge | `openai-compat` (codex `gpt-5.6-sol xhigh`) · 4 passes |
| verdicts | rollbacks 0 · escalations 1 · resumes 0 |
| checkpoints | 3 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS (re-run in the working tree — brownfield, harvested delivery) |
| harvest | landed at `d499128`; `rejection-live.test.ts` DIFFERS from the run workspace (review hand-fix, F-301) |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.3k/0 | $0.0000 | 11m 20s | ✓ PROCEED (0/2 criteria) |
| 2 | 3.9k/339 | $0.0000 | 10m 0s | ✓ PROCEED (2/2 criteria) |
| 3 | 4.0k/1.8k | $0.0000 | 1m 13s | ⚠ ESCALATE |

⚠️ Empty-diff probe step 1 — $0 (F-11 recurrence). Steps 1 and 2 were both **killed at the
600 s cap** (`step exceeded maxSeconds=600; killed after 679.8s (1.13× cap)` and
`600.1s (1.00× cap)`) yet step 2's kill still delivered the entire 26,463-byte WP, which the
next judge pass scored 2/2.

## Delivery quality (human review, post-landing)

**Landed files** (`d499128`, 14 files, +436/−40):

| file | what |
|---|---|
| `src/workflow/rejection.ts` (new, 79 L) | `decideRejection` — pure, replay-safe, beside `decideRemediation`/`decideEscalationWait` |
| `src/workflow/agent-loop.ts` | `applyRemediation` + `handleOperatorRejection`; three copies of the heal block collapsed to one |
| `src/workflow/remediation.ts` | `clampBrief` exported so rejection briefs share the 2,000-char bound |
| `src/taskspec.ts` · `schemas.ts` · `types.ts` · `index.ts` | `max_reject_strikes` → `maxRejectStrikes`, public export surface |
| `src/chain/node-spec.ts` | the new field added to both chain-template field lists |
| `test/runner/rejection.test.ts` (new) · `rejection-live.test.ts` (new) · `verdict-gating.test.ts` | 5 unit + 3 live + the converted gating expectations |

**The goal, line by line — all four clauses met:**

- *A reasoned reject heals instead of killing.* `agent-loop.ts:1173-1181` — both reject
  branches call `handleOperatorRejection`, which routes into the **existing** remediation
  path. No second heal mechanism was built; the old inline HALT block was deleted and now
  shares `applyRemediation` (`agent-loop.ts:324-342`).
- *The operator's words reach the agent, intact.* `rejection.ts:44-49` puts the reason in
  the brief verbatim under a `REMEDIATION BRIEF` header, clamped by the shared `clampBrief`.
- *Bounded.* `maxRejectStrikes`, default `DEFAULT_MAX_REJECTION_STRIKES = 1`; `0` restores
  the exact pre-WP-602 dead seal.
- *A reason-less reject still dies.* `rejection.ts:59-64` trims first, so `""`, `undefined`
  and `"   \t\n  "` all seal dead — the naive `reason !== undefined` check would have passed.

**All six designed traps rejected:**

| trap | the wrong delivery | evidence it was avoided |
|---|---|---|
| A | make the dead seal `resumable` and call it done | AC-2 drives a real Temporal run that continues under its own power and seals SUCCESS with no second operator command |
| B | unbounded heal loop | `rejection.ts:66-71` + the live "second reject spends the budget" scenario |
| C | heal a reason-less reject | `.trim()` before the emptiness test; whitespace case covered |
| D | drop the operator's words | the live test asserts a caller-invented marker string reaches the loop **through the journal**, not through an executor summary |
| E | a pure function nothing calls | AC-2 drives the real workflow through the real approve/reject path |
| F | spend a strike on what the agent did not control | `rejectionStrikesSpent` increments only inside `handleOperatorRejection`; infra kills never touch it — **but this was never gated, see F-300** |

**Independent verification of what the ACs took on trust.** The judge escalated at pass #4
precisely because the full-suite and ESLint greens existed only in executor prose. That was a
correct instinct. Re-run by hand in the run workspace before approval:

| check | result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec eslint .` | exit 0 |
| `pnpm exec vitest run` (full) | 1,312 passed · 1 failed · 23 skipped |

The one failure was `test/judge/check-timeout-reap.test.ts:60` — `expected 10990 to be less
than 10000` — a load flake: the same test passes in **1,155 ms** run alone, and the file is
untouched by the delivery.

**Judge behavior.** Checks genuinely executed (`judge-executed check … exited 0` in the AC-1
and AC-2 justifications). Family diversity real: gemini executor vs codex judge. One genuine
true-positive: the pass #3 completion review failed `design_serves_overall_goal` **and**
`cumulative_design_coherent` on two nearly identical rejection blocks in `agent-loop.ts`;
step 3 consolidated them and pass #4 scored both green. That catch is the reason
`applyRemediation` exists at all.

**Scope discipline.** Clean. The only chain-side touch is the new field name added to two
template lists in `node-spec.ts` — the WP-542/543 chain gate-repair path is untouched.

## New friction

### F-300 🔴 — a spec has no channel for a run-scoped judge rubric item, and losing one is silent

`judge:` is a `.strict()` zod object (`packages/sdk-ts/src/taskspec.ts:219-229`) with no
`rubric_extra` key, so **this spec would not parse and the run could not start**. The
operator's only repair was to delete the block, which is what happened — as an uncommitted
working-tree edit, now preserved verbatim here:

```yaml
  rubric_extra:
    - id: heal_budget_measures_agent_control
      description: >
        A reject strike is spent only on something the agent controlled. An infra kill, a step the
        runner killed at maxSeconds, or a verdict later reverted must spend NO strike (WP-544 /
        F-209…F-214). Flag any code path that charges those against the reject budget.
    - id: chain_gate_repair_untouched
      description: >
        The chain-side tier-0 gate repair (WP-542/F-207) and the no-un-sealed-incarnation rule
        (WP-543/F-208) must be untouched. A run-level heal that reroutes or weakens the chain path
        is a regression, however green the run-level tests are.
```

Four compounding defects:

1. **No such field.** Trap F went ungated — the spec text itself says "Not gated by an AC
   this run — but … the rubric should say so." The author knew the right channel and it did
   not exist.
2. **The one field that looks like the channel is inert.** `judge.rubric_packs` parses
   (`taskspec.ts:227` → `taskspec.ts:468` → `schemas.ts:160` → `types.ts:244`) and has
   **zero consumers**. A parsed-but-unread field is worse than an absent one: it reads as
   the documented path.
3. **The loss leaves no trace.** After the deletion the preflight lint printed **all 🟢**.
   Nothing said "you just removed a gate."
4. **Second occurrence.** `bb6025b` performed the same amputation on dogfood-129's top-level
   `rubric:` block. The repair is always *delete the intent*.

The seam for the fix is already clean: `rubric` is an optional parameter defaulting to
`STANDING_RUBRIC` at both consumption points (`src/judge/verdict.ts:55`,
`src/judge/harness.ts:237`). → **WP-604**.

### F-301 🔴 — the acceptance typecheck does not cover test files, so a delivery whose tests do not compile passes green

AC-1 runs `cd packages/sdk-ts && pnpm exec tsc && …`. That compiles the **main** tsconfig
project only. Tests live in a second project, and the repo gate is
`tsc --noEmit && tsc --noEmit -p tsconfig.test.json` (`packages/sdk-ts/package.json`
`typecheck`). The delivery passed three `judge-executed check … exited 0` verdicts and the
executor's own "TypeScript 🟢 Clean" claim while carrying three type errors:

```
test/runner/rejection-live.test.ts(89,44): error TS2353: Object literal may only specify
known properties, and 'judgeWireUrl' does not exist in type
'{ repoUrl: string; cadence?: number | undefined; } & Partial<TaskSpec>'
```

Vitest transpiles without typechecking, so the tests were green too. Caught only by
`dogfood-open.sh`'s harvest gate. The key was **inert** — the judge wire URL reaches the
worker through `routerOptions` (`test/runner/rejection-live.test.ts:64`) — so removing it
changes no behavior. This is the F-274/F-277 family at a new altitude: the AC drove *a*
typechecker, not **the repo's typecheck gate**. HAND-FIXED (three call sites,
`rejection-live.test.ts:89,121,151`; 24 tests green across the three affected files).

### F-302 🟠 — a rejection heal discards work the operator never asked to discard

`applyRemediation` restores `lastGoodCheckpointId` unconditionally
(`packages/sdk-ts/src/workflow/agent-loop.ts:335-341` → `restoreCheckpoint` →
`restoreWorkspaceReposToCheckpoint`, `src/runner/activities.ts:1906-1918`). But
`lastGoodCheckpointId` only advances on **PROCEED with delivered work**
(`agent-loop.ts:990`, the F-211 rule). So when the escalation follows a step that delivered
good work but drew ESCALATE rather than PROCEED, a reasoned reject rolls the workspace back
**past that step**.

This run is the proof: step 3 delivered the 9,908-byte design consolidation the judge had
demanded, drew ESCALATE, and `lastGoodCheckpointId` stayed on step 2's checkpoint `@10`. Had
the operator rejected instead of approved, WP-602's first real use would have destroyed the
work the judge asked for. Right for HALT (the verdict condemned the work), wrong for an
operator correction on a passing verdict — and it contradicts the landed WP-544 doctrine that
the cheapest heal is the one that preserves work. → **WP-605**.

### F-303 🟡 — the strike default was written twice

`rejection.ts:13` exports `DEFAULT_MAX_REJECTION_STRIKES = 1`; `agent-loop.ts:351` used a
literal `?? 1`. Two sources of truth for one policy number. HAND-FIXED — `agent-loop.ts:351`
now consumes the exported constant.

### F-304 🟠 — a step killed at `maxSeconds` leaks an orphaned Temporal dev server

Step 2 launched vitest, whose global setup boots a Temporal dev server; the runner killed the
step at the 600 s cap, so vitest's teardown never ran. `temporal server start-dev --headless
--port 52252` was still alive with `PPID 1` more than three hours later. Every kill-recovered
step that touched the live suite leaks one process and one port. Track-B — the reaper needs a
process-group kill, not a single-pid kill.

### F-305 🟡 — the executor burned two 600 s caps waiting on background tasks it had already finished

Step 2's transcript is nine repetitions of "I have launched `pnpm exec vitest` … I will wait
for it to complete before proceeding" — the gemini executor kept re-announcing background
waits until the cap reaped it, *after* its 26 KB of work was already committed. Step 1 is
worse: 679.8 s for a 52-byte transcript reading `Error: timeout waiting for response` and a
0-byte diff. 21m 20s of the run's 40m active wall clock produced nothing but a provider hang
and a wait loop. Track-B — the ledger records both as FAILED steps, which understates a run
that in fact delivered everything in one of them.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-300 | 🔴 | no channel for a run-scoped judge rubric item; `judge.rubric_packs` parses but has zero consumers; the deletion is silent | → **WP-604** (queued) |
| F-301 | 🔴 | AC typecheck (`pnpm exec tsc`) skips `tsconfig.test.json`, so non-compiling tests pass green | **HAND-FIXED THIS SITTING** — `test/runner/rejection-live.test.ts:89,121,151`; 24 tests green (`rejection`, `rejection-live`, `verdict-gating`) |
| F-302 | 🟠 | a rejection heal rolls back past a delivered-but-ESCALATEd step, destroying work the operator did not object to | → **WP-605** (queued) |
| F-303 | 🟡 | `DEFAULT_MAX_REJECTION_STRIKES` duplicated as a literal `?? 1` | **HAND-FIXED THIS SITTING** — `src/workflow/agent-loop.ts:351` |
| F-304 | 🟠 | a `maxSeconds` kill leaks an orphaned Temporal dev server (pid 86445, port 52252, PPID 1) | track-B note — reaper needs a process-group kill |
| F-305 | 🟡 | executor spends full 600 s caps on background-wait loops and provider hangs; both steps journaled FAILED although one delivered the whole WP | track-B note |

## Verdict on the thesis

The self-correction axis moved: a run can now act on the single richest signal a human can
send it. dogfood-130's own recovery is the counterfactual — an operator wrote a complete
one-command work order into `--reject`, the run sealed dead at $0.11, and the human
re-drove everything by hand. That specific hand-recovery is now unnecessary.

The standing caution is bigger than the WP. F-300 is the **third** instance of one failure
shape on the books, and the other two are already numbered:

| F | intent the human supplied | channel | outcome |
|---|---|---|---|
| F-296 → WP-602 | "no — here is what is wrong" | none (text interpolated into the seal string) | run died; fixed by this run |
| F-298 → WP-603 | steer a branched run | none (`branch` takes no guidance, `inject` needs a live handle) | dogfood-130's branch ran unsteered, journal `injections 0` |
| F-300 → WP-604 | state a run-scoped judge invariant | none (`rubric_extra` unknown, `rubric_packs` inert) | the gate was deleted to launch; trap F shipped ungated |

Every one of them accepts human intent at the interface and drops it without a word. The
long-term posture this review adopts: **a channel that accepts intent and silently discards
it is a defect class, not three separate bugs** — and the loudness fix (say so when intent is
dropped) is worth more than any single channel.

Second caution, unchanged from dogfood-130: cost telemetry reads $0.0000 against 11.2k input
tokens because the keyless CLI executor is unpriced. The budget gate is effectively inert on
executor spend for every dogfood run.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 3 steps / 40m 15s active | 6 steps (dogfood-129) |
| kill → resume count | 0 resumes · **2 in-step kill-recoveries** (both `maxSeconds`) | 0 resumes across trailing 3 |
| judge true-positives pre-land | 1 (completion-review caught duplicated rejection blocks) | 2 · 3 · 1 over dogfood-130/129/125 |
| meta:product headline ratio | 0:1 (product) | 0/3 harness-meta — cap intact |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% — 9 rollbacks / 170 steps, target 99%+ |
| ladder rung vs exit gate | rung 0 (off-ladder, declared) | rung 4 for the trailing 3 — ⚠️ LADDER PACE flagged; P3 exit gate = rung 5 |

## NEXT RUN

**When a run is corrected and tries again, it stops throwing away the last thing it built — unless
the quality gate actually condemned that work.**

- **Spec:** `examples/dogfood/dogfood-132-wp605-heal-preserves-work.yaml`
- **WP:** WP-605 (a heal must not throw away work the human never asked to throw away)
- **Why THIS and not the ladder rung:** the §0 progression verdict is ✅ PROGRESSING with ⚠️ LADDER
  PACE flagged, so the default candidate is P3-rung-5, the phase exit gate — and its two blockers
  are unchanged and still operator-only: `brownfield-001`'s zod v3→v4 gold patch (3–6 h of human
  authoring, no upstream commit to name) and a re-run of both benchmark arms so stored results carry
  `repoRef` (hours of quota that dogfood-122 proved an LLM executor must not supervise). Neither is
  a product gap. WP-605 also beats WP-604 (the F-300 rubric channel) because it is a live
  correctness defect in code landed hours ago: this very run's step 3 would have been WP-602's first
  casualty.
- **The designed trap:** deleting the `restoreCheckpoint` call. It makes the preserve-the-work
  scenario pass instantly and guts WP-519 — a run that HALTed on repeated criterion failures would
  then heal *on top of* the work that failed, compounding it. AC-1 requires a rollback whenever the
  criteria did not all pass, under **both** triggers, and AC-2's second live scenario proves it: the
  condemned step's file must be gone and `rollbackTo` must be journaled. The sibling trap is keying
  the decision on the trigger ("rejects keep, HALTs roll back") instead of on what the verdict said.
- **Gate verdicts:**
  - §0 progression — ✅ PROGRESSING; rung 5 re-measured as operator-gated, reason recorded above.
  - §1.1 failure-surface — ✅ a conditional rollback inside the durable heal path, 2–6 steps,
    cross-file, on the self-correction pillar; the naive delivery is actively harmful.
  - §1.2 product-progress — ✅ real open product WP in `packages/sdk-ts/src/workflow/`, no scaffold.
  - §1.3 mission-critical — ✅ PROCEED (not busy work, not scaffold-hosted).
  - §1.5 friction budget — ✅ `class=product`; trailing-3 harness-meta headlines 0/3, cap intact.
- **AC arming evidence** — both ACs are VERIFY-SUITE, so `scripts/dogfood.sh` will NOT dry-run
  either; both were hand-verified in BOTH directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **3s** | ✅ exit 0, **3s** | 3 % |
| AC-2 | ✅ exit **1**, **10s** | ✅ exit 0, **10s** | 8 % |

  Worst case **10 s = 8 % of the 120 s judge cap**. The throwaway reference
  (`src/workflow/heal-rollback.ts` + the `applyRemediation` wiring) was reverted **by name** —
  `dogfood-arm.sh --discard` runs `git checkout -- .` over the whole tree and would have destroyed
  this review.

```
devbox run run-dogfood
```
