# dogfood-082 — WP-265 RUNG-3 HORIZON PROOF: the first INTRA-RUN ≥5-durable-step chikory run. One `chikory run` under an active `bounded_work_unit: {min_durable_steps: 5}` policy sealed **6 durable checkpoints** while advancing the genuinely-open WP-219 chain-runtime residuals (D3 halt-and-replan + structured compaction-note handoff), and survived a **LIVE mid-run `kill -9` → `chikory resume` landing BETWEEN sealed steps with zero step re-execution**. Both rung-3 KPIs captured. The pre-declared thin-checkpoint finding is CONFIRMED (step 1 front-loaded all product work; steps 2–6 sealed real-but-thin test-only checkpoints) → per-step work-unit CHUNKING (WP-270) is the next mechanism.

- **WP:** WP-219 — Goal decomposition & run chaining (ADR-005), D3 halt-and-replan + S4 structured compaction-note handoff (the two capabilities `src/chain/chain-loop.ts` itself named as "remain deferred"). A real open plan.md §6 product WP on the durable-execution / multi-run-chains pillar. Hosted the rung-3 horizon proof driven by the WP-269 step-forcing lever dogfood-081 delivered.
- **Date:** 2026-07-03
- **Spec:** `examples/dogfood/dogfood-082-wp219-chain-replan-rung3-horizon.yaml` (LOOSE, Ladder-rung 3, Thesis-KPI = intra-run durable step count, `budget_usd: 50`, `max_steps: 30`) — launched with `chikory run` (a SINGLE durable run; intra-run axis, NOT a chain). Loose-AC discipline honored: ACs anchor on the net-new `decideReplan` / `node_replanned` symbols the goal NAMES (absent on HEAD, so a recursive grep cannot false-green on an incumbent file — F-90), module/test layout left to the executor (F-82/F-83). AC-3 F-97-hardened: requires a `test/chain/` file co-referencing `decideReplan` + the LIVE-chain driver `createChainActivities` + the `node_replanned` outcome, so a unit test can't false-green the LIVE replan proof.
- **Run-id:** `run-ef4824e2-a91c-4633-aac3-bb26608217c4`. Executor `codex(openai)`, judge `openai-compat/gemini-3.1-pro-preview`.
- **Terminal state:** 🟢 **SUCCESS · 6 steps** — 4 judge passes all `✓ PROCEED (4/4 criteria)`, 0 rollbacks / 0 escalations / 0 injections / **6 durable checkpoints** / 6 pacing events. `$6.7558 / $50.00 · 57m 16s`.
- **Landed commit:** **`1d2c7e5`** (harvested post-review, 2026-07-03) — `feat(sdk-ts): WP-219 D3 halt-and-replan + S4 structured compaction-note handoff`, 14 files / +666 −17, `Ref: run-id: run-ef4824e2-…`. Harvest verify: build + lint + typecheck clean; sdk-ts vitest **651 passed | 19 skipped** on re-run (`fan-in-handoff.test.ts` flaked ONCE under full-suite live-Temporal load — green in isolation and on the full re-run, not a regression). ⚠️ Before this harvest the phase-0 §3 AC re-run FALSE-FAILED because it grepped the un-harvested working tree (HEAD `99dbc46`); AC-1/2/3 flip green on the landed tree.

## Trace

```
run run-ef4824e2 · SUCCESS · 6 steps · $6.76 / $50.00 · 57m 16s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step                          tokens(in/out)  cost     diff bytes  verdict
 1   Implemented WP-219 D3 replan…  3816k/19k       $4.9642  28332       ✓ PROCEED (4/4)
 2   Advanced PART 2 (norm tests)   231k/3.6k       $0.3245  1464        ✓ PROCEED (4/4)
 3   Advanced PART 2 cont.          278k/3.0k       $0.3774  3156        — (no judge; cadence 2)
 4   Advanced PART 3/4              209k/2.9k       $0.2901  669         ✓ PROCEED (4/4)
 5   Advanced PART 4               198k/2.0k       $0.2680  1091        — (no judge)
 6   Advanced PART 5 (live proof)   359k/4.5k       $0.4935  3276        ✓ PROCEED (4/4)
 totals: decisions 6 · judge passes 4 ($0.0381, 0.6%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 6 · pacing 6
```

