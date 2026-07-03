# dogfood-081 — WP-269 intra-run STEP-FORCING (the rung-3 ENABLER) landed COMPLETE, all-green, contract-additive: a pure `decideStepForcing` + an opt-in `boundedWorkUnit` policy that defers a premature `claimsComplete` and re-enters the durable loop, plus a LIVE Temporal test that drives one real run sealing 3 durable checkpoints under an active policy while the no-policy path stays one-shot. The rung-3 blocking dependency (F-95) is now built; the horizon PROOF is dogfood-082 ON this machinery.

- **WP:** WP-269 — intra-run step-forcing, the rung-3 ENABLER. A real open plan.md §6 product WP on the durable-execution pillar, created by the dogfood-080 review (F-95). Launched under the DOGFOODING §1.2 fallback carve-out: the default rung-3 headline (a rung-3 HORIZON run) is BLOCKED on this harness capability not yet existing, so building it IS the sanctioned next priority.
- **Date:** 2026-07-03
- **Spec:** `examples/dogfood/dogfood-081-wp269-intra-run-step-forcing.yaml` (LOOSE, Ladder-rung 3, Thesis-KPI = intra-run durable step count, `budget_usd: 40`, `max_steps: 30`) — launched with `chikory run` (a single durable run). Loose-AC discipline honored: ACs anchor on the net-new `decideStepForcing` symbol the goal NAMES (absent on HEAD, so a recursive grep cannot false-green on an incumbent file — F-90), module/test layout left to the executor (F-82/F-83).
- **Run-id:** `run-464b7b77-3c24-4566-b4bd-ecadd1eff6a3`. Executor `codex(openai)`, judge `openai-compat/gemini-3.1-pro-preview`.
- **Terminal state:** 🟢 **SUCCESS · 1 step** — `✓ PROCEED (4/4 criteria)`, 0 rollbacks / 0 escalations / 0 injections / 1 checkpoint (`lastGood true`). One-shot, as the spec explicitly predicted (this ENABLER is a normal feature build, not the horizon proof).
- **Landed commit:** **NONE** — delivery uncommitted on the working tree (verify §5: all 8 files `IDENTICAL` to the run workspace). Left for the user's review.

## Trace

```
run run-464b7b77 · SUCCESS · 1 step · $2.99 / $40.00 · 7m 50s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step                                        tokens(in/out)   cost      dur      verdict
 1   Implemented opt-in intra-run step-forcing…  2267k/15k        $2.98     7m 16s   ✓ PROCEED (4/4)
 totals: decisions 1 · judge passes 1 ($0.0125, 0.4%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 1
```

- **Step 1** built the whole feature — a **16,114-byte** diff across 8 files in **47 tool calls** — and the judge sealed `✓ PROCEED (4/4)` on the first session. `checkpoint run-464b7b77@4, lastGood true`.
- **Loop integrity 🟢:** single durable step, one sealed checkpoint (`lastGood true`), no duplicate journal entries, no re-executed step, no resumes. Clean.
- **This one-shot is CORRECT, not the F-95 miss.** dogfood-081 is the ENABLER build (deliver the step-forcing machinery), NOT the rung-3 horizon proof — the spec says so verbatim. The horizon proof (≥5 durable intra-run steps under an active policy + a mid-run kill→resume) is dogfood-082, run ON this machinery. A one-shot here is expected and fine.

## Delivery quality (human review of the uncommitted working tree) — 🟢 COMPLETE, all-green, contract-additive

