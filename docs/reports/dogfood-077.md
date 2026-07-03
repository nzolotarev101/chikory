# dogfood-077 — WP-206 HITL suspend/resume DELIVERED clean (SUCCESS, all-green, real live durable test) — but codex ONE-SHOT the whole 6-file feature in **1 journaled step**, so the rung-2 ≥10-step horizon AND the live kill→resume were BOTH missed a 3rd straight time; the miss is now proven STRUCTURAL, not a feature-sizing accident

- **WP:** WP-206 — operator-initiated HITL suspend/resume: `chikory suspend <run-id>` durably parks a HEALTHY running run at ZERO compute (Temporal `condition` wait, sibling of the budget-park), status `SUSPENDED` + journaled, resume continues with NO journaled step re-executed. Direct P2 exit-gate dependency. **Intended as the WP-265 rung-2 re-host** (≥10-step at-horizon run + first LIVE `kill -9` → `chikory resume`).
- **Date:** 2026-07-02
- **Spec:** `examples/dogfood/dogfood-077.yaml` (`dogfood-077-wp206-hitl-suspend-resume`, LOOSE format, ladder-rung 2) — single `chikory run`, WP-266 loose-AC lint 🟢 PASS at launch (WP-267 enforcement held). 6th consecutive correct launch mode.
- **Run-id:** `run-d14fb74c-989d-4cce-adad-f37e06b1b3f1`. Runtime HEAD `6540b51`.
- **Terminal state:** 🟢 **SUCCESS** — `✓ PROCEED (2/2 criteria)` @ step 1 (checkpoint `…@4`, `lastGood true`). Clean one-shot; no rollbacks, no escalations, no hung steps.
- **Landed commit:** none — **delivery is STAGED on the working tree, uncommitted, byte-IDENTICAL to the run workspace** (harvest §5: all 13 files IDENTICAL). No `Run-ID:` trailer (standing F-58/WP-249).

## Trace (single run, 1 step, 7m 53s)

```
run run-d14fb74c-… · SUCCESS · 1 step · $3.79 / $30.00 · 7m 53s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)

 #   step deliverable                                   tokens(in/out)  step$     judge$    verdict            dur / tools
 1   full WP-206 suspend/resume (6 src + 1 test +        2901k/15k       $3.7803   $0.0115   ✓ PROCEED (2/2)    7m20s / 51 tools
     3 contract-parity files), 20102-byte diff

totals: 1 decision · 1 judge pass · $3.7918 total (exact sum) · judge $0.0115 (0.3%) · 0 rollbacks · 0 escalations · 0 injections
        budget 12.6% of $30.00 · checkpoint …@4 (lastGood true) · family diversity real (codex/openai ≠ judge gemini via shim)
        peak context window 0% · compact 0 · park 0 · probe/empty-diff step: NONE (F-11 did not recur)
```

The single judge pass ran both ACs as judge-executed checks: **AC-1 (grep bundle for `cmdSuspend`/`suspend` dispatch/`SIGNAL_SUSPEND`/`condition`/`suspend` in runner/`cmdSuspend` in test) exited 0; AC-2 (`tsc --noEmit && eslint . && vitest run`) exited 0** (591 passed | 19 skipped, 92 files, incl. the new live suspend/resume durable test AND the WP-123 crash-recovery test). Rubric 4/4 (`tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`).

## Delivery quality (human review of the staged working tree) — 🟢 COMPLETE, correct, genuinely good code

Read the full 20102-byte diff line-by-line against the goal's OUTCOME clauses. **Every outcome the goal names is delivered.**

