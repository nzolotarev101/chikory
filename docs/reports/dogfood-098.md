# dogfood-098 — WP-308 (work-conserving limit scheduler) core landed — judge caught front-loading TWICE; the seam decides but does not yet act

- **Vibe check (plain):** Chikory built the decision brain that, when an LLM endpoint hits a usage limit, picks "switch to another endpoint" or "do other useful work" before ever sleeping. It landed unattended in 8 durable steps, with the quality-gate judge twice catching the executor writing later parts early and rolling those steps back. One real gap remains: the run loop *records* the scheduler's choice but doesn't *execute* it yet — the injected-limit step claims success while doing zero work — so WP-308 (work-conserving limit scheduler) stays 🟡, not done.
- **Bottom line:** delivery 🟢 (all 4 ACs re-pass, 845 TS tests green, harvest byte-identical) · Thesis-KPI 🟡 partial (structural scheduler + in-memory live proof landed; the end-to-end "slept less than baseline" run is still owed) · judge catches: **2 genuine true-positives pre-land** (ledger total now 3) · WP-308 **🟡 in progress**.

## Run at a glance — `run-6ef24fb7-04b3-4029-a0fb-388300b6e68b`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 8 steps · **$15.83 / $45** (35.2%; exact steps+judge sum $15.8128) · **47m 45s** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓) |
| Spec | `examples/dogfood/dogfood-098-wp308-work-conserving-limit-scheduler.yaml` (LOOSE, 6 ordered increments) |
| Host WP | WP-308 (work-conserving limit scheduler) — P3 intelligent-scaling track, direct dependant of WP-307 (endpoint capability model) |
| Landed | uncommitted on working tree — all 13 harvested `packages/sdk-ts` files byte-IDENTICAL to the run workspace (pack §5) |
| **Judge** | 6/8 PROCEED · **2 ROLLBACK (steps 2 and 4, both genuine front-load catches)** · $0.08 (0.5% share) · 0 escalations · all 4 ACs judge-executed every pass |
| **Pacing** | `autoCalibrate` · peak window 129% (compact 7) · compactions 3 (pacing 3) · first pacing fold step 5 · 7 pressure-steps |

## Trace

```
run run-6ef24fb7 · SUCCESS · 8 steps · $15.83 / $45.00 · 47m 45s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Part 1 (classifyLimitSignal)         1041k/7.6k       $1.38    ✓ PROCEED (1/4 — WIP, no regressions)
 2   Part 2 + front-loaded Parts 3–4      2192k/12k        $2.86    ⟲ ROLLBACK → @5   (front-loaded decideLimitResponse + agent-loop wiring)
 3   Part 2 redo, in scope                607k/7.9k        $0.84    ✓ PROCEED (4/4)
 4   Part 3 + front-loaded Parts 4–5      2678k/13k        $3.48    ⟲ ROLLBACK → @15  (front-loaded run-loop wiring + journal ledger)
 5   Part 3 redo, in scope (ordered plan) 709k/9.0k        $0.98    ✓ PROCEED (4/4)
 6   Part 4 (CHIKORY_LIMIT_AT_STEP wire)  1101k/9.2k       $1.47    ✓ PROCEED (4/4)
 7   Part 5 (journal + trace totals)      2756k/13k        $3.58    ✓ PROCEED (4/4)
 8   Part 6 (docs + live proof + suite)   876k/5.8k        $1.15    ✓ PROCEED (4/4)
totals: decisions 8 · judge passes 8 ($0.08, 0.5%) · rollbacks 2 · escalations 0 · checkpoints 8
        peak window 129% (compact 7) · compactions 3 (pacing 3) · pressure-steps 7 (first pacing fold step 5)
```

## The judge catches — 🟢 two genuine true-positives, pre-land (steps 2 and 4)