Read the diff line-by-line against the goal's three PARTS.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — PURE DECISION:** a pure, deterministic, side-effect-free `decideStepForcing(state, policy?)` returning whether to DEFER the completion milestone + FORCE another increment + the directive text; sibling of the existing pure `decide*` modules; no I/O / Temporal / clock; unit-tested exhaustively (floor-not-met→force; floor-met+criteria→allow; no-policy→never force) | `src/workflow/step-forcing.ts` (61 lines): total function, `policy===undefined → allow_completion`; normalizes `Math.max(0,·)` / `Math.max(1,·)` so it stays total on non-positive inputs; default directive constant. `test/runner/step-forcing.test.ts` (93 lines, 6 cases): no-policy, floor-not-met force, floor-met+criteria allow, floor-met+criteria-unmet force, non-positive normalization, no-mutation | 🟢 |
| **2 — DURABLE-LOOP WIRE:** call `decideStepForcing` in the completion-milestone path (`agent-loop.ts`) so an active policy defers a premature `claimsComplete` and re-enters, sealing a checkpoint per increment until the floor is met AND the judge confirms the ACs; NO-policy path byte-identical; policy is an additive OPTIONAL spec-input field (NOT a `StepRecord`/`JournalEntry`/`Checkpoint` mutation) | `agent-loop.ts:537-552`: computes `acceptanceCriteriaMet`, calls `decideStepForcing({durableStepsSealed: checkpoints.length, executorClaimedCompletion: record.claimsComplete===true, acceptanceCriteriaMet}, spec.boundedWorkUnit)`; on `deferCompletionMilestone` sets `judgeFeedback = incrementDirective` and `continue`s; else the `if (acceptanceCriteriaMet) return seal("SUCCESS")` is the SAME line as before. `boundedWorkUnit?` added to `TaskSpec` (`types.ts`), `BoundedWorkUnitPolicySchema` (`schemas.ts`, `.strict()` optional), `bounded_work_unit` YAML→camel mapping (`taskspec.ts`), barrel re-export (`index.ts`). **No shared contract shape altered.** | 🟢 |
| **3 — LIVE PROOF:** a LIVE Temporal test driving ONE real run whose goal has several parts under an active policy, asserting the run seals AT LEAST the floor of durable checkpoints (a genuine intra-run horizon), each advancing work, reaching SUCCESS; and asserting NO-policy on the SAME goal stays one-shot; reuse the live-Temporal harness, do NOT mock the workflow | `test/runner/agent-loop.test.ts` (+95 lines) inside the live `describe.skipIf(address===null)("agent loop (WP-121)")`: an active `{minDurableSteps:3}` policy drives a scripted 3-part run → asserts `checkpoints.length===3`, journal has 3 SUCCESS steps (`stepIndex [0,1,2]`), each forced step's summary carries the directive, terminal `SUCCESS`, judge wire hit 3×; then the SAME goal with NO policy → asserts `checkpoints.length===1`, one-shot. **Real Temporal, not mocked.** | 🟢 |
| CONSTRAINTS: strict TS, ESM `.js`, named exports, NO new dep, NO-policy path byte-identical, NO contract/`StepRecord`/`JournalEntry`/`Checkpoint` change, reuse `isCompletionMilestone` + the pure `decide*` pattern | No dep added; `boundedWorkUnit` is an additive optional field, not a contract mutation; `decideStepForcing` is a NEW pure module mirroring `decideContextWindowPacing`; the wire is purely additive; no shared type shape changed | 🟢 |

- **Scope:** exactly the 8 files the goal entails — 2 new (`src/workflow/step-forcing.ts`, `test/runner/step-forcing.test.ts`), 6 modified (`index.ts`, `schemas.ts`, `taskspec.ts`, `types.ts`, `workflow/agent-loop.ts`, `test/runner/agent-loop.test.ts`). No contract/shared-type file's shape changed (the `types.ts`/`schemas.ts` edits are additive optional fields). Clean.
- **Independent AC re-verify (this review, against the working tree):** AC-1/2/3 greps (`decideStepForcing` in `src/workflow/`, in `agent-loop.ts`, in `test/`) all **PASS**; AC-4 `tsc --noEmit` OK · `eslint .` OK · `vitest run` **636 passed / 19 skipped / 0 failed**. I re-ran `test/runner/agent-loop.test.ts` in isolation: the LIVE step-forcing horizon test **genuinely EXECUTED** (not skipped) — `✓ step-forcing policy creates an intra-run durable checkpoint horizon while no-policy stays one-shot 2847ms`, 6/6 in that file. PART-3 is live-satisfied, not grep-only.
- **Harvest byte-diff (verify §5):** all 8 files **IDENTICAL** to `.chikory/runs/run-464b7b77/workspace` — the working tree IS what ran.
- **Verdict on the delivery:** **WP-269 → 🟢 DONE** on merit (step-forcing is first-class, pure-sibling, opt-in, contract-additive, all-green, LIVE-proven). Uncommitted — the user harvests. The rung-3 blocking dependency (F-95) is now built; dogfood-082 runs the horizon proof ON it.

