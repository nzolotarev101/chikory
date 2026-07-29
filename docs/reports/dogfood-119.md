# dogfood-119 (verified-base gate run) — WP-541 (verified-base score gate): the benchmark number now stops when its base is untrusted

**Plain:** The run completed the missing publication gate correctly. Unverified bases stay visible
in the suite summary but no longer influence the headline scores, all three pinned corpus tasks now
declare how to verify their untouched bases, and the third brownfield task is runnable again.

- **WP:** WP-541 (verified-base score gate)
- **Date:** 2026-07-28 (America/Toronto; journal timestamps are 2026-07-29 UTC)
- **Spec:** [`examples/dogfood/dogfood-119-wp541-unverified-base-invalidates-the-score.yaml`](../../examples/dogfood/dogfood-119-wp541-unverified-base-invalidates-the-score.yaml)
- **Run:** `run-310d1b40-3b6d-4def-8cf4-38dfe218e78a` (the dogfood-119 execution)
- **Base HEAD:** `562e8e419348e51436363f3c6ef4159df3d2e0c6`
- **Landed commit:** `c78179c4d7da9079e66d8dab036e8fa5f45dc4fe`
- **Outcome:** 🟢 SUCCESS · 1 step · 2m 17s · $0.04698625 / $30.00

## Trace

| Event | Tokens in / out | Cost | Duration / evidence | Result |
|---|---:|---:|---|---|
| Executor step 1 | 4,634 / 1,130 | $0.00000000 | 1m 37s · 15,756-byte diff | SUCCESS |
| Judge pass 1 | 30,653 / 867 | $0.04698625 | 36s · 15,969 evidence bytes | PROCEED, 4/4 criteria |
| **Total** | **35,287 / 1,997** | **$0.04698625** | **2m 17s** | **SUCCESS** |

- **Executor / judge families:** `gemini-cli` (`gemini`) / `openai-compat`
  (`gpt-5.6-sol xhigh`) — structurally different families.
- **Checkpoint:** `run-310d1b40-3b6d-4def-8cf4-38dfe218e78a@5` ·
  `c300dafb6af7581ae233ac3bf641468d773985e9` · `lastGood: true`.
- **Journal sequence:** capability → step → pacing → judge → verdict → checkpoint → terminal;
  exactly one entry of each kind, so there is no duplicate step, verdict, checkpoint, or spend.
- **Interventions:** 0 rollbacks · 0 escalations · 0 resumes · 0 injections · 0 probe steps.

## Delivery

The harvested diff is byte-identical to the judged workspace and the landed-scope verifier reports
`MATCH`. The pure harvest commit changes six files, +290/−15, all under `benchmarks/`.

| Goal part | Status | Human-review evidence |
|---|---|---|
| Summary names and counts unverified tasks | 🟢 | `benchmarks/harness/src/results.ts:29-33,72-86` adds `tasksVerified` and `{taskId, reason}[]` without shortening `tasks` or `perTask` |
| Per-task base status reaches the published artifact | 🟢 | `benchmarks/harness/src/results.ts:44-46,96-105` emits `perTask[].baseVerified` |
| I-SR and D-SR (independent / dependency-adjusted satisfaction rates) exclude unverified requirements | 🟢 | `benchmarks/harness/src/results.ts:69-94` computes both rates only from `verifiedResults`; full-corpus requirement totals remain unchanged |
| No-repo greenfield task remains verified | 🟢 | `isTaskVerified` treats absent `baseVerification` as not applicable; AC-1 probes the greenfield negative |
| Red and undeclared pinned bases both fail closed | 🟢 | `suite.ts` records a non-green verdict for a missing command; `isTaskVerified` accepts only `green === true` once a verdict exists |
| Every pinned corpus task declares its base command | 🟢 | `brownfield-001` uses Yarn Berry `--immutable`; `brownfield-002` uses `pnpm@11.9.0 --frozen-lockfile`; `brownfield-003` uses `pnpm@10.12.1 --frozen-lockfile` |
| `brownfield-002` is runnable | 🟢 | `benchmarks/tasks/brownfield-002-cross-cutting-refactor.yaml:20-30` removes the false block and records the 1,128/1,128 measurement |
| Tests pin the number, not only field presence | 🟢 | 10 focused summary tests plus a real `runSuite` mixed-base case; AC-1 (behavioral acceptance criterion) independently asserts 4 tasks, 2 verified, named exclusions, and I-SR/D-SR = 1 |

### Independent verification

| Check | Result |
|---|---|
| Run acceptance criteria re-run on landed `c78179c` | 🟢 4/4 PASS, exit 0 |
| Harvest bytes vs run workspace | 🟢 IDENTICAL for all 6 files |
| Landed scope vs run diff | 🟢 `MATCH` |
| Build / lint / typecheck | 🟢 exit 0 |
| TypeScript SDK | 🟢 1,007 passed / 23 skipped |
| Benchmark harness | 🟢 113 passed / 11 files |
| Python SDK | 🟢 84 passed |
| Chain-aware harvest integration | 🟢 PASS |

## Anomalies

