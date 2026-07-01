# dogfood-072 — WP-233(a) pure plan-gate FAILURE CLASSIFIER LANDED (clean, spec-faithful); but the run's ENTIRE cost was a retry tax after codex blew the 600s step wall-clock cap

- **WP:** WP-233(a) — the PURE plan-gate failure classifier for the durable chain-planning layer (the dogfood-041 attempt-2 F-33 fix-half): `classifyPlanGateFailure(verdict: PlanVerdict): PlanGateFailureClass | null` + `PLAN_GATE_INFRA_REASON_PREFIXES` (the three verbatim `meta-judge-harness.ts` prefixes) + the `PlanGateFailureClass` interface, so a non-PROCEED plan-gate verdict caused by an **infra/transport fault** (judge unreachable — SAFE to re-run) is distinguishable from a **substantive plan rejection** (do NOT blindly re-run). The pure-first analog of WP-257 `planLiteralGaps` / WP-261 `assessLaunchModeMismatch`. Authored + launched correctly as a **single `chikory run`** (the launch-mode divergence streak that hit 067–071 did NOT recur — first correct launch in 6).
- **Date:** 2026-07-01
- **Spec:** `examples/dogfood/dogfood-072.yaml` (`dogfood-072-wp233a-plan-gate-failure-classifier`)
- **Run-id (single run):** `run-1ac16aa8-dc6a-4a72-bb94-d59ccb8a13d2`. Runtime HEAD `e6feab9`.
- **Landed commit:** none yet — **3 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/chain/plan-gate-failure.ts` NEW +35, `packages/sdk-ts/src/index.ts` EDIT +1, `packages/sdk-ts/test/chain/plan-gate-failure.test.ts` NEW +103), byte-**IDENTICAL** to the run workspace (pack §5 all three `IDENTICAL`). Left for operator review per dogfood-review §4.

## Trace (single run, 2 steps)

```
run run-1ac16aa8-… · SUCCESS · 2 steps · $0.42 / $5.00 · 25m6s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)

 #   step deliverable                                  tokens(in/out)  step$     judge$    verdict         dur / tools
 1   FULL delivery written, then KILLED @653.1s        0/0             $0.0000   $0.0085   ✗ FAILED        10m53s / 25 tools
     (maxSeconds=600 wall-clock cap, 1.09×, retriable)                                    (AC-1 ✓ / AC-2 ✗)
 2   0-BYTE diff — re-verify only, seals SUCCESS       298k/3.4k       $0.4072   $0.0084   ✓ PROCEED 2/2   1m52s / 19 tools

totals: 2 decisions · 2 judge passes · $0.4241 total (exact sum) · judge $0.0169 (~4.0%) · 0 rollbacks · 0 escalations
        budget 8.4% of $5.00 · checkpoints …@4 (3026c52f53e1) / …@9 (106a83019975) both lastGood
        step-2 empty-diff probe = $0.4072 = 96.0% of run cost (F-11/F-76) · harvest 3/3 files IDENTICAL to working tree
