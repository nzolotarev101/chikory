# dogfood-083 — WP-270 PER-STEP WORK-UNIT CHUNKING: the rung-3 QUALITY lever dogfood-082 proved is required (F-100). Built the opt-in `work_chunks` capability — an ordered list of named sub-goals on the existing `bounded_work_unit` policy plus a pure `decideWorkChunk` decision wired into the durable loop's step-forcing path — so each forced durable step carries ONE bounded, dependency-ordered directive instead of the whole goal. LIVE-proven in-code (a real Temporal run asserts each step's instruction equals its ordered chunk, all distinct, none equal the full goal; the no-chunk-list path stays byte-identical to WP-269). All 4 ACs green; harvest byte-IDENTICAL to the run workspace. The enabler for a NON-hollow rung-3 horizon (dogfood-084 next).

- **WP:** WP-270 — per-step work-unit chunking. A real open plan.md §6 product WP on the durable-execution pillar, the direct successor to WP-269 seal-deferral; §1.2 fallback carve-out applied (the default rung-3 NON-hollow horizon was BLOCKED on this capability not existing, F-100). This run IS that blocking dependency.
- **Date:** 2026-07-04
- **Spec:** `examples/dogfood/dogfood-083-wp270-per-step-work-unit-chunking.yaml` (LOOSE, Ladder-rung 3, Thesis-KPI = per-step work distribution, `budget_usd: 40`, `max_steps: 30`) — launched with `chikory run` (single durable run). Loose-AC discipline honored: ACs anchor on the net-new `decideWorkChunk` symbol the goal NAMES (absent on HEAD, so a recursive grep cannot false-green — F-90); module/test layout left to the executor (F-82/F-83). AC-3 F-97-hardened: requires a `test/` file co-referencing `decideWorkChunk` AND the LIVE runner driver `createRunnerWorker`, so a unit test cannot false-green the LIVE per-step-distribution proof.
- **Run-id:** `run-d3879dab-c1e4-4dde-930e-27f679a75d10`. Executor `codex(openai)` / gpt-5.5, judge `openai-compat/gemini-3.1-pro-preview`.
- **Landed commit:** un-harvested at review time (working tree, byte-IDENTICAL to the run workspace — pack §5 all IDENTICAL). Harvest then commit.

## Trace

```
run run-d3879dab · SUCCESS · 3 steps · $4.09 / $40.00 · 10m 22s · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step                                 tokens(in/out)  cost     diff bytes  verdict
 1   Implemented opt-in per-step chunking  2726k/15k       $3.5595  20569       ✓ PROCEED (4/4)
 2   Added non-integer/infinite unit tests 167k/2.0k       $0.2281  738         ✓ PROCEED (4/4)
 3   Added live per-step distribution asrt  200k/2.8k       $0.2776  924         ✓ PROCEED (4/4)
 totals: decisions 3 · judge passes 3 ($0.0281, 0.7%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 3 · pacing 3
```

