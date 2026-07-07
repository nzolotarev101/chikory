# dogfood-089 — WP-105 (durable-loop OTel spans) landed as the FIRST GENUINE rung-4 (wall-clock-endurance) CLIMB. An autonomous `chikory run` paced over **2h50m** by the WP-272 (time-paced durable re-entry) `soak` mechanism reached SUCCESS across **5 real durable parks / 2h30m slept**, while landing real WP-105 (OTel — all agent runs emit spans) instrumentation of the durable loop. The progression gate flips **⛔ STALLED → ✅ PROGRESSING** (rung 3→4) — dogfood-088 built the soak mechanism but false-FAILed; this is the run that actually climbed the rung.

- **WP:** WP-105 — OTel spans for the durable loop (observability pillar, CLAUDE.md "all agent runs emit OTel-compliant spans" + "full trajectory observability"; REQUIREMENTS RT-7 / OB-4). A real open plan.md §6 product WP. WP-272 (soak / durable re-entry) is the RUN VEHICLE (paces the run over hours); the OTel loop spans are the LANDED PRODUCT DIFF (§1.2 — real WP, not scaffold).
- **Date:** 2026-07-06
- **Spec:** `examples/dogfood/dogfood-089-wp105-loop-otel-spans-soak-endurance.yaml` (LOOSE — outcome-shaped goal, six dependency-ordered PARTs; module/test layout left to the executor, F-82/F-83). Ladder-rung 4. Thesis-KPI: wall-clock endurance.
- **Run-id:** `run-c3a1c54e-0c8a-42c0-a433-00c2a368329e` (SUCCESS · 6 steps · autonomous · byte-identical harvest on the working tree)
- **Landed:** un-committed on the working tree, byte-identical to the run workspace (verify §5 all `IDENTICAL`). HEAD at review `18eaf16`. Pending user review/commit.
- **Mode:** `chikory run` (single durable run, UNATTENDED — `unattended:{escalation:seal_resumable_failed}`) under a real `soak` policy (`sleep_ms 1_800_000` × `max_reentries 5` ≈ 2.5h).

## Trace

```
run run-c3a1c54e-0c8a-42c0-a433-00c2a368329e · SUCCESS · 6 steps · $5.19 / $80.00 · 2h 50m · executor codex(openai) · judge openai-compat/gemini-3.1-pro-preview
 #   step (chunk)                     tokens(in/out)  cost     verdict            note
 1   PART 1 pure step-span emitter    975k/5.5k       $1.27    ✓ PROCEED (2/4)    AC-2/AC-3 unmet = PART-2/PART-6 not yet landed, BY DESIGN
 2   PART 2 wire step span→executeStep 171k/1.9k      $0.23    ✓ PROCEED (3/4)    AC-3 unmet (PART-6 live test pending)
 3   PART 3 checkpoint span            611k/5.9k      $0.82    ✓ PROCEED (3/4)    AC-3 unmet; clean move of SPAN_CHECKPOINT const → otel.ts
 4   PART 4 soak re-entry span         353k/4.5k      $0.49    ✓ PROCEED (3/4)    AC-3 unmet (final live test still pending)
 5   PART 5 run root span + parenting  887k/9.4k      $1.20    ✓ PROCEED (4/4)    all ACs green
 6   PART 6 LIVE soak span-tree proof  845k/6.1k      $1.12    ✓ PROCEED (4/4)    live parenting + soak re-entry span asserted
 totals: decisions 6 · judge passes 6 ($0.06, 1.1%) · rollbacks 0 · escalations 0 · checkpoints 6 · re-entries 5 · soak-slept 2h30m · peak window 1%
```

- **The endurance is the finding.** 6 short compute steps (≈16m of real work) stretched to **2h50m wall-clock** by 5 zero-compute durable Temporal-timer parks (30 min each). The run genuinely SUSPENDED and re-entered 5× and self-certified SUCCESS unattended — the first run to satisfy the rung-4 wall-clock axis autonomously (dogfood-088 built the mechanism but its autonomous run false-FAILed on F-114).
- **WP-273 (chunk-aware verdict) validated a 2nd time:** AC-3 (the live-test co-reference grep) legitimately failed on steps 1–4 because the live test is PART 6 — yet the chunk-aware Rule-3 guard suppressed the consecutive-fail HALT on the non-final chunks and let it clear on PART 5/6. No spurious HALT/escalate. (dogfood-088 is where a bad AC + this same guard produced a false-FAIL; here the ACs were correct and the guard let the honest progression through.)
- **Loop integrity 🟢:** 6 distinct non-hollow checkpoints, `lastGood` true through @34, 0 rollbacks, 0 escalations, 0 crash-resumes (soak re-entries are durable timer wakeups, not kill→resume). No hollow/probe step; every step carries a distinct product diff (5.3KB / 1.2KB / 7.8KB / 5.0KB / 12.5KB / 3.9KB).

