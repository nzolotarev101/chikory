# Plan history — archived status prose

> Append-only archive. The bounded rolling status lives in [`plan.md`](../plan.md);
> per-run detail lives in [`docs/reports/`](reports/). Content below was moved
> verbatim out of the living docs on 2026-07-02 (course correction — plan.md §6).

## Archived 2026-07-09 — displaced by dogfood-092 (`run-4481c735`, WP-251 SUCCESS, live-fold missed 3rd time)

- **dogfood-089 — WP-105 DURABLE-LOOP OTel SPANS, the FIRST GENUINE rung-4 CLIMB (`run-c3a1c54e`, 🟢 SUCCESS · 6 steps, $5.19/$80, 2h50m, uncommitted):** an autonomous `soak`-paced `chikory run` (5 durable parks) landed the durable-loop span tree (live-proven parenting). **ladder rung 3→4 CLIMBED; progression ⛔→✅.** 🟡 F-116 (process-local span-parenting Map).

### F-119 / F-120 / F-121 — CLOSED by dogfood-092, detail moved out of plan.md §6 "Top open friction"

- 🔴 **F-121 → launch preflight (post-091 review 2026-07-08, launch-config silent no-op — FIXED):** dogfood-091's journal proves the "armed" `CHIKORY_CONTEXT_WINDOW_TOKENS=1200000` NEVER reached the workflow — `runs.task_json` carries no `debug` key and every pacing entry's denominator is the 400k gpt-5.5 default (`remainingTokens 397891 = 400000 − 2109`), so the run's whole challenge silently no-op'd. Fix landed: `scripts/dogfood.sh` treats every spec-named `CHIKORY_*` env as a LAUNCH CONTRACT (unset → refuse, exit 4), sanity-checks window scale (≥20k → refuse, F-120), echoes each armed seam with its compact/park thresholds, and gained `CHIKORY_PREFLIGHT_ONLY=1` (all guards, no spend); `dogfood-progression.sh --spec --preflight` executes every non-suite AC check against HEAD (BROKEN check → refuse — catches the F-119 class generically; zero RED-on-HEAD ACs → refuse). Confirmed cured by dogfood-092: the seam reached the workflow (`peak window 115%`, first pacing entry 227+1773=2000).
- 🔴 **F-119 → WP-266 lint (dogfood-091 `run-7fca16bc`, the run-killer, spec-authoring — FIXED):** AC-2 `test "$(grep -rc 'describeCompactionPressure' src/)" -ge 2` is UNSATISFIABLE — `grep -rc <dir>` emits `path:count` per file (multiline) so `test -ge` errors `integer expression expected` → exit 2 on EVERY judge pass → the "AC failed 3+ consecutive → HALT" budget-waste guard guillotined a complete, full-suite-green 4-part delivery. Fix landed: `dogfood-progression.sh` §WP-266 ⛔s any AC piping `grep -c`/`grep -rc` into an arithmetic `test`; sanctioned idiom `grep -roh PAT PATH | wc -l`. Confirmed cured by dogfood-092 (SUCCESS, AC-2 green all passes).
- 🟡 **F-120 → WP-251 re-run (dogfood-091, launch-config):** the real run never folded (`peak window 1% · compact 0`) — `CHIKORY_CONTEXT_WINDOW_TOKENS=1200000` was sized for codex's ≈400k–900k internal tokens, but the pacing window tracks Chikory's ASSEMBLED-CONTEXT tokens (~3k projected) → never crossed the compact band. Fixed via `=2000` in dogfood-092 (`peak 115% · compact 4`). NOTE: sizing was cured but folds still 0 — see F-122 (horizon, not window).

## Archived 2026-07-07 — displaced by dogfood-091 (`run-7fca16bc`, WP-251 false-HALT)

- **dogfood-088 — WP-272 SOAK / TIME-PACED DURABLE RE-ENTRY (`run-eeb0d5d7`, 🟡🟢 FAILED-then-hand-landed · 6 steps, $9.10/$80):** durable Temporal-timer re-entry live-proven; **WP-272 mechanism → 🟢, the ⑦ wall-clock axis UNBLOCKED.** ⚠️ autonomous run false-FAILed on a mis-specified AC (🔴 F-114 type-name AC — mine); hand-landed.

## Archived 2026-07-06 — displaced by dogfood-089 (`run-c3a1c54e`, first rung-4 climb)

Rolled out of the plan.md "Last 3 runs" window when dogfood-089 landed (see `docs/reports/dogfood-089.md`):

- **dogfood-086 — WP-271 CHUNK-SCOPED JUDGE + UNATTENDED-SAFE ESCALATE (`run-88235198`, 🟢 SUCCESS · 4 steps, $5.72):** chunk-scoped judge prompt + `decideEscalationWait`/`UnattendedPolicy`; 4/4 non-hollow, 0 escalations. **WP-271 → 🟢; F-107 CLOSED.**

Displaced verbatim from the DOGFOODING.md status block (was "Latest: dogfood-088"):