| Goal OUTCOME clause | Delivered | ✓ |
|---|---|---|
| `chikory suspend <run-id>` → `cmdSuspend` in `cli/commands.ts` (mirror `cmdCancel`/`cmdInject`: resolve handle → send request → close); missing run-id → nonzero exit; success → ack + exit 0 | `cmdSuspend` `commands.ts:464` — `runner.get(runId)` → `handle.suspend()` → `runner.close()` in `finally`; ack "suspend requested — …parks at the next step boundary" + a `chikory resume` hint; `catch` → `err(...)` + `return 1` | 🟢 |
| `case "suspend"` dispatch + help line in `cli/main.ts` | `main.ts` — import `cmdSuspend`, parse arm `case "suspend"` alongside status/cancel/inject, dispatch `case "suspend"` with `requireArg("run-id")`, help block line | 🟢 |
| durable `SIGNAL_SUSPEND` + `suspendSignal` (`defineSignal`) + `setHandler` in `agent-loop.ts`; park at `status="SUSPENDED"` on a Temporal `condition(...)` (ZERO compute, NOT poll/sleep) until resume clears it → back to `RUNNING`; park-check sits where NO journaled step re-executes on resume; park/unpark journaled | `SIGNAL_SUSPEND`/`SIGNAL_RESUME` `api.ts:15-18`; `suspendSignal`/`resumeSignal` `agent-loop.ts:91-92`; handlers `:150-155`; `parkIfOperatorSuspended()` `:199` = journal `control_event`(suspend) → `status="SUSPENDED"` → `await condition(() => resumeRequested \|\| cancelRequested)` → journal `control_event`(resume) → `status="RUNNING"`; **called at loop TOP `:230`, before the maxSteps check and before step execution** → resume re-executes nothing | 🟢 |
| `RunHandle` suspend sender in `runner.ts` (sibling of approve/inject/cancel, thin signal) | `runner.ts:95` `async suspend() { …getHandle(runId).signal(SIGNAL_SUSPEND) }`; `RunHandle.suspend()` added to the `types.ts:424` interface | 🟢 |
| resume path (extend `chikory resume` OR add a resume signal) → suspended run continues to a NORMAL terminal state with the SAME journaled steps | `runner.resume(runId)` `runner.ts:138` else-branch now signals `SIGNAL_RESUME`; the resume handler is guarded `if (status==="SUSPENDED" && suspendRequested)` so a stray resume on a RUNNING run (e.g. crash-recovery resume) is a **safe no-op** — WP-123 crash-recovery test still green | 🟢 |
| REAL behavioral test driving a LIVE Temporal run (mirror WP-123 / WP-212, NOT mocked); suspend after ≥1 journaled step; assert SUSPENDED + no advance while parked; resume; assert terminal with ZERO re-executed steps (no dup entries / dup spend); reference `cmdSuspend` | `test/runner/suspend-resume.test.ts` (net-new, `skipIf(address===null)`, real worker + `createTemporalRunner`): starts run, waits ≥1 journaled step, calls real `cmdSuspend`, asserts `SUSPENDED`+`currentStep≥1`, `sleep(750)` → asserts step & spend UNCHANGED, `runner.resume`, asserts terminal + `steps.length===5` + indices `[0,1,2,3,4]` unique + `totalCostUsd≈5×0.01` + control_events `[suspend,resume]` | 🟢 |
| CONSTRAINTS: strict TS, ESM `.js`, named exports, NO new dep, no `StepRecord`/`ExecutorAdapter`/`StepInput` change, don't remove/repurpose existing `SUSPENDED`/signals/budget-park — EXTEND additively | Confirmed: purely additive; new `control_event` journal kind synced across **TS `types.ts` + zod `schemas.ts` + py `types.py` + `docs/spec/journal-format.md`** (living-doc parity intact); no new dep; existing signals/budget-park untouched | 🟢 |

