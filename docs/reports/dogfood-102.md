# dogfood-102 — WP-309 (limit telemetry + reset learning) COMPLETION: cross-run capacity learning (the F-138 fix)

- **Vibe check (plain):** the run closed the last dead wire in WP-309 (the limit-learning feature). Before this run, when a real usage-limit hit happened, Chikory learned the endpoint's capacity *for that one run only* and forgot it the moment the run ended — the shared cross-run ledger had a table and a writer but nothing in `src/` ever called the writer. This run wired the writer into the real limit path: a real (non-injected) limit hit now records the learned window capacity to the shared ledger (`<dataDir>/ledger/endpoints.db`), so a *later* run's pacing governor (WP-310) can pace against a capacity it learned from an actual hit — not just a vendor-declared number. All four increments landed with real tests; the full SDK suite is green. Cost of the run was inflated ~20% by the judge correctly rolling back a step that front-loaded later work (the recurring front-load pattern, 4th product run running).
- **Bottom line:** delivery 🟢 (F-138 wired additively; injected-seam path provably unchanged; all 3 ACs re-pass; **904 TS tests green** / 22 skipped; harvest byte-IDENTICAL) · Thesis-KPI 🟢 proven by a DETERMINISTIC cross-run test (fresh ledger reads the learned capacity → `decideLimitPacing` throttles against it with zero declared/injected capacity) — but ⚠️ NOT live-proven across two real codex runs (no deterministic non-injected-limit seam exists — see F-142) · judge catches: **1** genuine (step-2 front-load scope ROLLBACK) · 🟡 **F-141** (AC-3 full-suite check twice exceeded the judge per-check cap → DID-NOT-COMPLETE, correctly classed infra so no false red) · 🟡 **F-134 recurrence** (front-load ×1, enforcement tax $2.19 = 19.5%) · ℹ️ **F-142** (cross-run learning has no live-run proof path). **WP-309 now DONE (test-complete); F-138 CLOSED.**

## Run at a glance — `run-cd98de3e-7c33-48a1-8e62-d2fbe8e46c45`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 7 steps · **$11.25 / $45** (25.0%; exact steps+judge sum $11.2489) · **1h 55m** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓, invariant #2 held) |
| Spec | `examples/dogfood/dogfood-102-wp309-cross-run-capacity-learning.yaml` (LOOSE, 4 ordered increments) |
| Host WP | WP-309 (limit telemetry + reset learning) COMPLETION — P3 intelligent-scaling track (plan.md §7); closes 🔴 F-138 |
| Landed | **uncommitted working tree** (harvest byte-IDENTICAL, pack §5) — left for user review |
| **Judge** | **5 PROCEED / 2 ROLLBACK** (8 passes incl. completion review) · 0 escalations · $0.06 (0.6% share) · all 3 ACs judge-executed |
| **Pacing (context-rot)** | `autoCalibrate` · peak window 108% (compact 4 · park 0) · pressure-steps 4 (unfolded 4) · feedback 1/1 steps |
| Scope | 3 files, all in `packages/sdk-ts/` (pack §4); the `scripts/cli-judge-proxy.mjs` mod in `git status` is a PRE-EXISTING unrelated working-tree change, not this run's |

## Trace

```
run run-cd98de3e · SUCCESS · 7 steps · $11.25 / $45.00 · 1h 55m · executor codex(openai) · judge openai-compat
 #   step                                          tokens(in/out)   cost     verdict
 1   PART 1 — ledger write on a real hit (+tests)   3917k/14k        $5.03    ✓ PROCEED (2/3)
 2   PART 2 test — front-loaded PART 3 asserts       1363k/4.7k       $1.75    ⟲ ROLLBACK → @5   (scope: imported decideLimitPacing)
 3   over-correction — empty diff                     341k/1.2k        $0.44    ⟲ ROLLBACK → @5   (empty diff, no PART 2 delivered)
 4   PART 2 — fresh-ledger cross-run read test         373k/3.9k       $0.50    ✓ PROCEED (2/3)
 5   PART 3 — governor paces learned capacity          1673k/6.5k       $2.16    ✓ PROCEED (3/3)
 6   PART 4 — full-suite regression (empty diff)        395k/4.5k       $0.54    ✓ PROCEED (2/3)  (AC-3 DID-NOT-COMPLETE — cap)
 7   completion summary (empty diff)                    575k/4.4k       $0.76    ✓ PROCEED (0/0)
totals: decisions 7 · judge passes 8 ($0.06, 0.6%) · rollbacks 2 · escalations 0 · injections 0 · checkpoints 7
        pacing events 7 · peak window 108% (compact 4 · park 0) · pressure-steps 4 (unfolded 4) · feedback 1/1 steps
        issues found 12 · changes made 4 (issues:changes 12:4)
```

