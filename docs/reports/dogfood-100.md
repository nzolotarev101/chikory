# dogfood-100 — WP-309 (limit telemetry + reset learning) — real call site + learned park landed; cross-run ledger seam left dead (F-138)

- **Vibe check (plain):** dogfood-098/099 built the limit scheduler that, on an LLM usage limit, decides "failover / do other work / park" and then *executes* that choice. But its classifier only ever saw a fake injected signal, and a park lasted a guessed duration. This run gave it real eyes and a learned sense of recovery: a **non-injected** path now feeds a real-shaped 429 / CLI usage-limit stderr into `classifyLimitSignal`, journals each as a per-endpoint observation, and net-new `learnEndpointReset` derives the reset window from those observations — so a park with no vendor `retry-after` lasts the **learned** duration (median of what was actually observed), not a guess. It also closed the last dogfood-099 gap (ℹ️ F-137): the forced-park branch now has a real end-to-end proof. It landed unattended in 6 durable steps, 6/6 judge PROCEED, full suite green. **BUT** review found the delivery satisfies its own (journal-only) spec while missing the plan.md WP-309 scope amendment: cross-run observations were never wired into the endpoint ledger (`EndpointLedger.appendLimitObservation` + `learnedCapacityTokens` stay dead, no `src/` caller) — so the WP-310 governor still cannot learn window capacity across runs. **WP-309 stays 🟡** with that residue.
- **Bottom line:** delivery 🟢 for its spec (all 4 ACs re-pass, **898 TS tests green** / 22 skipped, working tree committed as `8a330a4`) · Thesis-KPI 🟢 for the per-run axis (real non-injected call site classifies + observes; learned-duration park proven end-to-end, step-4 retry-after-less 429 parks the **learned 1000ms** median) · judge catches: **0** (clean run, no seeded bad diff, no front-loading — F-134 did NOT recur) · **🔴 scope gap F-138** (cross-run ledger seam un-wired; spec under-scoped vs plan.md line 325) · ℹ️ F-139 (F-135 recurrence: run wrote `docs/spec/*` outside sanctioned scope — but the edits were *correct* doc-syncs) · **WP-309 🟡 (residue owed).**

## Run at a glance — `run-1caffe21-3779-47d8-b7bd-89f7a04f1c51`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 6 steps · **$15.57 / $45** (34.6%; exact steps+judge sum $15.5688) · **41m 59s** wall-clock |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓, invariant #2 held) |
| Spec | `examples/dogfood/dogfood-100-wp309-limit-telemetry-reset-learning.yaml` (LOOSE, 6 ordered increments) |
| Host WP | WP-309 (limit telemetry + reset learning) — P3 intelligent-scaling track (plan.md §7), named 🔴 dependant of WP-308 |
| Landed | committed `8a330a4` (working tree now clean; pack §4 empty). ⚠️ commit also carries a hand-added `.github/workflows/ci.yml` (+3, NOT in the run workspace) |
| **Judge** | **6/6 PROCEED** · 0 ROLLBACK · 0 escalations · $0.06 (0.4% share) · all 4 ACs judge-executed & exited 0 every pass |
| **Pacing** | `autoCalibrate` · peak window 120% (compact 5 · park 0) · compactions 1 (pacing 1) · first pacing fold step 5 · pressure-steps 5 (unfolded 4) · evicted 2 |

## Trace

```
run run-1caffe21 · SUCCESS · 6 steps · $15.57 / $45.00 · 41m 59s · executor codex(openai) · judge openai-compat
 #   step                                          tokens(in/out)   cost     verdict
 1   Part 1 — real HTTP-429 call site + observation 3033k/15k       $3.94    ✓ PROCEED (4/4)
 2   Part 2 — real CLI usage-limit stderr call site 1302k/9.0k      $1.72    ✓ PROCEED (4/4)
 3   Part 3 — per-endpoint limit_observation ledger 1785k/9.6k      $2.33    ✓ PROCEED (4/4)
 4   Part 4 — learnEndpointReset (median + abstain)  1135k/12k       $1.54    ✓ PROCEED (4/4)
 5   Part 5 — feed scheduler + forced-park proof     3596k/16k       $4.65    ✓ PROCEED (4/4)
 6   Part 6 — trace + docs + full-suite regression   1000k/7.7k      $1.33    ✓ PROCEED (4/4)
totals: decisions 6 · judge passes 6 ($0.06, 0.4%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 6
        pacing events 6 · peak window 120% (compact 5 · park 0) · compactions 1 (pacing 1) · memory recalls 0 · evicted 2
```