- **Scope discipline:** exactly the 13 files the goal entails (6 workflow/runner/CLI src + `index.ts` barrel + `schemas.ts`/`types.ts`/`types.py`/`journal-format.md` contract-parity + the net-new test + `cli.test.ts` help-string update). Nothing out of scope. Harvest §5: all 13 byte-IDENTICAL to the workspace.
- **Verdict on the delivery: WP-206 is functionally DONE and correct.** The park is a genuine zero-compute `condition` wait at the loop boundary; resume re-executes zero journaled steps (proven by the live test's index/spend assertions); the `control_event` audit trail is durable and contract-synced. **WP-206 → 🟢 pending commit.**

## The finding: codex journals ~1 step per clean session → the rung-2 horizon KPI is unreachable by feature-sizing (root cause)

This run was the rung-2 re-host. Rung 2's two un-measured KPIs are **(a) a ≥10-step at-horizon build** (compounding-error / per-step-reliability data) and **(b) the first LIVE `kill -9` → `chikory resume`**. **Both missed again** — and the *why* is now proven structural, not a one-off sizing miss.

- WP-206 is a genuinely bigger feature than WP-213 (13 files vs 6; a full CLI+signal+workflow-park+contract-parity+live-test slice). codex still built the **entire thing in ONE journaled durable step** — 51 internal tool calls, 7m20s, in a single `runStep`/checkpoint.
- **Step count tracks judge-retry rounds, not feature complexity:** dogfood-075 = 3 steps (2 AC-retry rounds), 076 = 4 (2 retries + 2 hung), **077 = 1 (clean one-shot, zero retries)**. A correct one-shot delivery = 1 durable step **no matter how large the feature**.
- **Consequence for the thesis:** 1 durable step = 1 checkpoint. There is no mid-horizon durable state to (a) measure per-step reliability across or (b) kill and resume into. dogfood-076 already flagged WP-213 as "mis-sized as a horizon host" — 077 proves the problem is NOT sizing: **the codex adapter collapses any clean single-goal build into one step**, so "pick a bigger feature" can NEVER reach the ≥10-step rung. The horizon must come from *decomposition* (N sequential goals via `chikory chain`, each its own checkpoint) or a redefined step granularity — not a bigger single goal.

## New friction (highest prior F-85 → F-86, F-87)

### 🟡 F-86 → WP-508 — the WP-265 rung-2 "≥10-step horizon" is unreachable via single-goal feature-sizing; step count = codex judge-retry rounds, not feature size
- **Evidence:** three consecutive rung-2 attempts on progressively larger single-goal features produced **3 / 4 / 1** journaled steps (075/076/077); 077's clean one-shot of a 13-file feature = **1** step. Step count correlates with AC-retry rounds (075: 2, 076: 2+2 hung, 077: 0), not diff size (077's 20102-byte diff was the cleanest AND the fewest steps).
- **Why it matters (plan-integrity, blocks the whole ladder):** the P2 exit gate is a ≥10-step / multi-session / kill→resume horizon. If a single-goal loose spec can never produce more than a handful of durable steps regardless of size, rungs 2–3 and the exit gate are **structurally unreachable by the current "bigger feature" strategy** — three runs and ~$11 have now been spent proving it. The horizon must be sourced from **sequential decomposition** (`chikory chain`: K goals → ≥K durable checkpoints, kill/resume between children — the WP-219 multi-run-chain pillar) or from redefining a "step" as a tool-call/turn boundary the native adapter (WP-213) could journal.
- **Fix → WP-508:** redefine WP-265 rung 2 to be **chain-hosted** — the horizon comes from a decomposed multi-goal `chikory chain` on a real product WP (≥K children so the run crosses ≥10 durable step/checkpoint boundaries), with the deliberate mid-run `kill -9` → `chikory resume` landing BETWEEN children. Update the plan.md §6 ladder text + DOGFOODING §1.1/§1.4 so a "horizon" run is measured in durable checkpoints, and single-goal feature builds are explicitly rung-1-caliber regardless of file count. (This reshapes the ladder; see §5 next-run fork.)

### ℹ️ F-87 — live at-horizon `kill -9` → resume STILL un-captured (3rd cycle); durable resume IS proven at unit level, just not as a live dogfood artifact
- **Evidence:** the run reached SUCCESS in 7m53s / 1 step before any kill window opened (operator confirmed). Shares F-86's root cause (1 step = 1 checkpoint = nothing mid-horizon to kill into). Note the durable-resume *mechanism* is NOT unproven: the net-new `suspend-resume.test.ts` drives a real Temporal suspend→resume with zero-replay assertions, and the WP-123 crash-recovery test is green in this same suite — the gap is specifically the **live operator `kill -9` at horizon**, which needs a run with ≥2 durable checkpoints to be meaningful.
- **WP:** no new WP — the F-86/WP-508 chain re-host is the fix that finally opens a real kill window.

### ℹ️ Token-economics baseline (WP-203/207 data, no friction)
- One step consumed **2,901k input / 15k output** tokens across 51 tool calls for a 20102-byte diff — a **new campaign input high** (prior high: 076 step 1 at 2,232k), and **with ZERO compaction** (peak context window 0%, compact 0, park 0). Codex re-sends the growing transcript each internal tool call → superlinear input growth inside a single durable step the checkpointer can't compact across. This is exactly the context-rot cost surface WP-203/204 target; baseline datapoint.

### 🟡 F-58 / WP-249 reinforced — delivery unharvested, no `Run-ID:` trailer
- Same standing pattern: nothing landed via `chikory land --verify`; the correct delivery sits STAGED-uncommitted, byte-identical to the workspace, no run-id trailer. WP-249's harvest-adoption remainder owns it; no new WP.

## Verdict on the thesis

🟢🟡 **A clean product win that also delivered the clearest possible verdict on the ladder's method.** WP-206 HITL suspend/resume — a real open P2 exit-gate dependency — was BUILT correctly in one shot, all-green, with a genuine live Temporal durable test proving zero-replay resume and a contract-synced `control_event` audit trail (WP-206 → 🟢). The judge behaved (family-diverse, both ACs executed and passed, scope-clean). **But for the third straight rung-2 attempt the two horizon KPIs went un-measured — and 077 proves why it's structural, not bad luck:** codex collapses any clean single-goal build into ONE durable step, so a bigger feature can never buy more horizon. The strategy must change: **rung 2's horizon has to come from `chikory chain` decomposition (K goals → ≥K checkpoints, kill/resume between children), not from a heavier single goal.** That is the F-86 → WP-508 correction, and it is the real deliverable of this cycle.