> Latest: dogfood-088 — **WP-272 SOAK / TIME-PACED DURABLE RE-ENTRY (the ⑦ rung's WALL-CLOCK unblock)** (`run-eeb0d5d7-9334-47f4-b9ba-c9cb114f14a9`, `docs/reports/dogfood-088.md`). 🟡🟢 **FAILED-then-HAND-LANDED · 6 steps · $9.10/$80 · 28m28s · hand-harvested.** The mechanism is BUILT + LIVE-PROVEN: net-new pure `decideSoakDelay` + `SoakPolicy`; the loop's `soakBeforeNextStep()` runs it under opt-in `spec.soak` → `status="SUSPENDED"` → a durable `sleep(sleepMs)` **Temporal timer** → additive `control_event` `source:"soak"`; + `re-entries N · soak-slept <duration>` telemetry; resume rehydrates `soakState` (+ incidentally `consumedWorkChunks`, the F-108 surface); additive `soak` contract w/ Python parity. LIVE proof (`soak-live.test.ts`): a compressed-soak run durably sleeps between chunks (`>=950ms`), renders `re-entries 1 · soak-slept 1s`, SUCCEEDs unattended. **WP-272 → 🟢; ⑦ wall-clock axis UNBLOCKED. 744 TS + 52 py green.** ⚠️ The autonomous run false-FAILed — a mis-specified AC-2 (🔴 F-114 type-name AC, MINE) tripped the WP-273 chunk-aware Rule-3 HALT at the final chunk; delivery hand-harvested + hand-fixed (🟡 F-115). Rung did NOT autonomously climb — landed by hand.

## Archived 2026-07-04 — displaced by dogfood-083 re-run (`run-03d161e9`, F-101 closure)

Superseded when the dogfood-083 re-run closed F-101 (see `docs/reports/dogfood-083.md` ADDENDUM):

- **(was Top-open-friction / Queue track-B) F-101 latent:** "🟡 F-101 → WP-270-adjacent (NEW, dogfood-083, track-B): the chunk-consumption counter keys on raw `checkpoints.length`, so a ROLLBACK/non-PROCEED chunk step advances the chunk pointer past the reverted chunk (latent — 0 rollbacks this run; self-corrected by the terminal AC gate; consistent with WP-269's floor counter) → count only PROCEED/`lastGood` checkpoints for chunk consumption." Now CLOSED: the re-run replaced `checkpoints.length` with a dedicated `consumedWorkChunks` incremented only on PROCEED + `use_chunk`, plus a `workChunkMilestone` judge-gate and a LIVE scripted-ROLLBACK regression test.

## Archived 2026-07-04 — displaced by dogfood-083

Displaced from the plan.md "Last 3 runs" / "Queue" / "Top open friction" blocks
and the DOGFOODING header when dogfood-083 landed (see `docs/reports/dogfood-083.md`):

- **(was Last-3-runs) dogfood-080** — WP-265 rung-3 attempt on WP-205 branching (`run-233e7d7f`, 🟢 SUCCESS but rung 3 NOT reached — codex ONE-SHOT the 4-part goal; 🔴 F-95 → intra-run horizon is harness-unreachable by goal size). **WP-205 → 🟢.**
- **(was Queue) NEXT HEADLINE ⑤ dogfood-083** — WP-270 PER-STEP WORK-UNIT CHUNKING (`examples/dogfood/dogfood-083.yaml`): opt-in mechanism (successor to WP-269's seal-deferral) handing the executor ONE bounded dependency-ordered sub-goal per durable step so each sealed checkpoint carries real, distinct product progress. DELIVERED (`run-d3879dab`, 🟢 SUCCESS · 3 steps, harvest byte-IDENTICAL) — see report. §1.2 fallback carve-out applied: the NON-hollow horizon was BLOCKED on chunking not existing.
- **(was Top-friction) ℹ️ F-100 → WP-270 (PRE-DECLARED, dogfood-082):** `bounded_work_unit` DEFERS the seal but does not CHUNK the executor's work — dogfood-082 step 1 front-loaded all product code ($4.96/28KB); steps 2–6 sealed real-but-thin test-only checkpoints ($0.27–$0.49), so the intra-run horizon was real but HOLLOW. CLOSED by WP-270 (dogfood-083).

## Archived 2026-07-03 — displaced by dogfood-082

Displaced from the plan.md "Last 3 runs" / "Queue" / "Top open friction" blocks
when dogfood-082 landed (see `docs/reports/dogfood-082.md`):

- **(was Last-3-runs) dogfood-079** — WP-265 rung 2 CHAIN re-host on WP-204 tiered memory (`chain-f4b08133`, 🟢 **SUCCESS · 4/4 nodes — RUNG 2 REACHED**): planner DECOMPOSED into 4 sequential judge-gated nodes (`min_nodes: 4`, WP-509 live), 13 durable checkpoints, survived a **LIVE mid-chain `kill -9` → `chikory chain resume` without re-executing the completed node** — WP-204 DELIVERED + all-green + harvested `9304c68`, **WP-204 → 🟢**.
- **(was Queue) NEXT HEADLINE ⑤ dogfood-082** — WP-265 RUNG-3 HORIZON PROOF on the WP-219 chain residuals: one `chikory run` under `bounded_work_unit: {min_durable_steps: 5}` FORCING ≥5 sealed intra-run durable checkpoints + a deliberate LIVE operator mid-run `kill -9` → `chikory resume`. DELIVERED (`run-ef4824e2`, 6 checkpoints, kill→resume clean) — see report.
- **(was DOGFOODING header) dogfood-081** — WP-265 rung-3 ENABLER = WP-269 intra-run step-forcing (`run-464b7b77`, `docs/reports/dogfood-081.md`). 🟢 SUCCESS · 1 step — the rung-3 blocking dependency (F-95) is now BUILT. A pure total `decideStepForcing(state, policy?)` + opt-in `boundedWorkUnit` policy that DEFERS a premature `claimsComplete` and re-enters `agent-loop.ts` until a durable-step floor is met AND the judge confirms the ACs (contract-additive, no-policy byte-identical); a LIVE Temporal test sealed 3 durable checkpoints under an active policy while no-policy stayed one-shot. One-shot as the spec predicted (ENABLER build, not the proof). 🟡 F-97 → WP-266/511.
- **(was Top-open-friction, resolved/aged out):** ✅ F-88/F-89 → WP-509/WP-510 CLOSED + LIVE-PROVEN (dogfood-079). ✅ F-86/F-87 → WP-508 CLOSED (dogfood-079). 🟡 F-91 → WP-512 (exact-path chain writeSet needed FOUR false-fail fixes → wrong primitive for LOOSE chains). 🟡 F-92 → WP-513 (WP-257 literal floor REVISE-rejects a DECOMPOSED plan). 🟡 F-93 → WP-514 (launch-mode guard false-trips on header COMMENT prose). ℹ️ F-94 (no WP): chain horizon was inter-node; intra-run curve un-measured — now ADDRESSED by dogfood-082 (rung 3) with the F-100 hollow-horizon caveat. 🟡 F-90 → WP-511 (recursive symbol grep false-greens on HEAD). 🟡 F-85 → WP-268 (codex steps ran past the 600s cap). 🟡 F-58 harvest hygiene (WP-249). 🟡 F-79 → WP-263(b) (UNBLOCKED).

## Archived 2026-07-03 — displaced by dogfood-081

Displaced from the plan.md "Last 3 runs" block and the DOGFOODING.md status block
when dogfood-081 landed (see `docs/reports/dogfood-081.md`):

- **(was Last-3-runs) dogfood-078** — WP-265 rung 2 CHAIN re-host on WP-250 window-park (`chain-6dff03ee`, **FAILED** — delivery COMPLETE + all-green, hand-harvested; F-88 → WP-509, F-89 → WP-510; WP-250 → 🟡).
- **(was DOGFOODING header) Latest: dogfood-080** — WP-265 rung-3 (FIRST intra-run horizon attempt) on WP-205 branching (`run-233e7d7f`, `docs/reports/dogfood-080.md`). 🟢 **SUCCESS but RUNG 3 NOT REACHED — the decisive negative result.** WP-205 branching landed COMPLETE (`cmdBranch` + `forkRunAtCheckpoint` journal fork through the checkpoint + `branch_fork` provenance + git-worktree at the checkpoint commit + an additive `"BRANCH"` verdict with ROLLBACK still first + a LIVE Temporal proof); all-green (629 passed), scope-clean, byte-IDENTICAL to the workspace (uncommitted). BUT codex ONE-SHOT the deliberately 4-part decomposed goal in a SINGLE 57-tool-call step (the "2 steps" = 1 attempt + 1 accidental 600s step-cap auto-retry on a hanging live test); no operator kill→resume fired. 🔴 F-95: the intra-run horizon is UNREACHABLE by goal size (dogfood-077/079/080 all one-shot) — must be HARNESS-FORCED → WP-269 step-forcing (delivered dogfood-081). 🟡 F-96 → WP-515 (killed step reported `$0.00/0 tokens`; ℹ️ same kill proved WP-268's hard cap holds at 1.00×).

## Archived 2026-07-03 — displaced by dogfood-080

Displaced from the plan.md "Last 3 runs" block and the DOGFOODING.md status block
when dogfood-080 landed (see `docs/reports/dogfood-080.md`):

- **(was Last-3-runs) dogfood-077** — WP-265 rung 2: WP-206 HITL suspend/resume (`run-d14fb74c`, 🟢 **SUCCESS**, WP-206 → 🟢; but codex ONE-SHOT the 13-file feature in 1 step so horizon+kill→resume missed a 3rd time, 🟡 F-86 → WP-508).
- **(was DOGFOODING header) Latest: dogfood-079** — WP-265 rung-2 CHAIN re-host (WP-508) on WP-204 tiered memory (`chain-f4b08133`, `docs/reports/dogfood-079.md`). 🟢 **SUCCESS · 4/4 nodes — RUNG 2 REACHED (1st time, after 4 misses).** The `chikory chain` planner DECOMPOSED WP-204 into 4 sequential judge-gated nodes (`min_nodes: 4` — WP-509 live), crossed **13 durable checkpoints**, and survived the FIRST live at-horizon mid-chain `kill -9` → `chikory chain resume` WITHOUT re-executing the completed node (core seal ts `12:18:20.307` byte-identical + $1.01 unchanged post-resume = journal replay, not re-run). WP-204 tiered memory (core/archival/recall + provenance-reject) DELIVERED, all-green (621 passed), harvested `9304c68`, pushed → **WP-204/WP-508 → 🟢.** Cost: WP-510 needed FOUR writeSet false-fail fixes (🟡 F-91 → WP-512); the WP-257 literal floor REVISE-rejected the decomposed plan (🟡 F-92 → WP-513); the launch-guard false-tripped on a header comment (🟡 F-93 → WP-514) — all harness-meta track-B. ℹ️ F-94: each node one-shot in 1 step → horizon was inter-node; the intra-run ≥5-step reliability curve is still owed (rung 3).

## Archived 2026-07-03 — DOGFOODING.md status block displaced by dogfood-079

Displaced from the DOGFOODING.md bounded status block when dogfood-079 landed
(see `docs/reports/dogfood-079.md`):

- Latest: dogfood-078 — WP-265 rung-2 CHAIN re-host (WP-508) on WP-250 window-park (`chain-6dff03ee`, `docs/reports/dogfood-078.md`). 🔴 **FAILED — but NOT a delivery failure; two harness defects.** The WP-250 window-park feature was BUILT correctly + all-green (pure `shouldParkForWindow` → `agent-loop.ts:559` `condition`-park at `SUSPENDED` with a distinct `cause:"window"`, operator/chain surfaces + resume; suite 594 passed), hand-HARVESTED + PUSHED. But (1) 🔴 **F-88 → WP-509:** the `chikory chain` planner COLLAPSED the decomposable goal into ONE node → rung-2 ≥10-step horizon missed a 4th time, now at the PLANNER; (2) 🔴 **F-89 → WP-510:** the writeSet gate FALSE-FAILED the delivery for writing the two test files its AC requires (planner auto-writeSet was src-only) — judge had PROCEEDED, suite all-green. 🟡 **F-90 → WP-511:** AC-1's recursive `grep -rq contextWindowTokens test/` false-greened on incumbent files, so the spec's required LIVE durable window-park test went missing (WP-250 → 🟡, owes it).

## Archived 2026-07-03 — plan.md §preamble status prose displaced by dogfood-079

Displaced from the "Last 3 runs" bounded block when dogfood-079 landed
(see `docs/reports/dogfood-079.md`):

- **(was Last-3-runs) dogfood-076** — WP-265 rung 2 attempt: WP-213 native executor (`run-17a57451`, **FAILED** — native adapter BUILT + all-green@step2 but SECOND consecutive loose false-FAILED, 🔴 F-83 → WP-266 LANDED).

## Archived 2026-07-02 — plan.md §preamble status prose displaced by dogfood-077

Displaced from the "Last 3 runs" / "Queue" bounded block when dogfood-077 landed
(see `docs/reports/dogfood-077.md`):

- **(was Last-3-runs) dogfood-074** — WP-264 judge-check tree-reap (`run-6063231c`, SUCCESS, WP-264 → 🟢, LAST prescribed headline).
- **(was Queue) NEXT HEADLINE dogfood-077 = WP-265 rung 2 (re-attempt), HOST = WP-206 HITL suspend/resume** (spec ready, WP-266 lint 🟢) — ≥10-step LOOSE run building `chikory suspend <run-id>` + deliberate mid-run `kill -9` → `chikory resume`. **Outcome:** WP-206 DELIVERED clean (SUCCESS, WP-206 → 🟢) but codex one-shot it in 1 step → rung-2 horizon + kill→resume missed a 3rd time (F-86 → WP-508: rung 2 must be chain-hosted).

## Archived 2026-07-02 — DOGFOODING.md header status block displaced by dogfood-077

> Was the "Latest: dogfood-076" bounded status block in `docs/DOGFOODING.md`.

Latest: dogfood-076 — WP-265 rung-2 attempt on WP-213 native executor (`run-17a57451`). The native
raw-LLM loop executor (`createNativeAdapter`) was BUILT well and all-green at step 2 (WP-213 effectively
done) but UNHARVESTED. The run sealed FAILED on a self-inflicted AC (the 2nd loose headline in a row):
AC-1's `! grep -Eq 'execFile|spawn' native.ts` matched the doc comment "…is spawned" → false-FAILED →
budget-waste HALT. 🔴 F-83 → WP-266 (loose-AC lint) FIXED; 🔴 F-84 → WP-267 (enforce at launch); 🟡 F-85
→ WP-268 (codex steps ran 1.76×/1.98× past the 600s cap). Rung-2 ≥10-step horizon + live kill→resume
KPIs remained UN-measured (build was ~2 steps; run auto-terminated before the operator's kill).

## Archived 2026-07-02 — plan.md §preamble status prose displaced by dogfood-076

Displaced from the "Last 3 runs" / "Queue" / "Top open friction" bounded block when
dogfood-076 landed (see `docs/reports/dogfood-076.md`):

- **(was Last-3-runs) dogfood-073** — WP-233(b) notice renderer + wire (`run-a5f8c5fe`, F-78 → WP-264).
- **(was Queue ①/②)** ① dogfood-075 = WP-265 rung 1 (loose WP-212 `chikory inject`) ✅ DONE-with-caveat (`run-bb715500`, sealed FAILED on the AC-1 filename-pin but delivery COMPLETE + live-proven; WP-212 → 🟢, 3 files staged uncommitted). → ② hand-fix F-82 first (track-B): the loose-spec AC lint (WP-266) so a mis-authored loose AC can't false-FAIL a correct delivery at rung-2's ≥10-step / ~$15–40 scale. **[NOTE: item ② was SKIPPED — WP-266 was not built before rung 2 launched; dogfood-076 then hit the exact class it guards → F-84 → WP-267.]**
- **(was Top-open-friction) F-82 → WP-266 (dogfood-075):** a LOOSE-spec AC must anchor on OUTCOME symbols the goal names, never pin file layout the goal delegates — AC-1's `test -f test/cli/inject.test.ts` false-FAILED a complete `chikory inject`; fix = loose-AC lint in `scripts/dogfood-progression.sh --spec`. **[CLOSED 2026-07-02 dogfood-076 review — lint landed; extended to cover F-83 bare-word negative greps too.]**

## Archived 2026-07-02 — plan.md preamble status prose (was plan.md lines 7–156)

**Current status (2026-07-01, latest — dogfood-073 LANDED WP-233(b) part 1: the plan-gate failure NOTICE RENDERER + `planAndGateChain` consumer WIRE (the F-33 operator-facing fix — a non-PROCEED plan-gate verdict now renders "plan gate could not reach the meta-judge — INFRA fault, SAFE to re-run: …" vs "plan gate REJECTED the plan — NOT safe to re-run as-is: …", raw-rationale fallback when the classifier returns null; the dogfood-072 classifier's F-65-shaped orphan risk killed). `run-a5f8c5fe-26f8-4d33-b94b-b676039d6a8c` (single `chikory run`, 2nd consecutive correct launch), runtime `008d3fd`, SUCCESS 1 step · $0.75/$5 (15.0%) · judge 1.3% · PROCEED 2/2 · 548k/5.3k tokens · 2m54s · `docs/reports/dogfood-073.md`; 4 files STAGED uncommitted byte-IDENTICAL (`src/chain/plan-gate-notice.ts` +15, `src/cli/chain.ts` +5/−1, `src/index.ts` +1, `test/chain/plan-gate-notice.test.ts` +61); AC re-run green (12 grep-pins + scoped vitest 3 passed; tsc+eslint + full suite 574 passed | 19 skipped); spec-faithful, zero F-64 drift. **🔴 F-78 → WP-264 (review post-mortem of dogfood-072's step-1 AC-2 artifact): the judge-check runner's 120s timeout does NOT reap the check's process tree — `runCheck` (`src/judge/evidence.ts:76`) uses `execFileAsync` whose `timeout` kills only the direct `/bin/sh`; 072's post-kill AC-2 ran 695.9s = 5.8× the cap (vitest tinypool `Failed to terminate worker`), and the infra hang read as a substantive red AC. 🟡 F-79 re-scopes WP-263: the "seal via judge-only pass" short-circuit ALREADY exists (`agent-loop.ts:470-478` seals SUCCESS on PROCEED + allCriteriaPass after ANY step, incl. a killed one) — 072's retry tax was F-78 blocking that seal; WP-263 narrows to (a) WP-264 first, (b) mark timed-out checks INFRA-failed so a hang can't drive a false 3-strike HALT. NEXT dogfood headline: WP-264 judge-check tree-reap (dogfood-074, gate ✅ PROCEED).** _Prior — dogfood-072 LANDED the WP-233(a) PURE plan-gate FAILURE CLASSIFIER → WP-233 🟡 (`classifyPlanGateFailure` + `PLAN_GATE_INFRA_REASON_PREFIXES` + `PlanGateFailureClass`: infra/transport fault "safe to re-run" vs substantive plan rejection, anchored `startsWith`, PROCEED→null, no mutation — the dogfood-041 attempt-2 F-33 fix-half). `run-1ac16aa8-dc6a-4a72-bb94-d59ccb8a13d2` (single `chikory run` — the launch-mode divergence streak that hit 067–071 did NOT recur, first correct launch in 6), runtime `e6feab9`, SUCCESS 2 steps · $0.42/$5 · judge 4.0% · PROCEED 2/2 · `docs/reports/dogfood-072.md`; 3 files STAGED uncommitted byte-IDENTICAL to the workspace; AC re-run green (11 grep-pins + scoped vitest 8 passed; tsc+eslint + full suite 571 passed | 19 skipped); spec-faithful, zero F-64 drift (correct launch = full goal verbatim to executor). **🔴 F-76 → WP-263: codex wrote the FULL delivery in step 1 (5765-byte diff, AC-1 ✓) but blew the 600s wall-clock cap (`killed after 653.1s, 1.09×, retriable`) → the retry (step 2) had a 0-byte diff yet cost $0.4072/298k tokens re-ingesting context to re-run ACs = 96.0% of the run for zero incremental delivery (F-11 empty-diff economics via a NEW trigger — the retry-re-execution angle WP-255 left open after fixing reaping). 🟡 F-77 reinforces WP-255: that killed step 1 sealed $0.00/0 tokens — the KNOWN codex residual of WP-255(b) (claude-code recovers partial usage; codex has no pre-`turn.completed` usage event, `codex.ts:62`) confirmed LIVE. NEXT dogfood headline: WP-233(b) — wire `classifyPlanGateFailure` into `planAndGateChain` (`chain.ts:131`) so the operator sees "infra fault — safe to re-run" vs "plan rejected".** _Prior — dogfood-071 LANDED the WP-261 §4 `cmdChain` launch-mode wire → WP-261 🟢 (the guard now REFUSES a single-`run`-authored spec launched as `chikory chain`, at zero LLM cost, proven against its OWN launch). `chain-fd45e5a6-6805-4898-b171-e290823c84b2-node-node-1` (plan `plan-2976e9af-…`), runtime `fc90348`, SUCCESS 1 node · $1.13/$5 · judge 0.6% · PROCEED 2/2 · `docs/reports/dogfood-071.md`; 2 files STAGED uncommitted byte-IDENTICAL to the workspace; AC re-run green (8 grep-pins + scoped vitest 1 passed; tsc+eslint + full suite 563 passed | 19 skipped). **🔴 F-74 (🔴→🟢): 5th consecutive launch-mode divergence — the run whose whole job is to REFUSE this was itself launched by MAKING it; NO new WP, it closes on commit (this wire IS the fix). 🔴 F-75 → WP-262: the F-64 paraphrase caused REAL contract drift that shipped GREEN — the planner's one-line node goal dropped the mandated guard-after-`parseTaskSpec` placement, the SECOND override-hint `ioPair.err` line, the non-empty override semantics, and the parse-valid test fixture; substring-only ACs + an under-built behavioral test (unparseable fixture + `err.toHaveLength(1)` locking the drop) passed the drift — the WP-257 silent-divergence tail realized in DELIVERY, not by luck. NEXT dogfood headline: WP-233 durable, resumable chain planning layer.** _Prior — dogfood-070 LANDED WP-261's pure launch-mode-mismatch precheck (`detectIntendedSingleRun` + `assessLaunchModeMismatch` returning `LaunchModeMismatch | null`, `src/cli/launch-mode-precheck.ts` + 8-case test, the WP-258 `evaluateSpecStalenessPrecheck` analog) → WP-261 🟡 (pure decision done; the `cmdChain` warn/refuse wire remains, now top-priority). `chain-14f72c09-debe-4f60-a6ca-1c3b3b7d0e65` nodes node-1/node-2 (plan `plan-be71d6b1-…`), runtime `07f9687`, SUCCESS 2 nodes · $1.98/$5 (each node own $2.50 budget) · judge ~0.6% · both PROCEED first-try · `docs/reports/dogfood-070.md`; 2 files STAGED uncommitted, node-2 copies byte-IDENTICAL to the working tree; AC re-run green (8 grep-pins + scoped vitest; tsc+eslint + full suite 562 passed | 19 skipped). **The run DOGFOODED ITS OWN BUG A SECOND TIME (🔴 F-72):** the spec was authored single-`run` (header says "NOT a chain" / "HONOR THE LAUNCH MODE THIS TIME"), but the operator launched it as a `chikory chain` (**4th consecutive** launch-mode divergence) and F-64 recurred — the planner compressed the ~2000-word goal into two two-sentence node goals that dropped the marker regexes, the `warning` substrings, the truth table, and the verbatim test cases. It survived first-try each node ($1.98, cheaper than 069's $2.73) ONLY because the F-49 grep pins held the symbol/shape and the executor converged on the un-pinned `warning` substrings by luck (the silent-divergence tail — reinforces WP-257). **The delivered `assessLaunchModeMismatch({true, true})` returns non-null for THIS very spec — the guard would have refused/warned the launch that produced it.** **F-73 (🟢, no WP): the guard is proven against its own launch** → the §4 `cmdChain` wire (call `detectIntendedSingleRun` + `assessLaunchModeMismatch` in `cmdChain` and warn over `ioPair.err` / refuse pending `--force`) is now the single highest-value WP-261 slice (operator-landed / track-B, the WP-258 wire shape). **NEXT dogfood headline: a thesis-stressing slice on a real unblocked product WP — both the WP-261 `cmdChain` wire and the WP-257 `runPlannerPass` REVISE wire are operator-landed/track-B CLI-harness work, not headlines.** _History — dogfood-069 LANDED WP-257's pure literal-preservation verifier (`planLiteralGaps`/`extractGoalLiterals`, `src/planner/literal-preservation.ts` + 7-case test, the `planCoverageGaps` analog) → WP-257 🟡 (pure half done; the `runPlannerPass`/`buildPlan` REVISE wire remains, now top-priority). `chain-bdaef796-667f-4e17-8ad2-4bd49951bb7f-node-implement_literal_preservation` (plan `plan-91e4a59a-…`), runtime `361c4b4`, SUCCESS 3 steps · $2.73/$5 · judge 0.7% · 10m30s · `docs/reports/dogfood-069.md`; 2 files STAGED uncommitted, byte-IDENTICAL to the node workspace; AC re-run green (7 grep-pins + scoped vitest; tsc+eslint + full suite 554 passed | 19 skipped). **The run DOGFOODED ITS OWN BUG (🔴 F-70 → WP-261):** the spec was authored single-`run` (header says "NOT a chain" 3× because a chain re-risks F-64), but the operator launched it as a `chikory chain` (3rd consecutive launch-mode divergence) and F-64 recurred — the planner compressed the brief into a 2-sentence `node.goal` dropping **32 of 35** mandated literals; running the DELIVERED `planLiteralGaps` over this run's own `(parent goal, node goal)` returns those 32 gaps (incl. `WP-25`/`WP-255`/`assessSpecStaleness`/`parseWpStatus`). Steps 1-2 (~$1.72 = 63% of cost) failed AC-1 rebuilding the dropped literals; the run survived ONLY because the F-49 grep pins persisted into the acceptanceCriteria and the judge drove the executor to re-add them by step 3. **F-71 (🟢, no WP): the landed verifier is proven correct against the LIVE defect** — so the §4 wire (call `planLiteralGaps` in the planner pass + REVISE on non-empty) would have caught this paraphrase at plan time, and is the single highest-value WP-257 slice (operator-landed / track-B). **NEXT dogfood headline: a thesis-stressing slice on a real unblocked product WP (WP-202 Memory Pointer recall-wire or sibling) — the WP-257 §4 wire is planner-harness track-B, not a headline; WP-261 (launcher honor execution mode) is a small track-A CLI guard.** _History — dogfood-068 WIRED WP-256's spec-staleness gate LIVE → both WP-256 and WP-258 🟢; the F-65 orphan is killed. Again launched as a `chikory chain` (spec was written single-`run`) — the 2nd run in a row — and SUCCEEDED 2/2: `chain-aa25aa5c-c3e7-4a5c-a8cf-d33723f0655b` (plan `plan-8844e604-…`), runtime `e0da13f`, SUCCESS 2/2 · 2 steps · $1.6988 total · judge 0.62% ($0.0105) · ~5m42s · `docs/reports/dogfood-068.md`. node-1 `precheck-module` (pure `evaluateSpecStalenessPrecheck` + test, 1 step, $1.1489, 870k/5.7k tok) → node-2 `wire-precheck-cli` (the `commands.ts` wire + additive `CliDeps.readPlanText`, 1 step, $0.5499, 409k/3.4k tok) via the WP-239 handoff (`baseCommit 4631f4d == node-1 head`). `cmdRun` now warns `[chikory] WARNING: stale spec: …` (warn-only) when a spec's goal targets an already-🟢 WP. 3 files STAGED uncommitted, byte-IDENTICAL to node-2 workspace; AC re-run green (tsc+eslint+547 vitest). **F-69 (🟢 positive, no WP): 2nd consecutive durable chain landing real open-WP product code + exercising the WP-239 handoff — the pillar is repeatable, not a one-off.** BUT the planner paraphrase (F-64/WP-257, still 🔴) bit a THIRD time and this time leaked CONTRACT DRIFT past a GREEN chain: **F-67 → WP-259 (🔴)** — the delivered `evaluateSpecStalenessPrecheck` DROPPED the mandated `stale` field and used POSITIONAL `(specText, planText)` args instead of `{ goal, planText }`, yet AC-1 was green because `grep -q "stale"` matched the test's `.toContain("stale")` STRING (not a result field) and tsc/eslint only enforce INTERNAL consistency — the grep net pins NAMES, not interface SHAPES; **F-68 → WP-260 (🔴)** — the wire reads the target WP from the WHOLE yaml (incl. comment preamble), not `spec.goal`, correct today only by the dogfood-header-leads-with-target convention. **NEXT: WP-257 (chain planner must preserve mandated detail into node goals) is now TRIPLY-evidenced (066 HALT → 067 wrong semantics → 068 wrong contract) and is the strongest unblocked real-product slice — the durable-chain pillar's own root bug; the dogfoodable half is a pure literal-preservation verifier (the `planCoverageGaps` analog).** _History — dogfood-067 DELIVERED WP-256's pure spec-staleness decision AND, by being launched as a `chikory chain` (the spec was written single-`run`), became the FIRST durable CHAIN to land real open-WP product code end-to-end. `chain-d18a8c1b-f681-4fe3-ba35-c38fa0f54b65` (plan `plan-c4fd3fb0-…`), runtime `a4b8e7a`, SUCCESS 2/2 · 2 steps · $2.5073 total · judge 0.46% ($0.0115) · 6m44s · `docs/reports/dogfood-067.md`. node-1 `parseWpStatus` parser (1 step, $1.6743, 1,280,082/6,912 tok) → node-2 `assessSpecStaleness` consumer (1 step, $0.8330, 624,547/4,591 tok) via the WP-239 dependent handoff (node-2 `baseCommit f7f494a == node-1 head`; node-2 IMPORTED, did not reimplement). 4 files STAGED uncommitted, byte-IDENTICAL to node-2 workspace; AC re-run green (tsc+eslint+9 vitest). **F-66 (🟢 positive, no WP): decompose → meta-judge PROCEED → node-1 sealed → handoff live → node-2 sealed → chain SUCCESS — the durable-chain pillar is no longer "never exercised on real code" (closes the dogfood-066 gap).** BUT two caveats keep it from clean: **F-65 → WP-258 (🔴)** — WP-256's gate landed ORPHANED (`assessSpecStaleness` has ZERO live consumers: not in barrel, not in `precheck.ts`/`commands.ts`), so the pure decision exists but nothing REFUSES a stale spec at launch (the very F-60 orphan pattern WP-256 was to fix); WP-256 → 🟡 (half-done — wire it = WP-258). **F-64 → WP-257 (🔴, still): the planner STILL compresses node goals** — it dropped node-1's parent-goal positional semantics ("FIRST cell is the id", "THIRD cell is the status"), and the executor built a divergent header-driven parser; non-fatal ONLY because dogfood-067 hardened the one grep-pinned literal (`WP-25`) into the AC-1 description, so a chain can now silently build the WRONG function. **NEXT: WP-258 (wire the staleness gate live) is the strongest unblocked real-product slice — it closes WP-256 to 🟢 and makes the §5 standing-failure-mode guard actually fire.** _History — dogfood-066 attempted WP-256 as the first durable CHAIN and FAILED USEFULLY at node A (`chain-15509162-b259-483c-b313-f9d7dbafbcfa`, runtime `e423b64`, FAILED · 3 steps · $3.76/$6.00 · `docs/reports/dogfood-066.md`): the planner dropped the grep-pinned fixtures (`WP-255`/`WP-25`) from node A's `node.goal` while preserving the strict AC-1 grep → structurally unwinnable → budget-waste HALT after 3 fails; node B never dispatched → F-62 → WP-257; F-63 (🟢) the 3-strike HALT bounded cost at 63%. dogfood-067 hardened the `WP-25` literal into the AC-1 description, which carried it into the chain node and avoided the repeat._ _History — dogfood-065 landed the pure `describeStepDeadline(input)` WP-255 step-deadline descriptor (`src/runner/step-deadline.ts` + barrel + 6-case test, elapsed/overran/overrunRatio/remaining, strict `>` boundary, negative-span + `maxSeconds:0` clamps, no mutation) — technically perfect, all ACs green, byte-IDENTICAL harvest, BUT 🔴 F-60: the run landed an ORPHANED duplicate. `run-358273a3-dbbe-4103-8166-4f065606f309`, runtime `cfd4cba`, delivery STAGED on the working tree, `docs/reports/dogfood-065.md`. SUCCESS 1 step, $0.7048/$5 (14.0%), judge 1.1% ($0.0078), 520k/4.7k tokens, 21 tool calls, 3m19s; AC-1+AC-2 re-run green (4 grep-pins + scoped vitest 6 passed; tsc+eslint + full suite 533 passed | 19 skipped). ⚠️ F-60 → WP-256 (🔴): `describeStepDeadline` has ZERO runtime consumers (only `index.ts:136-138` barrel + the test) — operator commit `0533a4c` (15:03) had ALREADY landed the SAME `elapsedSeconds`/`overrunRatio` arithmetic INLINE in `step.ts:150-163` (WP-255(b)) plus the tree-reap, marking WP-255 → 🟢, 15 min BEFORE the run launched (15:18); the plan status itself pre-labeled this slice "now low-value". The pure-first cadence got LAPPED — the headline greened the dashboard while the backlog stood still, the textbook §5 standing failure mode. F-61 (🟡): 520k input tokens to land a 50-line specced pure fn — pure-port headlines now cost more than they deliver. ⚠️ NEXT MUST break the pure-first habit: WP-256 launch-time staleness gate, then the never-exercised durable-CHAIN pillar (WP-219/232/233, untouched across dogfood-042→065)._ _History — dogfood-064 landed: WP-254 pacing-NUMERATOR pure half — `estimateResidentContextTokens(parts: ResidentContextParts)` in `src/runner/pacing.ts`, the live-resident-occupancy value the agent-loop SHOULD feed instead of cumulative `spentTokens`; the fix primitive for F-56, the corpus's most-reinforced friction (~10 data points). NEW F-59 → WP-255: the step was KILLED at 2.45× its `maxSeconds=600` cap doing redundant post-completion verification, zeroing its telemetry — yet the run sealed a correct SUCCESS because the JUDGE grades on-disk artifacts. OPERATOR FOLLOW-UP LANDED (2026-06-29, commit `0533a4c`): both §4 frozen-runtime wires dogfood-064 surfaced — (1) WP-254 numerator FEED SWAP (`agent-loop.ts` feeds `estimateResidentContextTokens(buildResidentContextParts(...))` + `estimateTokensFromText(record.summary)`, BOTH numerator terms off the codex throughput → F-56 RETIRED at source; new `CHARS_PER_TOKEN`/`estimateTokensFromText`/`buildResidentContextParts` pure helpers in `pacing.ts`, WP-254 → 🟢); (2) WP-255(a) process-TREE REAP (`process.ts` `spawn(detached:true)` + `process.kill(-pid)` group-kill, ESRCH-guarded → killed step bounded near `maxSeconds`, `hang-grandchild` conformance case on both adapters); AND (3) WP-255(b) KILLED-STEP TELEMETRY — `parseClaudeCodeOutput` recovers the last `assistant`-turn usage (priced via `computeCostUsd`) when killed before the `result` event, and `step.ts:150-163` enriches the kill reason with the actual `{elapsed}s ({ratio}× cap)` so the overrun is VISIBLE in the trace. WP-254 → 🟢, WP-255 → 🟢._ dogfood-064 (`run-6aa5081e-bda6-406a-b40f-ddf2355e17a5`, runtime `74875b9`, delivery STAGED byte-IDENTICAL on the working tree pending harvest, `docs/reports/dogfood-064.md`) delivered all 3 files: `src/runner/pacing.ts` adds the local `ResidentContextParts` type + the pure `estimateResidentContextTokens(parts): number` (`Math.max(0, systemTokens + sum(recentSummaryTokens.slice(-clamp(retainedSummaryCount,[0,length]))))` — RETAINED TAIL since folding drops the oldest, result clamped ≥0, empty/≤0/negative paths, no mutation); `src/index.ts` extends the existing `./runner/pacing.js` re-export in place; `test/runner/pacing.test.ts` adds 6 cases (tail-sum 170, over-length retains all 160, 0/negative→100, empty→100, negative-`systemTokens`→0, no-mutation snapshot). `codex`/`gpt-5.5`, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly the 3 named files) 4/4 rubric, $0.0084/$5 (0.2%, ALL judge — the executor reported $0 after the kill), AC-1+AC-2 re-run green (4 grep-pins + scoped vitest 11 passed; tsc+eslint + full suite 521 passed | 19 skipped). Additive — `decideContextWindowPacing` + the existing pacing exports + `types.ts` untouched; no contract change, no new dep. **WP-254 PURE NUMERATOR half → done** (the §4 agent-loop feed swap `agent-loop.ts:350` `spentTokens`→`estimateResidentContextTokens(...)`, which RETIRES F-56 at source, remains the operator-landed follow-up). **NEW FRICTION F-59 → WP-255 (🟡):** step 1 journaled `step exceeded maxSeconds=600; killed (retriable: true)` but ran **24m32s = 2.45× the 600 s cap** AND lost ALL telemetry (`0/0` tokens, `$0.00`) — the wall-clock rail isn't a hard deadline + a killed step blinds the budget gate; **F-56/WP-254 did NOT recur (`peak window 0%`) ONLY because the kill zeroed the numerator** it would have over-read (masked, not fixed). The cause was the executor re-verifying scope AFTER the ACs were already met (WP-217 completion-signal gap). 🟢 Thesis WIN: durable + judge-grades-artifacts recovered the killed executor into a correct lint-green SUCCESS (checkpoint `…@4 lastGood true`, no rollback/re-execution). **F-58/WP-249 reinforced** (delivery again STAGED, no `Run-ID:` trailer, harvested outside `chikory land --verify`). **NEXT DOGFOODABLE HEADLINE → TBD (apply the three §5 gates at selection — see dogfood-064 report §"Ready the next run").** _History — dogfood-063 landed: WP-210 PAIRWISE scoring pure primitive (`aggregatePairwise` + `PairwiseOutcome`/`PairwiseTally`/`PairwiseResult` in `src/judge/scoring.ts`), the comparative sibling of the G-Eval half (dogfood-058) — BOTH pure scoring-mode primitives now exist, the pure scoring-modes surface is EXHAUSTED (the §4 `scoringMethod` field + live harness selection wire remains)._ dogfood-063 (`run-72713667-b730-4037-ace7-468c238738c0`, runtime `3313d62`, delivery STAGED byte-IDENTICAL on the working tree pending harvest, `docs/reports/dogfood-063.md`) one-shot all 3 files: `src/judge/scoring.ts` adds `aggregatePairwise(outcomes): PairwiseResult` (Map-backed tally; `"a"`→a +win/b +loss, `"b"`→b +win/a +loss, `"tie"`→both +tie; `winRate = (wins + 0.5·ties)/total`; sort win-rate DESC then id ASC; `winnerId` null on empty OR top-tie; pure, no input mutation) + the `PairwiseOutcome`/`PairwiseTally`/`PairwiseResult` local types; `src/judge/index.ts` extends the existing `./scoring.js` re-export in place; `test/judge/scoring.test.ts` adds 5 cases (clear winner winRate 1, tie→0.5/null, mixed 3-candidate rank+id-tiebreak, empty degenerate, no-mutation snapshot). `codex`/`gpt-5.5` SUCCESS in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly the 3 named files), $0.6412/$5 (12.8%), judge 1.3% ($0.0084), 466k/5.0k tokens, 20 tool calls, 2m52s; AC-1+AC-2 re-run green (6 grep-pins + scoped vitest 14 passed; tsc+eslint + full suite 515 passed | 19 skipped). Additive — `aggregateGEval`/`normalizeGEvalScore`, `types.ts`, every contract untouched; no contract change, no new dep. **WP-210 PAIRWISE pure half → done.** **NO new friction:** F-56/WP-254 reinforced (~10th data point — this trivial task PARKED at `peak window 236%` = `944k/400k` while the step's TRUE input was 466k = 116% of the 400k window; **ROOT CAUSE NOW PINNED:** `agent-loop.ts:350-352` feeds the pure `decideContextWindowPacing` cumulative `spentTokens` as `currentInputTokens` AND the same just-finished step as `estimatedNextStepTokens` → `projectedTokens ≈ 2×` the step; the decision is pure+correct and the denominator is already model-keyed (`context-window.ts`) — the OPEN defect is the NUMERATOR, which should measure LIVE resident orchestration-context occupancy, not cumulative subprocess throughput). F-58/WP-249 reinforced (delivery again STAGED, no `Run-ID:` trailer, harvested outside `chikory land --verify`). **NEXT DOGFOODABLE HEADLINE → WP-254 / dogfood-064 (gate ✅ PROCEED):** the pure LIVE-RESIDENT-OCCUPANCY estimator `estimateResidentContextTokens(parts: ResidentContextParts)` (sum the system preamble + only the RETAINED TAIL of `recentSummaries`, clamp/empty/negative/no-mutation) in `src/runner/pacing.ts` + barrel + `pacing.test.ts` — the value the agent-loop SHOULD feed instead of cumulative `spentTokens`; it RETIRES the most-reinforced friction in the corpus (F-56, ~10 points). The agent-loop feed swap (`agent-loop.ts:350`) is the §4 follow-up. The alternatives stay blocked or non-headline: WP-210 act half / WP-202 recall wire / WP-228 / WP-247 are §4 non-pure runtime wiring (operator-landed), WP-249 remainder is track-B harvest tooling, WP-251 observe-fold-live needs delicate multi-step seam tuning (F-32 wasted-run risk, parked 9×). _History — dogfood-062 landed: WP-202 Memory Pointer RECALL primitive — the pure READ half (`parsePointerReference` inverse + `recallPointerExcerpt` injected-excerpt recall), the documented `store.excerpt` recall remainder of the Memory Pointer Pattern; NO new friction, F-58/WP-254 reinforced._ dogfood-062 (`run-01add160-0b20-49ed-9af1-6598c6c558ae`, runtime `c6f1b32`, delivery STAGED byte-IDENTICAL on the working tree pending harvest, `docs/reports/dogfood-062.md`) one-shot all 3 files: `src/runner/memory-pointer.ts` adds `parsePointerReference(line): ParsedPointerReference | null` (regex `/^\[memory ([^\s]+) ([^\s]+)\] ([0-9]+)B — (.*)$/u`, literal U+2014 separator, `Number.parseInt(bytes,10)`, null-on-malformed, the exact inverse of `formatPointerReference` — round-trips) + the pure `recallPointerExcerpt(line, excerptFn)` (parse → injected async excerptFn, the `deps.runCheck` DI pattern; `null` WITHOUT calling the fn on malformed) + the local `ParsedPointerReference` type; `src/index.ts` extends the existing memory-pointer re-export in place; `test/runner/memory-pointer.test.ts` adds 5 cases (round-trip, multi-word summary, 3 malformed-null, spy recall asserting `toHaveBeenCalledWith("abc123def456", 8192)`, malformed no-call). `codex`/`gpt-5.5` SUCCESS in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly the 3 named files), $0.4436/$5 (8.8%), judge 1.9% ($0.0083), 319k/3.6k tokens, 12 tool calls, 2m52s; AC-1+AC-2 re-run green (5 grep-pins + scoped vitest 10 passed; tsc+eslint + full suite 510 passed | 19 skipped). Additive — `shouldPointerize`/`formatPointerReference`/`MemoryPointerPolicy`, `types.ts`, every contract untouched; no contract change, no new dep. **WP-202 RECALL/READ half → done** (the non-pure agent-loop wire calling the REAL `store.excerpt` through `recallPointerExcerpt` remains the §4 follow-up). **NO new friction — F-58/WP-249 reinforced** (delivery again STAGED with no `Run-ID:` trailer, harvested outside `chikory land --verify` — the harvest-bypass F-58 names; track-B remainder). **WP-254 reinforced — a SPURIOUS compact:** journaled `pacing` = `action compact · projectedTokens 646,090 · utilization 1.615225` → `peak window 162%`, yet the step's TRUE occupancy was 319k/400k = 80% (UNDER the window) — `projectedTokens 646,090 ≈ 2×319k` is the standing WP-254 numerator doubling, so a comfortably-fitting `codex` step triggered a `compact` under no real pressure (denominator 400k correct per WP-252; numerator still over-reads). **NEXT DOGFOODABLE HEADLINE → TBD (apply the three §5 gates at selection).** History — dogfood-061 landed: WP-249 fix-clause (c) — `chikory land --verify` now RE-GATES the landed commit by re-running the run's OWN journaled acceptance `check`s against the landed tree, fail-closed; AND new F-58 → WP-249 de-escalated 🔴→🟡 (the product fix exists but the dogfood HARVEST path bypasses it).** dogfood-061 (`run-f4dcc770-c9a6-4180-a0b6-28da39a60206`, runtime `ea29799`, delivery STAGED byte-IDENTICAL on the working tree pending harvest, `docs/reports/dogfood-061.md`) one-shot both files: `src/cli/land.ts` adds the injectable `LandDeps.loadAcceptanceChecks` dep + a journal-reading `defaultLoadAcceptanceChecks` (`new Journal(journalPath(dataDir ?? ".chikory", runId)).getRun()?.task.acceptanceCriteria`, the `requireSpec` shape) + the fail-closed acceptance gate INSIDE the `--verify` block AFTER the `VERIFY_COMMANDS` loop (reuses `runCheck(check, repo)` against the landed tree, `return 1` keep-commit on red) + the `acceptance: N/N checks green` count (non-json) / `acceptanceChecks: N` (json); `test/cli/land.test.ts` adds the passing + fail-closed-keep-commit cases. `codex`/`gpt-5.5` SUCCESS in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly the 2 named files), $1.2787/$5 (25.6%), judge 0.8% ($0.0096), 965k/6.2k tokens (NEW series-high input), 27 tool calls, 4m38s; AC-1+AC-2 re-run green (4 grep-pins + vitest 10 passed; tsc+eslint + full suite 505 passed | 19 skipped). Additive — `VERIFY_COMMANDS`, the journal/TaskSpec contracts, `types.ts`, and the `args.verify !== true` paths all untouched; no contract change, no new dependency. **WP-252 calibration CLOSED by a live PARK read** — journaled `pacing` = `action park · projectedTokens 1,943,084 · utilization 4.85771` = `1,943,084 / 400,000` → `peak window 486%` (the `gpt-5.5`→400k calibrated denominator, first park-branch confirmation; on legacy 200k this reads ~970%). **NEW F-58 → WP-249 (de-escalate 🔴→🟡):** inspection shows `chikory land` ALREADY satisfied clauses (a) [commits only the run diff, inherent] and (b) [stamps `Run-ID:` at `land.ts:122`]; this run adds clause (c) — so ALL THREE WP-249 clauses now exist in the product `chikory land` path. BUT the dogfood loop harvests via `scripts/harvest.sh` + a manual `git commit` (`harvest.sh:212`), which invokes NO `land --verify`, NO acceptance re-gate, and NO `Run-ID:` trailer — so F-57's failure mode (green dashboard / red main; run-id-less commit) is STILL reachable on the next harvest. WP-249's remaining work is OPERATIONAL ADOPTION (route the harvest through `chikory land --verify` or replicate re-gate + `Ref: run-id:` in `harvest.sh`) — `harvest.sh`/operator tooling, TRACK-B, not a failable product-dogfood headline. **F-56 → WP-254 recurs** (9th park data point `peak window 486%`; same codex-subprocess-throughput numerator defect; no new WP). **NEXT DOGFOODABLE HEADLINE → WP-202 Memory Pointer RECALL primitive (dogfood-062, gate ✅ PROCEED):** the pure READ half of the Memory Pointer Pattern — `parsePointerReference(line)` (the exact inverse of the landed `formatPointerReference`) + `recallPointerExcerpt(line, excerptFn)` (parse → injected store-excerpt), in `src/runner/memory-pointer.ts` + barrel + test; the documented WP-202 "store.excerpt recall path" remainder, the core context-rot thesis pillar this run's 486% window motivates, the pure-first shape `shouldPointerize`/`formatPointerReference` landed in. The §4-walled alternatives — WP-249 remaining (harvest tooling, track-B), the dependency/secret deterministic OVERRIDE, WP-210 act half, WP-250 park→durable-suspend — and the observability-only WP-251/WP-254 keep WP-202's recall slice the strongest UNBLOCKED real-product thesis slice. _History — dogfood-060 landed: WP-215 S5 — the live judge-evidence WIRE that consumes the S4 dependency-scan primitive, completing the Agent-as-a-Judge dependency-evidence chain; AND new 🔴 F-57 → WP-249 ESCALATED (harvest bundled unrelated host files and broke the lint gate on `main` — green dashboard, red main)._ dogfood-060 (`run-291cf0b5-70d4-4919-8669-cef579679a56`, runtime `96df844`, `docs/reports/dogfood-060.md`) one-shot all 5 files: `evidence.ts` imports `scanDiffForNewDependencies` + adds the REQUIRED `CollectedEvidence.newDependencyLabels` field populated over the FULL diff (BEFORE the `bound(...)` prompt-excerpt truncation — the named failure surface, gotten right), `prompt.ts` renders the `## EVIDENCE — deterministic new-dependency scan (added diff lines)` section (via `renderNewDependencyLabels` mirroring `renderSecretScanLabels`) immediately after the secret-scan section, `harness.ts` threads `collected.newDependencyLabels` into `buildJudgeMessages`, + a new 3-case wire test (and a trivially-entailed `+1` line in `secret-scan-evidence.test.ts` for the new required field). `codex`/`gpt-5.5` SUCCESS in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (the RUN touched exactly the 5 files; `eslint .` on the run CLONE = exit 0, what the judge graded), $1.0665/$5 (21.4%), judge 0.9% ($0.0100), 775k/8.8k tokens, 30 tool calls, 4m39s. Additive — `scanDiffForNewDependencies`/`scanDiffForSecrets`, `buildVerdict`, the rubric, `types.ts`, and the journal payloads all untouched; no contract change, no new dependency; the LLM still adjudicates the verdict. The new section rendered `(none)` live (the run's own diff adds no NEW external package — foreseen, unit-proven non-empty). **WP-215 S5 → 🟢; the secret (S1→S2→S3) + dependency (S4→S5) judge-evidence chain is complete.** **NEW 🔴 F-57 → WP-249 ESCALATED (🟡→🔴):** the run was perfectly scoped, but the HARVEST commit `821cae5` SWEPT IN 2 unrelated uncommitted host files (`test/cli/cli.test.ts`, `test/cli/trace.test.ts` — duplicate `stripAnsi` helpers with `/\x1b\[[0-9;]*m/g`) the run never wrote (run workspace + run-base `96df844` both have 0 `stripAnsi`), and those 2 files FAIL `pnpm exec eslint .` (`no-control-regex` ×2) → `821cae5` (HEAD/main) FAILS AC-2's own lint gate while the dashboard reads ✅ PROCEED 2/2. **Green dashboard, red main** — the judge graded the clean clone; nothing re-runs the run's AC checks against the LANDED commit. 3rd recurrence of WP-249 harvest-hygiene (F-51 dogfood-049 → dogfood-058 auto-commit → F-57), FIRST that breaks the build (and would poison the next clone-of-HEAD dogfood). **Fixed inline this review** (`// eslint-disable-next-line no-control-regex` above both helpers — `eslint .` exit 0, main lint-clean, left uncommitted). WP-249 gains a 3rd fix clause: **after harvest, RE-RUN the run's own AC `check`s against the landed commit** (not just trust the clone's green). **F-56 → WP-254 recurs** (8th park data point: `peak window 392%` on a 5-file additive wire; same codex-subprocess-throughput numerator defect; no new WP). **NEXT DOGFOODABLE HEADLINE → the WP-215 deterministic dependency/secret OVERRIDE (WP-253-style §4 follow-up) — re-gate at selection:** the now-landed S5 evidence wire makes a non-empty `newDependencyLabels`/real-secret deterministically FLIP a verdict pre-land possible — that is the next thesis slice on this pillar (alternatively pay down 🔴 WP-249 on real launcher/harvest code). _History — dogfood-059 landed: WP-215 S4 — the PURE new-dependency scan primitive for the Agent-as-a-Judge security/architecture rubric, the dependency analog of the landed secret-scan chain; AND new F-56 → WP-254 (the WP-252-calibrated pacing metric STILL over-reads on `codex` steps).** dogfood-059 (`run-bc841ce6-ad2c-4356-bb49-355a7a7b6637`, runtime `00b31e8`, delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-059.md`) one-shot all 3 files: a NEW pure `src/judge/scan-dependencies.ts` — `scanDiffForNewDependencies(diff): string[]` (added-lines-only/`+++`-excluded `getAddedDiffLines`; three module-grade regexes for `from`/side-effect-`import`/`require`; `.`/`/`/`node:` exclusion; scoped `@scope/pkg/sub`→`@scope/pkg` + unscoped `lodash/merge`→`lodash` normalization; `Set`+`.sort()` de-dup/sort, empty-safe; pure) — re-exported from the judge barrel (`src/judge/index.ts`) + an 11-case vitest (10 mandated + an extra absolute-import exclusion). `codex`/`gpt-5.5` SUCCESS in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly the 3 named files), $0.9850/$5 (19.7%), judge 0.8% ($0.0079), 734k/5.9k tokens, 27 tool calls, 4m34s; AC-1+AC-2 re-run green (3 grep-pins + vitest 11 passed; tsc+eslint + full suite 500 passed | 19 skipped). Additive — `scanDiffForSecrets`/`scanDiffForRealSecrets`/`collectEvidence`, the judge prompt/harness/rubric, `buildVerdict`, `types.ts`, and the journal payloads all untouched; no contract change, no new dependency. **WP-215 S4 → 🟢.** **NEW FRICTION F-56 → WP-254 (🟡):** the WP-252-calibrated denominator HELD (`1,480,248 / 3.70062 = 400,000` exactly, the `gpt-5.5`→400k window — NOT a 200k regression), but this TRIVIAL 3-file additive task still read `peak window 370%` and PARKED, **falsifying dogfood-058's "park-saturation series breaks here"** (that step was just light — 716,994 → 1.79× → compact). The defect is the NUMERATOR, foreseen in WP-252's residual note: `projectedTokens = spentTokens + estimate = (734,193+5,931)×2 = 1,480,248` feeds a fresh codex subprocess's SUMMED-across-27-internal-turns throughput (even the raw 734k/400k = 1.835× already overflows) as if it were live window occupancy, and the window is keyed to `routing.stages.code.model` not the actual codex executor. The calibrated metric still can't tell genuine pressure from per-subprocess accounting — anti-thesis for "maximal observability — no magic". Park-saturation is the 7th F-54 data point (602/604/759/585/334/904[pre-wire]/179[058-light]/370). **NEXT DOGFOODABLE HEADLINE → WP-215 S5 / dogfood-060 (🟡→judge-evidence wire, re-gate at selection):** the dependency-scan primitive is consumed NOWHERE — S5 threads `scanDiffForNewDependencies` into `collectEvidence` (the `scanDiffForSecrets`→S2 evidence-wire analog: an additive `CollectedEvidence.newDependencyLabels` field over the FULL diff + a judge-prompt evidence section + the `harness.ts` thread + tests), so the Agent-as-a-Judge mechanically flags new dependencies in the diff it already collects. Cross-file, real WP-215 judge-pillar feature code. The §4-walled alternatives — WP-210 act half (`scoringMethod` field + the live judge-harness wire consuming `aggregateGEval`, a contract change), WP-250 (park→durable-suspend control-flow), WP-253 (destructive override) — and the observability-only WP-251/WP-254 (a measurement-accuracy fix, not a thesis headline) keep WP-215 S5 the strongest UNBLOCKED real-product thesis slice. _History — dogfood-058 landed: WP-210 — the PURE G-Eval scoring primitive (`src/judge/scoring.ts`: `normalizeGEvalScore` + `aggregateGEval` + 3 local types, barrel re-export, 9-case vitest), opening the judge SCORING-modes pillar; `run-67d39267-…`, runtime `6292f62`, `docs/reports/dogfood-058.md`, $0.4905/$5, judge 1.8%, 355k/3.8k, suite 489 passed. That run was (prematurely) read as "F-55 CLOSED BY OBSERVATION / park-saturation breaks" off its single light `compact 1 · park 0` step at `peak window 179%` — dogfood-059 corrects both claims (see F-56)._ _History — dogfood-057 landed: WP-252 — the pacing-window denominator is now CALIBRATED to the executor model, retiring the five-report-recurring F-55 finding._ dogfood-057 (`run-6b23da51-c440-432a-bbf8-51d4ee8a24af`, runtime `3a3dc8d`, delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-057.md`) one-shot all 3 files: a NEW pure `src/runner/context-window.ts` — `CONTEXT_WINDOW_TABLE` (14 rows mirroring `pricing.ts`'s `PRICE_TABLE` family keys: Anthropic 200k, OpenAI 400k, Gemini 1M) + `lookupContextWindow(model, fallback=200_000)` (the EXACT `lookupPricing` longest-prefix shape) + pure `resolveContextWindowForSpec(spec, fallback)` (reads `spec.routing.stages.code?.model`) — WIRED into `agent-loop.ts:355` (`spec.debug?.contextWindowTokens ?? resolveContextWindowForSpec(spec, DEFAULT_CONTEXT_WINDOW_TOKENS)`, the `debug.contextWindowTokens` seam STILL first in the `??` chain) + a 6-case vitest. `codex`/`gpt-5.5` SUCCESS in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly the 3 named files), $1.1870/$5 (23.7%), judge 0.8%, **898k/6.5k tokens (NEW series-high input)**, 31 tool calls, 4m28s; AC-1+AC-2 re-run green (4 grep-pins + vitest 6 passed; tsc+eslint + full suite 480 passed | 19 skipped). Additive — `decideContextWindowPacing`, the pacing/compaction journal payloads, `types.ts`, and the trace renderer all untouched; no contract change. **NO new friction.** **F-55 NOW FIXED IN CODE** (it had recurred across dogfood-052→056); closure is the F-53/F-52 close-when-observed shape — HEAD at launch predates the wire, so this run's own trace still reads the pre-wire `peak window 904%`, and the FIRST calibrated live read is automatically the NEXT dogfood (confirm its `peak window %` drops to the `gpt-5.5`-400k-relative figure). Park-saturation recurs (6th point 602%→604%→759%→585%→334%→904%, F-54/WP-250/WP-251). **NEXT DOGFOODABLE HEADLINE → WP-210 / dogfood-058 (🟡→pure slice, gate ✅ PROCEED):** the pacing/context-rot observability sub-series is complete (dogfood-051 wiring → 052 summary → 053 compaction-summary → 057 calibration), so the loop pivots to the Agent-as-a-Judge SCORING pillar — a pure first slice of WP-210 (pairwise + G-Eval scoring modes): a new `src/judge/scoring.ts` with `normalizeGEvalScore` + `aggregateGEval` (the `buildVerdict`/`decideContextWindowPacing` pure-decision shape, local types, NO contract change), the continuous-score analog of the binary verdict. The §4-walled alternatives (WP-250 park→durable-suspend control-flow, WP-253 destructive `no_secrets_introduced` override — both touch verdict/control-flow logic, operator-landed) and the observability-only WP-251 are all blocked or non-product, so WP-210's pure slice is the strongest UNBLOCKED real-product thesis slice. _History — dogfood-056 landed: WP-253 / WP-215 S3 — the example-key allowlist + real-secrets-only scan that unblocks the deterministic `no_secrets_introduced` override._ dogfood-056 (`run-37862cf7-0c24-4aec-b09a-547028bd6720`, runtime `8e4661c`, delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-056.md`) one-shot all 3 files: a new `src/judge/secret-allowlist.ts` (`EXAMPLE_SECRET_VALUES` + pure `isExampleSecret`) + a NEW `scanDiffForRealSecrets(diff)` in `scan-secrets.ts` (excludes allowlisted dummies; `scanDiffForSecrets` behavior UNCHANGED) + a 3-case vitest; `codex`/`gpt-5.5` SUCCESS in 1 step, judge ✓ PROCEED 2/2 scope ✓, $0.4744/$5 (9.4%), judge 2.0%, 328k/5.4k tokens; AC re-run green (vitest 474 passed, tsc+eslint exit 0). NO new friction; park-saturation recurs (5th point), denominator recurs (F-55/WP-252). The destructive override that flips `no_secrets_introduced` pre-land = WP-253, the §4 hand-design follow-up (operator-landed — touches verdict/override logic). _History — dogfood-055 landed: the WP-215 secret scanner is now WIRED into the inner-loop judge's evidence — the Agent-as-a-Judge mechanically inspects the diff for secrets, the documented WP-215 consumer._ dogfood-055 (`run-73437934-9672-43d4-b453-557044ec349b`, runtime `88d2102`, delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-055.md`) threaded `scanDiffForSecrets` into `collectEvidence` (additive `CollectedEvidence.secretScanLabels` over the FULL diff) + a new judge-prompt evidence section + the `harness.ts` wire + a 2-case vitest; `codex`/`gpt-5.5` one-shot all 4 files in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓, $0.7834/$5 (15.6%), judge 1.0%, 580k/5.0k tokens, 3m45s; AC-1+AC-2 re-run green (vitest 471 passed, tsc+eslint exit 0). NO new friction (the section rendered live but `(none)` — clean diff by design); park-saturation recurs (4th point 602%→604%→759%→585%, F-54/WP-250/251) + uncalibrated denominator recurs (F-55/WP-252). **NEXT HEADLINE → WP-253 / dogfood-056** (gate ✅ PROCEED): the example-key allowlist (`isExampleSecret` + `scanDiffForRealSecrets`) that unblocks the deterministic `no_secrets_introduced` override. _History — dogfood-054 landed: the Agent-as-a-Judge true-positive CATCH lands on REAL product-WP code, off the throwaway scaffolding of dogfood-046/047/048._ dogfood-054 (`run-f7106c03-a222-4b2c-bec8-a16bf51a10f4`, delivery committed `cfb8bcd` byte-IDENTICAL to the working tree, `docs/reports/dogfood-054.md`) landed **WP-215 S1** — the pure secret-scan primitive `scanDiffForSecrets(diff): string[]` (`src/judge/scan-secrets.ts`, R1 added-lines-only/`+++`-excluded · R2 `/AKIA[0-9A-Z]{16}/`→`aws-access-key` · R3 `/sk-[A-Za-z0-9]{20,}/`→`openai-key` · R4 sorted+de-duped+empty-safe; pure, no contract change) + 5-case vitest — AND re-proved the **WP-244 judge-catch on this REAL WP code**: `codex`/`gpt-5.5` wrote a correct scanner at step 0 → the seam overwrote it with an always-`[]` stub (102 bytes) → cadence-1 judge `vitest` AC `exited 1` → deterministic override → AC FAILED (**THE CATCH**, pre-land, on real code) → executor restored from the failing-test feedback → **SUCCESS in 2 steps**. $1.3298/$5 (26.6%), judge 1.0%, family-diverse (`codex`/openai vs Google `gemini-3.1-pro-preview`), `seams fired 1`, 754k/4.4k then 243k/2.5k tokens; AC-1+AC-2 re-run green (vitest 469 passed | 19 skipped, tsc+eslint exit 0). **WP-215 S2 → dogfood-055 LANDED** (`run-73437934-9672-43d4-b453-557044ec349b`, runtime `88d2102`, delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-055.md`): `scanDiffForSecrets` is now wired into the judge's evidence collection — `codex`/`gpt-5.5` one-shot all 4 files in 1 step: `evidence.ts` imports the scanner + adds the REQUIRED `CollectedEvidence.secretScanLabels` field populated over the FULL diff (before the prompt-excerpt truncation), `prompt.ts` renders the `## EVIDENCE — deterministic secret scan (added diff lines)` section (labels `- <label>` / `(none)`), `harness.ts` threads it through, + a 2-case vitest. Judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓ (exactly 3 named files + 1 test), $0.7834/$5 (15.6%), judge 1.0%, 580k/5.0k tokens, 24 tool calls, 3m45s; AC-1+AC-2 re-run green (5 grep-pins + vitest 471 passed | 19 skipped, tsc+eslint exit 0). Additive, no contract change; LLM still adjudicates `no_secrets_introduced`. **NO new friction** — the secret-scan section rendered live but `(none)` (this run's own diff is secret-free by design; non-empty firing is unit-proven, deferred to the WP-253 dogfood). **NEXT HEADLINE → WP-253 / dogfood-056 (gate ✅ PROCEED):** the example-key allowlist that unblocks the deterministic `no_secrets_introduced` override — a pure `isExampleSecret`/`EXAMPLE_SECRET_VALUES` primitive (new `src/judge/secret-allowlist.ts`) + a new `scanDiffForRealSecrets(diff)` in `scan-secrets.ts` that excludes canonical dummies (AWS's `AKIAIOSFODNN7EXAMPLE`) so a live destructive override won't self-trip ROLLBACK on test fixtures; `scanDiffForSecrets` (the evidence scan) stays unchanged. Cross-file, real WP-253/Agent-as-a-Judge security code. **New F-55 → WP-252 (🟢):** the pacing window denominator is a hardcoded 200k (`agent-loop.ts:63`) uncalibrated to the executor model, so `peak window 759%` is loud but its divisor is arbitrary — every codex step blows 200k 3–6× → `park` is structural, the `compact` branch unreachable; fix sources `contextWindowTokens` from the routing model's real window. **Park-saturation recurs (3rd data point: 602%→604%→759%)** — already tracked F-54/WP-250 (park→suspend act-slice)/WP-251 (seam-forced live fold); no new WP. _History (dogfood-053 landed: the act-half `trigger` field is now ACTIONABLE in the `chikory trace` TOTALS line, and the totals are honestly self-evidencing about their own limit.)_ dogfood-053 (`run-41f2744f-82d6-4e54-825d-9704f77b1ee7`, runtime `4abb478` (the WP-207 act half), delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-053.md`) added a pure `summarizeCompaction(entries): CompactionSummary` reducer (`src/runner/compaction-summary.ts`, the `summarizePacing` analog — digestRef-gated `folds`, `trigger:"pacing"` subset `pacingFolds`, non-`compaction`/digest-less ignored, empty→0/0, NO contract change) + barrel re-export + the `chikory trace` totals wire `compactions N (pacing M)` (additive/byte-identical no-compaction path) + 2 tests. `codex`/`gpt-5.5` one-shot all 5 files in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 1/1 scope ✓, $0.8086/$5 (16.2%), judge 0.9%, 598k/5.4k tokens, 22 tool calls, 3m29s; AC-1 re-run green (grep-pins + vitest 27 + tsc + eslint exit 0). **Residual F-54 (🟡, folds into WP-203/207 → WP-251):** the run itself **PARKED** — `peak window 604% (compact 0 · park 1)`, **0 folds** — so the new `compactions N (pacing M)` segment never rendered live (a single step that overflows the window 6× cannot be helped by folding → it parks, the WP-250 suspend path). The telemetry is unit-proven but not yet observed live (the dogfood-051/F-53 pre-close shape); **WP-251** = a multi-step run under the deterministic `CHIKORY_CONTEXT_WINDOW_TOKENS` seam past `keepLastN` to force a `trigger:"pacing"` fold and read `compactions N (pacing M)` live. **NEXT HEADLINE → dogfood-054** (already gated ✅ PROCEED): the Agent-as-a-Judge true-positive CATCH on REAL product-WP code (WP-215 pure `scanDiffForSecrets` + the WP-244 seam seeded INTO it), escalating the catch off the dogfood-046/048 throwaway utilities. _History (dogfood-052 act-half unlock): the context-rot pillar is now ACTED ON, not just observed. The live pacing decision DRIVES compaction cadence — under context-window pressure the runner folds history NOW (WP-203 S2 / WP-207 act half), so dogfood-052's 602%-window PARK signal is no longer inert._ Operator hand-design on branch `feat/wp207-pressure-compaction`: `agent-loop.ts` passes `underPressure = pacing.action !== "continue"` into the existing `compactContext` activity, which under pressure uses an effective `{ triggerAfterSteps: keepLastN }` policy (fold beyond the verbatim window immediately) instead of the count trigger (8); each `compaction` entry is tagged `trigger:"pacing"\|"count"` (additive, no contract change), `chikory trace` renders ` (pacing)` per-entry, and a deterministic `debug.contextWindowTokens` seam (`CHIKORY_CONTEXT_WINDOW_TOKENS`) makes it provable. Real-Temporal proof: `compaction-wiring.test.ts` "context-window pressure folds before the count trigger" — a 7-step run under a tiny window override folds at step 6 with `trigger:"pacing"`; full SDK suite 460 passed, tsc+eslint clean. **WP-203 → 🟢, WP-207 act half → 🟢.** Remaining: `park`→suspend (a single overflowing step can't be helped by folding) → **WP-250** (§4 control-flow follow-up, the next thesis slice). **NEXT DOGFOOD → dogfood-053 re-pointed** to `summarizeCompaction` trace totals (surface the new `trigger` field in the totals line, the dogfood-052 `summarizePacing` analog); the WP-215 judge-catch-on-real-code spec moved to dogfood-054. _Earlier (dogfood-052): context-rot observability completed — `chikory trace` reads PEAK window pressure (the build run itself read 602%)._ dogfood-052 (`run-7e13ae2a-a233-4e2d-9fdc-d564a9eee5bc`, runtime `0880806`, delivery uncommitted byte-IDENTICAL on the working tree, `docs/reports/dogfood-052.md`) made dogfood-051's journaled pacing payload ACTIONABLE: a pure `summarizePacing(entries): PacingSummary` reducer (`src/runner/pacing-summary.ts`, the `evaluateBaselinePrecheck` analog — `Math.max` peak utilization, `compact`/`park` counts excluding `continue`, non-`pacing` ignored, empty→0, NO contract change) + barrel re-export + the `chikory trace` totals wire `peak window X% (compact C · park P)` (additive/byte-identical no-pacing path) + 2 tests. `codex`/`gpt-5.5` one-shot all 5 files in 1 step, judge `gemini-3.1-pro-preview` ✓ PROCEED 1/1 scope ✓, $0.8032/$5 (16.0%), judge 0.9%, 597k/5.0k tokens, 3m4s; AC-1 re-run green (vitest 25 + tsc + eslint exit 0). **F-53 CLOSED 🟢 — first live read:** this run journaled a real `pacing` entry (`action park · projectedTokens 1,203,440 · remainingTokens -1,003,440 · utilization 6.0172`) and the new reducer rendered `peak window 602% (compact 0 · park 1)` over it. **Remaining WP-207 — the *act* half — stays §4-blocked on the WP-203 S2 runtime compaction trigger (operator-landed LLM-call hand-design); unblocking it is the highest-leverage move out of the additive-observability regime. NEXT HEADLINE → dogfood-053: prove the Agent-as-a-Judge true-positive CATCH on REAL product-WP code (a WP-215 pure `scanDiffForSecrets` security-evidence reducer, the catch seam seeded INTO it), NOT the throwaway utilities of dogfood-046/047/048. Gate: §1.1 ✅ · §1.2 ✅ · §1.3 ✅ PROCEED (stresses two thesis pillars — judge security-evidence feature + judge true-positive catch — on real WP code).** _History (dogfood-051):_ delivered the WP-207 journaling+wiring half: the pure `decideContextWindowPacing` decision is wired into the live agent loop, which now journals a durable replay-safe `pacing` entry every step from REAL per-step token usage (`recordPacingEvent` activity, idempotent `appendOnce` keyed on `pacingEventIndex`, mirroring WP-245 `recordSeamEvent`/WP-243 `recordBudgetEvent`) and `chikory trace` surfaces `pacing events N` + a per-entry `% window` line. `codex`/`gpt-5.5` one-shot all 5 files, judge `gemini-3.1-pro-preview` ✓ PROCEED 1/1, $2.8487/$5 (57.0%), judge 0.3%, **2178k/12k tokens — a NEW series-high input** (the very pressure this now instruments), 48 tool calls, 6m46s; full SDK suite 454 passed re-verified incl. the real-Temporal `verdict-gating` ARMED + `crash-recovery` paths (confirms `recordPacingEvent` registered live, not unit-mocked). One benign delivery deviation (judge `scope ✓`): executor relocated `stepIndex += 1` upward so `atStep` is 0-based — behavior-safe. **Residual F-53 (🟢, folds into WP-207):** unit-proven but not yet OBSERVED live (own trace predates the wiring) — the NEXT dogfood run is automatically the first live read of `pacing events N>0`. **Remaining WP-207 — the ACT half (use the decision to tune compaction/checkpoint cadence) — is blocked on the WP-203 S2 runtime compaction trigger (WP-202 store + §4 LLM-call hand-design), operator-landed, NOT a dogfood headline.** _Earlier (dogfood-050): the Agent-as-a-Judge true-positive-catch pillar is PROVEN, reproducible on demand, AND now self-documenting in the trace._ dogfood-046 (`run-b024565e-a927-49ce-8626-c70705c750e9`, runtime `ebab493` WP-244 seam, delivery committed `5b6ca24`, `docs/reports/dogfood-046.md`) used the WP-244 `debug.seedBadDiff` seam to make the core thesis happen on demand for the first time in 46 dogfoods: the `codex`/`gpt-5.5` executor wrote a **correct** `clamp` at step 0, the seam then overwrote `clamp.ts` with a compiling-but-wrong `return value;` *after* the executor finished but *before* the judge ran, the cadence-1 judge's `vitest` AC went **red** (AC-1 `exited 1`), the deterministic override (`harness.ts:105`) **blocked the SUCCESS seal** (THE CATCH), and the executor read the failing test from the judge feedback and **restored a correct impl** at step 1 → **SUCCESS in 2 steps**. Proven from artifacts (executor diff `77bcb0`=correct vs judge evidence diff `84e435`=`return value;` vs step-2 base `fa94ca9`=corrupted), not the run's own green; family-diverse (`codex`/`openai` vs Google `gemini-3.1-pro-preview`), $1.1321 / $5 (22.6%), judge 1.4%, 525k input tokens step 1. **WP-244 → 🟢 DOGFOOD-PROVEN; the DOGFOODING §1.1 KPI ("regressions the judge caught pre-land") is sealed and forceable.** Two caveats kept honest: the catch came from the judge-*executed* test (the LLM verdict on the bug was PROCEED — confirms "the judge runs tests", not "the LLM spots bugs"); and the seam fires with **zero journaled telemetry** so the trace's `injections 0` masks the seeded catch → **F-47 → WP-245** (journal + surface the seam firing; the proof today survives only by hand byte-diffing three blobs). **Update (2026-06-22, dogfood-047 review): the chain-level judge-catch is STILL UNPROVEN — the run was launched DISARMED.** WP-246 (per-node seam wiring) **landed** (`3fc27bb`), but dogfood-047 (`chain-989b31b9-…`, `docs/reports/dogfood-047.md`) was launched `chikory chain dogfood-047.yaml --watch` **without** the `CHIKORY_SEED_BAD_DIFF_*` env → the seam never armed (node B `task_json` has no `debug.seedBadDiff`, trace `injections 0`) → node B sealed clean SUCCESS in 1 step → **no chain-level catch** (the F-32 "path not exercised" wasted-run mode the spec header warned about verbatim). The durable-chain machinery itself worked (2-node SUCCESS 2/2, real WP-239 dependent handoff with node B importing node A's `roundTo`, family-diverse, $1.1965/$12), and the delivery harvested IDENTICAL (`37cddb1`) — but two gaps now block an honest re-run: **F-48 → WP-247** (nothing pre-flight refuses/warns when a seam-requiring spec is launched disarmed) and **F-49 → WP-248** (the AC `check` gates on the executor's *self-authored* tests — dogfood-047's executor deviated from the spec's mandated formula/assertions and the judge passed it `scope_matches_instruction ✓`; a circular gate). **Update (2026-06-23, dogfood-048 review): THE CHAIN-LEVEL JUDGE-CATCH IS NOW PROVEN — armed re-attempt landed.** dogfood-048 (`chain-b7665e97-0416-4638-bba5-71e66293d5ea`, runtime `3fc27bb`, delivery committed `2c516d5`, `docs/reports/dogfood-048.md`) escalated the dogfood-046 catch into a **dependent node of a durable chain** and it fired exactly as designed: node A wrote a correct pure `truncateDecimals` → SUCCESS; node B (dependent, imports node A's `truncateDecimals` via the WP-239 handoff) wrote a correct `truncateToCents` at step 0, the WP-246 seam (`CHIKORY_SEED_BAD_DIFF_NODE_INDEX=1`) overwrote `truncate-to-cents.ts` with `return value;` after the executor finished, node B's cadence-1 judge re-ran AC-2's `grep`+`vitest` → **`vitest exited 1` → deterministic override → AC-2 FAILED (0/1) → node B refused to seal SUCCESS (THE CHAIN-LEVEL CATCH)** → the executor restored a correct impl from the failing-test feedback at step 1 → **node B SUCCESS → chain SUCCESS 2/2.** Proven from artifacts (node B step-2 diff base = the seeded `return value;`; `debug.seedBadDiff` present in node B `task_json`; node B took 2 steps), family-diverse (`codex`/`openai` vs Google `gemini-3.1-pro-preview`), chain total $1.6381, judge share <1%. **Both dogfood-047 gaps closed at spec-authoring time: F-48** (the four `CHIKORY_SEED_BAD_DIFF_*` vars baked into the launch header + verified armed post-run) and **F-49** (each AC `check` `grep`s the mandated literals verbatim before vitest, so the executor can't rewrite the gate — validated inline). **WP-246 → 🟢 DOGFOOD-PROVEN.** Two honest residuals carried forward: **F-47 → WP-245** (the seam STILL fires with zero journaled telemetry — node B's trace reads `injections 0`, masking the most important catch yet; proof survives only by manual artifact archaeology → now top observability debt) and **F-48 → WP-247** (arming still relies on manual discipline; nothing in the launcher refuses a disarmed seam-spec). Minor: **F-50** (the graded gate enforces behaviour + assertions but not all spec prose — node B's landed impl dropped the mandated JSDoc; folds into WP-248). **Top next: pay down WP-245 (seam telemetry) or WP-247 (pre-flight seam-armed guard) on real launcher/trace code — the catch itself is settled; do NOT re-prove it on fresh scaffolding.** Also queued: **WP-248** (spec-authored assertions — cheapest grep-pin form validated inline by dogfood-048), **WP-228** (baseline precheck wiring for `run`/`chain`). **Update (2026-06-23, dogfood-049 review): WP-247's PURE PARTIAL LANDED — `describeSeamArming(env): SeamArmingReport`.** dogfood-049 (`run-26e74ad3-901e-4671-b669-38cd60b76736`, runtime `4599a3c`, delivery committed `dde765b`, `docs/reports/dogfood-049.md`) one-shot the `evaluateBaselinePrecheck`/`precheck.ts` analog: a pure decision reading the four `CHIKORY_SEED_BAD_DIFF_*` keys → armed/disarmed + optional 0-based `nodeIndex` + empty-CONTENT warning, in a new `packages/sdk-ts/src/cli/seam-precheck.ts` (re-exported `index.ts:114`), mirroring the host-side readers (`cli/chain.ts:158-171`, `cli/commands.ts:235`). `codex`/`gpt-5.5` SUCCESS in 1 step, all four grep-pinned assertions verbatim (F-49 discipline), judge `gemini-3.1-pro-preview` ✓ PROCEED 1/1, scope `✓` (run touched exactly its 3 files), $0.5362/$5 (10.8%), judge 1.3%, 387k/4.6k tokens; full SDK suite 449 passed re-verified. **WP-247 → 🟡** (cheapest partial done; the 2-line launcher banner wire + the structural disarmed-spec guard still owed). **New friction F-51 → WP-249** (harvest-commit hygiene): the harvest commit `dde765b` bundled an unrelated operator hand-edit (`test/cli/land.test.ts` flaky-`rm` retry wrapper the run never wrote) AND cites no run-id → `dogfood-verify §6` / `git log --grep <run-id>` can't resolve the landed commit (dogfood-046/047/048 harvests equally run-id-less). **THE CHOSEN NEXT HEADLINE IS WP-245 (seam telemetry, top observability debt) → dogfood-050** — a single `chikory run` that makes the seam journal a durable `seam` entry so `chikory trace` stops reading `injections 0` on the catch; mirrors the WP-243 park seam's journaled `cause:"debug"` budget event (types + `recordSeamEvent` activity + agent-loop wire + `seams fired N` trace surfacing). **Update (2026-06-23, dogfood-050 review): WP-245 DELIVERED — the seam is now self-documenting.** dogfood-050 (`run-55eb5422-57f4-41b6-bec1-d91e24408b96`, runtime `a4e9665`, delivery uncommitted byte-IDENTICAL to the run workspace, `docs/reports/dogfood-050.md`) one-shot all 7 files (6 named + the entailed `schemas.ts` Zod-enum mirror): additive `"seam"` `JournalEntryKind`, a `recordSeamEvent` activity (idempotent `appendOnce` keyed on `seamEventIndex`, payload carries byteCount NOT content), the agent-loop wire inside the seam-fire guard, and the `chikory trace` ` · seams fired N` surfacing (additive, no-seam path byte-identical). `codex`/`gpt-5.5` SUCCESS in 1 step, all 5 grep-pins verbatim (F-49), judge `gemini-3.1-pro-preview` ✓ PROCEED 1/1 scope `✓`, $1.0340/$5 (20.6%), judge 0.7%, **770k/6.5k tokens (series high)**; full SDK suite 451 passed re-verified incl. the `verdict-gating` "seedBadDiff ARMED" Temporal path (the new activity is registered, not just unit-mocked). **F-47 → WP-245 CLOSED in code** — the seeded-catch proof now survives in a durable `seam` journal entry + the trace, not three-blob byte-archaeology. Minor residual **F-52** (telemetry unit-proven but not yet observed live; instruments-not-arms by design → confirm on the next armed run or add a one-line assertion — NOT a scaffold-hosted re-run; folds into WP-245). **THE CHOSEN NEXT HEADLINE IS WP-207 (pacing telemetry) → dogfood-051** — the seam saga is settled, so the loop pivots to the most-cited UNSOLVED pillar (context-rot/token-economics, 387k–793k input tokens/step every report): WIRE the existing pure `decideContextWindowPacing` (dogfood-031) INTO the live agent loop + journal a durable replay-safe `pacing` entry each step (the `"pacing"` kind already exists, NO contract change) + surface `pacing events N` in `chikory trace` — the IDENTICAL gap-pattern WP-245 just closed for the seam, and the documented FA-3/SE-2 remaining work. Gate verdicts ✅✅✅ PROCEED.

**Prior status (2026-06-21): WP-241 chain-level child approval/resume is DOGFOOD-PROVEN LIVE, and WP-243's park-injection seam is what proved it** (`chain-1bfb9d13-6c3f-4f9d-bcb0-abba4d6730df`, runtime `4dfcac1` WP-243 seam on `8918219` WP-241 substrate, delivery landed `4730e98`; `docs/reports/dogfood-044.md`). The dogfood-044 re-run finally exercised the path end-to-end: node B **parked** at step 0 via `debug.parkBeforeStep` (`budget_event` halt, `cause:"debug"`, `budgetUsd 0.05`), the chain surfaced it, a single `chikory chain resume <chain-id> --add-budget 5` topped up (+$5 → `budgetUsd 5.05`) and drove the chain to **SUCCESS 2/2 with the parent worker attached** — only the *trigger* is synthetic; `childParkedState`/`followChain` surfacing + chain-resume are the real WP-241 path. Decomposition propagated node-a budgetUsd 11.95 / node-b budgetUsd **0.05**, both durable nodes ran family-diverse (`gpt-5.5` exec / `gemini-3.1-pro-preview` judge), node B built on node A's artifact via the WP-239 handoff (dependent `formatResumeReport` import), harvest reconciled 4 byte-IDENTICAL files (AC-1/AC-2 re-verified green: vitest + tsc + eslint exit 0). $0.61133 / $12 (5.1%), judge 1.25%, ≈456k input tokens, ≈2m59s wall, F-11-closed `s0 j@0` held for both productive steps. **WP-241 → 🟢, WP-243 → 🟢, F-42 closed live.** First attempt (`chain-bc247058-…`) couldn't park (node B one-shotted → F-44 → built WP-243); one false-start re-run (`chain-8c303011-…`) FAILED because it cloned a HEAD that already held the deliverables (committed `b0ca2b7`) → empty diff → non-empty-diff guard sealed node-a FAILED after burning ≈$0.2714 → **new F-45** (WP-228 redundant-run precheck must cover `chikory chain`). **Top next: wire WP-228** (run acceptance checks against the clean baseline before launch; refuse/warn unless `--force`) — it now has two chain/run empirical proofs of wasted no-op runs. Earlier: WP-239 artifact-backed fan-in is DOGFOOD-PROVEN (dogfood-043 SUCCESS 3/3, `chain-6f1bf0ee-…`, `docs/reports/dogfood-043.md`).

**Historical status through dogfood-029**: Phase 0 complete (2026-06-10); **Phase 1 complete (2026-06-11)**; **P2 underway**. Twenty-eight dogfood campaigns reached first-attempt SUCCESS (dogfood-017 the lone FAILED). **dogfood-029 (`run-74f88081`) delivered WP-203 S2 — the pure compaction digest-prompt half**: `DIGEST_SYSTEM_PROMPT` (a frozen `[...].join("\n")` system prompt: fold older step summaries into one faithful prose digest, preserve decisions/file+symbol names/open threads, drop redundancy, prose-only no JSON) + `buildDigestMessages(toDigest: readonly string[]): Message[]` (a pure builder returning `[{role:"system",…}, {role:"user", content:<numbered oldest→newest block under a header>}]`) in a new `src/runner/compaction-prompt.ts` — the analog of `planner/prompt.ts` / `judge/prompt.ts`, **no response schema** (the digest call returns PROSE), `Message` imported **type-only**, no `types.ts`/contract change. 3 files (new module + new test + single barrel re-export at `index.ts:74`), 4 new tests (298 pass / 19 skip, +4), harvested byte-`IDENTICAL` + staged on `main`. **With the S4 trace renderer (dogfood-026), WP-203's entire pure surface is now exhausted**; the remaining S2 digest wiring (`planCompaction` → `buildDigestMessages(plan.toDigest)` → router fold → `store.put` behind a Memory Pointer (WP-202) → journal `CompactionResult` with `digestRef`) is non-pure hand-design (TASK-PROTOCOL §4) and **stays blocked on the WP-202 store wiring**. Clean SUCCESS in ONE step, no probe (F-11 stays closed, `s0 j@0`, **eighth** straight run); no new friction; F-30 did not recur. **Cost-trend update:** input tokens came in at **462k** — low band for the nine-slice series (021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k → 028 410k → 029 462k), tracking neither diff size nor run order — per-step input cost is *noisy, not monotonic*; WP-203/WP-207 stay queued as a variance/ceiling lever. **Next dogfood: WP-201 Python-SDK parity — port the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` + `build_digest_messages(to_digest)` in a new `packages/sdk-py/src/chikory/compaction_prompt.py`, the Python parity of dogfood-029, source-of-truth the TS module; `Message` already ported at `chikory/types.py:87`, no contract change; dogfood-030): the TS pure surface is now exhausted, so the dogfoodable thread is dual-SDK parity (🟢, plan.md §6) — vendor-neutral dual SDK is a launch requirement and the core contracts already landed in `sdk-py` (dogfood-002 `run-2899005b`). **Earlier: dogfood-028 (`run-7681a607`) delivered WP-202 / CM-3 — the pure Memory Pointer decision + reference renderer**: `shouldPointerize(bytes, policy)` + `formatPointerReference(ref)` (`src/runner/memory-pointer.ts`) — a pure threshold predicate (`bytes > policy.maxInlineBytes`; exactly-at-threshold inlines) plus a pure single-line renderer over the frozen `ArtifactRef` (`[memory <kind> <12-char id>] <bytes>B — <summary>`, the `id.slice(0, 12)` convention shared with the WP-203 S4 trace renderer); the analog of the judge's `buildVerdict` / planner's `buildPlanVerdict` / dogfood-027's `evaluateBaselinePrecheck`. 3 files (new module + new test + single barrel re-export), 5 new tests, harvested byte-`IDENTICAL` + staged on `main`, `ArtifactRef` imported **type-only**, no `types.ts`/contract change (local policy type). **Remaining WP-202 is the non-pure wiring** (intercept a tool output → `shouldPointerize(output.bytes, policy)` → if true `store.put(...)` then inject `formatPointerReference(ref)`, else inline, TASK-PROTOCOL §4) — the first step toward unblocking WP-203 S2 digest wiring. Clean SUCCESS in ONE step, no probe (F-11 stays closed, `s0 j@0`, **seventh** straight run); no new friction; F-30 did not recur. **Cost-trend update:** input tokens came in at **410k** — a **new low** for the eight-slice series (021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k → 028 410k), tracking neither diff size nor run order — per-step input cost is *noisy, not monotonic*; WP-203/WP-207 stay queued as a variance/ceiling lever. **Next dogfood: WP-203 S2 — the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` + `buildDigestMessages(toDigest)` in a new `src/runner/compaction-prompt.ts`, the analog of `planner/prompt.ts`/`judge/prompt.ts`, dogfood-029): the pure prompt regime for the compaction LLM digest call over the already-frozen `CompactionPlan.toDigest` + `Message`, no contract change — the remaining *pure* piece of the WP-203 S2 digest path (the router call + `store.put` of the digest behind a Memory Pointer + `CompactionResult` journal write stays non-pure hand-design). **Earlier: dogfood-027 (`run-f97a0e63`) delivered WP-228 S1 — the pure launch-baseline-precheck decision**: `evaluateBaselinePrecheck(results): BaselinePrecheckResult` (`src/cli/precheck.ts`) — given the exit codes of a spec's acceptance `check`s run against the clean baseline, partitions them into `passedIds`/`failedIds` (input order preserved, inputs not mutated), sets `satisfied = results.length > 0 && failedIds.length === 0`, and builds a one-line `summary` for the launch warning; the analog of the judge's `buildVerdict` / planner's `buildPlanVerdict`, the redundant-run guard dogfood-017 F-25 demanded. 3 files, 5 new tests, harvested byte-`IDENTICAL` + staged on `main`, no contract/`types.ts` change (local result types). **Remaining WP-228 is the non-pure launch-path wiring** (run each `check` against the baseline `child_process` → `evaluateBaselinePrecheck` → warn / refuse unless `--force`, TASK-PROTOCOL §4); input tokens 527k, low band. **Earlier: dogfood-026 (`run-f9d699d4`) delivered WP-203 S4 — the pure compaction-trace renderer**: `formatEntryLine` (`src/cli/trace.ts`) gains a `case "compaction"` (placed before `case "terminal"`) casting `entry.payload as CompactionResult` and rendering `[ts] compaction <before>→<after> tokens` via the existing `formatTokens`, then ` (digest <12-char id>)` or ` (no digest)`. 2 files (additive edit to one source + two new tests), harvested byte-`IDENTICAL`, no contract/router/loop/journal-format change; `CompactionResult` re-checked field-for-field against `types.ts:362`; both digest-present and digest-absent branches tested. **WP-203's pure trace surface is now complete** (S4) — the compaction JIF entry is legible in `chikory trace --watch`. Clean SUCCESS in ONE step, no probe (F-11 stays closed, `s0 j@0`, **fifth** straight run); no new friction; F-30 did not recur. **Cost-trend update:** input tokens came in at **807k** (mid-band — above 023's 451k / 025's 467k, below 022's 969k / 024's 976k) for the *smallest* diff of the six adjacent pure slices (2940 bytes); the series now reads 862k → 969k → 451k → 976k → 467k → 807k, tracking neither diff size nor run order — per-step input cost is *noisy, not monotonic*; WP-203/WP-207 stay queued as a variance/ceiling lever. **Earlier: dogfood-025 (`run-0d39fd12`) delivered WP-219 S2b's verdict-assembly half** — the pure `buildPlanVerdict` (`planner/meta-judge-verdict.ts`, mirroring the judge's `buildVerdict`): turns a schema-valid `{ kind, rationale }` plan-judge reply into a validated `PlanVerdict`, folding the landed pure `planCoverageGaps` in as a **deterministic coverage override** (code, not the LLM, downgrades `PROCEED`→`REVISE` and appends the override clause when a goal criterion is uncovered; `uncoveredCriteria` populated). 3 files, harvested byte-`IDENTICAL`, no contract/router/loop/judge/coverage change, 5 new tests; `PlanVerdict` shape re-checked field-for-field against `types.ts:475`. **WP-219's entire pure surface is now complete** — S2 planner (prompt + assembly) and S2b plan meta-judge (prompt + verdict assembly) both mirror the executor judge symbol-for-symbol; everything left in WP-219 is non-pure / hand-design (the `decompose` wrapper + plan-judge harness, TASK-PROTOCOL §4). Clean SUCCESS in ONE step, no probe (F-11 stays closed, `s0 j@0`, **fourth** straight run); no new friction; F-30 did not recur. **Cost-trend update:** input tokens fell back to **467k** (the low band, next to dogfood-023's 451k, less than half dogfood-024's 976k) — the five adjacent pure slices now trace a clean sawtooth (862k → 969k → 451k → 976k → 467k), confirming per-step input cost is *noisy, not monotonic*; WP-203/WP-207 stay queued as a variance/ceiling lever, not a runaway-trend fix. **Earlier: dogfood-024 (`run-28073328`) delivered WP-219 S2b's PROMPT half** — the pure plan meta-judge prompt regime (`planner/meta-judge-prompt.ts`: `PLAN_JUDGE_SYSTEM_PROMPT` + `PLAN_VERDICT_RESPONSE_SCHEMA` + `buildPlanJudgeMessages`, mirroring `judge/prompt.ts`; schema verified field-for-field against the frozen `PlanVerdict`), 3 files, harvested byte-`IDENTICAL`, 5 new tests; clean one-step SUCCESS, no probe; input tokens hit 976k (since shown to be a sawtooth peak, not a ratchet). **Earlier: dogfood-023 (`run-2d40ded5`) delivered WP-219 S2 Slice 2** — the pure plan-assembly half (`planner/assemble.ts`: `buildPlan(reply, input, opts): Plan` + `BuildPlanOptions`, mirroring the judge's pure `buildVerdict`), assembling a validated `Plan` from the planner's schema-valid `{ nodes }` reply with three structural checks (non-empty / unique ids / no dangling `dependsOn`), 3 files, harvested byte-`IDENTICAL`, no contract/router/loop change. **WP-219 S2's pure surface is now complete** (prompt half + assembly half); the only S2 piece left is the non-pure `decompose` wrapper (hand-design, TASK-PROTOCOL §4). Clean SUCCESS in ONE step, no probe (F-11 stays closed, `s0 j@0`); no new friction; F-30 did not recur. **Cost-trend update:** input tokens fell to **451k** (the lowest of the last four runs, ~half dogfood-022's 969k) for a comparably small change — so the 022 "climbing input tokens" worry is noise, not a one-way ratchet; WP-203/WP-207 stay queued but the trend is not monotonic. **Earlier: dogfood-022 (`run-499218ef`) delivered WP-219 S2 Slice 1** — the pure goal-planner prompt half (`planner/prompt.ts`: `PLANNER_SYSTEM_PROMPT` + `PLAN_RESPONSE_SCHEMA` + `buildPlannerMessages`, mirroring `judge/prompt.ts` symbol-for-symbol), 3 files, harvested byte-`IDENTICAL`, no contract/router/loop change. **F-11 is now CLOSED — by observation.** This was the kill-test dogfood-021 named: the first real run on post-Slice-B code where the executor emits `CHIKORY_TASK_COMPLETE`. The chain fired end-to-end — step 0's summary carried the marker → `claimsComplete === true` → `isCompletionMilestone` fired the judge off-cadence on the productive step → SUCCESS sealed in **ONE step, no empty-diff probe step** (`components over time: s0 j@0`, vs the `s0 s1 j@1` F-11 signature of all twenty predecessors). No new friction; F-30 did not recur. **Watch-item:** the productive step cost $1.26 on **969k input tokens** (campaign high; 019 921k, 020 646k, 021 862k) — with the probe gone, input-side cost (WP-203 compaction / WP-207 pacing) is now the next reliability lever. **Earlier: dogfood-021 (`run-91eced6b`) delivered WP-221 Slice B** — `claimsCompleteFromSummary` in `executors/step.ts` reads the executor's completion marker out of `parsed.summary` and sets `StepRecord.claimsComplete` on the SUCCESS branch; Slice A's `isCompletionMilestone` already ORs it into the WP-217 trigger (marker protocol + Slice A trigger + Slice B consumption all landed; F-11 paid one last time at 26.6 % there because that run ran pre-Slice-B HEAD). **Architect wall cleared by hand (2026-06-14)** — four blocking items landed so the headline P2 pillars are dogfoodable again: **(1)** WP-218 token gate landed end-to-end (pure `estimateNextStepTokens`/`tokenBudgetBreached` + agent-loop wiring gated on `budgetTokens` + the additive `budget_event` `cause?`/`remainingTokens?` shape + integration test; token breach → resumable FAILED, no top-up channel); **(2)** the F-11 probe-retirement proof now exists end-to-end (`agent-loop.test.ts`: a productive non-empty step that `claimsComplete` is judged directly, run seals SUCCESS in ONE step, no probe); **(3)** WP-219 S2 planner *function* contract frozen (`PlanInput`/`GoalPlanner` + pure `planCoverageGaps`); **(4)** WP-203 compaction contract frozen (ADR-006: checkpoint-boundary compaction, `CompactionPolicy`/`CompactionPlan`/`CompactionResult` + pure `planCompaction`). All green (TS 263 pass, py 47 pass). Next dogfood: **WP-228 S1 — the pure launch-baseline-precheck decision** (`evaluateBaselinePrecheck(results): BaselinePrecheckResult` in a new `src/cli/precheck.ts`, the analog of the judge's pure `buildVerdict` and the planner's `buildPlanVerdict`) — turns the exit codes of a spec's acceptance `check`s, run against the clean baseline, into a `{ satisfied, passedIds, failedIds, summary }` verdict so a redundant run can be warned/refused (dogfood-017 F-25); local result types, **no `types.ts`/contract change** (the `PlanJudgeReply` precedent), so it needs nothing un-landed; dogfood-027. The non-pure half (run each `check` against the baseline → `evaluateBaselinePrecheck` → warn / refuse unless `--force`) is the hand-design follow-up (TASK-PROTOCOL §4). WP-203's pure surface is now exhausted (S4 trace renderer done, dogfood-026); its remaining slices are the **S2 digest wiring** (blocked on the WP-202 Memory Pointer store) and the S3 recall-tier projection (no frozen pure contract yet). WP-219's pure surface is also exhausted, so its remaining pieces (the non-pure `decompose` impl + plan-judge harness — router call + parse + verdict assembly) are hand-design follow-ups (TASK-PROTOCOL §4, LLM call). (dogfood-022 pure token-math spec withdrawn — subsumed by item 1.) · **Plan date**: 2026-06-09 · **Stage 1 deadline (per spec §10)**: ~2026-09-07 (90 days)

---

**Current dogfood update (2026-06-20)**: 🔴 **dogfood-041
(`run-a28655c9-3e5e-456a-bd90-becfdeddff2a`) — THE FIRST CHAIN DOGFOOD shipped its
deliverable but NOT its purpose.** It was specced and queued to launch with the new
`chikory chain` verb (decompose a goal → plan meta-judge gate → each node a
judge-gated child run through `chainLoop`), but it was launched with **`chikory
run`** and sealed a clean single-run SUCCESS: 1 step, plain `run-` id, **no
`.chikory/chains/` directory, no `…-node-…` child runs**, the step `plan item` ==
the goal verbatim (no decomposition), only the per-step executor judge (no
planner, no plan meta-judge). The *feature* the goal asked for landed correctly —
the `chikory trace <chain-id>` CLI branch (`cmdTrace` falls back to
`chainJournalPath` → `ChainJournal` → `chainRecordFrom` → `renderChainTrace`,
run-journal authoritative on id collision; 2 files +138/−6, 2 new tests, harvested
IDENTICAL + staged uncommitted, AC-1/2/3 green) — so the chain *forensics surface*
now exists, built ironically by a non-chain run. **But the chain executor has
never run against a real goal: WP-219's durable-multi-run thesis still has ZERO
end-to-end dogfood evidence after 40 campaigns.** New friction **F-32** (a
`run`-vs-`chain` launch mismatch is mechanically invisible — the spec format is
identical and nothing flagged it; the F-11 one-step streak camouflaged the miss),
spawning **WP-232** (chain-launch verification: `dogfood-verify.sh` must flag a
chain-intended spec that produced only a single run journal, or `chikory run` must
refuse a `mode: chain` spec). _The "Nth straight one-step SUCCESS" KPI is now
actively harmful — it camouflaged F-32; the dogfood-039 call to retire it is
upgraded to urgent._ **Attempt 2 (Path A: delivery reverted, docs landed
`a6880f3`, re-launched with `chikory chain`) finally engaged the chain path — the
planner SUCCEEDED and decomposed a real goal into a multi-node Plan — but died at
the plan meta-judge gate on a transient `transport error: fetch failed` (router
retried 5×), aborting host-side before `startChain` with ZERO persisted state (no
`ChainJournal`, the Plan thrown away).** Two more frictions: **F-33** (the chain's
host-side decompose+gate is non-durable — a transient infra fault is fatal,
unrecoverable, and conflated with a substantive plan rejection → **WP-233**) and
**F-34** (`dogfood.sh` assumes any in-use :8787 is a healthy proxy with no health
check → **WP-234**, now addressed: `dogfood.sh:80-95` health-probes and
kills+restarts a dead listener). **Attempt 3 (2026-06-20, proxy healthy) got the
FURTHEST yet: the planner LLM call AND the plan meta-judge LLM call BOTH
succeeded** (`gpt-5.5 · 13845ms` planner + `gemini-3.1-pro-preview · 5468ms`
judge, family-diverse) — then the gate died on **its own schema bug** (`plan
meta-judge reply failed schema validation: unrecognized_keys 'uncoveredCriteria'`).
New friction **F-35** (FIXED this session → **WP-235**): the meta-judge response
schema `required` `uncoveredCriteria` and the system prompt told the model to emit
it, but the parse schema `PlanJudgeReplySchema` was `.strict()` over only
`{ kind, rationale }` and rejected it — a deterministic 100%-fail contradiction
the unit tests missed because they mocked replies *without* the field. Fix:
`schemas.ts` `PlanJudgeReplySchema` now accepts
`uncoveredCriteria: z.array(z.string()).default([])` (the deterministic
`planCoverageGaps` floor stays authoritative; model value advisory) + a
regression test feeding the real reply shape (`tsc` clean, 13 meta-judge tests
pass). **Attempt 4 (2026-06-20, F-35 fixed) went one layer deeper: the planner
decomposed a clean 2-node plan AND the meta-judge LLM returned PROCEED with a
sound rationale mapping every node to every AC — then the DETERMINISTIC coverage
floor overrode PROCEED→REVISE and stopped the chain** (`coverage override: plan
leaves goal criteria uncovered: AC-1, AC-2, AC-3 - cannot PROCEED`). New friction
**F-36** (FIXED this session → **WP-236**): `planCoverageGaps` (`coverage.ts:21`)
marks a goal criterion covered only if some node carries an AC with the *same
id*, but the planner prompt + spec told the planner to invent its own per-node
criterion ids — so zero id overlap → every correct plan rejected 100% of the
time (another deterministic trap like F-35). Fix: `PLANNER_SYSTEM_PROMPT` +
`buildPlannerMessages` (`prompt.ts`) now instruct the planner to reuse each goal
criterion id VERBATIM on the node(s) that cover it (coverage matched by id, not
wording); floor unchanged as a genuine safety net; regression test added (41
planner tests pass). Highest friction is now **F-36** (fixed). See
`docs/reports/dogfood-041.md` (Addendum — Attempt 4). **The last GATING blocker is
now removed: re-launch `devbox run dogfood` (the SDK rebuild picks up the prompt
fix) — a PROCEED can finally flow into `startChain`/`chainLoop` and the nodes can
execute. Harden the planning-layer durability separately (WP-233).** 🎉
**ATTEMPT 5 (2026-06-20): THE CHAIN RAN END-TO-END — the thesis pillar is PROVEN
to run.** Plan gate PROCEED → node `resolve-id-and-render-trace` SUCCESS (PROCEED
2/2, 1 step, changes made 1, $1.44) → node `verify-and-test` FAILED (HALT, 3 steps,
**changes made 0**) → chain FAILED 1/2 (`chain-d3794c24-…`). Durable 2-node chain
(`.chikory/chains/chain-d3794c24-…/chain.db` + 2 per-node run journals),
per-node judge gating, **the judge HALTing a stuck empty-diff node after 3
consecutive failures** (true positive — budget/goal-drift guard), and
halt-on-FAILED chain semantics ALL worked. It FAILED only on the deferred **S4
context handoff (F-37 → WP-237, the now-top-priority keystone)**: node 2 depended
on node 1 but ran against a fresh HEAD clone WITHOUT node 1's diff
(`chain-loop.ts:87` spawns each node from `template.repos`/HEAD, no
`parentRunId`), so it had nothing to verify. Secondary: the planner emitted a
verification-only node with no diff of its own — **F-38 → WP-238, FIXED this
session** (`PLANNER_SYSTEM_PROMPT` now requires every node to produce a non-empty
diff and forbids verify-only/test-only nodes; each node is already
independently judge-gated; regression test added, 6 prompt tests pass). Highest
friction is now **F-37** (queued, critical path). See `docs/reports/dogfood-041.md`
(Addendum — Attempt 5). **Next: build WP-237 (S4 context handoff — base a node's
workspace on its predecessor's sealed checkpoint) by hand, then re-launch for the
first GREEN dependent chain. Until S4, only single/independent-node chains can go
green (no compounding-error coverage).** **Earlier: dogfood-039
(`run-6bb8ac7e-3f4c-4421-aa1c-d777a33070ba`) delivered **WP-201 dual-SDK parity —
the Python chain-state reducer**, a 1:1 port of the dogfood-038 TS reducer now
that WP-219's TS chain-executor pure surface is exhausted (dogfood-037/038):
`derive_chain_status(record) -> ChainStatus` (the four-rule, first-match-wins
ADR-005 §S3 precedence — ESCALATE→`AWAITING_PLAN_APPROVAL`, FAILED→`FAILED`,
all-nodes-SUCCESS→`SUCCESS`, else `RUNNING`) + `advance_chain(record, node_id, outcome) -> ChainRecord`
(a pure immutable fold of one sealed node's `NodeOutcome` into `node_outcomes`,
then recompute `status`) in a new `packages/sdk-py/src/chikory/chain_advance.py`,
mirroring the TS `src/chain/advance.ts` source-of-truth symbol-for-symbol.
`ChainRecord`/`NodeOutcome`/`ChainStatus` reused from `chikory/types.py`;
re-exported from `__init__.py` (alphabetical import + sorted `__all__`); 6 pytest
cases in a new `test/test_chain_advance.py` mirroring the TS
`test/chain/advance.test.ts` builder shape 1:1. No `types.py`/contract change —
the dogfood-035/036 parity pattern. Clean SUCCESS in ONE step, no probe (F-11
stays closed, `s0 j@0`, **sixteenth** straight run); harvested byte-`IDENTICAL`,
uncommitted on the working tree (pending the user's review). 80 py tests green
(+6), pyright + ruff clean; no new friction (highest stays F-31); F-30 did not
recur. **Cost-trend update:** input tokens came in at **755k** — the
**Python-parity-series high** (035 318k → 036 398k → 039 755k), high-mid for the
whole one-step pure-slice series; the series now reads 021 862k → 022 969k →
023 451k → 024 976k → 025 467k → 026 807k → 027 527k → 028 410k → 029 462k →
030 434k → 031 375k → 033 327k → 034 594k → 035 318k → 036 398k → 037 793k →
038 625k → 039 755k (032 excluded — 2-step), tracking neither diff size nor run
order; per-step input cost is *noisy, not monotonic*; WP-203/WP-207 stay queued
as the input-side variance/ceiling lever. _Cosmetic nit, no WP: the delivered
`chain_advance.py` reassigns `outcomes = record.node_outcomes.values()` twice (the
second is dead) — behavior-identical, ruff/pyright clean, flagged in
`docs/reports/dogfood-039.md` for an optional one-line cleanup._ **WP-219's S3-pure
primitive set stays complete** (`readyNodes` + `hasDependencyCycle` +
`advanceChain` + `deriveChainStatus`), with the **S3-wiring substrate hand-landed
(2026-06-20, TASK-PROTOCOL §4, uncommitted):** the Temporal-native chain executor
— `ChainJournal`/`chainRecordFrom` (D4 store, `src/chain/store.ts`), the
`chainLoop` workflow (`readyNodes` → `executeChild(agentLoop)` → `advanceChain`
fold → `node_started`/`node_sealed` journaling, halt on `FAILED`), chain
activities, and pure node→TaskSpec helpers; 360 TS pass (+15 chain tests).
**`chikory chain` CLI launch path hand-landed (2026-06-20, this session,
TASK-PROTOCOL §4):** the unlock that makes the chain executor dogfoodable
end-to-end — `cmdChain` (`src/cli/chain.ts`) parses a goal spec, decomposes it
host-side via `runPlannerPass`, gates it with the different-family
`runPlanJudgePass` (a non-PROCEED verdict stops the chain — v1, no auto-replan),
then `runner.startChain` drives the durable `chainLoop` and `followChain` polls
the `ChainJournal` to a terminal `ChainStatus`. New `chain` command wired in
`main.ts`; `startChain` added to the TemporalRunner; 4 new unit tests over the
decompose→gate seam (`test/cli/chain.test.ts`, 369 TS pass); no contract change.
Deferred: D3 halt-and-replan, S4 context handoff, parallel fan-out, S5
suspend/resume, the `chikory trace <chain-id>` branch (itself dogfood-041's
goal). **Next dogfood is dogfood-041 — THE FIRST CHAIN DOGFOOD** (WP-219 S3
end-to-end, launched with `chikory chain`): decompose a goal → gate → run each
node as a judge-gated child run through `chainLoop`. This breaks the 39-run
pure-leaf streak that never tested the thesis (durable multi-run execution +
compounding error + a real judge surface). **dogfood-040 (Python pacing parity)
is demoted to track-B regression coverage** — parity ports are not thesis
evidence; land them as normal PRs, not the dogfood headline. _Recommended KPI
change: retire "N straight one-step SUCCESS" as the health signal (it rewards
triviality); track real regressions the judge caught pre-land, successful
resumes, and measured per-step reliability over long horizons instead._


## Archived 2026-07-02 — plan.md §6 queue notes (was plan.md lines 324–422)

**Historical queue order through dogfood-029**: dogfood findings outrank the original listing. ~~WP-217~~, ~~WP-218 slice 1~~, ~~WP-220~~, ~~WP-222 slice 1~~, ~~WP-223 initial fix~~, ~~WP-224~~, ~~WP-225~~, ~~WP-209 trace slices~~, ~~WP-208 pure delivery slices~~, ~~WP-219 S1 contracts~~, ~~WP-219 `readyNodes`~~, ~~WP-219 `hasDependencyCycle`~~, ~~WP-226~~, ~~WP-227~~ (hand-landed `26b9964`), ~~WP-229~~ (dogfood-018 `run-59115f35`, F-27 closed), ~~WP-221 Slice A~~ (pure trigger half, dogfood-019 `run-d836635b`), ~~WP-230~~ (typecheck covers `test/**`, dogfood-020 `run-3575ba23`, F-29 closed), ~~WP-221 Slice B~~ (runner consumes the marker → `claimsComplete`, dogfood-021 `run-91eced6b` — the F-11 cost win), ~~WP-221 / F-11~~ (**closed by observation**, dogfood-022 `run-499218ef` — first marker-emitting run, one step, no probe), ~~WP-219 S2 prompt half~~ (`planner/prompt.ts`, dogfood-022 `run-499218ef`), ~~WP-219 S2 assembly half~~ (`planner/assemble.ts` `buildPlan`, dogfood-023 `run-2d40ded5` — S2 pure surface complete), ~~WP-219 S2b plan-judge prompt half~~ (`planner/meta-judge-prompt.ts` `buildPlanJudgeMessages`, dogfood-024 `run-28073328` — mirrors `judge/prompt.ts`), ~~WP-219 S2b verdict-assembly half~~ (`planner/meta-judge-verdict.ts` `buildPlanVerdict`, dogfood-025 `run-0d39fd12` — mirrors `buildVerdict`; **WP-219's pure surface complete**), ~~WP-203 S4 compaction-trace renderer~~ (`formatEntryLine` `case "compaction"`, dogfood-026 `run-f9d699d4` — **WP-203's pure trace surface complete**), ~~WP-228 S1 baseline-precheck decision~~ (`evaluateBaselinePrecheck`, `src/cli/precheck.ts`, dogfood-027 `run-f97a0e63` — the analog of `buildVerdict`/`buildPlanVerdict`; the non-pure check-execution + warn/`--force` wiring stays hand-design), ~~WP-202 / CM-3 Memory Pointer decision + renderer~~ (`shouldPointerize` + `formatPointerReference`, `src/runner/memory-pointer.ts`, dogfood-028 `run-7681a607` — the analog of `buildVerdict`/`evaluateBaselinePrecheck`; type-only `ArtifactRef`, no contract change; the interception + `store.put` + injection wiring stays non-pure hand-design), ~~WP-203 S2 compaction digest-prompt half~~ (`DIGEST_SYSTEM_PROMPT` + `buildDigestMessages(toDigest)`, `src/runner/compaction-prompt.ts`, dogfood-029 `run-74f88081` — the analog of `planner/prompt.ts`/`judge/prompt.ts`; type-only `Message`, no schema, no contract change; **WP-203's pure surface now exhausted**; the digest wiring stays non-pure hand-design, blocked on the WP-202 store), ~~WP-201 Python compaction digest-prompt parity~~ (`compaction_prompt.py`, dogfood-030 `run-1a97e2ca`), ~~WP-201 Python branch-target parity~~ (`branch_target.py`, dogfood-035 `run-b0bc3865`, committed `88e496c`, landing-scope MATCH), ~~WP-201 Python Memory Pointer parity~~ (`memory_pointer.py` `should_pointerize` + `format_pointer_reference` + local `MemoryPointerPolicy`, dogfood-036 `run-51645fbb` — mirrors the TS `runner/memory-pointer.ts`, `ArtifactRef` reused, no contract change; uncommitted on the working tree), ~~WP-219 S3-pure chain-state reducer~~ (`advanceChain` + `deriveChainStatus`, `src/chain/advance.ts`, dogfood-038 `run-61e8b0a1` — the `computeVerdict` analog per ADR-005 §S3; type-only contract imports, no contract change; uncommitted on the working tree), ~~WP-219 S6-pure chain-trace renderer~~ (`renderChainTrace`, `src/chain/trace.ts`, dogfood-037 `run-295b2947` — the pure chain analog of the per-run `renderTrace`; type-only `ChainRecord`/`PlanNode`/`ChainEntry` imports, no contract change; **WP-219's dogfoodable pure surface now exhausted**; uncommitted on the working tree), ~~WP-201 Python chain-state reducer parity~~ (`advance_chain` + `derive_chain_status`, `packages/sdk-py/src/chikory/chain_advance.py`, dogfood-039 `run-6bb8ac7e` — 1:1 port of the TS `src/chain/advance.ts` from dogfood-038; `ChainRecord`/`NodeOutcome`/`ChainStatus` reused, no contract change; harvested IDENTICAL + uncommitted on the working tree), and the **2026-06-14 hand-landed wall-clear** (~~WP-218 token gate~~ math+wiring+event-shape, the ~~F-11 e2e probe-retirement proof~~, the ~~WP-219 S2 planner contract~~, the ~~WP-203 compaction contract~~ ADR-006) are delivered. **Architect wall cleared by hand (2026-06-14)** — the four blocking items are landed (see the Status line): WP-218 token gate (math+wiring+event shape+test), the F-11 e2e probe-retirement proof, the WP-219 S2 planner function contract, and the WP-203 compaction contract (ADR-006). All green (TS 263 / py 47). **WP-228 S1 done** (dogfood-027 `run-f97a0e63`, harvested IDENTICAL + staged on `main`, pending commit): the pure launch-baseline-precheck decision `evaluateBaselinePrecheck(results): BaselinePrecheckResult` in `src/cli/precheck.ts` — turns the exit codes of a spec's acceptance `check`s, run against the clean baseline, into a `{ satisfied, passedIds, failedIds, summary }` verdict so a redundant run can be warned/refused (dogfood-017 F-25); local result types, no `types.ts` change; the non-pure half (run each `check` against the baseline `child_process` → `evaluateBaselinePrecheck` → warn / refuse unless `--force`) is the hand-design follow-up (TASK-PROTOCOL §4). **WP-202 / CM-3 pure decision+renderer done** (dogfood-028 `run-7681a607`, harvested IDENTICAL + staged on `main`, pending commit): `shouldPointerize(bytes, policy)` + `formatPointerReference(ref)` in a new `src/runner/memory-pointer.ts` — the pure decision of *when* a tool output is large enough to store externally and *how* to render the short context-facing reference (project.md Memory Pointer Pattern; CONTRACTS.md §5 / CM-3), the analog of `buildVerdict`/`evaluateBaselinePrecheck`; local policy type, type-only `ArtifactRef` import, no `types.ts` change; the non-pure half (intercept a tool output → `shouldPointerize` → `store.put` → inject `formatPointerReference`, else inline) is the hand-design follow-up (TASK-PROTOCOL §4) and the **first step toward unblocking WP-203 S2 digest wiring** (the Phase-2-exit compaction path). **WP-203 S2 pure digest-prompt half done** (dogfood-029 `run-74f88081`, harvested IDENTICAL + staged on `main`, pending commit): `DIGEST_SYSTEM_PROMPT` + `buildDigestMessages(toDigest): Message[]` in a new `src/runner/compaction-prompt.ts` — the pure prompt regime for the compaction LLM digest call over the already-frozen `CompactionPlan.toDigest` + `Message`, the analog of `planner/prompt.ts`/`judge/prompt.ts`; type-only `Message`, no response schema (prose output), no `types.ts` change. **WP-203's entire pure surface is now exhausted** (S4 trace renderer dogfood-026 + this S2 digest-prompt half); the non-pure S2 digest wiring (router fold `toDigest` → digest string → `store.put` behind a Memory Pointer → journal `CompactionResult`) is the hand-design follow-up (TASK-PROTOCOL §4) and **stays blocked on the WP-202 store**; S3 recall-tier projection has no frozen pure contract yet. **Next dogfood: WP-201 Python-SDK parity — port the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` + `build_digest_messages(to_digest)` in a new `packages/sdk-py/src/chikory/compaction_prompt.py`, the Python parity of dogfood-029; source-of-truth the TS `compaction-prompt.ts`; `Message` already ported at `chikory/types.py:87`, no contract change) — dogfood-030. The TS pure surface is exhausted, so the dogfoodable thread shifts to dual-SDK parity (🟢, plan.md §6, vendor-neutral launch requirement; the core contracts already landed in `sdk-py` via dogfood-002 `run-2899005b`). WP-219's pure surface is likewise exhausted (S2 planner + S2b plan meta-judge complete through dogfood-025). **WP-219 S2/S2b non-pure harnesses landed by hand 2026-06-19 (on `main`, staged):** `runPlannerPass` + `DecomposingPlanner` (`src/planner/harness.ts`) and `runPlanJudgePass` (`src/planner/meta-judge-harness.ts`) — the `decompose` router call + the family-diversity-enforced plan-judge pass, both failures-as-values, 15 new tests, no contract change. **Goal decomposition is now end-to-end runnable.** **Next value-driving work (hand-design, the keystone after dogfood-035): the S3 durable chain executor** — the Temporal workflow that loops the landed pure `readyNodes` over a meta-judge-gated `Plan`, spawns one child run per node from the predecessor checkpoint, threads `ChainRecord` state across runs, and halt-and-replans on node failure (ADR-005 D3/D4). The dogfoodable pure slice that falls out of it: a pure chain-state reducer (`advanceChain`/`deriveChainStatus` over `ChainRecord` + a node terminal result, the `computeVerdict` analog) — write the ADR D3/D4 transition rules by hand first, then dogfood the reducer. (dogfood-022 pure token-math spec withdrawn — the math landed with the wiring.) **Stale-text correction (2026-06-19):** the WP-202 interception wiring and WP-203 S2 digest wiring are **landed on `main`** (not on the obsolete `feat/wp-202-203-memory-compaction-wiring` branch, which is behind `main`). Rationale: `docs/reports/dogfood-002.md` through `docs/reports/dogfood-027.md`.

**Current queue note (dogfood-034 review)**: WP-205's pure surface is now
**complete** — dogfood-033 `run-41dd7c98` landed `parseBranchTarget`, dogfood-034
`run-1634171d` (`docs/reports/dogfood-034.md`) landed `branchNameForTarget`, both
verified in one step with no new friction. The remaining WP-205 work — the actual
`chikory branch` CLI command, the journal fork, and the git worktree creation —
is non-pure hand-design (TASK-PROTOCOL §4), the architect's next move, not a
dogfood run. With both the TS WP-205 pure surface and the broader TS pure backlog
thin, the dogfoodable thread shifts back to dual-SDK parity (the dogfood-030
pattern). **WP-201 branch-target parity done** (dogfood-035 `run-b0bc3865`,
harvested IDENTICAL, committed `88e496c` on `main`, landing-scope MATCH —
`docs/reports/dogfood-035.md`): `parse_branch_target` + `branch_name_for_target`
in a new `packages/sdk-py/src/chikory/branch_target.py` (local frozen
`BranchTarget` dataclass, not in `types.py`), mirroring the TS
`src/cli/branch-target.ts` source-of-truth behavior-for-behavior, re-exported
from `__init__.py`, 16 pytest cases, no contract change; clean one-step SUCCESS,
no probe (F-11 closed, twelfth straight), input tokens 318k (series low), no new
friction. **WP-201 Memory Pointer parity done** (dogfood-036 `run-51645fbb`,
harvested IDENTICAL + uncommitted on the working tree —
`docs/reports/dogfood-036.md`): `should_pointerize` + `format_pointer_reference`
+ a local frozen `MemoryPointerPolicy` in a new
`packages/sdk-py/src/chikory/memory_pointer.py`, mirroring the TS
`runner/memory-pointer.ts` source-of-truth byte-for-byte, `ArtifactRef` reused
from `chikory/types.py:197`, 5 pytest cases, no contract change; clean one-step
SUCCESS, no probe (F-11 closed, thirteenth straight), input tokens 398k, no new
friction (highest stays F-31). **WP-219 S3-pure chain-state reducer done**
(dogfood-038 `run-61e8b0a1`, harvested IDENTICAL + uncommitted on the working
tree — `docs/reports/dogfood-038.md`): `deriveChainStatus` (four-rule precedence
ESCALATE→AWAITING_PLAN_APPROVAL / FAILED→FAILED / all-SUCCESS→SUCCESS / RUNNING)
+ `advanceChain` (pure immutable node-fold) in a new
`packages/sdk-ts/src/chain/advance.ts`, the `computeVerdict` analog and sibling
of the landed `readyNodes`/`hasDependencyCycle`; type-only contract imports,
re-export at `index.ts:72`, 6 vitest cases; no contract change. Clean one-step
SUCCESS, no probe (F-11 closed, fourteenth straight), input tokens 625k, no new
friction (highest stays F-31). **WP-219 S3-wiring substrate hand-landed**
(2026-06-20, TASK-PROTOCOL §4, uncommitted on the working tree): the
Temporal-native chain executor — `ChainJournal`/`chainRecordFrom` (D4 store),
the `chainLoop` workflow (`readyNodes` → `executeChild(agentLoop)` →
`advanceChain` fold → `node_started`/`node_sealed` → halt on FAILED), chain
activities, and pure node→TaskSpec helpers; 360 TS pass (+15 chain tests). D3
replan, S4 handoff, parallel fan-out, S5, and CLI glue deferred. **WP-219 S6
pure chain-trace renderer done** (dogfood-037 `run-295b2947`, harvested
IDENTICAL + uncommitted on the working tree — `docs/reports/dogfood-037.md`):
`renderChainTrace(record, entries): string` in a new
`packages/sdk-ts/src/chain/trace.ts`, the pure chain analog of the per-run
`renderTrace` — a six-line render (header `chain <planId> · <status> · <N> nodes
· <S>/<N> succeeded` + `goal:` + 60-rule + per-node rows in plan order with
deps/run/outcome cell + `totals:` footer + an optional `failed: <reason>` line
from a `terminal` FAILED `ChainEntry`); type-only `ChainRecord`/`PlanNode`
(`../types.js`) + `ChainEntry` (`./store.js`) imports, re-export at
`index.ts:73`, 5 vitest cases (365 TS pass / 19 skip, +5), no contract change;
clean one-step SUCCESS, no probe (F-11 closed, fifteenth straight), input tokens
793k, no new friction (highest stays F-31). **WP-219's entire dogfoodable pure
surface is now exhausted** (`readyNodes` + `hasDependencyCycle` + `advanceChain`
+ `deriveChainStatus` + `renderChainTrace`); what remains is non-pure
hand-design (the `chikory trace <chain-id>` CLI branch loading `ChainJournal` →
`renderChainTrace`, S3-wiring D3 replan, S4 handoff, S5 suspend/resume —
TASK-PROTOCOL §4). **WP-201 Python chain-state reducer parity DONE** (dogfood-039
`run-6bb8ac7e`, harvested IDENTICAL + uncommitted on the working tree —
`docs/reports/dogfood-039.md`): `advance_chain` + `derive_chain_status` in a new
`packages/sdk-py/src/chikory/chain_advance.py`, a 1:1 port of the TS
`src/chain/advance.ts` (dogfood-038) — the four-rule ADR-005 §S3 precedence + the
pure immutable node-fold, `ChainRecord`/`NodeOutcome`/`ChainStatus` reused from
`chikory/types.py`, re-export from `__init__.py`, 6 pytest cases (80 py green,
+6), no contract change; clean one-step SUCCESS, no probe (F-11 closed, sixteenth
straight), input tokens 755k (series high), no new friction. **The `chikory
chain` CLI launch path then landed by hand (2026-06-20, TASK-PROTOCOL §4) so the
chain executor is dogfoodable end-to-end** — `cmdChain` (`src/cli/chain.ts`)
decomposes a goal host-side (`runPlannerPass`), gates it with the
different-family `runPlanJudgePass`, then `runner.startChain` drives the durable
`chainLoop` and `followChain` polls the `ChainJournal` to terminal; `chain`
command wired in `main.ts`, `startChain` added to the TemporalRunner, 4 unit
tests over the decompose→gate seam (369 TS pass), no contract change. **dogfood-041
(`run-a28655c9`) was THE FIRST CHAIN DOGFOOD on paper but DID NOT exercise the
chain path** — it was launched with `chikory run`, not `chikory chain`, and sealed
a single-run SUCCESS that delivered the `chikory trace <chain-id>` branch correctly
(harvested IDENTICAL + staged uncommitted — `docs/reports/dogfood-041.md`) while
never invoking the planner, the plan meta-judge, or `chainLoop` (no
`.chikory/chains/`, no node runs, the goal ran verbatim in one step). **F-32 →
WP-232** (chain-launch verification: a `run`-vs-`chain` mismatch is mechanically
invisible today). **Path A taken (2026-06-20):** the single-run delivery
was reverted (`git restore`) and the docs landed (`a6880f3`), then the SAME spec
was re-launched with `chikory chain`. **Attempt 2 engaged the chain path** — the
planner decomposed a real goal into a multi-node Plan (first genuine end-to-end
decomposition) — but **died at the plan meta-judge gate** on a transient
`transport error: fetch failed` (router retried 5×), host-side before `startChain`,
leaving zero persisted state (no `ChainJournal`, the Plan thrown away). → **F-33**
(non-durable planning layer — a transient infra fault is fatal and conflated with
a substantive plan rejection, **WP-233**) + **F-34** (`dogfood.sh` assumes any
in-use :8787 is a healthy proxy with no health check, **WP-234**). **The first
REAL chain run (nodes actually executing) is STILL owed**: fix the proxy health
(WP-234, immediate unblock), verify the shim serves, re-launch `chikory chain`;
harden the planning layer separately (WP-233). **dogfood-040 (Python pacing parity) demotes to track-B regression
coverage** — parity is essential but it is not thesis evidence and should not be
the dogfood headline. _KPI change (now urgent — the one-step streak camouflaged
F-32): retire "N straight one-step SUCCESS" as the health signal; track real
regressions caught pre-land, successful resumes, and measured per-step reliability
over long horizons instead._

## Archived 2026-07-02 — DOGFOODING.md header run log (was DOGFOODING.md lines 8–517)

**LATEST (dogfood-073, `docs/reports/dogfood-073.md`): WP-233(b) part 1 LANDED — the
plan-gate failure NOTICE RENDERER (`renderPlanGateFailureNotice`, `src/chain/plan-gate-notice.ts`)
+ the `planAndGateChain` consumer WIRE (`src/cli/chain.ts:132-135`), the F-33 operator-facing
fix: a non-PROCEED plan-gate verdict now renders "INFRA fault, SAFE to re-run: …" vs
"REJECTED … NOT safe to re-run as-is: …" (raw-rationale fallback on null).** Single
`chikory run` (2nd consecutive correct launch), `run-a5f8c5fe-…`, runtime `008d3fd`,
SUCCESS 1 step $0.75/$5, PROCEED 2/2, full suite 574 passed | 19 skipped, harvest 4/4
byte-IDENTICAL. **The review's post-mortem of dogfood-072's step-1 AC-2 artifact re-framed
that run's retry tax (🔴 F-78 → WP-264, see §7):** the judge-check runner's 120 s timeout
does NOT reap the check's process tree — `runCheck` (`src/judge/evidence.ts:76`) kills only
the direct `/bin/sh`, and 072's post-kill AC-2 ran **695.9 s = 5.8× the cap** (vitest
tinypool `Failed to terminate worker`), reading as a substantive red AC that blocked the
already-available SUCCESS seal (F-79: `agent-loop.ts:470-478` seals on PROCEED +
all-criteria-pass after ANY step — the WP-263 short-circuit already exists; the check
infra was the blocker). Next headline: WP-264, port the WP-255(a) `runBounded` group-kill
to `runCheck` (dogfood-074).

**Earlier (dogfood-069, `docs/reports/dogfood-069.md`): WP-257's pure literal-preservation
verifier LANDED (`planLiteralGaps`/`extractGoalLiterals`, `src/planner/literal-preservation.ts`
+ 7-case test, the `planCoverageGaps` analog) → WP-257 🟡; SUCCESS 3 steps, $2.73/$5, full
suite 554 passed.** But the run **DOGFOODED ITS OWN BUG (🔴 F-70 → WP-261, see §7):** the
spec was authored single-`run` (header says "NOT a chain" 3×, *because a chain re-risks F-64*)
yet was launched as `chikory chain` — the **3rd consecutive launch-mode divergence** — and
F-64 recurred: the planner compressed the brief into a 2-sentence `node.goal` dropping **32 of
35** mandated literals (`WP-25`/`WP-255`/`assessSpecStaleness`/…); steps 1-2 burned ~63% of
cost failing AC-1, the run survived only because the F-49 grep pins persisted into the ACs.
**F-71 (🟢): running the DELIVERED `planLiteralGaps` over this run's own `(parent, node)` goal
returns exactly those 32 gaps — the verifier is proven correct against the LIVE defect, so the
§4 `runPlannerPass`/`buildPlan` REVISE wire (operator-landed / track-B) is the top remaining
WP-257 slice.**

**Earlier PROVEN PATH (dogfood-068, `docs/reports/dogfood-068.md`): the durable CHAIN landed
real open-WP product code end-to-end a SECOND consecutive time — the pillar is
repeatable.** A single-`run`-authored spec was again launched as `chikory chain`
(`chain-aa25aa5c-…`, runtime `e0da13f`) and SUCCEEDED 2/2: node-1 `precheck-module`
(pure `evaluateSpecStalenessPrecheck` + test) sealed SUCCESS → **node-2 cloned node-1's
handed-off tree (`baseCommit 4631f4d == node-1 head`) and consumed its module (WP-239
dependent handoff)** → node-2 `wire-precheck-cli` (the `commands.ts` wire) sealed
SUCCESS → chain SUCCESS ($1.6988, judge 0.62%, ~5m42s; AC re-run green tsc+eslint+547
vitest). This WIRED WP-256's spec-staleness gate LIVE — `cmdRun` now warns on a stale
spec at launch (F-65 orphan killed; WP-256 + WP-258 → 🟢). **A SHARPENED gotcha this
surfaced (see §7/§8): the chain planner paraphrase (F-64) can now leak past a GREEN
chain not just as wrong SEMANTICS (dogfood-067) but as wrong CONTRACT SHAPE.** The
planner dropped node-1's mandated interface fields + param shape, so the executor
shipped `evaluateSpecStalenessPrecheck` with NO `stale` field and POSITIONAL
`(specText, planText)` args (vs the mandated `{ targetWpId, stale, warning }` /
`{ goal, planText }`) — and it stayed GREEN because the AC grep pins symbol NAMES, not
interface SHAPES (`grep -q "stale"` matched the test's `.toContain("stale")` string),
and tsc/eslint only enforce internal consistency (**F-67 → WP-259**: assert the
type-shape, not just the name). The wire also reads the target WP from the whole yaml,
not `spec.goal` (**F-68 → WP-260**). **WP-257 is now triply-evidenced (066 HALT → 067
wrong semantics → 068 wrong contract)** — the durable-chain pillar's own root bug.

**Earlier (dogfood-067, `docs/reports/dogfood-067.md`): the FIRST durable chain to land
real open-WP product code** (`chain-d18a8c1b-…`, runtime `a4b8e7a`, SUCCESS 2/2,
$2.5073): node-1 `parseWpStatus` parser → node-2 `assessSpecStaleness` consumer via the
WP-239 handoff, closing the dogfood-066 gap (node A HALTed there, handoff never ran).
That run first surfaced F-64 (the planner dropped the "id in the FIRST cell / status in
the THIRD cell" positional rule → a divergent header-driven parser that still passed the
loose AC) and F-65 (the 4-files-only spec landed `assessSpecStaleness` ORPHANED).
**Harden every load-bearing literal/rule into the AC `check` / AC description (which
survive to the node verbatim), not just the goal prose (F-64 → WP-257).**

**CLOSED (dogfood-048, `docs/reports/dogfood-048.md`): the CHAIN-LEVEL judge-catch
is PROVEN.** The armed re-attempt of dogfood-047 landed the first chain-level
true-positive catch: in `chain-b7665e97-…` (delivery `2c516d5`), node A wrote a
correct `truncateDecimals` → SUCCESS, then node B (dependent, imports it via the
WP-239 handoff) wrote a correct `truncateToCents` at step 0, the WP-246 seam
(`CHIKORY_SEED_BAD_DIFF_NODE_INDEX=1`) overwrote it with `return value;`, node B's
cadence-1 judge re-ran AC-2 → `vitest exited 1` → deterministic override → **AC-2
FAILED (0/1), node B refused to seal SUCCESS (THE CATCH)** → executor restored a
correct impl from the failing-test feedback → node B SUCCESS → **chain SUCCESS
2/2.** Both dogfood-047 gaps were closed at spec-authoring time: **F-48** (the four
`CHIKORY_SEED_BAD_DIFF_*` vars were baked into the launch header AND the seam was
verified armed post-run — `debug.seedBadDiff` in node B `task_json`, node B took 2
steps) and **F-49** (each AC `check` `grep`s the mandated literals verbatim before
vitest, so the executor could not rewrite the gate). **WP-246 → 🟢 DOGFOOD-PROVEN.**
Two residuals carried forward: **WP-245** (the seam STILL journals no telemetry —
node B's trace reads `injections 0`, so the catch is invisible to `chikory trace`;
§8 — **the chosen next headline, dogfood-050**) and **WP-247** (arming still relies on
manual discipline — nothing in the launcher refuses a disarmed seam-spec; §7).
**Update (dogfood-049, delivery `dde765b`, `docs/reports/dogfood-049.md`): WP-247's
pure pre-flight decision LANDED** — `describeSeamArming(env): SeamArmingReport`
(`packages/sdk-ts/src/cli/seam-precheck.ts`) reports armed/disarmed + optional
`nodeIndex` + empty-CONTENT warning from the four `CHIKORY_SEED_BAD_DIFF_*` keys, the
`evaluateBaselinePrecheck`/`precheck.ts` analog. One-shot SUCCESS, grep-pinned
assertions (F-49). The 2-line launcher banner wire + the structural disarmed-spec
guard are still owed (WP-247 → 🟡). New **F-51 → WP-249** (harvest-commit hygiene; §7):
that delivery commit bundled an unrelated operator `land.test.ts` edit and cites no
run-id, so `dogfood-verify §6` couldn't resolve the landed commit.

**Latest (2026-06-24, the WP-207 act-half unlock — operator hand-design, branch
`feat/wp207-pressure-compaction`):** the context-rot pillar is now ACTED ON, not just
observed. The live pacing decision DRIVES compaction cadence — `agent-loop.ts` passes
`underPressure = pacing.action !== "continue"` into the existing `compactContext` activity,
which under pressure folds history beyond the verbatim window NOW (effective
`{triggerAfterSteps: keepLastN}` policy) instead of waiting for the count trigger (8). Each
`compaction` entry is tagged `trigger:"pacing"|"count"` (additive, no contract change);
`chikory trace` renders ` (pacing)` on a pressure fold; a deterministic `debug.contextWindowTokens`
seam (`CHIKORY_CONTEXT_WINDOW_TOKENS`, the `seedBadDiff`/`parkBeforeStep` convention) makes it
provable without a 200k-token accumulation. Real-Temporal proof: `compaction-wiring.test.ts`
"context-window pressure folds before the count trigger" (a 7-step run under a tiny window
override folds at step 6 with `trigger:"pacing"`); full SDK suite 460 passed. So dogfood-052's
602%-window PARK signal is no longer inert. **WP-203 → 🟢, WP-207 act half → 🟢; the `park`→
durable-suspend remainder is WP-250.** dogfood-053 (`run-41f2744f-…`, runtime `4abb478`,
`docs/reports/dogfood-053.md`) surfaced the new `trigger` field in the `chikory trace` TOTALS:
a pure `summarizeCompaction(entries)` reducer (`src/runner/compaction-summary.ts`) renders
`compactions N (pacing M)` additively (byte-identical no-compaction path); `codex`/`gpt-5.5`
one-shot 5 files, judge ✓ PROCEED 1/1, $0.8086/$5, vitest 27 + tsc + eslint exit 0. **But the
build run itself PARKED (`peak window 604% (compact 0 · park 1)`, 0 folds) — the new segment
never rendered live → F-54 → WP-251 (telemetry unit-proven, not yet observed live; closes on a
seam-forced multi-step fold, the F-53/F-52 close shape; see §8).** **CLOSED (dogfood-054,
`run-f7106c03-…`, committed `cfb8bcd`, `docs/reports/dogfood-054.md`): the Agent-as-a-Judge
true-positive catch now lands on REAL product-WP code, off the throwaway scaffolding.** The
corrupted file was WP-215 S1's real `scanDiffForSecrets` (`src/judge/scan-secrets.ts`), not a
disposable `clamp`/`roundTo`/`truncateDecimals`: `codex`/`gpt-5.5` wrote a correct scanner →
the seam stubbed it to always-`[]` (102 bytes) after step 0 → cadence-1 judge `vitest` AC
`exited 1` → deterministic override → AC FAILED (the catch) → executor restored from the
failing-test feedback → SUCCESS in 2 steps, $1.33/$5, judge 1.0%, family-diverse. New **F-55 →
WP-252** (§8): the `peak window 759%` denominator is a hardcoded uncalibrated 200k. **LANDED
(dogfood-055, `run-73437934-…`, runtime `88d2102`, delivery uncommitted byte-IDENTICAL on the
working tree, `docs/reports/dogfood-055.md`): WP-215 S2 — `scanDiffForSecrets` is now wired into
the inner-loop judge evidence.** `codex`/`gpt-5.5` one-shot all 4 files in 1 step: `collectEvidence`
calls the scanner over the FULL diff into a new REQUIRED `CollectedEvidence.secretScanLabels` field
(before the prompt-excerpt truncation), `prompt.ts` renders a `## EVIDENCE — deterministic secret
scan (added diff lines)` section, `harness.ts` threads it through, + a 2-case vitest. Judge
`gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓; $0.7834/$5 (15.6%), judge 1.0%, 580k/5.0k tokens;
vitest 471 passed, tsc+eslint exit 0. Additive, no contract change. NO new friction; the section
rendered live but `(none)` (the run's own diff is secret-free by design — non-empty firing is
unit-proven, deferred to the WP-253 dogfood). Park-saturation recurs (4th point 602/604/759/585%,
F-54/WP-250/251) + denominator recurs (F-55/WP-252). **LANDED (dogfood-056, `run-37862cf7-…`,
runtime `8e4661c`, delivery uncommitted byte-IDENTICAL on the working tree,
`docs/reports/dogfood-056.md`): WP-253 / WP-215 S3 — the example-key allowlist that unblocks the
deterministic `no_secrets_introduced` override.** `codex`/`gpt-5.5` one-shot all 3 files in 1 step:
a new `src/judge/secret-allowlist.ts` (`EXAMPLE_SECRET_VALUES` + pure `isExampleSecret`, AWS's
`AKIAIOSFODNN7EXAMPLE` built by concatenation) + a NEW `scanDiffForRealSecrets(diff)` in
`scan-secrets.ts` (`.match`es the existing patterns, EXCLUDES allowlisted dummies; the
evidence-facing `scanDiffForSecrets` behavior UNCHANGED — the 5-case S1 suite is the regression
guard) + a 3-case vitest. Judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓; $0.4744/$5 (9.4%,
the cheapest WP-215-series headline), judge 2.0%, 328k/5.4k tokens; vitest 474 passed, tsc+eslint
exit 0. Additive, no contract change. NO new friction; park-saturation recurs (5th point
602/604/759/585/334%, F-54/WP-250/251) + denominator recurs (F-55/WP-252). The secret-scan
evidence section again rendered `(none)` live — **self-trip discipline means any dogfood touching
the live judge cannot carry a contiguous secret in its own diff, so the non-empty path can't be
observed naturally in a build run; its closure belongs to a dedicated assertion in the override
slice (§8), not a scaffold run.** The destructive override that consumes `scanDiffForRealSecrets`
to flip the verdict pre-land = WP-253, the §4 hand-design follow-up (operator-landed). **LANDED
(dogfood-057, `run-6b23da51-c440-432a-bbf8-51d4ee8a24af`, runtime `3a3dc8d`, delivery uncommitted
byte-IDENTICAL on the working tree, `docs/reports/dogfood-057.md`): WP-252 — the pacing-window
denominator is now CALIBRATED to the executor model.** `codex`/`gpt-5.5` one-shot all 3 files in 1
step: a NEW pure `src/runner/context-window.ts` (`CONTEXT_WINDOW_TABLE` 14 rows + `lookupContextWindow`
longest-prefix, the `lookupPricing` analog + `resolveContextWindowForSpec`) WIRED into `agent-loop.ts:355`
so the live pacing decision divides by the routing model's REAL window (`gpt-5.5`→400k), the
`debug.contextWindowTokens` seam still winning + a 6-case vitest. Judge `gemini-3.1-pro-preview`
✓ PROCEED 2/2 scope ✓; $1.1870/$5 (23.7%), judge 0.8%, 898k/6.5k tokens (series-high input); vitest
6 + full suite 480 passed, tsc+eslint exit 0. Additive, no contract change. **NO new friction; F-55
FIXED IN CODE** (recurred dogfood-052→056) — closure is the F-53 live-read shape, the first calibrated
read being the NEXT run (this run's own trace predates the wire, reads `peak window 904%`).
Park-saturation recurs (6th point 602/604/759/585/334/904%, F-54/WP-250/251). **LANDED (dogfood-058,
`run-67d39267-c99c-471e-b625-5de20a3bb8ca`, runtime `6292f62`, delivery uncommitted byte-IDENTICAL on
the working tree, `docs/reports/dogfood-058.md`): WP-210 — the pure G-Eval scoring primitive opens the
Agent-as-a-Judge SCORING-modes pillar.** `codex`/`gpt-5.5` one-shot all 3 files in 1 step: a NEW pure
`src/judge/scoring.ts` (`normalizeGEvalScore` clamp→[0,1] divide-by-zero-guarded + `aggregateGEval`
weighted-mean/missing-weight→1/≤0-weight-ignored/empty-degenerate/threshold-INCLUSIVE + 3 local types,
the `buildVerdict` continuous-score analog, NO contract change) re-exported from `src/judge/index.ts`
+ a 9-case vitest. Judge `gemini-3.1-pro-preview` ✓ PROCEED 2/2 scope ✓; $0.4905/$5 (9.8%), judge
1.8%, 355k/3.8k tokens; vitest 9 + full suite 489 passed, tsc+eslint exit 0. Additive, no contract
change, no new dep. **NO new friction; F-55 CLOSED BY OBSERVATION** — this is the first live un-seamed
read with the WP-252 calibration committed: the journaled `pacing` entry reads `utilization 1.792485`
= `716994/400000` and the trace renders the believable `peak window 179%` (vs the pre-wire 904%), with
the calibrated window flipping the step from `park` to `compact` (`compact 1 · park 0`) — the first
WP-203/WP-207 act-half payoff. The act half of WP-210 (`scoringMethod` field + the live judge wire that
consumes `aggregateGEval`) is a §4 contract-touching follow-up, operator-landed, NOT a dogfood headline.

**Earlier proven path:** dogfood-052 (`docs/reports/dogfood-052.md`) completed WP-207's
**context-rot observability** and made it self-evidencing. dogfood-051 journaled a `pacing`
entry per step but `chikory trace` only printed a bare `pacing events N` count; dogfood-052
added a pure `summarizePacing(entries)` reducer (`src/runner/pacing-summary.ts`) that folds
those entries into the run's PEAK window utilization + `compact`/`park` recommendation counts,
surfaced additively as `peak window X% (compact C · park P)` in the same totals sub-line
(byte-identical no-pacing path). `codex`/`gpt-5.5` one-shot all 5 files, judge ✓ PROCEED 1/1,
$0.8032/$5 (16.0%), vitest 25 + tsc + eslint exit 0 (`run-7e13ae2a-…`, runtime `0880806`).
**F-53 CLOSED — first live read:** this run journaled a real `pacing` entry and the new reducer
rendered `peak window 602% (compact 0 · park 1)` over it (`action park · projectedTokens
1,203,440 · remainingTokens -1,003,440 · utilization 6.0172`) — the executor ran at 6× the
200k window with PARK recommended and unheeded (the *act* half is §4-blocked on the WP-203 S2
runtime compaction trigger). _Earlier (dogfood-051):_ wired `decideContextWindowPacing` into
the live loop + journaled the durable `pacing` entry per step (`recordPacingEvent`, idempotent
`appendOnce` keyed on `pacingEventIndex`); the seam saga before that is settled
(dogfood-046/048/050). **Next headline (dogfood-053):** prove the Agent-as-a-Judge true-positive
catch on REAL product-WP code — a WP-215 pure `scanDiffForSecrets` security-evidence reducer
with the WP-244/246 catch seam seeded INTO it (off the throwaway utilities of dogfood-046/047/048).
**Earlier:** dogfood-050 (`docs/reports/dogfood-050.md`) made the
judge-catch seam **self-documenting** — WP-245 seam telemetry: the `debug.seedBadDiff`
seam now journals a durable replay-safe `seam` entry and `chikory trace` prints
`seams fired N`, so "was the catch a *seeded* deterministic regression?" is answerable
from telemetry instead of three-blob byte-archaeology (`run-55eb5422-…`, runtime
`a4e9665`). dogfood-048
(`docs/reports/dogfood-048.md`) is the first
**chain-level Agent-as-a-Judge true-positive catch** — the §1.1 KPI sealed inside a
dependent node of a durable chain (`chain-b7665e97-…`, delivery `2c516d5`; see the
CLOSED item above). Its single-run predecessor dogfood-046 (`docs/reports/dogfood-046.md`)
was the first **reproducible** catch — the §1.1 KPI sealed on demand. The WP-244
`debug.seedBadDiff` seam (armed via `CHIKORY_SEED_BAD_DIFF_PATH`
/`_CONTENT`/`_AT_STEP`) overwrote a correct `clamp` with `return value;` after the
executor finished but before the judge ran; the cadence-1 judge's `vitest` AC went
red (AC-1 `exited 1`), the deterministic override (`harness.ts:105`) blocked the
SUCCESS seal (the catch), and the executor restored a correct impl from the
failing-test feedback → SUCCESS in 2 steps (`run-b024565e-…`, runtime `ebab493`,
delivery committed `5b6ca24`). The catch came from the judge-*executed* test, not
the LLM diff read (the LLM verdict on the bug was PROCEED). Earlier:
dogfood-044 (`docs/reports/dogfood-044.md`) is the first
LIVE chain-level park→approve→resume proof: the re-run
`chain-1bfb9d13-6c3f-4f9d-bcb0-abba4d6730df` SUCCESS 2/2 forced node B to park at
step 0 with the WP-243 seam (`debug.parkBeforeStep` via `CHIKORY_PARK_BEFORE_STEP`
/ `CHIKORY_PARK_NODE_INDEX`), the chain surfaced the parked child, and a single
`chikory chain resume <chain-id> --add-budget 5` drove it to terminal SUCCESS with
the parent worker attached (F-42/WP-241 closed live). Earlier: dogfood-043
(`docs/reports/dogfood-043.md`) is the first
artifact-backed fan-in chain: `chain-6f1bf0ee-ce7a-42be-9416-4843b366cf0d`
SUCCESS 3/3, two independent predecessors (A=left, B=right, isolated baselines)
both materialized into dependent consumer C through the WP-239 handoff (not a
shared workspace), C's judge ran the canonical `fan-in-handoff.test.ts` in the
inner loop, and chain-aware `devbox run harvest` reconciled the non-linear
delivery (6 files, 397 TS + 82 Python tests green). Earlier: dogfood-042
(`docs/reports/dogfood-042.md`) is the first green dependent *linear* chain —
`chain-1cde6ae3-d05f-438e-b818-8af76419d6ae` SUCCESS 2/2, node B imported node
A's handed-off module, a quota ESCALATE survived approve/resume, harvested
`b1b825d`.

Proven path: dogfood-001 (`docs/reports/dogfood-001.md`) implemented WP-202's
first slice this way — 2 steps, 1 judge pass, 3/3 judge-executed checks,
SUCCESS in 4 minutes. Dogfood-002 (`docs/reports/dogfood-002.md`) repeated it
for WP-201 slice 1 — first-attempt SUCCESS, zero new harness code.
Dogfood-003 (`docs/reports/dogfood-003.md`) had the engine modify its own
runner loop (WP-217) — third first-attempt SUCCESS, and the landed trigger
fired in the run that delivered it. Dogfood-004
(`docs/reports/dogfood-004.md`) landed WP-218 slice 1 (honest cost meter) —
fourth first-attempt SUCCESS, the first spec designed to *falsify* the old
behavior (cadence > max_steps, so only the WP-217 milestone trigger could
seal), and the delivered warning now flags that very run's trace.
Dogfood-005 (`docs/reports/dogfood-005.md`) delivered WP-220
(`chikory land`) — fifth first-attempt SUCCESS, the first fully *priced*
campaign ($2.14/$5.00 metered by the WP-218 table), and the deliverable
was verified by landing its own run into a clean clone. Dogfood-006
(`docs/reports/dogfood-006.md`) delivered WP-222 slice 1 (executor env
scrub) — sixth first-attempt SUCCESS, the first campaign with **no new
friction numbers**, and the bug being fixed fired inside the run's own
executor steps exactly as the spec predicted. Dogfood-007
(`docs/reports/dogfood-007.md`) delivered WP-223 (watch renders journal
transitions) — seventh first-attempt SUCCESS, closing F-15 by construction
(three clean full-suite runs post-fix) and confirming F-14 closure (zero
shim noise in the executor transcript, the acceptance test dogfood-006
set). Dogfood-008 (`docs/reports/dogfood-008.md`) delivered WP-224
(`chikory land --verify` + git-stderr capture) — eighth first-attempt
SUCCESS, the **second campaign with no new friction**, closing F-17 (land
never verified) and F-18 (git stderr leak): `land --verify` now reruns
build/lint/typecheck/test against the fresh commit and exits nonzero on
red. F-11's completion-probe tax recurred at a new record 25.4 % cost
share (cheap productive step → proportionally larger wasted probe).
Dogfood-009 (`docs/reports/dogfood-009.md`) delivered WP-225 (de-flake the
WP-217 milestone test) — ninth first-attempt SUCCESS, the **third campaign
with no new friction**, closing F-19 (the `agent-loop.test.ts` waitFor race
that could spuriously fail a judge-executed check, now gated on the durable
verdict; 8/8 host runs). F-11's probe tax recurred at a new record *low*
5.8 % cost share — the probe step skipped the suite re-run — so the tax now
spans 5.8 %–25.4 % across eight data points; the spread, not the magnitude,
is the WP-221 argument. Dogfood-010 (`docs/reports/dogfood-010.md`)
delivered WP-209 slice 1 (the issues-found:changes-made process metric in
`chikory trace`, SE-3's concrete half) — tenth first-attempt SUCCESS, the
**fourth campaign with no new friction**, hitting the prescribed footer
string byte-for-byte under a tight two-file scope. F-11's probe tax recurred
mid-spread at 16.1 % (the probe re-ran the full suite), confirming the tax
tracks executor discretion across a 5.8 %–25.4 % range over nine data
points. Dogfood-011 (`docs/reports/dogfood-011.md`) delivered WP-209 slice 2
(the components-over-time timeline in `chikory trace`, SE-3's temporal half —
both SE-3 footer halves now render) — eleventh first-attempt SUCCESS, the
**fifth campaign with no new friction**, hitting the prescribed
`components over time: s0 s1 j@1` footer string byte-for-byte under a tight
two-file scope. F-11's probe tax set a new record *high* of 34.3 % (the probe
re-ran the full suite while the productive step 1 was cheap, $0.58), widening
the spread to **5.8 %–34.3 %** over ten data points. Dogfood-012
(`docs/reports/dogfood-012.md`) opened WP-208 with slice 1 (the pure
`notificationsFor` derivation — `JournalEntry[]` + `NotificationPolicy` →
ordered notification messages; delivery + call-site deferred) — twelfth
first-attempt SUCCESS, the **sixth campaign with no new friction**, hitting
the prescribed escalate/milestone/terminal message strings and policy-filter
behavior byte-for-byte under a strict two-NEW-file scope, proving the loop
generalizes past the now-exhausted WP-209 trace-footer vein. F-11's probe tax
recurred at 25.1 % (212k input tokens, full-suite re-run), within the
established 5.8 %–34.3 % spread over eleven data points. Dogfood-013
(`docs/reports/dogfood-013.md`) added WP-208 slice 2 (the pure `slackPayloadFor`
formatter — `Notification` → Slack `{ text }` with a `🚨`/`✅`/`🏁` trigger
prefix; webhook POST + call-site deferred) — thirteenth first-attempt SUCCESS,
the **seventh campaign with no new friction**, hitting the prescribed emoji
lookup and payload strings byte-for-byte under a strict two-NEW-file scope.
F-11's probe tax set a **new record high of 35.1 %** (220k input tokens,
full-suite re-run) — set from below, by the cheapest productive step yet
($0.51), widening the spread to **5.8 %–35.1 %** over twelve data points. Dogfood-014
(`docs/reports/dogfood-014.md`) added the slice-3 pure half (`desktopPayloadFor`
— `Notification` → `{ title, body }`) — fourteenth first-attempt SUCCESS, and
the **first run to modify an existing tracked file** (additive, beside
`slackPayloadFor`) rather than create two new ones. That first surfaced **F-20**:
the harvest tool silently dropped the modified files (non-interactive conflict
skip) while reporting success — root-caused and fixed the same session
(reconciliation guard + `harvest-audit`, which confirmed no past silent losses).
F-11 was a mid-spread 24.1 %. **Then the contract wall fell by hand**: WP-219
ADR-005 was accepted and its slice-1 contracts (`Plan`/chain types +
`claimsComplete`/`budgetTokens`) landed — unblocking the dogfoodable chain
implementation slices. Dogfood-015
(`docs/reports/dogfood-015.md`) delivered that pure half — `readyNodes(plan,
completed)`, the chain executor's dependency-resolution core — the **first
slice to consume the ADR-005 contracts** (its own AC-2 kept the 77-test
conformance suite green inside the run), and the cheapest campaign yet ($0.39).
Its one new friction, **F-21**, is again in the *landing*, not the output: the
harvested NEW files (`src/chain/`) were left untracked and the operator's
commit shipped only the review docs under a "readyNodes" message — a "feat"
commit with none of the feature's code (→ WP-226: harvest stages what it
applies; fixed before the next campaign). Dogfood-016
(`docs/reports/dogfood-016.md`) delivered the other S3 pure precondition,
`hasDependencyCycle(plan)`, with the prescribed Kahn traversal and four focused
tests — sixteenth first-attempt SUCCESS. It also proved WP-226 live: both new
files were harvested byte-identically and staged. Three surrounding issues
surfaced: parallel Devbox startup races (F-22, operational rule added), the
terminal-boundary remainder of the F-15 observer race (F-23 → WP-227), and the
env-prefixed explicit `dogfood-verify` command aborting Vitest under Devbox
0.17.0 (F-24, command form fixed). F-11 was 7.6 %. Dogfood-017
(`docs/reports/dogfood-017.md`) was the **first FAILED campaign — and the
clearest thesis win**: WP-227 had already been hand-landed (`26b9964`) so the
spec ran redundantly, the executor narrated completion over an empty diff, every
acceptance check and rubric item passed, and the structurally-different judge
still ESCALATEd on the diff-vs-claim mismatch. It surfaced F-25 (retire
superseded specs; launch baseline-satisfied precheck → WP-228), F-26 (executor
empty-diff completion claim → raises WP-221), and F-27 (the `--watch` ESCALATE
line drops the judge reasoning → WP-229). Dogfood-018
(`docs/reports/dogfood-018.md`) delivered WP-229 cleanly — `followRun` now
renders `judge escalated: <reason>` on the watch stream before the
AWAITING_APPROVAL line; diff byte-for-byte to spec, 3/3 AC + 4/4 rubric PROCEED,
harvested byte-identically. **F-27 closed.** It surfaced F-28 (specs
over-prescribed to the keystroke under-test the thesis — see §3) and F-11
recurred at 34.8 % of run cost (top of the range). Dogfood-019
(`docs/reports/dogfood-019.md`) delivered WP-221's pure trigger half —
`isCompletionMilestone(record)` ORs `claimsComplete` into the WP-217 empty-diff
trigger, behavior preserved — its eighteenth first-attempt SUCCESS. **But human
review caught F-29**: the new test's fixtures violate the `ArtifactRef` contract
(7 real `TS2353` errors) yet shipped green, because `typecheck` compiles only
`src/**` and Vitest skips type-checking. A SUCCESS run again surfaced a
plan-changing gap (dogfood-002's lesson). Dogfood-020
(`docs/reports/dogfood-020.md`) delivered WP-230 — `typecheck` now runs a second
`tsc -p tsconfig.test.json` pass so `test/**` is type-checked, verified to trip
on a bad fixture (`TS2353`). **F-29 closed.** It surfaced **F-30** (the same
spec was launched twice ~11 min apart, ~$1 wasted — operator ceremony, no WP).
Dogfood-021 (`docs/reports/dogfood-021.md`) delivered **WP-221 Slice B** — the
runner now reads the executor's `CHIKORY_TASK_COMPLETE` marker via pure
`claimsCompleteFromSummary` → `StepRecord.claimsComplete`, so the productive step
is judged directly and the F-11 probe step retires. Dogfood-022
(`docs/reports/dogfood-022.md`) delivered **WP-219 S2 Slice 1** — the pure
goal-planner prompt half (`planner/prompt.ts`, mirroring `judge/prompt.ts`) — but
its headline is in the trace: as the **first real run on post-Slice-B code where
the executor emits the marker**, it sealed SUCCESS in **ONE step with no
empty-diff probe step** (`components over time: s0 j@0`, vs the `s0 s1 j@1` F-11
signature of all twenty predecessors). **F-11 is CLOSED — by observation, not
just in code.** Twenty-first first-attempt SUCCESS, no new friction, single clean
launch (F-30 did not recur). The one watch-item: the productive step cost $1.26
on **969k input tokens** (campaign high) — with the probe gone, input-side cost
(WP-203 compaction / WP-207 pacing) is the next reliability lever. Dogfood-023
(`docs/reports/dogfood-023.md`) delivered **WP-219 S2 Slice 2 — the pure
plan-assembly half** (`planner/assemble.ts` `buildPlan(reply, input, opts): Plan`
+ `BuildPlanOptions`, mirroring `buildVerdict`: three structural checks →
the frozen `Plan`), completing S2's pure surface. Twenty-second first-attempt
SUCCESS, the F-11-closed `s0 j@0` shape held for a second straight run, no new
friction, single clean launch. Bright spot on the cost watch-item: input tokens
fell to **451k** (lowest of the last four runs, ~half the 969k high) for a
comparably small change — the 022 "climbing tokens" worry is **noise, not a
ratchet**. Dogfood-024 (`docs/reports/dogfood-024.md`) delivered **WP-219 S2b —
the pure plan meta-judge prompt half** (`planner/meta-judge-prompt.ts`:
`PLAN_JUDGE_SYSTEM_PROMPT` + `PLAN_VERDICT_RESPONSE_SCHEMA` +
`buildPlanJudgeMessages`, mirroring `judge/prompt.ts`); dogfood-025
(`docs/reports/dogfood-025.md`) delivered **its pure verdict-assembly half**
(`planner/meta-judge-verdict.ts`: `buildPlanVerdict`, mirroring `buildVerdict`,
folding `planCoverageGaps` in as a deterministic coverage override that
downgrades `PROCEED`→`REVISE` when a goal criterion is uncovered). **WP-219's
entire pure surface is now landed** — both the S2 planner and the S2b plan
meta-judge mirror the executor judge symbol-for-symbol; everything left in
WP-219 is non-pure / hand-design (the `decompose` wrapper + plan-judge harness,
TASK-PROTOCOL §4). Dogfood-026 (`docs/reports/dogfood-026.md`) then delivered **WP-203 S4 — the
pure compaction-trace renderer** (`formatEntryLine` gains a `case "compaction"`
rendering `tokensBefore→tokensAfter` + digest presence), the WP-209
trace-renderer pattern; **WP-203's pure trace surface is now complete** and the
compaction JIF entry is legible in `chikory trace --watch`. All three runs
sealed SUCCESS in one step, no probe (F-11-closed shape, now five straight); no
new friction. The input-token series ran a clean sawtooth across the six
adjacent pure slices (862k → 969k → 451k → 976k → 467k → 807k), the smallest
diff of the set drawing a mid-high 807k — cost is **noisy, not monotonic**, a
variance/ceiling lever (WP-203/WP-207), not a runaway trend. Dogfood-027
(`docs/reports/dogfood-027.md`) then delivered **WP-228 S1 — the pure
launch-baseline-precheck decision** (`evaluateBaselinePrecheck`, the
`buildVerdict`/`buildPlanVerdict` analog: partitions acceptance-check exit codes
→ `{ satisfied, passedIds, failedIds, summary }`, dogfood-017 F-25), a sixth
straight one-step no-probe SUCCESS, no new friction; input tokens 527k (low
band), the largest diff of the recent set drawing one of the smallest input
counts — cost tracks neither diff size nor run order. The non-pure
check-execution + warn/`--force` launch wiring is the hand-design follow-up.
Dogfood-028 (`docs/reports/dogfood-028.md`) then delivered **WP-202 / CM-3 — the
pure Memory Pointer decision + reference renderer** (`shouldPointerize(bytes,
policy)` + `formatPointerReference(ref)` in a new `src/runner/memory-pointer.ts`,
the `buildVerdict`/`evaluateBaselinePrecheck` analog over the frozen
`ArtifactRef`): a **seventh** straight one-step no-probe SUCCESS, no new
friction; input tokens 410k, a new series low (021–028: 862k → 969k → 451k →
976k → 467k → 807k → 527k → 410k) — cost stays noisy, not monotonic. The
non-pure interception + `store.put` + injection wiring is the hand-design
follow-up. Dogfood-029 (`docs/reports/dogfood-029.md`) then delivered **WP-203 S2
— the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` +
`buildDigestMessages(toDigest): Message[]` in a new
`src/runner/compaction-prompt.ts`, the `planner/prompt.ts`/`judge/prompt.ts`
analog over the frozen `CompactionPlan.toDigest` + `Message`, type-only `Message`,
no schema/contract change): an **eighth** straight one-step no-probe SUCCESS, no
new friction; input tokens 462k, low band (021–029: 862k → 969k → 451k → 976k →
467k → 807k → 527k → 410k → 462k) — cost stays noisy, not monotonic. **WP-203's
entire pure surface is now exhausted** (S4 trace + S2 digest-prompt); the digest
wiring (router fold → `store.put` behind a Memory Pointer → journal
`CompactionResult`) stays non-pure hand-design, blocked on the WP-202 store.
Dogfood-030 (`docs/reports/dogfood-030.md`) then delivered **WP-201 Python-SDK
parity — the pure compaction digest-prompt half** (`DIGEST_SYSTEM_PROMPT` +
`build_digest_messages(to_digest) -> list[Message]` in a new
`packages/sdk-py/src/chikory/compaction_prompt.py`, the Python parity of
dogfood-029; mirrors the TS `compaction-prompt.ts` source-of-truth, `Message`
already ported, no contract/runtime wiring change): a **ninth** straight
one-step no-probe SUCCESS, no new friction; input tokens 434k, low band
(021-030: 862k -> 969k -> 451k -> 976k -> 467k -> 807k -> 527k -> 410k ->
462k -> 434k). Dogfood-031 (`docs/reports/dogfood-031.md`) then delivered
**WP-207 context-window pacing** — the pure `decideContextWindowPacing` runner
decision (`continue` / `compact` / `park`) before any non-pure runner/journal
wiring: a **tenth** straight one-step no-probe SUCCESS, input tokens 375k (new
low), but surfaced **F-31** — the landed commit `67eb167` mixed the verified
three-file run diff with five unrelated warning-suppression edits outside the
judge's evidence. Dogfood-032 (`docs/reports/dogfood-032.md`) delivered
**WP-231 landing-scope audit** — `dogfood-verify` now includes a landed-scope
section backed by `scripts/dogfood-landed-scope.sh`, which mechanically compares
"what ran" to "what landed" and reports `MATCH`, `EXTRA_IN_COMMIT`,
`MISSING_IN_COMMIT`, or `DIFFERS_FROM_RUN`. Its judge made a useful step-1
ESCALATE on verifier abort behavior, step 2 fixed it, and F-31 is closed.
Dogfood-033 (`docs/reports/dogfood-033.md`) then opened **WP-205 branching**
with the pure `parseBranchTarget(input)` helper for `chikory branch
<run-id>@<step>` targets: another one-step SUCCESS, no probe, no new friction,
and the branch/worktree side effects still deferred. Dogfood-034
(`docs/reports/dogfood-034.md`) completed **WP-205's pure surface** with
`branchNameForTarget(target)`, deriving the default git branch name
(`branch-<sanitized-run-id>-step-<n>` / `branch-<…>-base`) for a parsed target:
an **eleventh** straight one-step no-probe SUCCESS, no new friction, input tokens
594k (mid-band). The actual `chikory branch` command + journal/worktree fork is
non-pure hand-design; with the TS pure backlog thin the dogfoodable thread
shifts back to dual-SDK parity. Dogfood-035
(`docs/reports/dogfood-035.md`) ported that WP-205 surface to the Python SDK —
`parse_branch_target` + `branch_name_for_target` (local frozen `BranchTarget`
dataclass) in `packages/sdk-py/src/chikory/branch_target.py`, mirroring the TS
`src/cli/branch-target.ts` source-of-truth behavior-for-behavior, 16 pytest
cases, no contract change: a **twelfth** straight one-step no-probe SUCCESS, no
new friction, input tokens 318k (new series low). It was the first
branch-target-series run committed to `HEAD` (`88e496c`) rather than staged, and
`dogfood-landed-scope.sh` reported **MATCH** — the F-31 audit confirming the
committed diff is exactly the verified run diff. Dogfood-036
(`docs/reports/dogfood-036.md`) ported the WP-202 / CM-3 Memory Pointer pure
surface to the Python SDK — `should_pointerize` + `format_pointer_reference` +
a local frozen `MemoryPointerPolicy` dataclass in
`packages/sdk-py/src/chikory/memory_pointer.py`, mirroring the TS
`runner/memory-pointer.ts` source-of-truth byte-for-byte (12-char id truncation,
em dash U+2014), `ArtifactRef` reused, 5 pytest cases, no contract change: a
**thirteenth** straight one-step no-probe SUCCESS, no new friction, input tokens
398k (low-mid band). **The S3 wall was then cleared by hand (2026-06-19):** the
architect wrote the ADR-005 §S3 transition rules and froze the `NodeOutcome` +
`ChainRecord.nodeOutcomes` contract across all langs, unblocking the WP-219
**S3-pure chain-state reducer**. Dogfood-038
(`docs/reports/dogfood-038.md`) then delivered it — `deriveChainStatus`
(four-rule precedence ESCALATE→AWAITING_PLAN_APPROVAL / FAILED→FAILED /
all-SUCCESS→SUCCESS / RUNNING) + a pure immutable `advanceChain` node-fold in a
new `packages/sdk-ts/src/chain/advance.ts`, the `computeVerdict` analog and
sibling of the landed `readyNodes`/`hasDependencyCycle`, type-only contract
imports, re-export at `index.ts:72`, 6 vitest cases, no contract change: a
**fourteenth** straight one-step no-probe SUCCESS, no new friction, input tokens
625k (high-mid band). **WP-219's S3-pure primitive set is now complete**
(`readyNodes` + `hasDependencyCycle` + `advanceChain` + `deriveChainStatus`).
**The S3-wiring substrate was then hand-landed (2026-06-20, TASK-PROTOCOL §4):**
the Temporal-native chain executor — `ChainJournal`/`chainRecordFrom` (the D4
chain store), the `chainLoop` workflow that loops `readyNodes` →
`executeChild(agentLoop)` per ready node → `advanceChain` fold →
`node_started`/`node_sealed` journaling, halting on a `FAILED` seal, plus chain
activities and pure node→TaskSpec helpers (both workflows share a bundle barrel).
That substrate created a chain journal, which unblocked the **WP-219 S6 pure
chain-trace renderer** — `renderChainTrace`, the chain analog of the per-run
`renderTrace` — **delivered via dogfood-037 (`run-295b2947`, refocused off the
deprioritized pacing parity port onto the critical path; 5 vitest cases, no
contract change, `src/chain/trace.ts`)**. **WP-219's entire dogfoodable pure
surface is now exhausted** (`readyNodes` + `hasDependencyCycle` + `advanceChain`
+ `deriveChainStatus` + `renderChainTrace`), so the dogfood thread returned to
dual-SDK parity. Dogfood-039 (`docs/reports/dogfood-039.md`) ported the S3
chain-state reducer to the Python SDK — `derive_chain_status` (the four-rule
ADR-005 §S3 precedence) + `advance_chain` (pure immutable node-fold) in a new
`packages/sdk-py/src/chikory/chain_advance.py`, mirroring the TS
`src/chain/advance.ts` source-of-truth 1:1, `ChainRecord`/`NodeOutcome`/`ChainStatus`
reused from `chikory/types.py`, 6 pytest cases, no contract change: a
**sixteenth** straight one-step no-probe SUCCESS, no new friction, input tokens
755k (Python-parity-series high). The next dogfood stays on parity: **dogfood-040
— the Python port of the WP-207 context-window pacing decision**
(`decide_context_window_pacing` + local `ContextWindowUsage`/`ContextWindowPacingPolicy`/`ContextWindowPacingDecision`
dataclasses, `chikory/pacing.py`, mirroring the TS `src/runner/pacing.ts`); the
`renderChainTrace` Python parity stays blocked behind it (needs the
not-yet-ported `ChainEntry` store type). Remaining hand-design follow-ups: D3
halt-and-replan, S4 context handoff, S5 suspend/resume, and the
`chikory chain`/`plan` + `chikory trace <chain-id>` CLI glue.

## 2026-07-04 — displaced by dogfood-085 review (bounded status-block replace)

**Last-3-runs prose (dogfood-081, since rolled out of the window):** dogfood-081 — rung-3 ENABLER WP-269 intra-run step-forcing (`run-464b7b77`, 🟢 SUCCESS · 1 step): pure `decideStepForcing` + opt-in `boundedWorkUnit` defers a premature `claimsComplete` and re-enters `agent-loop.ts`. **WP-269 → 🟢.** dogfood-082 — WP-265 RUNG-3 HORIZON PROOF REACHED (`run-ef4824e2`, 🟢 SUCCESS · 6 steps, $6.76/$50, 57m16s): ONE `chikory run` under `min_durable_steps:5` sealed 6 durable checkpoints + survived a LIVE mid-run `kill -9` → `chikory resume` between sealed steps, zero re-execution; delivered WP-219 D3 replan + S4 compaction note, harvested `1d2c7e5`. 🔴 F-99 (bare resume lost `OPENAI_COMPAT_BASE_URL`); ℹ️ F-100 (horizon REAL but HOLLOW — seal-deferral without chunking). **WP-219 D3/S4 → 🟢.**

**Queue prose (pre-085, ⑥ now DONE):** NEXT HEADLINE was ⑥ dogfood-085 — the NON-HOLLOW rung-3 HORIZON on host WP-215 architecture rubric; delivered 🟢 (`run-17b5ef57`, 6 steps, 5/6 non-hollow), see `docs/reports/dogfood-085.md`. Surfaced 🔴 F-107 (chunk-unaware judge ESCALATE parks the run for approval — a hard blocker for the ⑦ overnight-unattended rung) → new WP-271.

## 2026-07-04 — displaced DOGFOODING.md header block (dogfood-083, replaced by dogfood-085)

Latest: dogfood-083 — **WP-270 PER-STEP WORK-UNIT CHUNKING** (`run-d3879dab`, `docs/reports/dogfood-083.md`). 🟢 SUCCESS · 3 steps · $4.09/$40 · 10m22s. Built the rung-3 QUALITY lever F-100 demanded: opt-in ordered `work_chunks` on `bounded_work_unit` + a pure `decideWorkChunk` (`src/workflow/work-chunk.ts`) wired into `agent-loop.ts` step-forcing. Additive; frozen contracts held; no new dep; LIVE-proven, 658 tests green; harvest byte-IDENTICAL. ✅ F-101 CLOSED (re-run `run-03d161e9`): PROCEED-gated `consumedWorkChunks` counter, LIVE scripted-ROLLBACK regression, 660 tests green. ⚠️ dogfood-084 RETIRED — host WP-214 shipped outside the loop (`fadc124`); glob mis-fire re-ran closed 083 as `run-0a285f5b` (083c, F-104/F-106; fixed `59c57f6`).

## 2026-07-04 — displaced from plan.md §6 status block (dogfood-086 review)

Moved verbatim on the dogfood-086 review (WP-271, `run-88235198`, F-107 closed):

- **Last 3 runs (pre-086):** dogfood-083 — WP-270 PER-STEP WORK-UNIT CHUNKING, the rung-3 QUALITY lever (`run-d3879dab`, 🟢 SUCCESS · 3 steps, $4.09/$40): opt-in ordered `work_chunks` + pure `decideWorkChunk` (`src/workflow/work-chunk.ts`) wired into `agent-loop.ts`, additive, LIVE-proven; ✅ F-101 CLOSED by re-run `run-03d161e9` (PROCEED-gated `consumedWorkChunks`). **WP-270 → 🟢** · dogfood-083c (`run-0a285f5b`, 🟢 · 4 steps, $3.02) — accidental glob re-run of the closed WP-270 spec (F-104), harvested `b103645`; WP-214 multi-repo shipped outside the loop (`fadc124`, retires dogfood-084, F-106) · **dogfood-085 — WP-215 ARCHITECTURE RUBRIC + the NON-HOLLOW rung-3 HORIZON (`run-17b5ef57`, 🟢 SUCCESS · 6 steps, $4.36/$50, 22m41s, un-harvested):** the FIRST launch to USE `work_chunks` in its own YAML (5 dependency-ordered sub-goals) — shipped the whole architecture-scan chain (net-new pure `scanDiffForLayeringViolations` → `collectEvidence` `architectureLabels` → `prompt.ts` render → NON-destructive `no_architecture_violations` standing-rubric item → LIVE proof), all 4 ACs green, harvest byte-IDENTICAL, **5/6 non-hollow** (big improvement on 082), **per-step reliability 100%**. **WP-215 architecture side → 🟢.** 🔴 **F-107 → WP-271:** the judge is CHUNK-UNAWARE — at step 2 (chunk 2/5, all ACs+rubric PASS) it ESCALATEd on a "missing" PART 4 that was deferred BY DESIGN → PARKED the run for human approval (no timeout — a HARD blocker for the ⑦ overnight-UNATTENDED rung) and re-handed chunk 2 → hollow step 3 (0-byte, 4.9% cost). 🟡 F-108 (`consumedWorkChunks` not restored on resume, latent).
- **Queue (pre-086):** ✅ **rung-3 machinery COMPLETE — enabler WP-269 (dogfood-081) → hollow horizon proof WP-219 (dogfood-082) → quality lever WP-270 per-step chunking (dogfood-083, `run-d3879dab`, 🟢 SUCCESS, harvest pending).** `work_chunks` + pure `decideWorkChunk` now hand the executor ONE ordered sub-goal per forced step, LIVE-proven; the field EXISTS in HEAD after harvest, so a launch YAML can finally reference it. ⚠️ **dogfood-084 RETIRED** (`.yaml.retired`) — host WP-214 shipped outside the loop (`fadc124`, F-106) so its net-new AC symbol already exists; and the pre-`59c57f6` 3-digit-exact glob mis-fired on its suffixed name → the accidental 083c re-run (F-104; glob + refuse-by-default staleness gate fixed `59c57f6`, F-105). ✅ **⑥ dogfood-085 DONE (`run-17b5ef57`) — the non-hollow rung-3 horizon REACHED on host WP-215 (5/6 non-hollow, 100% per-step reliability).** **NEXT HEADLINE (⛔ STALLED over 083c/085 ⇒ ladder rung BINDING; but ⑦ overnight-UNATTENDED is BLOCKED — §1.2 fallback carve-out FIRES): ⑦′ dogfood-086 — WP-271, the F-107 unblock: chunk-scoped judge adjudication + an unattended-safe ESCALATE policy.** → ⑦ overnight unattended → ⑧ P2 exit-gate 24h brownfield. Track-B follow-ups: F-108, F-99, WP-515 (F-96), WP-512/513/514 (F-91/92/93), F-97 → WP-266/511.
- **Top open friction (pre-086):** 🔴 **F-107 → WP-271 (dogfood-085 — headline blocker):** the judge is CHUNK-UNAWARE. · 🟡 F-108, 🟡 F-109 test-concurrency, ✅ F-100/F-101 CLOSED (WP-270), 🔴 F-99 (WP-206-adjacent), 🟡 F-97/F-98/F-96/F-90/F-85, ✅ F-95 CLOSED, ✅ F-82/F-83/F-84 CLOSED, 🟡 F-58/F-79. (Full text in the git history of plan.md §6.)

## 2026-07-08 — displaced from plan.md §6 status block (WP-519/WP-520 hand-land session)

Moved verbatim when the ADR-009 self-heal run level landed track-B (F-110/F-108/F-99 closed):

- **F-110 (pre-close):** 🟡 **F-110 → track-B (dogfood-086):** the unattended escalate seals `status=FAILED`, conflating a policy-park with a genuine failure (a distinct resumable terminal would reshape the frozen `RunStatus` → needs an ADR); operator distinguishes only via the `unattended … escalation` reason prefix.
- **F-108 (pre-close):** 🟡 **F-108 → WP-206×WP-270 (latent):** `consumedWorkChunks` (`agent-loop.ts:146`) isn't restored on resume → a resumed chunked run replays from chunk 0; now coupled to F-110's resume path.
- **F-99 (pre-close):** 🔴 **F-99 → WP-206-adjacent (track-B):** a bare `chikory resume` missing `OPENAI_COMPAT_BASE_URL` silently loses judge routing, masked as a ~30-min stall — add a fail-fast resume precondition.