## Cost / token economics — the WP-203/207 baseline datapoint

| Metric | Value |
|---|---|
| Total (steps + judge) | **$2.9918** — 7.5% of the $40 budget |
| Judge share | **$0.0125 (0.4%)** — one 32s pass, 30,018 evidence bytes |
| Step-1 tokens | **2,267k in / 15k out** — ~151:1 in:out ratio |
| Empty-diff probe step (F-11 datapoint) | **none** — no probe step this run (productive step judged directly, F-11 stays retired) |

- ℹ️ **2.27M input tokens for one 16KB / 299-line diff is the notable number** — it is the 47 tool-call turns each re-feeding growing context (codex reading sdk-ts to place a pure sibling module + wire it), NOT a telemetry bug (cost is populated, `gpt-5.5`/`gemini-3.1-pro-preview` priced, budget gate live). Record it as the single-clean-step baseline for WP-203/WP-207 context-economics: one clean codex feature step ≈ 2.3M input tokens ≈ $3. (Compare dogfood-080's step-2 retry = 1,265k input for a 1.4KB delta.)

## New friction (highest prior F-96 → F-97)

### 🟡 F-97 → WP-266/WP-511 loose-AC lint extension (track-B) — AC-3's grep is satisfied by the UNIT test alone; nothing in the ACs actually enforces the PART-3 LIVE horizon test the spec demands
- **Evidence:** the spec's PART 3 mandates a LIVE Temporal test asserting `>1` durable checkpoint in one run. But AC-3's `check` is `grep -rq 'decideStepForcing' test/` — and `test/runner/step-forcing.test.ts` (the pure unit test) already contains `decideStepForcing`. So AC-3 greens with the unit test ONLY; had the executor skipped the live `agent-loop.test.ts` horizon test, all four ACs (AC-1 src grep, AC-2 loop grep, AC-3 test grep, AC-4 suite green) would STILL pass — nothing re-requires the live proof. The executor over-delivered (the live test IS present and executes), so this run was fine; the AC set is what under-constrains.
- **Why it matters:** loose-spec ACs on symbol greps (the correct F-82/F-90 discipline for outcome-anchoring) cannot distinguish "the LIVE horizon test exists" from "the symbol appears in any test file." For rung-3 PROOF specs (dogfood-082) where the LIVE ≥5-step horizon assertion IS the deliverable, a grep AC could false-green on a unit test — the exact class of gap dogfood-075's F-82 was about, one layer up. AC-4 (full suite green) doesn't force a live test either (live tests `skipIf(address===null)`).
- **Fix → extend the WP-266/WP-511 loose-AC lint (track-B):** when a spec PART names a "LIVE" / Temporal test, the corresponding AC `check` should anchor on the live-harness symbol (`skipIf(address`, `createTemporalRunner`, `awaitTerminal`) in the file that asserts the horizon, not a bare shared symbol grep. Not loop-integrity (no bad outcome this run, executor over-delivered) → track-B note, NOT a headline. Especially load-bearing for dogfood-082.
- **ℹ️ Note for dogfood-082:** its ACs must PIN the horizon numerically (assert `≥5` sealed durable checkpoints in one run + the operator kill→resume landing BETWEEN sealed steps), not merely grep a symbol — the F-97 lesson applied forward.

### 🟡 F-98 → track-B doc-hygiene (WP-249-adjacent) — plan.md §6 status rows drift behind the code, and a stale row nearly misdirected the rung-3 host pick
- **Evidence:** readying dogfood-082 (phase 5) required a real OPEN ≥5-part product WP to host the horizon. The plan §6 WP-213 row reads 🟡 "**PROMOTED TO NEXT HEADLINE** … Router-driven loop" — but the code is already shipped: `src/executors/native.ts` (449 lines, full router tool-loop + `maxTurns`/`maxSeconds` bounding + token accounting), committed as `0db60ba feat(executors): native raw-LLM loop executor (WP-213)`, wired into `cli/commands.ts` + `index.ts`. WP-219's S3-wiring residuals are similarly overstated as open — `chain-loop.ts` shows S4 handoff + `node_started`/`node_sealed` journaling already landed; only D3 replan + structured-compaction-notes + parallel fan-out genuinely remain (the loop's own deferred-note is the trustworthy signal, not the §6 prose).
- **Why it matters:** headline selection is driven by which §6 WPs look open. A stale "still open" row on already-shipped code is a **trap toward the exact failure mode DOGFOODING §1.1/§5 warns about** — a headline an agent can't plausibly fail because the work already exists (a hollow parity rebuild). Here it was caught by grepping the code before writing the spec; without that check dogfood-082 would have rebuilt WP-213.
- **Fix → track-B doc-hygiene (folds into WP-249's harvest-hygiene family):** when a WP's delivery lands, flip its §6 status in the same harvest; and phase-5 host selection must grep the code for the WP's landmark symbols before trusting a §6 "open" marker. Not loop-integrity (no bad run happened) → track-B, NOT a headline.

### 🟡 F-58 / WP-249 — (standing) delivery uncommitted with no harvest trailer
- No landed commit for this run yet (verify §6). When harvested, the commit must carry a `Run-ID: run-464b7b77…` trailer linking it to the audit trail. WP-249 owns it; no new WP.

## KPIs (DOGFOODING §1.4)

| KPI | This run (dogfood-081) | Trailing window / target |
|---|---|---|
| Max horizon survived (durable steps / wall-clock) | **1 step / 7m 50s** — one-shot ENABLER build (expected; not the horizon proof) | rung-3 target = ≥5 durable intra-run steps in one run — the ENABLER for it now EXISTS; PROOF = dogfood-082 |
| Kill→resume count (live at-horizon) | **0** — an ENABLER build, no long run to kill | rung-2's live kill→resume stands (dogfood-079); the rung-3 mid-run kill→resume is dogfood-082's job, now unblocked |
| Judge true-positives pre-land | **0** — single clean PROCEED (4/4), no seam drill; honest 0 | seam drills excluded per ledger |
| Trailing-3 meta:product headline ratio | **0:3** (079/080/081 all product) | target ≤1:3 — 🟢 well under |
| Per-step reliability (runs ≥5 steps) | **n/a — still 0 runs ≥5 steps** | the intra-run horizon gap; the harness lever to CROSS ≥5 steps in one run now exists → dogfood-082 finally measures it |
| Current ladder rung vs P2 exit gate | **rung 2 REACHED (dogfood-079); rung-3 ENABLER LANDED (dogfood-081) — rung-3 PROOF pending (dogfood-082)** | next: dogfood-082 rung-3 horizon + mid-run kill→resume ON this machinery → then P2 exit gate (24h brownfield) |

## Verdict on the thesis

🟢 **The decisive negative result of dogfood-080 (F-95: the intra-run horizon cannot be summoned by enlarging the goal — it must be harness-forced) now has its remedy built.** WP-269 landed the harness lever exactly as specified: a pure, total, side-effect-free `decideStepForcing` (a true sibling of `decideContextWindowPacing`), an opt-in `boundedWorkUnit` policy that is a purely additive optional spec-input field (no `StepRecord`/`JournalEntry`/`Checkpoint` contract touched), a purely-additive wire whose no-policy path is byte-identical to before, and — critically — a LIVE Temporal test that genuinely drives ONE real durable run to seal **3 sealed checkpoints under an active policy** while proving the no-policy path stays one-shot. That is the first mechanically-demonstrated intra-run horizon in the codebase, even if via a scripted executor. The run itself one-shot, exactly as the spec predicted for an ENABLER build — and that is fine, because the machinery is the deliverable. The single caveat surfaced for review is F-97: the loose grep ACs don't actually re-require the PART-3 live test (the executor over-delivered it anyway), a lint gap that dogfood-082 MUST close by pinning its horizon assertion numerically. **Next headline is now unambiguous and pre-declared: dogfood-082 — rung-3 horizon PROOF + a mid-run `kill -9` → `chikory resume` landing BETWEEN sealed steps, run ON the `boundedWorkUnit` policy this WP just delivered.**
</content>
</invoke>