- **The `bounded_work_unit` lever worked.** `min_durable_steps: 5` deferred the seal 6 times: codex declared `claimsComplete` early, `decideStepForcing` (WP-269) re-entered the durable loop with the increment directive, and the run sealed a checkpoint per increment until the floor was met AND the judge confirmed the ACs — **6 sealed durable checkpoints in ONE `chikory run`**, the first intra-run horizon on record.
- **Loop integrity 🟢:** 6 distinct sealed steps (journal idx 0/5/10/13/18/21), 6 distinct checkpoints, no duplicate journal entry, no re-executed step across the kill→resume boundary (below). Clean.

## The two rung-3 KPIs — captured from the run's OWN journal (a working-tree AC cannot read a checkpoint count)

### KPI-1 — INTRA-RUN HORIZON: ✅ 6 sealed durable checkpoints ≥ the policy floor of 5

| checkpoint | journal idx | commit | lastGood |
|---|---|---|---|
| @4  | 4  | `a1744ee6bfab` | true |
| @9  | 9  | `871c5677b9dc` | true |
| @12 | 12 | `6e2b906a9a76` | false |
| @17 | 17 | `adce65cf2e2d` | true |
| @20 | 20 | `1bf69eb40868` | false |
| @25 | 25 | `c35dae0cdf36` | true |

Target ≥5 → **MET (6)**. This is the FIRST per-step-reliability / compounding-error data point over a single long chikory session (see the thin-checkpoint caveat below — the datapoint is real but partly hollow).

### KPI-2 — MID-RUN KILL→RESUME: ✅ landed BETWEEN sealed steps, zero re-execution

The journal timestamps expose the operator `kill -9` → `chikory resume` window unambiguously:

| event | journal idx | time (UTC) |
|---|---|---|
| step 3 checkpoint sealed | 12 | 23:50:45 |
| step 4 step-entry | 13 | 23:52:06 |
| **← kill → resume window (~37 min) →** | | |
| step 4 checkpoint sealed | 17 | **00:29:06** |

The ~37-minute gap between step 4 starting (23:52:06) and its checkpoint sealing (00:29:06) is the kill→resume window. On resume, journal replay reproduced the already-sealed steps 1–3 byte-identically (no re-execution — costs/commits unchanged), the resumed run continued from step 4, and reached terminal SUCCESS. **The operator action the spec cannot self-perform was performed by hand and the durability guarantee held.**

⚠️ **That 37-minute gap is ALSO F-99** — the resume didn't advance immediately because a bare `chikory resume` lost the judge routing config; see New friction.

## Delivery quality (human review of the un-harvested run workspace) — 🟢 COMPLETE, all-green, contract-additive

All 5 numbered PARTs of the goal landed, additively, in the workspace. Reviewed line-by-line against the goal.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — PURE REPLAN DECISION:** side-effect-free total `decideReplan(record, failedNodeId, maxReplans)` — sibling of `deriveChainStatus`/`advanceChain`; REPLAN under budget, HALT when budget exhausted or no sealed FAILED node; no I/O/Temporal/clock/id-gen; unit-tested exhaustively | `src/chain/replan.ts` (79 lines): `ReplanDecision` discriminated union; `boundedBudget` floors non-positive to 0; counts sealed FAILED outcomes as replans used; `failedCount > budget → HALT`, else `REPLAN`; `failedOutcome?.status !== "FAILED" → HALT`. `test/chain/replan.test.ts` unit cases | 🟢 |
| **2 — PURE STRUCTURED COMPACTION NOTE:** deterministic, size-bounded predecessor→successor handoff note ALONGSIDE the git bundle, no I/O; unit-tested | `src/chain/compaction-note.ts`: `buildStructuredCompactionNote(input)`, `DEFAULT_STRUCTURED_COMPACTION_NOTE_MAX_CHARS = 1_200`, `limit()` truncates with `...`, sorts changed paths deterministically; renders node/goal/outcome/verdict/changed_paths. `test/chain/compaction-note.test.ts` | 🟢 |
| **3 — REPLAN WIRE:** call `decideReplan` from `chain-loop.ts`'s FAILED-node path so a REPLAN re-invokes the planner over remaining goals, splices revised nodes, journals `node_replanned`; a HALT seals FAILED as today; additive (zero-budget = byte-for-byte the current halt path) | `chain-loop.ts:168` `decideReplan(record, node.id, maxReplans)` → on REPLAN `activities.replanRemaining(...)` → splice `plan = replanned.plan` + journal `node_replanned` (`activities.ts:126/142`); `replanRemaining` is an OPTIONAL injected activity dep (`activities.ts:18`). `node_replanned` added as an ADDITIVE journal-event kind (`types.ts:363`, `schemas.ts:392`, `store.ts` payload+reducer, `cli/chain.ts:210` trace render) | 🟢 |
| **4 — HANDOFF WIRE:** thread the PART-2 note into the S4 handoff additively, so a successor's context carries the structured note IN ADDITION to the git bundle; no frozen-contract shape change | `chain-loop.ts:108-134`: builds `structuredNotes` from predecessors, appends a `## Structured predecessor compaction notes` block to the existing `handoffNote`, threaded through the existing optional `node-spec.ts` `handoffNote?` param (reused, not reshaped) | 🟢 |
| **5 — LIVE PROOF:** LIVE Temporal chain test (reuse `createChainActivities`/`createRunnerWorker`/`describe.skipIf(address===null)`, no mock) where one node FAILS → REPLAN fires → `node_replanned` journaled → chain reaches SUCCESS; and zero-budget → same chain seals FAILED on the unchanged halt path | `test/chain/replan-live.test.ts`: test 1 asserts `status==="SUCCESS"`, 1 replan decision, `node_replanned` journaled once with `failedNodeId:"N-1"`, plan spliced to `N-1R`, `nodeOutcomes` = {N-1 FAILED, N-1R SUCCESS}; test 2 asserts zero budget → `status==="FAILED"`, 0 replan decisions, 0 `node_replanned`, `nodeOutcomes` = {N-1 FAILED}. Real Temporal, `describe.skipIf(address===null)` | 🟢 |