## Delivery quality (human review, post-landing) — 🟢 COMPLETE, additive, contract-safe

All 6 PARTs landed. Reviewed line-by-line against the goal. Scope = 6 files, all named/entailed by the goal:

| Goal PART | Delivered | ✓ |
|---|---|---|
| **1 — pure step-span emitter** | `src/otel.ts`: `recordRunStepSpan(input)` + `SPAN_RUN_STEP` (`chikory.run.step`); mirrors `recordLLMCallSpan` (getTracer→startSpan→setAttribute→end), `startTime` back-dated by `record.durationMs`; step index / status / tokens / cost / duration / tool-calls / artifact refs; ERROR status on FAILED. Re-exported from barrel. Unit-tested (in-memory exporter). | 🟢 |
| **2 — wire into `executeStep`** | `runner/activities.ts`: `recordRunStepSpan({runId,stepIndex,planItem,record})` called from the `executeStep` ACTIVITY after journaling (determinism-safe — never the `agent-loop.ts` workflow body). Additive; step record unchanged. | 🟢 |
| **3 — checkpoint span** | `recordCheckpointSpan` + `SPAN_CHECKPOINT` (`chikory.checkpoint`: git.commit / journal.idx / last.good / budget) in `src/otel.ts`, wired into `writeCheckpoint`. Cleanly **refactored** the pre-existing inline checkpoint-span (moved the const `activities.ts`→`otel.ts`, barrel re-pointed). Unit + wire coverage. | 🟢 |
| **4 — soak re-entry span** | `recordSoakSpan` + `SPAN_SOAK` (`chikory.soak.reentry`: sleepMs / completedReentries / totalSleptMs) in `src/otel.ts`, wired into the `recordControlEvent` activity guarded by `source==="soak" && details!==undefined`. Additive. | 🟢 |
| **5 — run root span + parenting** | `SPAN_RUN` (`chikory.run`) via a process-local `activeRunSpans` Map: `recordRunStartSpan` (from `setupRun`), `recordRunEndSpan` (from the terminal seal — sets status + ERROR on non-SUCCESS), and `startRunChildSpan` parents step/checkpoint/soak spans under the run span via `trace.setSpan(context.active(), runSpan)`. LLM-call/judge spans unchanged. | 🟢 |
| **6 — LIVE soak span-tree proof** | `test/runner/soak-live.test.ts` (co-refs `recordRunStepSpan` + `createRunnerWorker`, F-97-safe): a real `createRunnerWorker`/`createTemporalRunner` multi-chunk run under a SHORT (500ms) soak asserts a `chikory.run` root, 2× `chikory.run.step`, 2× `chikory.checkpoint`, ≥1 `chikory.soak.reentry`, **all sharing the root traceId AND parented to the root spanId**, and SUCCESS never `AWAITING_APPROVAL`. `test/otel.test.ts` adds unit coverage for each emitter; `checkpoint.test.ts` gains a `recordCheckpointSpan` type-guard. | 🟢 |

- **Frozen contracts held:** all span emitters are NEW pure side-effect helpers; `SPAN_*` consts are NEW; wiring is ADDITIVE. No shape change to `StepRecord`/`JournalEntry`/`Checkpoint`/`ContextBundle`/`ArtifactRef`/`RunStatus`. No new dependency (`@opentelemetry/api` + `sdk-trace-base` already present). Determinism honored — every span starts in an ACTIVITY, never the workflow body; a run with no registered provider is a byte-equivalent no-op.
- **Judge diversity real:** executor codex(openai) vs judge gemini-3.1-pro-preview (openai-compat) — structurally different family. 6 judge passes executed the 4 ACs each (grep + full `tsc && eslint && vitest`), rationales sane.

## Independent verify

- **All 4 ACs PASS** against the working tree (§3 of the evidence pack, exit 0 each).
- **AC-4 full suite green:** `tsc --noEmit` + `eslint .` clean; `vitest run` → **748 passed / 19 skipped, 107 files** (28.5s).
- **Harvest byte-diff:** all 6 changed files `IDENTICAL` to the run workspace — no post-run drift.
- **Cost:** exact sum $5.1904 / $80 budget (6.5%); judge share 1.1% ($0.06). No empty-diff probe step (F-11 did not recur).

## New friction

Highest prior = **F-115**. Continue at F-116.