- **Step 2** (chunk: PART 2 ONLY, headroom oracle): the executor also implemented `decideLimitResponse` (PART 3) and wired `workflow/agent-loop.ts` (PART 4). Judge rubric `scope_matches_instruction` ✗ → ROLLBACK to `@5`. Step 3 redid PART 2 only ("matching the rollback feedback"), 4/4 PROCEED.
- **Step 4** (chunk: PART 3 ONLY, scheduler decision): the executor also wired the run loop (PART 4) and added the journal ledger `recordLimitResponse`/`LimitResponsePayload` (PART 5). ROLLBACK to `@15`. Step 5 redid PART 3 only, 4/4 PROCEED.
- Both are the F-130 (judge footprint-vs-chunk rubric) firing on real product code — the diff footprint betrayed the front-load even though every AC was green. Loop integrity held: rollback targets were the prior `lastGood` checkpoints; no duplicate journal entries; no re-executed steps.
- **Cost of enforcement:** the two discarded steps cost $2.86 + $3.48 = **$6.34 = 40.1% of the run's spend** (see F-134).

## Delivery quality (human review, post-landing)

- **Verified independently:** all 4 ACs re-run PASS against the working tree (pack §3; full suite **845 passed / 19 skipped**, `tsc` + `eslint` clean); all 13 harvested `packages/sdk-ts` files byte-IDENTICAL to the run workspace (pack §5). No landed commit — user reviews before committing.
- **PART 1** (`src/limit-signal.ts`, net-new, 171 lines): pure `classifyLimitSignal` normalizes HTTP 429 (+`retry-after`, both seconds and HTTP-date), CLI usage-limit stderr (regex + "resets in 2h 30m"-style duration parse), and the injected seam into one plain descriptor carrying the WP-307 capability's declared limits. No I/O, no key material.
- **PARTs 2–3** (`src/limit-response.ts`, net-new, 165 lines): the executor merged the headroom oracle into `decideLimitResponse` (loose format — its call; the oracle is `blockReason`/`peerFamily` inside). Returns an **ordered plan**: legal declared-failover targets for the throttled stage first, later-stage limit-independent work second, `park-until-reset` always last. Invariant #2 (judge family ≠ executor family) blocks a failover target that would collapse family separation (`invariant-2-same-family` block reason); `unknown` capabilities are never assumed to have headroom. Tested against the real `resolveEndpointCapabilities` shapes incl. the invariant-#2-blocks-the-only-alternative case (AC-3).
- **PART 4** (`src/runner/activities.ts:677+`): `CHIKORY_LIMIT_AT_STEP` seam — when set to the step index, `executeStep` classifies an injected signal, consults `decideLimitResponse`, journals the full plan + chosen response, and returns without parking. **No env ⇒ byte-identical path** (tested). But see F-136: the chosen action is recorded, not executed.
- **PART 5** (`journal.ts` + `cli/trace.ts`): additive `limit_signal` journal kind (schemas.ts/types.ts enum rows), `appendOnce`-idempotent (replay-safe); `runTotals` derives `limitSignals` / `limitSleptMs` / `limitSleepConservedMs`; trace totals print `limit signals N · limit-slept X · conserved Y` only when signals exist — limit-free runs render exactly as today (tested both ways).
- **PART 6:** `docs/components/router.md` documents the scheduler; live proof `test/runner/limit-response-activity.test.ts` runs the real activity against a real journal: injected limit at step 0 → `limit-independent-work` chosen, $0 spent, `runTotals` shows `limitSleptMs: 0, limitSleepConservedMs: 5000`.
- **Scope:** 13 files under `packages/sdk-ts/` + `docs/components/router.md` (the sanctioned doc PART) + `plan.md` (NOT sanctioned — see F-135).

## New friction