## Thesis-KPI — cross-run capacity learning proven (deterministic test; NOT live cross-run)

The KPI axis is **CROSS-RUN CAPACITY LEARNING**: a real observed limit hit in one run persists to the shared endpoint ledger as a learned window capacity, and a later run's pacing governor reads it and paces against it, with ZERO declared/injected capacity. Proven by two delivered tests:

| KPI leg (spec Thesis-KPI header) | Evidence (delivered test) | ✓ |
|---|---|---|
| Real (non-injected) hit → one ledger observation per declared window | `limit-response-activity.test.ts` "writes one cross-run observation per declared window for a real limit hit" — scripted HTTP 429 (`httpLimitSteps:[2]`) → 2 rows (`rolling-5h`, `weekly`), `consumed_tokens_at_hit=150`, `reset_at_ms=observed+12000` | 🟢 |
| Injected seam writes NOTHING (byte-identical constraint) | same file, "writes no cross-run observations for the injected limit seam" — `CHIKORY_LIMIT_AT_STEP=0` → `limitObservationRows(dataDir)` = `[]` | 🟢 |
| Learning survives the cross-run boundary | `endpoint-ledger.test.ts` "a fresh ledger on the same database reads the persisted learned capacity" — new `EndpointLedger` on the same path → `windowState().capacityTokens === 52_000` | 🟢 |
| Governor paces against the LEARNED capacity, observe-only without it | `endpoint-ledger.test.ts` "feeds only learned capacity into pacing…" — no observation → `push`/`Infinity`; after observation → `throttle`, `limitingWindow:"weekly"`, `sustainableTokensPerHour≈10_000`, `interStepDelayMs=300_000` | 🟢 |

⚠️ **Not live-proven across two real runs.** The KPI is validated deterministically, exactly as the spec scoped it ("Proof is a deterministic test … no real provider limit, no key material"). It is NOT yet observed on two chained real codex runs — and cannot be, because there is no deterministic seam to force a **non-injected** limit hit in a live run (the injected `CHIKORY_LIMIT_AT_STEP` seam deliberately writes nothing). See **F-142**.

## Delivery quality (human review, post-landing)

Reviewed `git diff HEAD` line-by-line against the goal. Writes confined to `packages/sdk-ts/` (pack §4). Base = HEAD `e03707a`.

| Goal PART | Landed | Verdict |
|---|---|---|
| P1 — ledger write on a real hit | `activities.ts` — net-new `appendEndpointLimitObservations(deps, spec, observedAtMs, resetAtMs)`: resolves declared quota windows (`spec.debug?.quotaWindows` ?? capability limits), opens the `EndpointLedger`, and for each window `appendLimitObservation({consumedTokensAtHit: windowState(...).consumedTokens, …})`; ledger failure swallowed (observe-only degradation, mirrors `appendStepConsumption`). Called at `activities.ts:~1131` **inside `if (observation !== undefined)`** | 🟢 additive; guarded on the real-hit branch |
| — injected seam unchanged | `observation` is `undefined` when `classified.source === "injected"` (`activities.ts:1084`), so the injected path never reaches the ledger writer. Proven by the injected-seam test (0 rows) | 🟢 the byte-identical / no-fake-hit constraint holds |
| P2 — learned capacity readable cross-run | `endpoint-ledger.test.ts` — a fresh `EndpointLedger` on the same db path returns the persisted observation as `windowState().capacityTokens` (closes handle in `finally`) | 🟢 genuine cross-lifetime read |
| P3 — governor paces the learned capacity | `endpoint-ledger.test.ts` — co-reference test drives BOTH `appendLimitObservation` (write) AND `decideLimitPacing` (read): observe-only before learning, throttle after | 🟢 ties the PART-1 write to the WP-310 read (F-97-safe co-reference, AC-2) |
| P4 — regression | full `tsc + eslint + vitest` green; a no-limit run writes no rows (injected-seam test) | 🟢 |