### 🟡 F-116 → track-B / DOGFOODING §8 (NEW, dogfood-089, delivery — cross-process span parenting): the run-root Map is process-local
- **Evidence:** `src/otel.ts` parents child spans under the run root via a module-level `const activeRunSpans = new Map<string, Span>()`. `recordRunStartSpan` populates it from the `setupRun` activity; `startRunChildSpan`/`recordRunEndSpan` read/delete it. This is correct in the single-worker dogfood harness (the live test proves shared `traceId` + parent `spanId`).
- **Impact:** in a distributed multi-worker Temporal deployment, `setupRun` and `executeStep`/`writeCheckpoint`/soak activities can run in **different worker processes**; a child activity on worker B won't find the run span in worker A's Map, so `ensureRunSpan` mints a **fresh orphan root per worker** and the "single run-rooted span tree" claim breaks. Secondary: a run that crashes before the seal activity leaks its run span in the Map forever (never `end()`ed). Neither affects run correctness — spans are side-effects, the loop is unchanged — so this is a product limitation, NOT loop-integrity.
- **WP it spawns:** none new; track-B refinement folded under WP-105. The durable-correct fix is to reconstruct the root-span **context from the journal / OTel context propagation** (a stored root `traceId`/`spanId` rehydrated per activity) rather than in-process memory — the same shape the durable loop already uses for state. Record as a DOGFOODING §8 known limitation until a multi-worker deployment needs it.

### Carry-forward observations (not numbered friction)
- **Token-expiry-across-park not yet surfaced.** Parks were 30 min; the spec hoped `sleepMs` above the proxy-token TTL to force a refresh-across-park, but the run showed no token-refresh event — 30 min likely sits under the TTL. The next rung-4 consolidation should bump `sleep_ms` toward the literal ~8h ⑦ target to actually exercise token-expiry / worker-uptime across a park.
- **Input-token economics:** 171k–975k input tokens/step (codex context), 1.9k–9.4k output. Baseline for WP-203/207; unchanged shape from prior runs.

## Verdict on the thesis

🟢 **The rung-4 wall-clock axis is CLIMBED, autonomously, with real product landing.** For the first time a `chikory run` durably endured **hours** of wall-clock (2h50m, 5 durable parks, 2h30m slept) and self-certified SUCCESS unattended — proving the durable-execution pillar over real time, not just a compressed test timer. And it did so while landing genuine WP-105 product: the durable loop (`run`/`step`/`checkpoint`/`soak`) now renders as a standard OTel span tree, exactly the observability a long-horizon operator needs for an overnight run. The judge held family diversity, executed every AC, and WP-273's chunk-aware verdict let an honest by-design AC progression through without a spurious HALT (its 2nd live validation). The one real finding — F-116, the process-local parenting Map — is a distributed-deployment limitation, not a correctness bug, and is track-B under WP-105. Net: progression flips ⛔→✅ (rung 3→4); the next horizon is either a longer rung-4 consolidation (toward the literal ~8h ⑦, surfacing token-expiry-across-park) or the ⑧ P2 exit gate (24h+ brownfield).

## KPI table (DOGFOODING §1.4)

| KPI | 089 | Trailing-3 (087/088/089) | Gate |
|---|---|---|---|
| Max horizon survived | **6 steps / 2h50m** | 2h50m (089) — 5.9× the prior best 28m | ⑧ P2-exit = 24h+ (closer, not there) |
| Kill→resume count | 0 (5 durable soak re-entries, not crashes) | 0 | resume proven earlier |
| Judge true-positives pre-land | 0 (no seeded defect; AC progression is by-design, not a catch) | 0 | opportunistic |
| Meta:product headline ratio | product | **0:3** | ≤1:3 ✅ |
| Per-step reliability (runs ≥5 steps) | 6/6 PROCEED, sealed SUCCESS | 100.0% (0 rollbacks / 24 steps, 4 runs ≥5) | 99%+ ✅ |
| Ladder rung | **4** (first autonomous climb) | 3 → 3 → **4** (✅ PROGRESSING) | P2 exit = ⑧ 24h+ |

**Glossary:** WP = Work Package · AC = Acceptance Criterion (grep/exit-code check the judge runs) · rung = WP-265 horizon-ladder step (④ = hours/wall-clock endurance, ⑦ = overnight ~8h, ⑧ = P2-exit 24h+) · soak = a durable idle/re-entry interval (WP-272) that produces real wall-clock time via a zero-compute Temporal timer · durable park / re-entry = the workflow SUSPENDs on a Temporal timer then resumes from its journal · span tree = the OTel parent/child trace structure · non-hollow = every sealed step carries distinct product work · process-local = state held in one worker's memory, not shared across a distributed Temporal worker fleet.