| Checklist item | Finding | Disposition |
|---|---|---|
| Wasted/filler steps | None: the only step produced the complete 15,756-byte delivery | No action |
| Cost telemetry | Executor recorded **$0.0000 with 5,764 tokens**; the judge supplied 100% of measured cost | Known F-167 (unpriced CLI telemetry) / F-9 (zero-cost telemetry) family; track-B, no new friction id |
| Token economics | 4,634 input tokens produced the full implementation; judge input was 30,653 tokens because it reviewed the diff plus four checks | Baseline datum for cost governance; no new WP |
| Judge behavior | All four checks genuinely exited 0; all six rubric items were specific and correct; no false positive or missed in-spec defect | Clean |
| Family diversity | `gemini` executor vs `openai-compat` judge | Invariant held |
| Loop integrity | Seven ordered journal entries; one step, one verdict, one checkpoint, one terminal; `lastGood` points to the landed step | Clean |
| Human ceremony | At least three operator boundaries remain: commit the launch snapshot, launch/watch, then harvest/review/land | Existing WP-219 (multi-run chains) / WP-220 (one-command landing) automation territory; no uncovered ceremony |

The run consumed **0.1566%** of its USD budget. Because the executor was unpriced, the measured
judge cost share is **100.0%**, above `judge.max_cost_share: 0.5`; that warning is economically
uninformative until the CLI subscription arm has a price model.

## New friction

No new friction item was opened. The sole anomaly is the already-recorded F-167 (unpriced CLI
telemetry) recurrence: 5,764 executor tokens costed at $0.0000. It remains a track-B cost-governance
note and cannot preempt the stalled Phase-3 benchmark ladder.

## Friction disposition table

No rows: this review opened no new `F-n` (friction) identifier.

## Verdict

The delivery proves the publication-integrity slice it was designed to prove. A base that is red,
unmaterializable, or undeclared is now visible and excluded from I-SR/D-SR; a greenfield task is
not accidentally discarded; and the full task count remains auditable.

It also moves the real product backlog: the runnable brownfield corpus is now **3 of 5**, up from
2 of 5. It does not climb P3-rung-4 (five-task baseline comparison), so the mechanical progression
gate remains `⛔ STALLED`; the next campaign must attempt the rung itself.

## KPI

| DOGFOODING §1.4 (run KPI table) | This run | Current / trailing window |
|---|---|---|
| Max horizon survived | 1 step · 2m 17s | trailing-3 max 2 steps vs prior-3 max 4 |
| Kill→resume count | 0 | 0 across dogfood-113…119 |
| Judge true-positives pre-land | 0 | trailing dogfood-117/118/119 = 0 |
| Meta:product headline ratio | product | trailing-3 = **0:3** harness-meta:product; cap intact |
| Per-step reliability, runs ≥5 steps | n/a | **93.8%** = 120 clean seals / 128 steps, 8 rollbacks, 17 qualifying runs |
| Current phase ladder | rung-3 climbed; this run remains rung 0 | rung-4 is next; rung-5 is Phase-3 exit |
| Progression verdict | ⛔ STALLED | no horizon, rung, resume, or looseness axis improved |

## NEXT RUN

**Grow the real corpus to five tasks, score the identical five with Chikory and raw Claude Code, and produce an auditable score range linked to both raw result sets.**

- **Spec:** [`examples/dogfood/dogfood-120-wp302-wp304-five-task-baseline-range.yaml`](../../examples/dogfood/dogfood-120-wp302-wp304-five-task-baseline-range.yaml)
- **Advances:** WP-302 (brownfield task authoring) and WP-304 (baseline runs and publication).
- **Why this and not another unblock:** §0 (progression gate) is `⛔ STALLED`, so this is the
  current P3-rung-4 (five-task baseline comparison) itself; another one-step prerequisite is barred.
- **Designed trap:** a plausible delivery grades an empty baseline workspace, compares different
  task sets, hides unverified bases by shortening the corpus, or reports a point estimate as a range.

### Gate verdicts

- **§0 progression:** ⛔ STALLED → rung-4 attempt is binding.
- **§1.1 failure surface:** ✅ two new real OSS tasks, two agent arms, like-for-like validation,
  and statistical ranges are genuinely failable.
- **§1.2 product progress:** ✅ real open benchmark work on WP-302 and WP-304; no throwaway utility.
- **§1.3 mission critical:** ✅ PROCEED — this is the moat ladder, not busy work or scaffolding.
- **§1.5 friction budget:** ✅ class=`product`; trailing-3 harness-meta:product = 0:3.

### Acceptance-oracle arming

| AC | RED on `c78179c` | GREEN on throwaway reference | Wall-clock / 120s cap |
|---|---|---|---|
| AC-1 compare CLI + Wilson intervals | exit 1, `unknown command 'compare'` | `AC-1 OK` | 2.14s / 2.63s |
| AC-2 raw baseline materializes the pin | exit 1, baseline exit 2 | `AC-2 OK` | 1.93s / 2.01s |
| AC-3 five runnable tasks | exit 1, `got 3` | `AC-3 OK` | 1.97s / 2.01s |
| AC-4 real two-arm publication bundle | exit 1, `ENOENT` | `AC-4 OK` | 0.29s / 0.28s |
| AC-5 scoped harness floor | exit 1, 113 < 120 | `AC-5 OK`, 120 tests | 7.22s / 7.18s |

`AC-1`, `AC-2`, `AC-3`, and `AC-5` are classified VERIFY-SUITE by preflight and therefore were
hand-verified in both directions. All five checks are well below the 120-second judge cap.
`parseTaskSpec` passes with 5 acceptance criteria, `$80` outer-chain budget, and 30 maximum steps.
Format lint reports LOOSE, ladder rung 4, thesis KPI present, and no delegated-file or
prose-grep acceptance-check hazard.

```sh
devbox run chain-dogfood
```