- **AC re-run (pack §3):** AC-1 (`appendLimitObservation(` now has a `src/` caller other than the ledger def) PASS · AC-2 (a `test/` file co-references `appendLimitObservation` + `decideLimitPacing`) PASS · AC-3 (`tsc && eslint && vitest`) PASS — **904 passed / 22 skipped** (36.63s standalone).
- **Additivity proven:** no frozen-contract reshape, no new dependency, no key material; the write reuses the existing `EndpointLedger` and `describeEndpointCapability`.
- **Family diversity real:** executor codex(openai) ≠ judge gemini(openai-compat); invariant #2 held.

## New friction

Continuing global sequence (dogfood-101 ended at F-140).

### 🟡 F-141 — the full-suite AC (`tsc+eslint+vitest`) exceeds the judge's per-check cap

- **Evidence:** AC-3 = `cd packages/sdk-ts && pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm exec vitest run`. At **step 3** and **step 6** the judge reported it *"DID NOT COMPLETE (killed at the per-check cap) — infra failure, not a code red."* Standalone the suite finishes in **36.63s wall** (but ~262s of test CPU, parallelized); inside the judge's constrained per-check sandbox it blew the 120s cap twice.
- **Why it did not fail the run:** the judge correctly classes a cap-kill as infra, not a code red, so no false ROLLBACK fired — but on those two passes the "full suite green" leg of the rubric could not be relied on, and it is non-deterministic which passes hit the cap.
- **Severity / WP:** 🟡 track-B, no headline (STALLED binding). Fix options: (a) AC authoring rule — a headline AC-3 should be a **scoped** `pnpm exec vitest run <the touched test files>` (under the cap) plus a separate whole-suite check the judge is allowed more time for; or (b) size the judge per-check cap off the run's own baseline suite time. Folds into the WP-266/511 loose-AC-hygiene family (the "time your judge-executed checks under 120s" rule in the skill is currently advisory). Not loop-integrity → does not headline.

### 🟡 F-134 recurrence — front-load rollback, 4th consecutive product run (enforcement tax $2.19 = 19.5%)

- **Evidence:** step 2 (PART 2 chunk) imported `decideLimitPacing` and asserted on `decision.action`/`decision.sustainableTokensPerHour` — PART 3 work — so the judge failed `scope_matches_instruction` and ROLLED BACK to `@5`. Step 3 then over-corrected to an **empty diff** ("remove only the premature governor") → a second ROLLBACK (empty diff, PART 2 undelivered). Step 4 redid PART 2 cleanly. Cost of the two discarded steps = $1.75 + $0.44 = **$2.19 (19.5% of the $11.25 run)**.
- **Pattern:** front-loading now recurs on every product run that chunks — dogfood-097 (step 1), dogfood-098 (steps 2 & 4), dogfood-102 (step 2). The judge catches it every time (genuine true-positive scope discipline — the durable rollback prevents PART 3 landing early), but the enforcement tax is a standing cost. F-133/F-134 already recorded the observation that the `bounded_work_unit` chunk directive is **advisory** (only judge-enforced post-hoc, not enforced on the executor pre-execution).
- **Severity / WP:** 🟡 no new WP this cycle (STALLED → the preventive fix is not loop-integrity and cannot headline), but the cumulative tax across 4 runs argues for a preventive WP note: a stronger pre-execution injection of the active chunk's "do NOT touch later PARTs" directive, or a mechanical diff-footprint pre-check before the judge pass. Recorded under the F-133/F-134 lineage.