- **The `min_durable_steps: 3` floor deferred the seal 3 times** (WP-269 step-forcing lever — the new `work_chunks` field is deliberately NOT used in the launch YAML, since it does not exist in HEAD's `.strict()` schema; a launch referencing it would be REJECTED at parse time). The chunk-list capability is proven instead by the in-code live test (dogfood-081 pattern).
- **Loop integrity 🟢:** 3 distinct sealed steps, 3 distinct checkpoints (`@4`/`@9`/`@14`, all `lastGood true`), no duplicate journal entry, no re-executed step, 0 resumes. Clean.

## Delivery quality (human review, post-run workspace = working tree) — 🟢 COMPLETE, all-green, contract-additive

All 4 numbered PARTs of the goal landed, additively. Reviewed line-by-line against the goal.

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — POLICY EXTENSION:** additive OPTIONAL ordered `work_chunks` list on the existing `bounded_work_unit` / `BoundedWorkUnitPolicy`; synced across spec-input type, zod schema, and the YAML→camel mapping exactly as `min_durable_steps`; no existing shared-contract shape change | `types.ts`: new `WorkChunk {name, directive}` + optional `BoundedWorkUnitPolicy.workChunks?`; `schemas.ts`: `WorkChunkSchema` (`.strict()`, both fields `min(1)`) + `workChunks: z.array(...).optional()`; `taskspec.ts`: `RawTaskSpecYaml` accepts `work_chunks` and `parseTaskSpec` maps `work_chunks → workChunks`; `index.ts` re-exports. `StepRecord`/`JournalEntry`/`Checkpoint` untouched. | 🟢 |
| **2 — PURE DECISION:** side-effect-free total `decideWorkChunk(state, policy?)` — sibling of `decideStepForcing`; returns the next unconsumed chunk / all-consumed / no-chunks; no I/O, Temporal, clock | `src/workflow/work-chunk.ts` (46 lines): `WorkChunkDecision` discriminated union (`use_chunk`/`all_chunks_consumed`/`no_chunks`); absent-or-empty list → `no_chunks` (WP-269 default preserved); `consumedChunks` normalized via `Number.isFinite` + `Math.max(0, Math.trunc(...))`; indexes `chunks[consumedChunks]`. | 🟢 |
| **3 — DURABLE-LOOP WIRE:** `decideWorkChunk` called from the step-forcing path so a forced step carries EXACTLY the next chunk's directive (not the whole goal); completion deferred until all chunks handed out AND judge confirms ACs; additive — no chunk list = byte-for-byte WP-269 | `agent-loop.ts`: top-of-loop computes `activeWorkChunk` from `{consumedChunks: checkpoints.length}`; `stepInstruction = use_chunk ? chunk.directive : spec.goal` feeds both `context.goal`/`planItem` and `executeStep.instruction`. Completion path (line 557) recomputes `nextWorkChunk`; `use_chunk` → `judgeFeedback = chunk.directive; continue` (defers before the WP-269 `deferCompletionMilestone` check, then falls through to it when chunks exhausted). | 🟢 |
| **4 — LIVE PROOF:** LIVE Temporal test driving one real `chikory run` with a multi-chunk policy; asserts ≥1 checkpoint per chunk AND each forced step advanced a DISTINCT chunk, reaching SUCCESS; and the SAME goal with NO chunk list seals on the unchanged WP-269 path | `test/runner/work-chunk.test.ts`: unit `describe` (first→chunk[0], mid→next, all-consumed, empty/absent→no-chunks, NaN/Infinity/negative normalization, no input mutation) + LIVE `describe.skipIf(address===null)`: real Temporal run with 3 chunks asserts each step's `instruction`/`planItem` **equals the ordered chunk directive** (`toEqual(directives)`), set size = 3 (all distinct), none equal `fullGoal`, each `diffRef.bytes > 0` with distinct diff summaries, one `step-N.txt` per chunk; the no-chunk-list variant asserts all steps use `fullGoal` (WP-269 additive guarantee). | 🟢 |

- **Frozen contracts held:** the change is a NEW pure module + one additive optional field on `BoundedWorkUnitPolicy` + additive loop edits. No shape change to `StepRecord` / `JournalEntry` / `Checkpoint`. No new dependency.
- **Scope (`git status --short`):** 9 files under `packages/sdk-ts` + `docs/spec/task-spec.md`, all entailed by the goal — new: `src/workflow/work-chunk.ts`, `test/runner/work-chunk.test.ts`; modified additively: `src/{index,schemas,taskspec,types}.ts`, `src/workflow/agent-loop.ts`, `test/taskspec.test.ts`. No out-of-scope file.
- **Additive guarantee proven by the live test itself:** the no-chunk-list variant is a live assertion that the SAME goal seals on the byte-identical WP-269 path — not a claim.

## Independent verify — the run's own green confirmed

- Pack §3 re-ran all 4 ACs against the WORKING TREE: **AC-1/2/3/4 PASS** (AC-4 = `tsc --noEmit && eslint . && vitest run` → **658 passed / 19 skipped**, exit 0). The delivery is on the working tree (un-harvested but present), so the tree-grep ACs are trustworthy here (unlike dogfood-082's un-harvested false-fail).
- Pack §5 byte-diffed all 8 changed `packages/…` files vs the run workspace: **all IDENTICAL** — the working tree IS the run's output; no divergence.
- The run's OWN judge executed all 4 ACs against the workspace and sealed `✓ PROCEED (4/4)` on each step; each pass shows AC-4 exited 0. Family diversity real: executor gpt-5.5 (OpenAI family) vs judge gemini-3.1-pro-preview (Gemini family, via openai-compat shim).

## New friction

Friction numbering is global + sequential; highest prior = F-100 (dogfood-082), so continue at F-101.

### 🟡 F-101 → WP-270-adjacent (NEW, track-B): the chunk-consumption counter uses raw `checkpoints.length`, so a ROLLBACK/non-PROCEED step advances the chunk pointer past the reverted chunk

- **Evidence:** the wire keys chunk selection on `{consumedChunks: checkpoints.length}` both at top-of-loop and in the completion path. `writeCheckpoint`/`checkpoints.push` (`agent-loop.ts:511/518`) run on EVERY step, including a step whose judge verdict is `ROLLBACK` (which restores the tree at line 504 before the checkpoint captures it) or a FAILED step with no judge pass. On the next iteration `checkpoints.length` has incremented, so `decideWorkChunk` hands `chunk[N+1]` — the rolled-back/failed chunk `N`'s work is never re-attempted; the run silently advances the chunk order.
- **Impact:** the per-step-distribution guarantee (one distinct chunk of REAL work per durable step) is violated under a ROLLBACK or a non-PROCEED chunk step — the reverted chunk is skipped rather than redone. Not exercised this run (0 rollbacks, all PROCEED), so **latent**. It is **self-corrected by the terminal gate** — run-level SUCCESS still requires every acceptance criterion to pass, so a chunk whose work is missing fails the final judge and cannot false-seal SUCCESS. It is also **consistent with the pre-existing WP-269 `durableStepsSealed: checkpoints.length` floor counter**, so it is not a regression — but for CHUNKING specifically, a skipped chunk is more consequential than an over-counted floor.
- **WP it spawns:** a track-B refinement (🟡, not loop-integrity — no divergence, no re-execution, self-corrected by the AC gate) — count only PROCEED/`lastGood` checkpoints for chunk consumption so a rolled-back chunk is re-handed on the next step. Folded into WP-270's follow-up; NOT a headline. To be surfaced live by dogfood-084's non-hollow horizon if a chunk step ever draws a non-PROCEED verdict.

### ℹ️ F-100 recurrence (NOT new): this build run itself front-loaded — confirming, by construction, why WP-270 exists

- **Evidence:** step 1 cost **$3.5595** on a **20,569-byte** diff and front-loaded ALL product code (PARTs 1–3: policy + pure decision + loop wire). Steps 2–3 cost **$0.2281 / $0.2776** on **738 / 924-byte** diffs — unit + live test additions only. The seal was deferred 3×; the WORK was not distributed.
- **Why this is expected, not a new finding:** the launch used `bounded_work_unit: {min_durable_steps: 3, directive: ...}` with NO `work_chunks` (the field this run BUILDS does not exist in HEAD's schema, so a launch referencing it is rejected at parse — the spec's NOTE said so and proved the field in-code instead). So this run rode the OLD WP-269 floor — which IS hollow, exactly the F-100 phenomenon WP-270 fixes. dogfood-084 is the first launch that can use `work_chunks` in its YAML and thereby produce a NON-hollow horizon.

## Cost / token economics — the WP-203/207 baseline datapoint

| metric | value |
|---|---|
| total (exact sum, steps + judge) | **$4.0933** / $40.00 budget = **10.2%** used |
| judge share | **0.7%** (`$0.0281` across 3 passes; `max_cost_share 0.5` never approached) |
| step 1 (real product work) | $3.5595 · 2,726k in / 15k out · 53 tool calls · 6m 42s · 20,569-byte diff |
| steps 2–3 (thin, F-100) | $0.23 / $0.28 · 167k / 200k in · 8 / 13 tool calls · 738 / 924-byte diffs |
| probe step (empty-diff) | none — F-11 did NOT recur (sixteenth+ clean run) |
| input-token economics | step 1 dominates (2.7M in ≈ 87% of spend); the 2 forced steps burned ~367k input for ~$0.51 of thin test work — the F-100 seal-deferral-without-chunking tax, again |

## Verdict on the thesis

🟢 **Clean positive — the honest next lever, built and LIVE-proven.** dogfood-082 surfaced that seal-deferral alone (WP-269) yields a *hollow* horizon; dogfood-083 built exactly the successor it named — opt-in per-step work-unit chunking — as a pure `decideWorkChunk` decision plus an additive loop wire, with a LIVE Temporal test that asserts distinct ordered per-step work AND the byte-identical WP-269 fallback. The judge inner loop stayed cheap (0.7% cost share) and clean (3/3 PROCEED, 0 false catches); family diversity real (gpt-5.5 executor vs gemini judge). Frozen contracts held; harvest byte-identical. The run ironically front-loaded (F-100 recurred) — because it could not yet use the field it was building — which is the clearest possible motivation for the NEXT run: **dogfood-084 launches a ≥5-step `chikory run` USING `work_chunks` on a real product WP, to convert the hollow rung-3 horizon into a TRUSTWORTHY per-step-reliability curve.** One latent robustness gap (F-101, chunk-skip under ROLLBACK) is track-B and self-corrected by the terminal AC gate.

---

## ADDENDUM — re-run `run-03d161e9` CLOSES F-101 (2026-07-04)

> The identical dogfood-083 spec was **re-launched** on a HEAD that already carried the committed (buggy) WP-270 (`1248160`). The executor found `decideWorkChunk` present and, rather than rebuild, **hardened the loop wire — fixing the exact F-101 latent bug this report predicted for dogfood-084.** Delivery is on the working tree, un-harvested, byte-IDENTICAL to the re-run workspace.

- **Run-id:** `run-03d161e9-88f5-4d5f-ac6c-f580c1d53ab3`. SUCCESS · 3 steps · **$2.58 / $40.00** (exact sum $2.5785, 6.5%) · 8m 58s · executor `codex(openai)`/gpt-5.5 · judge `openai-compat/gemini-3.1-pro-preview`. 3/3 PROCEED (4/4 criteria each), judge share 0.9% ($0.0236), 0 rollbacks / 0 escalations, 3 checkpoints.
- **Landed:** un-harvested on the working tree — `M packages/sdk-ts/src/workflow/agent-loop.ts` (+9/−3), `M packages/sdk-ts/test/runner/work-chunk.test.ts` (+95). Pack §5: both **IDENTICAL** to workspace. Harvest then commit.

### 🟢 F-101 CLOSED — chunk counter no longer skips a rolled-back chunk

- **The bug (confirmed on HEAD `d5c5f7d`):** `git show HEAD:…/agent-loop.ts` keys chunk selection on `{consumedChunks: checkpoints.length}` at **lines 365 and 558**. `checkpoints.push(checkpoint)` (line 520) runs UNCONDITIONALLY, before the verdict gate — so a ROLLBACK/non-PROCEED step still grows `checkpoints.length`, and the next iteration hands `chunk[N+1]`, silently skipping the reverted chunk `N`. The FIRST dogfood-083 run (`run-d3879dab`, `1248160`) shipped this; its 4/4 ACs + the family-diverse judge **greened it** because no AC exercised the rollback path.
- **The fix (working tree):** a dedicated `let consumedWorkChunks = 0` counter replaces `checkpoints.length` at both call sites; it increments ONLY inside `if (verdict.kind === "PROCEED")` AND `if (activeWorkChunk.action === "use_chunk")` (`agent-loop.ts:547`). A rolled-back chunk therefore leaves the counter untouched and is re-handed next iteration. The fix also adds a `workChunkMilestone` (`activeWorkChunk.action === "use_chunk"`) to the judge-gate condition so every chunk step draws a verdict — the mechanism that makes the PROCEED-gated counter actually advance.
- **LIVE-proven:** new test `retries the same chunk after ROLLBACK instead of skipping ahead` drives a scripted judge (`AC-1:false`+rubric fail → ROLLBACK, then false, then pass) and asserts the journal step instructions equal `[chunk0, chunk0, chunk1]` — the reverted chunk0 is RE-ISSUED, not skipped. A second live test proves chunked steps advance even when the executor never claims completion. Plus a boundary unit case (`consumedChunks: 99 → all_chunks_consumed`).
- **Verified green:** pack §3 re-ran all 4 ACs on the tree — AC-4 (`tsc --noEmit && eslint . && vitest run`) → **660 passed / 19 skipped**, exit 0 (up from 658; +2 live tests). tsc + eslint clean.
- **Status:** F-101 → **🟢 CLOSED**. WP-270 hardened. The dogfood-084 premise ("surface F-101 live under a non-hollow horizon") is now pre-empted — 084 still runs as the rung-3 horizon proof, but F-101 is already sealed by this fix + its regression tests.

### New friction (global sequential; prior max = F-101)

**🟡 F-102 → process (track-B note, NOT a headline WP): an already-green spec was re-launched instead of the queued ladder headline.** dogfood-083 was SUCCESS + recorded + committed; re-running its identical YAML consumed a run slot ($2.58) that the loop's own queue had assigned to dogfood-084. It happened to yield a high-value F-101 fix, so net-positive here — but there is no routing that turns a documented track-B robustness gap (F-101) into a scoped track-B PR rather than a duplicate dogfood run. *WP it spawns:* none as code — a DOGFOODING §7 note ("a track-B fix found in review should land as a normal PR, not a re-run of the closed headline spec"); the fix itself is legitimate and kept.

**ℹ️ F-103 → the re-run widened judge cadence beyond the spec ACs (in-scope, noted for traceability).** `workChunkMilestone` forces a judge pass on EVERY chunk step regardless of `judge.cadence`. The loose ACs (symbol grep + tsc/eslint/vitest) cannot see this behavior change. It is defensible — necessary so a PROCEED-gated `consumedWorkChunks` can advance and so each chunk of real work is individually gated — but it is executor-initiated scope the ACs did not pin. Reinforces the root lesson: **symbol-presence ACs miss behavioral correctness under adverse verdicts** (the same blind spot that let F-101 ship green the first time). *WP it spawns:* none — folded into WP-270; feeds the WP-265 AC-hardening thread (make horizon ACs exercise a ROLLBACK, not just PROCEED).

### Verdict on the addendum

🟢 **Thesis win — self-correction caught a shipped durable-execution bug the ACs + judge had greened.** The first WP-270 delivery passed every gate yet skipped rolled-back chunks under adverse verdicts; a re-run, with no human pointing at the line, rewrote the counter to be PROCEED-gated and pinned it with a LIVE scripted-ROLLBACK regression test. That is exactly the compounding-error mitigation the project exists to demonstrate — the cost is F-102 (a run slot spent on a duplicate spec instead of a routed track-B PR).

---

## SECOND ADDENDUM — re-run `run-0a285f5b` (083c) CLOSES nothing new; it is the launcher-glob accident (2026-07-04)

> The identical dogfood-083 spec was launched a **THIRD** time — not on purpose. The pre-`59c57f6` launcher glob `dogfood-[0-9][0-9][0-9].yaml` (3-digit-EXACT) did not match the newly-authored, suffix-named `dogfood-084-wp214-multirepo-nonhollow-horizon.yaml`, so it silently fell back to the bare-named `dogfood-083.yaml` and re-ran the already-closed WP-270 spec. The executor found the work done and padded the forced horizon with test-only assertions.

- **Run-id:** `run-0a285f5b-fcfb-4f22-847b-1c11b6e93f8c`. SUCCESS · **4 steps** · **$3.02 / $40.00** (exact sum $3.0199, 7.5%) · 10m 10s · executor `codex(openai)`/gpt-5.5 · judge `openai-compat/gemini-3.1-pro-preview`. 3 judge passes (cadence 2), all ✓ PROCEED 4/4, judge share **0.8%** ($0.02), **0 rollbacks / 0 escalations**, 4 checkpoints.
- **Ledger row:** `083c,WP-270,run,SUCCESS,4,3.02,loose,product,0,0,0,0` (the WP-270 family's third row; `rollbacks` column populated = 0).
- **Landed:** the test-only harvest committed as **`b103645`** (`test(sdk-ts): assert context snapshots and check ordered chunk horizon`, +60/−1 to `test/runner/work-chunk.test.ts`) by the auto-commit hook. Pack §3 re-ran all 4 ACs on the tree → **681 passed | 19 skipped**, tsc+eslint exit 0.

### 🔴 The hollow half — step 1 is a $1.43 empty probe

- **Evidence:** step 1 sealed a **0-byte diff** at **$1.4342 = 47.5% of the whole run** (1105k in / 5.3k out, 33 tool calls, 3m 13s) — the executor confirmed WP-270 + the F-101 fix already exist on HEAD and produced nothing. Steps 2–4 sealed **1311 / 1854 / 1493-byte** diffs — assertions on `work-chunk.test.ts` only, no product code. The `work_chunks` field this spec's successor was meant to exercise was **still not used** (the spec pre-dates it in HEAD). This is a HOLLOW horizon by construction: nothing left to build.
- **Why it greened anyway:** the ACs are symbol-presence greps (`decideWorkChunk` in `src/workflow/`) + `tsc/eslint/vitest` — all satisfied by the incumbent code, so a run that builds nothing passes. The F-90 net-new-symbol guard protects against false-green on a WRONG file; it does NOT protect against a spec whose named symbol has since SHIPPED (the F-106 failure mode below).

### New friction (global sequential; prior max = F-103)

**🟡 F-104 → launcher-glob fallback (CLOSED-ON-ARRIVAL by `59c57f6`).** The 3-digit-exact spec-pick glob could not match a suffix-named spec (`dogfood-084-…-horizon.yaml`) and silently fell back to the previous bare-named spec, re-running closed dogfood-083 for **$3.02** — 47.5% of it wasted on the empty probe. *Fix (landed `59c57f6`):* the glob is now `dogfood-[0-9][0-9][0-9]*.yaml | sort | tail -1` (zero-padded numeric prefix keeps order; a suffixed name sorts after its bare sibling). *WP it spawns:* none — fixed; regression-guarded by the `sort|tail` semantics.

**🟡 F-105 → warn-only spec-pick gate (CLOSED-ON-ARRIVAL by `59c57f6`).** The staleness/spec-pick precheck warned but launched anyway, so a mis-resolved glob could still burn a run. *Fix (landed `59c57f6`):* refuse-by-default staleness gate. *WP it spawns:* none — fixed.

**🟡 F-106 → queued-headline invalidated by out-of-loop delivery (this review; doc-drift, F-98 class, opposite direction).** WP-214 multi-repo workspaces — the host of the QUEUED dogfood-084 headline — was implemented OUTSIDE the dogfood loop (`fadc124`, `collectWorkspaceRepos`), so dogfood-084's net-new AC symbol (asserted "absent on HEAD") already exists → the headline is dead on arrival and would green hollow (a guaranteed 083c-repeat). *Fix (this review):* dogfood-084 RETIRED (`.yaml.retired`, out of the launcher glob); the identical non-hollow rung-3 horizon re-hosted on the only surviving §6 candidate, **WP-215 architecture rubric**, as **dogfood-085**. *Operational lesson (→ DOGFOODING §7):* before launching a queued headline, re-validate it against HEAD — grep its net-new AC symbol; if present, the host WP already shipped and the headline must be rewritten.

### Verdict on the second addendum

🔴 **Pure waste, cleanly bounded — a process bug, not a thesis result.** run-0a285f5b delivered no product code ($3.02, 47.5% of it an empty probe) and exists only because a launcher glob mis-resolved (F-104) past a refuse-gate that only warned (F-105), onto a spec whose successor was already invalidated by an out-of-loop WP-214 delivery (F-106). All three are closed — two by `59c57f6`, the third by retiring dogfood-084 and re-hosting the horizon as dogfood-085 on WP-215. The one durable signal: the progression gate correctly flips **⛔ STALLED** over 083/083b/083c, which BINDS the next headline to the current ladder rung — exactly what dogfood-085 is.
