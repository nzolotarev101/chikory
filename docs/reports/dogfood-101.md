# dogfood-101 — WP-310 (proactive limit-pacing governor) live-proof + F-124 (compaction step-index) fix

- **Vibe check (plain):** two things at once. (1) A real codex run was run under a *fake, compressed* weekly usage-limit window (3h standing in for 7 days, 20M-token cap). The **WP-310 governor** (the thing that spaces out spend so a run doesn't drain its weekly quota) genuinely kicked in: it pushed early, then **throttled three times** — inserting durable sleeps totalling **15m 6s** across steps 1–3 — and sealed SUCCESS having burned only **1.92M of the 20M** tokens. That is the first time the pacing governor has been observed doing its job on a real agent, not a unit test. (2) The run *also* carried a real fix: **F-124** — the `compaction` journal record was missing the step number it was folded at, which quietly broke crash-recovery de-duplication and forced the "which step first compacted" telemetry to guess. The fix is a clean 2-line additive change plus tests.
- **Bottom line:** delivery 🟢 (F-124 fixed additively, all 3 ACs re-pass, **900 TS tests green** / 22 skipped, harvest byte-IDENTICAL) · Thesis-KPI 🟢🟢 (governor observed live: `limit_pace` push→throttle×3, `control_event source:"pace"` durable sleeps matching to the millisecond, consumption 1.92M ≪ 20M cap, `pace` trace-footer line renders) · judge catches: **0** (clean run, no seeded diff, no front-loading) · ℹ️ **F-140** (PART-2's dedicated idempotency unit test is tautological — greens on HEAD; the true regression is caught by the Temporal wiring test instead) · **WP-310 now live-proven; F-124 CLOSED.**

## Run at a glance — `run-6c9873e3-aae0-472c-b080-43d97787995b`

| field | value |
|---|---|
| Outcome | 🟢 SUCCESS · 4 steps · **$2.90 / $45** (6.4%; exact steps+judge sum $2.9027) · **29m 43s** wall-clock (incl. 15m 6s pace-throttle sleeps) |
| Executor / Judge | codex(openai) / gemini-3.1-pro-preview via openai-compat (family-diverse ✓, invariant #2 held) |
| Spec | `examples/dogfood/dogfood-101-wp310-pacing-governor-liveproof.yaml` (LOOSE, 4 ordered increments) |
| Host WP | WP-310 (proactive limit-pacing governor) — P3 intelligent-scaling track (plan.md §7); deliverable = 🟡 F-124 under WP-203 |
| Landed | **uncommitted working tree** (harvest byte-IDENTICAL, pack §5) — left for user review |
| Launch env | `CHIKORY_QUOTA_WINDOWS='[{"window":"weekly","durationMs":10800000,"capacityTokens":20000000}]'` (THROTTLE variant) |
| **Judge** | **4/4 PROCEED** (+1 completion-review pass) · 0 ROLLBACK · 0 escalations · $0.03 (1.1% share) · all 3 ACs judge-executed & exited 0 every pass |
| **Pacing (context-rot)** | `autoCalibrate` · peak window 106% (compact 2 · park 0) · pressure-steps 2 (unfolded 2) · feedback 1/1 steps |
| **Pacing (WP-310 quota)** | push→throttle×3 · burn 12.58M tok/h · **weekly 90% left** · pace-throttled 15m 6s (3×) |

## Trace

```
run run-6c9873e3 · SUCCESS · 4 steps · $2.90 / $45.00 · 29m 43s · executor codex(openai) · judge openai-compat
 #   step                                          tokens(in/out)   cost     verdict
 1   PART 1 — payload carries stepIndex (+ tests)   1212k/5.8k       $1.57    ✓ PROCEED (3/3)
 2   PART 2 — idempotency proof (new test file)      331k/3.6k       $0.45    ✓ PROCEED (3/3)
 3   PART 3 — exact first-fold step (+ fallback)     364k/2.9k       $0.48    ✓ PROCEED (3/3)
 4   PART 4 — full-suite regression (empty diff)     268k/2.7k       $0.36    ✓ PROCEED (0/0)
totals: decisions 4 · judge passes 5 ($0.03, 1.1%) · rollbacks 0 · escalations 0 · injections 0 · checkpoints 4
        pacing events 4 · peak window 106% (compact 2 · park 0) · pressure-steps 2 (unfolded 2)
        pace throttle (burn 12580k tok/h) · weekly 90% left · pace-throttled 15m 6s (3×) · feedback 1/1 steps
```

## Thesis-KPI — WP-310 governor observed LIVE (read from the journal, launch-env-dependent)

The KPI is not an AC the executor can satisfy — it is proven from the run journal. All five review checks pass:

| WP-310 review check (spec header) | Evidence from `journal.db` | ✓ |
|---|---|---|
| `limit_pace` entries present, push→throttle transition | 4 rows: `push`@step0 → `throttle`@steps1/2/3 | 🟢 |
| ≥1 throttle with `limitingWindow:"weekly"` | all 3 throttles `limitingWindow:"weekly"` | 🟢 |
| `control_event` resume `source:"pace"`, sleepMs matches `interStepDelayMs` | 3 events; sleepMs **450571 / 256662 / 199037** match `limit_pace` `interStepDelayMs` exactly | 🟢 |
| `run.totals` throttle count ≥ 1 | pace-throttled 3× (15m 6s total) | 🟢 |
| total consumption < injected `capacityTokens` | final `consumedTokens` **1,919,087** ≪ **20,000,000** (weekly 90% left) | 🟢 |
| trace footer `pace` line renders | `pace throttle (burn 12580k tok/h) · weekly 90% left …` | 🟢 |

Observed burn decayed **17.57M → 14.13M → 12.58M tok/h** across the throttles, converging toward the window's sustainable **~6.0–6.7M tok/h** — the governor is regulating, not just logging. Zero real provider 429s (no `limit_signal` injected/real rows in the pace path). This is the first live evidence of the long-horizon-pacing thesis pillar.

## Delivery quality (human review) — F-124 fix

Reviewed the working-tree diff (`git diff HEAD`) line-by-line against the goal. Writes confined to `packages/sdk-ts/` (pack §4). Base = HEAD `2c519bf`.

**What landed and is genuine (🟢):**

| Goal PART | Landed | Verdict |
|---|---|---|
| P1 — payload field | `types.ts:521` — `stepIndex?: number` added to `CompactionResult` (optional → old journals still parse); `activities.ts:1871` — `stepIndex: input.stepIndex` added to the compaction payload write site | 🟢 minimal, additive, matches the `appendOnce({field:"stepIndex"})` key |
| P2 — idempotency proof | new `test/runner/compaction-journal.test.ts` — `appendOnce` keyed on `stepIndex` yields ONE row on double-append | 🟡 passes but tautological (see F-140) |
| P3 — exact first-fold step | **no source change needed** — `compaction-pressure.ts:36` already read `payload.stepIndex`; P1 supplies the data. `compaction-pressure.test.ts` gains a "derives from journaled stepIndex" test + a "falls back for legacy payloads" test | 🟢 correct — the reader was already right, only starved of data |
| P4 — regression | full suite green; `compaction-wiring.test.ts` extended to assert the **live** `compactContext` fold payload carries a numeric `stepIndex` and `firstPacingFoldStep` equals it | 🟢 real write-site→telemetry proof |

- **AC re-run (pack §3):** AC-1 (write-site greps `stepIndex`), AC-2 (co-reference test hits both `compactContext`/`"compaction"` and `firstPacingFoldStep`), AC-3 (`tsc && eslint && vitest`) all **PASS** — **900 passed / 22 skipped** (36.36s).
- **Additivity proven:** `CompactionResult.stepIndex` is optional and `describeCompactionPressure` keeps the legacy `latestPressureStep` inference as fallback — pre-fix compaction journals still render.
- **Family diversity real:** executor codex(openai) ≠ judge gemini(openai-compat); invariant #2 held.

## New friction

Continuing global sequence (dogfood-100 ended at F-139).

### ℹ️ F-140 — a "must-fail-on-HEAD" increment shipped a test that greens on HEAD

- **Evidence:** PART 2's spec directive was *"a test proves `appendOnce` now actually dedupes a re-executed compaction … the test must fail against the old payload shape."* The delivered `compaction-journal.test.ts` hand-builds `fold.payload = { stepIndex: 7, … }` and calls `appendOnce({field:"stepIndex", value:7}, fold)`. Because the payload already carries `stepIndex`, `findByKey`'s `json_extract($.stepIndex)` matches on HEAD too — the test **passes against the un-fixed payload shape**, so it does not reproduce the F-124 bug (the bug is that the *activity* omits `stepIndex`, which this test bypasses by constructing the payload directly).
- **Why it did not fail the run:** the judge's AC-2 is a co-reference *grep*, not a RED-on-HEAD challenge; it is satisfied by `compaction-wiring.test.ts` (which *does* drive the real `compactContext` write site and would fail on HEAD). So aggregate coverage is sound — only the dedicated PART-2 unit test is weak.
- **Severity:** ℹ️ low — the true regression is covered elsewhere. **No new WP.** Track-B note: loose "ordered-increment" specs whose PARTs claim "must fail on HEAD" have no mechanical enforcement that the increment's *own* test is RED-on-HEAD; the judge only greps. If cheaply enforceable later, fold into the WP-114/AC-hygiene family. Not loop-integrity → does not headline.

### ℹ️ Observation (not friction) — "pressure fired for 2 steps, no pacing folds recorded"

The verify pack surfaced this warning. It is the **unfolded-pressure** telemetry state (context window entered pressure but the pacing decision compacted 2× via a non-`pacing` trigger, so `firstPacingFoldStep` stayed unset) — a legitimate state `describeCompactionPressure` is designed to report, and precisely the metric F-124's fix makes exact when folds *do* carry a pacing trigger. No defect.

### ℹ️ Data point — probe step (F-11 / WP-221)

Step 4 = empty diff, $0.3621 = **12.5%** of run cost. It is the mandated PART-4 regression checkpoint (runs `tsc+eslint+vitest`, no code), not filler; already tracked under WP-221. Recorded for the empty-diff cost series.

## Verdict on the thesis

Strongest single data point to date for the **long-horizon-pacing** pillar (WP-310): a real multi-step codex agent, under a compressed weekly quota, **paced itself** — durable throttle sleeps injected mid-run, quota preserved (90% left), SUCCESS sealed — with the whole governor state replay-safe in the journal. The F-124 fix simultaneously tightened the **crash-recovery** pillar (compaction folds are now idempotent by an actually-populated key) and the **context-rot telemetry** (exact first-fold step). Clean judge run (0 catches) is expected — no bad diff was seeded; the KPI here is the governor, not a catch.