- **F-134 (🟡 front-load recurrence ×2, no new WP — escalation trigger recorded).** F-133 (chunk directive is advisory; the judge rollback enforces) recurred **twice in one run** (steps 2 and 4), despite the rollback feedback from the first catch being in context for step 4. Enforcement cost this run: **$6.34 = 40.1% of spend** (vs $1.55 = 14% in dogfood-097). The gate works; the economics degrade with spec part-count. No new WP now (F-130 owns the mechanism), but if the next multi-part run shows ≥2 front-load rollbacks again, spawn a WP for executor-side scope hardening (e.g. withhold later PART texts from the step context) or salvage-rollback (keep in-scope hunks). Evidence: pack §2 steps 2/4; trace step-2 summary lists `agent-loop.ts` among changed files under a PART-2 chunk.
- **F-135 (ℹ️ write-scope miss, track-B note, no new WP).** The run edited `plan.md` (WP-308 row 🔴→🟡) — outside the spec's "writes ONLY inside `packages/sdk-ts/` (+ one doc PART)" constraint — and the step-8 judge PROCEEDed: the F-130 footprint rubric compares the diff against the **chunk directive**, not the spec-level write-scope list. Content was accurate and honest (it names its own residue), so no harm landed. Track-B: feed the spec's write-scope constraint into the judge scope rubric alongside the chunk directive. Evidence: workspace `plan.md` differs from HEAD at line 324; step-8 rubric `scope_matches_instruction` ✓.
- **F-136 (🟡 scheduler decides but does not act — the real WP-308 residue).** On an injected limit, `executeStep` journals the plan and chosen response, then returns a fabricated step record: `status: "SUCCESS"`, `claimsComplete: true`, `toolCalls: 0`, empty diff — **no failover re-dispatch happens, no limit-independent work is performed, and `conservedMs` is bookkeeping** (the retry-after it would have slept). Seam is off by default, so zero production impact; but a real forced-limit end-to-end run today would "conserve" by *skipping the throttled step's plan item while claiming it complete* — hollowing exactly the proof WP-308's acceptance demands (measurably less slept wall-clock than park-only baseline, honestly earned). This is not a new WP: it **is** the open half of WP-308 (execute the decision: re-route the stage to the failover target / genuinely reorder limit-independent work / durable-timer park), and it feeds WP-309 (limit telemetry + reset learning) for real 429/CLI-stderr call sites — `classifyLimitSignal`'s http/cli branches currently have no production caller. Evidence: `activities.ts:677–780`, `test/runner/limit-response-activity.test.ts:117–124` (asserts `claimsComplete: true`, 0 tool calls).

## KPI table (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| Max horizon survived | 8 steps / 47m 45s | 11 steps / **25h 54m** (dogfood-096, the P2 exit gate) |
| Kill→resume count | 0 (no kill armed; none needed) | 1 (dogfood-095 deterministic kill→resume) |
| Judge true-positives pre-land | **2** (steps 2, 4 — genuine, product code) | ledger total **3** (097: 1, 098: 2; 046/048 seeded catches excluded) |
| Trailing-3 meta:product headline ratio | — | **0:3** (096/097/098 all product) ✅ cap ≤1:3 |
| Per-step reliability (runs ≥5 steps) | 6/8 = 75% this run | **96.4%** (3 rollbacks / 84 steps) vs 99%+ target — all 3 are judge catches of executor scope errors, not durability misses |
| Ladder rung vs P2 exit gate | rung-4-shape consolidation (ladder retired at rung 5) | P2 exit gate PASSED (dogfood-096) |

## Verdict on the thesis

🟢 **Strong on the judge pillar, honest 🟡 on the scaling pillar.** The family-diverse judge caught the executor front-loading twice on real product code and both rollbacks recovered cleanly to `lastGood` — per-step enforcement is now demonstrably repeatable, not a one-off (ledger: 3 genuine catches, all pre-land). The vendor-neutral scaling pillar moved: limit signals are now classified, scheduled, journaled, and rendered — but the scheduler's choice is not yet executed (F-136), so the headline Thesis-KPI ("slept measurably less than park-only baseline", end-to-end) is *structurally proven, operationally owed*. That gap is the natural dogfood-099 headline.