## Delivery quality (human review, post-landing)

Reviewed the landed diff (`git diff be6dd7a..8a330a4`, the run's own workspace base was `be6dd7a` = WP-310 governor) line-by-line against the goal.

**What landed and is genuine (🟢):**

| Goal PART | Landed | Verdict |
|---|---|---|
| P1/P2 real non-injected call site | `activities.ts:1007-1011` — `rawLimitSignalFromStepRecord(record)` on a `FAILED` step record (429 **and** CLI-stderr shapes) → `classifyLimitSignal` (non-injected). The `CHIKORY_LIMIT_AT_STEP` seam at `:867` is untouched. | 🟢 real caller, both shapes covered by one extractor |
| P3 observation ledger (per-run) | `limit_observation` journal kind (`schemas.ts`/`types.ts`/`journal.ts`); `appendOnce({field:"atStep"})` idempotent; additive alongside `limit_signal` | 🟢 replay-safe, additive |
| P4 `learnEndpointReset` | `limit-response.ts:191` — filters to the endpoint, takes **median** of observed reset delays, **abstains** (`undefined`) when `samples < minObservations` (default 2). Pure. | 🟢 principled, non-hollow |
| P5 feed scheduler + forced-park proof | `activities.ts:1030` consumes `learnEndpointReset` when the signal carries no `retryAfterMs`/`retryAtMs`; `agent-loop.test.ts:345` drives a **real** `runner.start`→`awaitTerminal` workflow — step-4 429 has NO retry-after → park lasts the **learned 1000ms** (median of steps 1/3), resumes, throttled item completed. Closes ℹ️ F-137. | 🟢 real end-to-end, no wall-clock assert (F-115-safe) |
| P6 trace + docs + regression | `trace.ts:356` renders `· learned resets <endpointCapabilityId> <duration>`; no-signal run byte-identical; `docs/components/router.md` updated; 898 TS green | 🟢 |

- **AC re-run (pack §3):** AC-1/2/3/4 all **PASS** in the working tree. AC-4 = `tsc --noEmit && eslint . && vitest run` → **898 passed / 22 skipped** (36.02s). AC-2 (`learnEndpointReset` ≥2 occurrences) genuinely satisfied: definition + `index.ts` export + `activities.ts:1030` consumption.
- **Family diversity real:** run executor codex(openai) ≠ judge gemini(openai-compat). (The P5 test fixture uses all-anthropic routing with `allowSameFamily:true` — that is a unit fixture, not the run; invariant #2 held for the actual run.)

**The gap (🔴 F-138 — WP-309 not fully done):** the delivery journals observations to the **per-run** journal only. Plan.md WP-309 (line 325, scope amendment landed 2026-07-12 with WP-310) requires observations to **also persist to the cross-run endpoint ledger** (`EndpointLedger.appendLimitObservation`, `<dataDir>/ledger/endpoints.db`) so the in-window consumption sum at hit time becomes the WP-310 governor's **learned window capacity**. Verified dead:
- `grep -rn appendLimitObservation packages/sdk-ts/src` → **only the definition** (`endpoint-ledger.ts:110`); no caller. (Tests call it — `endpoint-ledger.test.ts` — but that landed with WP-310.)
- `grep -rn learnedCapacityTokens packages/sdk-ts/src` → **no reader** — the governor's learned-capacity field is never populated.
- `learnEndpointReset` reads `endpointResetObservations(journal, …)` — a **single run's** journal, so learning cannot carry across runs.

Root cause: the dogfood-100 **spec** was authored journal-only (its goal/ACs predate / omit the WP-309 plan amendment), and the judge only gates the spec's ACs — so a partial WP-309 greened. **WP-309 stays 🟡.**

## New friction

Continuing global sequence (dogfood-099 ended at F-137).

- **🔴 F-138 — spec under-scoped a WP; cross-run learned-capacity seam left dead.** dogfood-100 landed the per-run half of WP-309 but never wired `EndpointLedger.appendLimitObservation` / `learnedCapacityTokens`, which plan.md line 325 makes part of WP-309. Evidence: no `src/` caller of `appendLimitObservation`, no reader of `learnedCapacityTokens`; `learnEndpointReset` reasons over one run's journal only. **Effect:** the WP-310 governor still cannot learn subscription-window capacity across runs — the exact spend-awareness WP-309/310 exist to deliver. **Spawns:** WP-309 completion slice — wire the real call site to also `appendLimitObservation`, and read learned capacity into `decideLimitPacing`. Not loop-integrity → does not headline over the STALLED binding; queued as WP-309 residue (candidate dogfood-102 or hand-fix). **Process lesson (attach to F-138):** before writing a dogfood spec for a WP, diff that WP's plan.md row for amendments landed since the last run — the ACs must cover the *current* WP scope, not a stale snapshot.
- **ℹ️ F-139 — F-135 recurrence: run wrote outside the spec's sanctioned scope, judge can't see it.** The spec said "writes ONLY inside `packages/sdk-ts/` + `docs/components/router.md`", but the run also edited `docs/spec/CONTRACTS.md` (+1 line: `limit_observation` in the `JournalEntryKind` union) and `docs/spec/journal-format.md` (+1 row). The judge's footprint rubric compares the diff to the active PART, not the spec's write-scope, so it greened. **Nuance:** both edits are *correct* living-doc syncs the doc-drift invariant actually requires — so here the spec's write-scope was itself too tight. Same root as F-135 (dogfood-098). **Spawns:** no new WP beyond the standing F-135 note; the durable lesson is that a "packages-only" write-scope must carve out the CONTRACTS/journal-format sync a new journal kind mandates. Track-B note.
- **ℹ️ (note, no F) hand-added `ci.yml`.** The landed commit `8a330a4` carries `.github/workflows/ci.yml` (+3) that is **not** in the run workspace diff — a human harvest addition, not run output (F-10 human-ceremony territory). No WP.

## KPI table (DOGFOODING §1.4)

| KPI | This run (dogfood-100) | Trailing window |
|---|---|---|
| Max horizon survived | 6 steps / 41m 59s | 8 steps (dogfood-098) over trailing-3 |
| Kill→resume count | 0 (no soak; normal product run) | 0 across trailing-3 |
| Judge true-positives pre-land | 0 (clean run, no seeded diff) | 097 ×1, 098 ×2, 099/100 ×0 |
| Trailing-3 meta:product headline ratio | product | **0:3** (098/099/100 all product) — cap ✅ |
| Per-step reliability (runs ≥5 steps) | 6/6 PROCEED, 0 rollback | **96.9%** (3 rollbacks / 96 steps, 13 runs) — target 99%+ |
| Current ladder rung vs P2 exit gate | rung 4 | rung retired at 5 (P2 exit PASSED dogfood-096); rung column structurally flat on ~6-step product runs |

## Verdict on the thesis

🟢 **The per-run intelligent-scaling loop got materially more real.** A real (non-injected) limit signal is now classified, observed, and learned-from, and a park lasts a *learned* duration proven end-to-end — durable execution + work-conserving scaling on live Chikory source, unattended, family-diverse judge gating every step. The judge held the line cleanly (no front-loading this run; F-134 dormant).

🟡 **But "green for the spec" ≠ "WP done."** The most valuable finding is not in the run — it's that the spec under-scoped WP-309 relative to plan.md, so the cross-run learned-capacity seam (the whole point of pairing WP-309 with WP-310) is dead code. The judge cannot catch a scope gap the spec never asked for. This is the standing tension the loop must watch: an AC set is only as good as its fidelity to the *current* WP scope.

## Next run

Progression gate = ⛔ **STALLED** (rung flat at 4 ×3; expected — the WP-265 ladder retired at rung 5, a ~6-step product run cannot climb it). BINDING: next headline = the plan.md §7 queue item. That item is the pre-planned, spec-ready **dogfood-101 (WP-310 governor live proof + F-124 fix)** — unpark it. F-138 (WP-309 cross-run residue) is 🟡 product-completeness, NOT loop-integrity → it does not headline; queued behind as a WP-309 completion slice.