### ℹ️ F-142 — cross-run capacity learning has no live-run proof path

- **Evidence:** the KPI (a real hit in run A paces run B) is provable only by unit test today. To write to the ledger a hit must be **non-injected** (`observation !== undefined`), but the only deterministic seam (`CHIKORY_LIMIT_AT_STEP`) drives `source === "injected"` → no ledger write (by design, to keep no-op runs byte-identical). So there is no way to force a ledger-writing limit hit in a live codex run without a real provider 429 (needs keys / a real subscription actually at its limit).
- **Severity / WP:** ℹ️ low — the deterministic test is the sanctioned proof and the design constraint (never pollute the shared ledger with fake hits) is correct. But if a future headline wants a LIVE cross-run proof, it needs a **non-injected, deterministic, test-only real-shaped-hit seam** that is allowed to write the ledger under an explicit flag. Track-B; candidate scaffolding for a future cross-run/chain live-proof headline. Not loop-integrity → does not headline.

### ℹ️ Observations (recurrences, not new friction)

- **Unfolded pressure** (`peak window 108% · compact 4 · pressure-steps 4 (unfolded 4)`, verify-pack warning "pressure fired for 4 step(s), but no pacing folds were recorded"): the F-140 telemetry state — the window entered pressure and compacted 4× via a non-`pacing` trigger, so `firstPacingFoldStep` stayed unset. Legitimate state, no defect.
- **Step-1 token/cost spike** (3.917M input / **$5.03 = 44.7%** of run cost; judge pass #1 latency **16m 48s**): the F-132 context-rot economics data point (WP-203/207). PART 1 assembled a very large first-step context; the recurring "big step 1" pattern. Recorded for the token-economics series. Empty-diff probe step (F-11 / WP-221): step 7 = $0.76 = 6.8% of run cost.

## KPI table (DOGFOODING §1.4)

| KPI | This run | Trailing window | P3 target |
|---|---|---|---|
| Max horizon survived | 7 steps / 1h 55m | 25h 54m / 11 steps (dogfood-096) | 24h+ ✅ (P2 exit passed) |
| Kill→resume count | 0 (no kill drill) | 0 over 097–102 | ≥1 per exit gate |
| Judge true-positives pre-land | 1 (step-2 front-load) | 097:1 · 098:2 · 102:1 (4 total) | ≥1 on seeded/failable runs |
| Trailing-3 meta:product headline ratio | 0:3 (100/101/102 all product) | ✅ ≤1:3 | ≤1:3 |
| Per-step reliability (runs ≥5 steps) | 71% (5/7 this run; 2 rollbacks) | **95.1%** (5 rollbacks / 103 steps) | 99%+ |
| Ladder rung vs P2 exit gate | rung 4 (P3 completion; ladder retired at rung 5, dogfood-096) | flat 4 ×4 (⛔ STALLED) | rung 5 retired; axis = P3 WP completion |

## Verdict on the thesis

WP-309 is now **test-complete**: the intelligent-scaling loop can, for the first time, **carry a learned window capacity across run boundaries** — a real limit hit in one run teaches the shared ledger, and a later run's pacing governor reasons against that learned number with no vendor-declared capacity at all. That closes the last dead link (F-138) between the reactive limit scheduler (WP-308), the reset learner (WP-309 per-run half), and the proactive governor (WP-310). The delivery is clean, additive, and provably leaves the injected seam and no-op runs untouched. Two honest caveats: (1) the cross-run KPI is proven deterministically, not yet observed live across two real runs (F-142 — no seam exists to force it live), and (2) the run paid a **19.5% front-load enforcement tax** (F-134 recurrence) — the judge's scope discipline works, but the executor keeps front-loading, and a preventive mechanism is now overdue. Per-step reliability dipped to 71% on this run (2 rollbacks) though the trailing window holds at 95.1%.