- **Frozen contracts held (byte-checked):** `types.ts` diff vs HEAD is EXACTLY one additive line — `| "node_replanned"` at line 363. No shape mutation to `ChainRecord` / `NodeOutcome` / `ChainEntry` / `Plan` / `ChainNodeHandoff` — exactly as the goal permitted ("`node_replanned` is at most an additive journal-event kind"). The compaction note rides existing/optional fields.
- **Scope:** 14 files under `packages/sdk-ts`, all entailed by the goal — new: `src/chain/replan.ts`, `src/chain/compaction-note.ts`, `test/chain/{replan,compaction-note,replan-live}.test.ts`; modified additively: `src/{types,schemas,index}.ts`, `src/chain/{chain-loop,advance,store,activities}.ts`, `src/cli/chain.ts`, `test/chain/chain-loop.test.ts`. No new dependency. No out-of-scope file.
- **Additive guarantee proven by the live test itself:** the zero-budget path (test 2) asserts the SAME failing chain seals FAILED on the unchanged halt — the byte-for-byte-current-behavior guarantee is a live assertion, not a claim.

## Independent verify — never trust the run's own green

⚠️ **The phase-0 evidence pack §3 re-ran the ACs against the WORKING TREE and reported AC-1/2/3 FAIL, AC-4 PASS. This is a FALSE FAIL, not a delivery defect:** the delivery is un-harvested, so `decideReplan` is not in the working-tree `src/chain/` (AC-1/2/3 grep the tree and miss it); AC-4 (`tsc && eslint && vitest`) is tree-independent and passes on HEAD regardless of this delivery — so its green says nothing about the run's code. **The trustworthy signal is the run's OWN judge**, which executed all 4 ACs against the workspace and sealed `✓ PROCEED (4/4)` on steps 1/2/4/6 — each judge pass shows AC-4 `pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm exec vitest run` exited 0 in the workspace. I byte-diffed the 14 workspace files vs HEAD by hand (above) and confirmed the additive shape. **Harvest the workspace, then AC-1/2/3 flip green on the tree.**

## New friction

Friction numbering is global + sequential; highest prior = F-98 (dogfood-081), so continue at F-99.

### 🟡 F-99 → WP-206-adjacent (NEW): a bare `chikory resume` from a shell missing `OPENAI_COMPAT_BASE_URL` silently loses judge routing, and Temporal masks it as a ~30-min stall instead of failing fast