```

## Delivery quality (human review, post-landing)

🟢 **Spec-faithful, exactly the three named files, every mandated symbol / prefix / behavior present — the cleanest chain-pillar slice since the streak broke.** Reviewed `src/chain/plan-gate-failure.ts` + the test line-by-line against the goal:

| Mandated | Delivered | ✓ |
|---|---|---|
| `import type { PlanVerdict } from "../types.js";` (type-only) | exact (`plan-gate-failure.ts:1`) | 🟢 |
| `interface PlanGateFailureClass { kind: "infra"\|"substantive"; safeToReRun: boolean; reason: string; }` | exact (`:3-7`) | 🟢 |
| `PLAN_GATE_INFRA_REASON_PREFIXES: readonly string[]` = the THREE verbatim harness prefixes | exact, all three, matching `meta-judge-harness.ts:80,98,109` | 🟢 |
| PROCEED → `null` | `if (verdict.kind === "PROCEED") return null;` (`:22-24`) | 🟢 |
| infra prefix match via **`startsWith`** (anchored, NOT `includes`) → `{ kind:"infra", safeToReRun:true, reason }` | `PLAN_GATE_INFRA_REASON_PREFIXES.some(p => verdict.rationale.startsWith(p))` (`:26-32`) | 🟢 |
| every other non-PROCEED → `{ kind:"substantive", safeToReRun:false, reason }` | `:34` | 🟢 |
| no input mutation; pure (no I/O/clock/rng) | confirmed — reads only, returns new object literals | 🟢 |
| JSDoc cites WP-233(a) + F-33 + the pure-first cadence | present (`:15-20`) | 🟢 |
| barrel re-export of both symbols next to `./chain/*` | `index.ts:1` added line | 🟢 |
| test: PROCEED→null, exact F-33 transport ESCALATE→infra, both other infra prefixes, substantive coverage-floor REVISE→false, **anchored-vs-includes** discriminator, no-mutation snapshot, prefixes length 3 | all 8 `it` cases present, real `PlanVerdict` literals (`kind`/`rationale`/`uncoveredCriteria` — matches `types.ts:513`) | 🟢 |

- **Anchor discriminator is real, not cosmetic.** The test at `:73-85` feeds a rationale that *contains* `"plan meta-judge reply failed schema validation:"` mid-sentence and asserts `substantive` — proving `startsWith`, not `includes`. This is exactly the false-positive the spec's §1.1 failure-surface flagged; the executor got the polarity right.
- **Scope discipline:** exactly the 3 named files (pack §4 / `git status --short`). No `types.ts`, `meta-judge-harness.ts`, `chain.ts`, or any contract touched — the classifier is a net-new pure module the WP-233(b) wire will CONSUME. ✓
- **AC re-run against working tree:** AC-1 PASS (11 grep-pins + scoped vitest **8 passed**), AC-2 PASS (tsc + eslint + full suite **571 passed | 19 skipped**). ✓
- **Harvest:** all 3 files byte-IDENTICAL to the run workspace (pack §5). ✓
- **No F-64 paraphrase drift** — because this was a single `chikory run`, the full ~2500-word goal reached the executor verbatim (no planner one-line compression). The anti-F-64 hardening in the spec header worked as designed: correct launch mode = no mandate-dropping.

## New friction

Friction numbering is global + sequential; the highest prior is F-75 (dogfood-071), so this report opens at **F-76**.

### 🔴 F-76 → WP-263 (new) — a step killed at the 600s wall-clock cap forces a full-context retry that pays 96% of the run cost for a 0-byte diff

- **Evidence.** Step 1 sealed **FAILED** with `failure: step exceeded maxSeconds=600; killed after 653.1s (1.09× cap) (retriable: true)`. But step 1's diff was **5765 bytes = the COMPLETE delivery** (AC-1 already ✓ at step 1). The kill was a wall-clock timeout, not a work-incompleteness. The runner then retried → **step 2**, whose diff is **0 bytes** (nothing left to write) yet cost **$0.4072 / 298k input tokens / 19 tool calls** re-ingesting the whole context solely to re-run the acceptance checks and seal SUCCESS. That retry is **96.0% of the $0.4241 total** — the entire metered run cost bought zero incremental delivery.
- **This is the F-11 empty-diff-probe economics via a NEW cause.** WP-221 retired the *completion-probe* empty step; this is a *retry-after-timeout* empty step — same 0-byte-diff-at-full-cost failure mode, different trigger. The run only sealed cheaply ($0.42) because step 1's own compute went **unmetered** (see F-77); a metered retry of a 298k-context step is the real cost floor.
- **This is a NEW angle on top of WP-255 — the reaping was fixed, the retry economics were not.** WP-255 (F-59, dogfood-064) fixed the wall-clock *reaping* (`process.ts` now `spawn(detached:true)` + `process.kill(-pid, signal)` on the process GROUP) — proven live here: dogfood-072's kill landed at **1.09× the cap** vs dogfood-064's **2.45×**, so the process-group reap works. But WP-255 did **not** add a "workspace already satisfies the ACs → don't re-execute" short-circuit. The dogfood-064 write-up framed the kill-then-recover as a WIN with "no re-execution"; dogfood-072 shows a **full 298k-token re-execution step actually runs** after the retriable kill even though step 1's diff already passed AC-1.
- **Root cause candidates.** (a) on a `retriable: true` kill the runner runs a fresh full executor turn instead of checkpointing the killed step's partial (already-complete) diff and going straight to the judge; (b) no "workspace already satisfies all ACs → short-circuit to a judge-only seal" guard on retry (the WP-228 baseline-precheck logic, applied to the *retry* path rather than launch); (c) the 600s per-step cap may be tight for `codex` (653s / ~140 lines / 25 tool calls suggests codex thrash, not task size).
- **Spawns WP-263:** on a `retriable` wall-clock kill, before re-spending a full executor turn, re-run the killed step's acceptance `check`s against the current workspace; if they pass, seal via a judge-only pass (no executor re-ingest) — the retry-path analog of WP-228 baseline-precheck, sibling of WP-217 (completion signal) and WP-255 (which fixed reaping + telemetry, not this). Directly retires the retry tax this run paid.

### 🟡 F-77 → reinforces WP-255 (no new WP) — the killed codex step seals $0.00 / 0 tokens: the KNOWN codex residual of WP-255(b), now confirmed live

- **Evidence.** Step 1 ran **10m53s with 25 tool calls** yet sealed `$0.0000 (estimated) · 0/0 tokens`. All of codex's step-1 work — the entire delivery — is **absent from the cost ledger**; only the retry (step 2) was metered, so the trace's `$0.42 total` *understates* true compute.
- **Not a new WP — this is exactly the residual WP-255(b) already documents.** WP-255(b) recovers partial usage from a killed step's last turn, but ONLY for `claude-code` (`parseClaudeCodeOutput` recovers the last assistant-turn usage). The DOGFOODING §8 note explicitly carves out: *"a codex step killed mid-turn with no `turn.completed` is still genuinely unrecoverable — no usage event exists."* The `codex` adapter (`src/executors/codex.ts:62`) reads token usage **only** from the `turn.completed` event; a kill before that event leaves `tokens` undefined → `finalTokens = {input:0, output:0}` → $0.00. dogfood-072 is the first **live codex confirmation** of that carve-out (dogfood-064 was the diagnosis).
- **Why it still matters (CG-2).** The token-denominated budget gate (WP-218) can't see a killed codex step's spend — a run that repeatedly hits the cap and retries burns real provider tokens while the meter reads near-zero. **Open question folded into WP-255:** does `codex exec` emit any *incremental* per-turn usage before `turn.completed` that a killed-step parse could recover? If yes → a WP-255(c) codex analog of the claude-code recovery; if genuinely no usage event exists pre-completion, WP-255's carve-out stands and F-76's skip-re-execution fix (WP-263) is the real mitigation.

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern: the 3 files are STAGED uncommitted (not harvested), so the landed-commit re-gate `chikory land --verify` provides is again bypassed. No new WP — WP-249's track-B harvest-adoption remainder already owns this.

## Verdict on the thesis

🟢 **The judge + durable substrate delivered a spec-faithful, full-suite-green pure classifier first-pass — and the correct single-`run` launch broke the F-64 paraphrase risk that corrupted dogfood-071. But the run also exposed a durable-execution cost bug: a wall-clock-timeout kill turns into a full-price no-op retry that the cost meter can't even see.**

- 🟢 **WP-233(a) landed clean.** The classifier is exactly what F-33 demanded (infra-vs-substantive, anchored `startsWith`, PROCEED→null, no mutation), the anchor discriminator is genuinely tested, scope is the 3 named files, harvest is byte-IDENTICAL, and the full suite is green. Because the launch mode was correct, the full goal reached the executor verbatim — no mandate was dropped. This is the WP-257/WP-261 pure-first cadence executed cleanly.
- 🔴 **But the entire run cost was a retry tax.** codex wrote the complete delivery inside step 1, blew the 600s wall-clock cap at 653s, and got killed → the retry (step 2) re-ingested 298k tokens for a 0-byte diff and paid 96% of the run. Worse, the killed step's own 10m53s / 25-tool-call compute sealed $0.00 / 0 tokens — invisible to the budget meter. The durability substrate correctly recovered (checkpoint …@4 → …@9, no duplicate delivery), but the recovery is far more expensive than it looks and the meter hides it.

**WP-233(a) → 🟢** (pure classifier LANDED, spec-faithful, harvest IDENTICAL; the `planAndGateChain` consumer wire + Plan-persistence/resume half remain as WP-233(b)). **New: F-76 → WP-263** (🔴 retriable wall-clock-kill re-executes a full 298k-token turn for a 0-byte diff = 96% of run cost; re-run-ACs-before-re-executing on the retry path — the angle WP-255 left open after fixing reaping). **F-77 → reinforces WP-255** (🟡 killed codex step seals $0.00/0 tokens — the KNOWN codex residual of WP-255(b) confirmed live; codex has no pre-`turn.completed` usage event; open question whether one is recoverable → possible WP-255(c)). **F-58/WP-249 reinforced** (STAGED, no `Run-ID:` trailer). **Next dogfood headline: WP-233(b) — wire `classifyPlanGateFailure` into `planAndGateChain` so the operator sees "infra fault — safe to re-run" vs "plan rejected", the direct F-33 operator-facing fix on the just-landed pure half.**
