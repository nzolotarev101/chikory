# dogfood-078 — WP-265 rung-2 CHAIN re-host (WP-508) on WP-250 window-park: the `chikory chain` planner COLLAPSED the decomposable goal into ONE node (horizon missed a 4th time), then the writeSet gate FALSE-FAILED a complete, all-green delivery for writing the very tests its AC demands — chain never reached the rung-2 kill→resume; delivery hand-harvested + verified green

- **WP:** WP-250 — pacing `park` → durable suspend on context-window overflow (the WP-207 act-half follow-up; a direct P2 exit-gate dependency, unblocked by the WP-206 suspend machinery dogfood-077 landed). Hosted here as the **WP-508 chain re-host** of WP-265 rung 2 (≥10 durable step/checkpoint boundaries via decomposition + a live mid-chain `kill -9` → resume).
- **Date:** 2026-07-02
- **Spec:** `examples/dogfood/dogfood-078.yaml` (`dogfood-078-wp250-window-park-durable-suspend`, LOOSE format, ladder-rung 2) — launched with `chikory chain` (WP-508's whole premise). WP-266 loose-AC lint 🟢 at launch; WP-267 launch-mode enforcement held.
- **Run-id:** `chain-6dff03ee-ebcb-4bdb-87b2-7ed7163b1a58-node-wp-250-implementation` (chain-id `chain-6dff03ee-ebcb-4bdb-87b2-7ed7163b1a58`). Runtime HEAD `a698e51`.
- **Terminal state:** 🔴 **FAILED** — but NOT a delivery failure. Judge `✓ PROCEED (1/1 criteria)` @ step 1 (checkpoint `…@4`, `lastGood true`). The chain harness sealed FAILED at handoff: `node wp-250-implementation wrote outside its declared writeSet: packages/sdk-ts/test/cli/chain-control.test.ts, packages/sdk-ts/test/runner/pacing.test.ts`.
- **Landed commit:** none at run time — **delivery hand-harvested to the working tree this review** (8 files, patch from the run workspace `main..HEAD`, byte-clean apply), then re-verified green (see §Harvest). Committed + pushed to origin at review close.

## Trace (single chain node, 1 step, 5m 23s)

```
run chain-6dff03ee-…-node-wp-250-implementation · FAILED · 1 step · $2.80 / $20.00 · 5m 23s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview

 #   step deliverable                                  tokens(in/out)  step$     judge$    verdict            dur / tools
 1   full WP-250 window-park (6 src + 2 test),          2142k/12k       $2.7957   $0.0073   ✓ PROCEED (1/1)    5m13s / 51 tools
     14721-byte diff

totals: 1 decision · 1 judge pass · $2.8030 total (exact sum) · judge $0.0073 (0.3%) · 0 rollbacks · 0 escalations · 0 injections
        budget 14.0% of $20.00 · checkpoint …@4 (lastGood true) · family diversity real (codex/openai ≠ judge gemini via shim)
        peak context window 0% · compact 0 · park 0 · probe/empty-diff step: NONE (F-11 did not recur)
FAILED (handoff): node wrote outside its declared writeSet — test/cli/chain-control.test.ts, test/runner/pacing.test.ts
```

The node's own AC was the reduced planner-derived check **WP-250-LOGIC-COMPILES** (`cd packages/sdk-ts && pnpm exec tsc --noEmit`, exited 0) — NOT the spec's full AC-1/AC-2. The judge PROCEEDED on it (rubric 4/4: `tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`). The FAILED seal came AFTER the judge, at the chain writeSet gate (`activities.ts:1015`).

## What actually happened — two harness defects, in order

1. **The chain planner did NOT decompose.** dogfood-078 was the WP-508 re-host: the whole point (per dogfood-077 F-86) is that the ≥10-step horizon must come from a `chikory chain` splitting a decomposable goal into ≥K sequential nodes, each its own durable run + checkpoint. The WP-250 goal was written to decompose into ≥6 deliverables (pure decision → window-cause journal → workflow wire → operator surface → resume → live test). **The planner produced exactly ONE node — `wp-250-implementation` — and folded the entire feature into it.** So the chain crossed 1 durable checkpoint, not ≥10. **The rung-2 horizon KPI missed a 4TH straight time (075/076/077/078), this time at the PLANNER, not the codex adapter.** → F-88.
2. **The writeSet gate false-FAILED the complete delivery.** That single node's planner-derived `writeSet` was **src-only** — 6 files:
   `src/cli/chain.ts · src/cli/commands.ts · src/index.ts · src/runner/activities.ts · src/runner/pacing.ts · src/workflow/agent-loop.ts`.
   The executor also wrote the two test files the spec's AC-1 explicitly **requires** (`test/cli/chain-control.test.ts`, `test/runner/pacing.test.ts`). The gate (`activities.ts:1015`, `undeclaredWritePaths`) flagged those two as undeclared and sealed the node FAILED — **even though tsc/eslint/the full vitest suite are all green and the judge PROCEEDED.** A goal that says "prove it with a test" is structurally incompatible with a src-only auto-writeSet. → F-89 (🔴 loop-integrity).

Because the node sealed FAILED, the chain never advanced, so **the rung-2 live mid-chain `kill -9` → resume never got a window** (no ≥2 completed nodes to kill between), and **nothing was auto-harvested** (working tree stayed clean).

## Delivery quality (human review of the harvested working tree) — 🟢 COMPLETE + all-green; 🟡 durable behavior only UNIT-proven

Read the full 14721-byte diff line-by-line against the goal's OUTCOME clauses. The feature is real, additive, and correct — the FAILED seal is pure chain-bookkeeping, not a code defect.

| Goal OUTCOME clause | Delivered | ✓ |
|---|---|---|
| A PURE decision separating fold-and-continue `compact` from must-suspend `park` — sibling of `decideContextWindowPacing`, reads only the pacing result, typed + tested | `shouldParkForWindow(decision)` `pacing.ts:127` (`decision.action === "park"`) + barrel re-export `index.ts:133`; 2-case unit test `pacing.test.ts` (park→true, compact→false) | 🟢 |
| On a `park` action the loop durably parks at `status="SUSPENDED"` on a Temporal `condition` (ZERO compute, NOT poll/sleep), journaling a DISTINCT `window` cause; park-check where NO journaled step re-executes on resume | `agent-loop.ts:559` — `if (shouldParkForWindow(pacing))` → `recordBudgetEvent({event:"halt", cause:"window", details:{projectedTokens, remainingTokens, utilizationPercent, atStep}})` → `status="SUSPENDED"` → `await condition(() => resumeRequested \|\| cancelRequested)` → on resume `recordBudgetEvent({event:"top_up", cause:"window"})` → `status="RUNNING"`; placed at loop bottom after step commit | 🟢 |
| `activities.recordBudgetEvent` accepts the new `window` cause additively (WP-218 `usd`/`tokens`, WP-243 `debug`) | `activities.ts:906` `cause?: "usd" \| "tokens" \| "debug" \| "window"` | 🟢 |
| Operator surface (`chikory status`/`--watch`, chain surface) reports the window-park state + an ACTIONABLE unblock hint mirroring the budget top-up | `commands.ts` `followRun` window branch → "run is SUSPENDED for context-window pressure … resume with: chikory resume <id>"; `suspendedReasonFromJournal` + `renderReport`/`cmdStatus` `suspended <reason>` line; `chain.ts:281` `childParkedState` window reason + `unblockHint` → `chikory chain resume <id>` | 🟢 |
| Resume continues a window-parked run to a NORMAL terminal state with the SAME journaled steps, preserving the folded digest | Reuses the existing `resumeRequested` signal path; `top_up` marker clears the park; back to `RUNNING`, no step re-executed | 🟢 |
| REAL behavioral test driving a LIVE Temporal run through the frozen `debug.contextWindowTokens` seam — assert SUSPENDED at zero compute, no advance while parked, resume, ZERO journaled-step re-execution | **NOT delivered** — the two added tests are UNIT-level: `pacing.test.ts` tests the pure `shouldParkForWindow` gate; `chain-control.test.ts` tests `childParkedState` journal parsing. There is NO live Temporal park→resume test. The workflow `condition`-park added at `agent-loop.ts:559` is **untested at runtime.** | 🔴 |
| CONSTRAINTS: strict TS, ESM `.js`, named exports, NO new dep; no `StepRecord`/`JournalEntry`/`decideContextWindowPacing` shape change; don't remove/repurpose `SUSPENDED`/signals/WP-206/WP-243 paths — EXTEND additively | Confirmed additive; `cause` union widened, no shape change; existing signals/operator-suspend/budget-park untouched; no new dep | 🟢 |

- **Scope:** exactly the 8 files the goal entails (6 src + 2 test). No contract-parity churn was needed (the `cause` union widened in place). Clean.
- **Verdict on the delivery:** the window-park control-flow, the `window` journal cause, the operator/chain surfaces, and the resume path are all correctly built and the whole suite is green. **But the spec's PRIMARY thesis artifact — a live Temporal park→resume durable test — is missing;** the durable `condition` park is only unit-adjacent, never exercised end-to-end. **WP-250 → 🟡 (pure + wire + surfaces landed; live durable test owed).**

## Harvest (this review — the operator ask)

The run auto-harvested NOTHING (chain FAILED → clean tree). Hand-harvested this review:
- `git -C <workspace> diff main HEAD` → `wp250.patch` (8 files, 204 insertions / 12 deletions) → `git apply` onto HEAD `a698e51`, byte-clean.
- Re-verified against the working tree (the spec's real AC-2, which the run never ran): **`tsc --noEmit` OK · `eslint .` OK · `vitest run` 🟢 594 passed | 19 skipped (92 files)** — including the WP-123 crash-recovery live-Temporal test (21.9s). AC-1 greps all pass.
- ⚠️ AC-1's `grep -rq 'contextWindowTokens' test/` passes **only because incumbent files** (`test/runner/compaction-wiring.test.ts`, `test/cli/trace.test.ts`) already contain the symbol — NOT because this run added a window-park test. See F-90.

## New friction (highest prior F-87 → F-88, F-89, F-90)

### 🔴 F-88 → WP-509 — the `chikory chain` planner collapsed a deliberately-decomposable goal into ONE node, so the WP-508 chain-hosted-horizon strategy failed at the planner (rung-2 horizon missed a 4th time)
- **Evidence:** dogfood-078's goal was authored (per WP-508) to decompose into ≥6 sequential deliverables; the planner emitted a single node `wp-250-implementation` and folded the whole feature into it (1 durable checkpoint, `…@4`). The chain run directory contains exactly one node dir.
- **Why it matters (blocks the whole rung-2 ladder):** WP-508 is the standing fix for the rung-2 horizon miss — its entire premise is "chain decomposition sources the ≥10 durable checkpoints a single goal can't." If the planner won't actually split a decomposable goal, chain-hosting buys **zero** extra horizon and the ladder is still blocked — now at the planner instead of the codex adapter. Four runs (~$14) have now whiffed rung 2.
- **Fix → WP-509:** make the chain planner decompose — either honor an explicit node list / `min_nodes` in the chain spec, or strengthen the decomposition prompt so a multi-deliverable goal yields ≥K nodes. Sibling of WP-508/WP-219. Until this lands, a chain re-host of rung 2 cannot reach the horizon.

### 🔴 F-89 → WP-510 — the chain writeSet gate FALSE-FAILED a complete, all-green delivery for writing the very test files its AC requires (planner auto-writeSet was src-only)
- **Evidence:** node's declared `writeSet` = 6 `src/` files only; executor also wrote `test/cli/chain-control.test.ts` + `test/runner/pacing.test.ts` (exactly what AC-1 demands: "prove it with a test"); `activities.ts:1015` `undeclaredWritePaths` flagged the two tests → `status:"FAILED"`. Judge had already PROCEEDED; tsc/eslint/full vitest all green on the harvested tree.
- **Why it matters (🔴 loop-integrity):** this is the 4th self-inflicted false-FAILED in the rung-2 series (F-82/F-83 were AC-pin variants; this is the chain-gate variant). A src-only writeSet is fundamentally incompatible with any spec that requires a test — the gate punishes the executor for satisfying the AC. It also compounds F-88: a chain that DID decompose would false-FAIL every node that writes a test.
- **Fix → WP-510:** the planner-derived writeSet must admit the test tree that the node's AC checks reference (derive write globs from the AC `check` paths, or always include `test/**` alongside the src globs), OR the gate must not fail a node whose only "undeclared" writes are test files under a covered package. Land as a normal hand-fix / track-B (TASK-PROTOCOL §4) — it blocks the chain-hosted rung-2 re-host.

### 🟡 F-90 → WP-511 — AC-1's recursive `grep -rq 'contextWindowTokens' test/` false-greens on incumbent files, so a spec that demands a NEW live durable test passes even when that test is absent
- **Evidence:** AC-1 pins the new live window-park test via `grep -rq 'contextWindowTokens' test/` + `grep -rq 'SUSPENDED' test/`. Both match PRE-EXISTING files (`compaction-wiring.test.ts`, `trace.test.ts`, `suspend-resume.test.ts`), so the AC passes with zero new durable test added. This is the F-82/F-83 false-green class at the *recursive-grep-over-the-whole-tree* level: a recursive positive grep can't prove a NET-NEW artifact.
- **Why it matters:** the spec's whole failure surface was "drive a real Temporal park→resume through the frozen seam." A greppable-symbol AC that any incumbent file already satisfies cannot pin a net-new live test — the delivery landed with only unit coverage of the durable park and the AC was none the wiser.
- **Fix → WP-511:** extend the WP-266 loose-AC lint to flag a recursive symbol grep whose symbol ALREADY appears on HEAD in the test tree (require a fresh-file anchor or a `git diff`-scoped grep for net-new-test ACs — the F-45 "new test file must be ABSENT on HEAD" rule made checkable). Separately, WP-250 still OWES its live window-park durable test (a `test/runner/window-park.test.ts` mirroring `suspend-resume.test.ts`/`crash-recovery.test.ts`) — track-B follow-up.

### 🟡 F-58 / WP-249 reinforced — delivery unharvested by the run, no `Run-ID:` trailer
- Same standing pattern: the chain FAILED so nothing landed via `chikory land --verify`; the correct delivery was hand-harvested this review. WP-249 owns it; no new WP.

### ℹ️ Token-economics baseline (WP-203/207 data, no friction)
- One node-step consumed **2,142k input / 12k output** tokens over 51 tool calls for a 14721-byte diff, with **ZERO compaction** (peak window 0%, compact 0, park 0) — consistent with the 077/064 single-step-superlinear-input pattern; a within-step-uncompactable input surface WP-203/204 target.

## KPIs (DOGFOODING §1.4)

| KPI | This run (dogfood-078) | Trailing window / target |
|---|---|---|
| Max horizon survived (durable steps / wall-clock) | **1 step / 5m23s** (chain node) | rung-2 target ≥10 durable checkpoints — **missed 4th straight (075/076/077/078)** |
| Kill→resume count (live at-horizon) | **0** — chain FAILED before ≥2 nodes existed → no kill window | still **0 live**; durable resume unit-proven (WP-123 + `suspend-resume.test.ts` green) |
| Judge true-positives pre-land | 0 (judge PROCEEDED correctly; the seal was the writeSet gate, not the judge) | seam drills excluded per ledger |
| Trailing-3 meta:product headline ratio | 0:3 (075/076/077 all product; 078 product) | target ≤1:3 — 🟢 well under |
| Per-step reliability (runs ≥5 steps) | n/a (1 step) | no ≥5-step run yet — the horizon gap |
| Current ladder rung vs P2 exit gate | **rung 1** (rung 2 still OPEN; blocked by F-88+F-89) | P2 exit gate = 24h brownfield; rungs 2→3→exit still ahead |

## Verdict on the thesis

🔴🟡 **A double harness failure that produced a good, all-green product delivery the loop could not credit — and exposed that the WP-508 "chain buys horizon" fix is itself blocked by the planner.** WP-250 window-park (a real P2 exit-gate dependency) was built correctly and verifies green on the harvested tree, but (a) the chain planner refused to decompose the goal, so rung-2 horizon missed a 4th time — this time at the planner (F-88 → WP-509); (b) the writeSet gate then false-FAILED the complete delivery for writing the tests its own AC demands (F-89 → WP-510, 🔴 loop-integrity); and (c) a recursive-grep AC false-greened over incumbent files, letting the spec's required live durable test go missing (F-90 → WP-511). **The rung-2 chain re-host cannot succeed until WP-509 (planner decomposes) and WP-510 (writeSet admits AC tests) land** — both are hand-fix / track-B loop-integrity work, not new dogfood headlines. The delivery is harvested, verified, and pushed; the durable window-park behavior still owes its live test.