- **Evidence:** the 37-minute gap between step 4's entry (23:52:06) and its seal (00:29:06). The operator's `kill -9` → `chikory resume` was issued from a shell that did NOT export `OPENAI_COMPAT_BASE_URL` (that var is only exported inside `dogfood.sh`'s own shell). The resumed judge/router activity had no base URL, so Temporal's activity retry policy (~65 attempts over ~30 min) looped SILENTLY — no loud error, just a frozen journal — until the operator noticed, fixed the env, and the run advanced.
- **Impact:** the durable-execution / crash-recovery pillar's headline UX (`chikory resume`) can silently stall for 30 min on a trivially-detectable config gap. A resume is exactly when the operator is under pressure and least able to diagnose a silent retry-loop. This is durable-execution operability, not journal corruption (the replay itself was clean).
- **WP it spawns:** a **fail-fast resume precondition** — `chikory resume` (and `chikory run`) should validate that the configured judge/routing provider config (e.g. `OPENAI_COMPAT_BASE_URL` when the routing block names `openai-compat`) is present BEFORE entering the durable retry loop, and fail loud with the missing key named, rather than deferring to a 65-attempt silent retry. Track-B (🟡 operability, not loop-integrity — no divergence, no re-execution). Documented as a resume precondition in DOGFOODING §7. Sibling of WP-206.

### ℹ️ F-100 → WP-270 (NEW): `bounded_work_unit` defers the SEAL but does not CHUNK the executor's work — the horizon is real but partly hollow (PRE-DECLARED expected finding)

- **Evidence:** step 1 cost **$4.9642** on a **28,332-byte** diff and front-loaded ALL of the product implementation (all 5 PARTs' `src/chain/` code — `decideReplan` + compaction note + replan wire + handoff wire). Steps 2–6 cost **$0.27–$0.49** each on **669–3,276-byte** diffs — test additions and small refinements only. The seal was deferred 6 times; the WORK was not distributed across the 6 steps.
- **Impact:** the intra-run ≥5-step horizon is genuinely MET, but the per-step-reliability / compounding-error KPI it exists to measure is **partly hollow** — 5 of the 6 "durable steps" did trivial test-tweak work that essentially cannot fail, so "6/6 sealed" over-states real per-step reliability. To make the compounding-error curve (95%→5% over 60 steps → target 99%+) a TRUSTWORTHY measurement, each forced step must do REAL, distinct sub-goal work.
- **This was pre-declared** in the spec's ⚠️ EXPECTED FINDING ("step-forcing only DEFERS the SEAL — it does not CHUNK... that IS a valid rung-3 result pointing at the NEXT mechanism (per-step work-unit CHUNKING, not just seal-deferral)"). Confirmed exactly.
- **WP it spawns:** **WP-270 — per-step work-unit CHUNKING.** Beyond WP-269's seal-deferral: an opt-in mechanism that hands the executor ONE bounded sub-goal (e.g. one PART / one dependency-ordered work-unit) per durable step so each sealed checkpoint carries real, distinct product progress — turning the hollow horizon into a genuine per-step-reliability curve. This is the honest next ladder mechanism (rung-3 quality), the durable-execution-pillar successor to WP-269.

## Cost / token economics — the WP-203/207 baseline datapoint

| metric | value |
|---|---|
| total (exact sum, steps + judge) | **$6.7558** / $50.00 budget = **13.5%** used |
| judge share | **0.6%** (`$0.0381` across 4 passes; max_cost_share 0.5 never approached) |
| step 1 (real product work) | $4.9642 · 3,816k in / 19k out · 66 tool calls · 9m 26s · 28,332-byte diff |
| steps 2–6 (thin) | $0.27–$0.49 each · 198k–359k in · 11–16 tool calls · 669–3,276-byte diffs |
| probe step (empty-diff) | none — F-11 did NOT recur (fifteenth+ clean run) |
| input-token economics | step 1 dominates (3.8M in); the 5 forced steps burned ~1.3M input for ~$1.75 of thin work — the F-100 tax of seal-deferral-without-chunking |

## Verdict on the thesis

🟢 **Strong positive, with a sharp honest caveat.** The durable-execution pillar delivered its hardest proof yet: ONE `chikory run` seals **6 durable checkpoints** under a policy floor and **survives a real mid-run `kill -9` → resume with byte-identical journal replay and zero step re-execution** — the crash-recovery guarantee is real at intra-run granularity, not just inter-node (dogfood-079). The Agent-as-a-Judge inner loop stayed cheap (0.6% cost share) and clean (4/4 PROCEED, 0 false catches). The delivered WP-219 D3 replan + S4 compaction note are genuine, additive, frozen-contract-safe, and LIVE-proven. **The caveat (F-100) is the thesis working as intended:** the run honestly surfaced that seal-deferral alone produces a *hollow* horizon, and named the next mechanism (per-step chunking, WP-270) needed to make the compounding-error curve trustworthy. Two mechanisms remain before the horizon KPI is real: chunking (WP-270) and a fail-fast resume precondition (F-99).
