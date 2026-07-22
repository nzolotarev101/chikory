# dogfood-110 — WP-302/WP-530 P3-rung-4 prep: `brownfield-001`/`002` scored through the `chikory` adapter (both terminal FAILED)

- **WP:** WP-530 (P3 proof ladder, `plan.md` §7) rung-4 prep · WP-302 (brownfield benchmark task authoring). Ran the two tasks pinned in dogfood-109 (spec-authoring, no run) through Chikory's own `chikory` adapter for the first time.
- **Date:** 2026-07-21
- **Not an `examples/dogfood/` spec** — two `benchmarks/harness/` runs (`devbox run bench … run --adapter chikory`), Chikory's own executor as the agent-under-test. Harness folders `benchmarks/results/20260721-231257-chikory` (`brownfield-001`) and `benchmarks/results/20260721-235008-chikory` (`brownfield-002`).
- **Outcome:** 🔴 **BOTH RUNS TERMINAL FAILED** (executor hit the 3-consecutive-step-failure escalation). `brownfield-001` = a clean single run whose 2/3 grade is genuine partial progress; `brownfield-002` = 3 spawned run-ids, 45 orphaned-workflow journal errors, and a broken workspace copy-back that makes its 1/4 grade **untrustworthy**. Rung-4 (≥5 pinned tasks vs a baseline) NOT climbed — corpus still 3, and both scoring runs failed.

## Plain lead (vibe check)

We ran the two hard brownfield tasks pinned last session (a real zod v3→v4
major-version upgrade, and a real cross-cutting store refactor) through
Chikory itself for the first time. **Both runs ended in FAILED** — and the
most important reason is a control-plane bug, not agent incapacity: **a step
is marked FAILED purely because the executor CLI process exits non-zero**
(`step.ts:167`). On a "make the tests pass" task the agent naturally ends each
step by running the test suite, which exits non-zero while any test is still
red — so every step "fails", three in a row trips the runner's escalation, and
the run seals FAILED **even when Chikory's own judge just voted PROCEED
("work in progress, no regressions")**. The judge — the whole thesis — is
overruled by a crude exit-code heuristic. Two smaller harness bugs surfaced and
were hand-fixed mid-session (`activities.ts`, uncommitted).

## Glossary (IDs used here)

- **I-SR / D-SR** — Instance / Dependency Success Rate (fraction of grading
  requirements satisfied; D-SR only counts requirements whose dependencies passed).
- **R1–R4** — the task's grading `check`s (install / tests / typecheck / discriminator).
- **P3-rung-N** — rung on the P3 moat ladder (`plan.md` §7, WP-530). rung-3 = one
  benchmark task scored end-to-end (dogfood-108); rung-4 = ≥5-task slice vs a baseline.
- **F-n** — global sequential friction id.

## Run summary

| Metric | `brownfield-001` (zodios) | `brownfield-002` (gitify) |
|---|---|---|
| Chikory run-id | `run-2cb113d8-1f79-4159-9019-9e6dd2b66da4` | `run-ec7858be-d534-46c2-baf8-6602cc0adc56` (+2 orphans) |
| Terminal state | 🔴 FAILED (escalation) | 🔴 FAILED (escalation) |
| Steps | 3 (all executor exit 1) | 3 (all executor exit 1) |
| Cost | $2.35 / $25.00 | $2.71 / $25.00 |
| Duration | 11m 53s | 11m 22s |
| Executor / Judge | `claude-code` (anthropic) / `openai-compat` (family-diverse ✅) | same |
| Judge passes | 1 (step 3 → PROCEED, 2/3) | 1 (step 2) |
| Grade (I-SR / D-SR) | 2/3 = 66.7% / 66.7% — **genuine** | 1/4 = 25% / 25% — **INVALID** (see F-157 recurrence) |
| Journal-integrity errors | 0 | **45** ("no journal run row — was prepareRun skipped?") |

### Per-step (both runs, executor exit 1 every step)

| Task | step | tokens in/out | cost | verdict |
|---|---|---|---|---|
| bf-001 | 1 | 1184k / 5.0k | $0.71 | ✗ FAILED · diff 509,455 B (the whole zod upgrade) |
| bf-001 | 2 | 1165k / 13k | $0.83 | ✗ FAILED |
| bf-001 | 3 | 1098k / 11k | $0.81 | ⚠ ESCALATE · diff 165 B · **judge PROCEED 2/3** |
| bf-002 | 1 | 1475k / 13k | $0.99 | ✗ FAILED |
| bf-002 | 2 | 1408k / 16k | $1.02 | ✗ FAILED |
| bf-002 | 3 | 1098k / 8.6k | $0.70 | ⚠ ESCALATE |

## Delivery quality (human review, post-landing)

**`brownfield-001` — genuine 2/3.** The copied-back workspace is complete
(`node_modules`, full `src/`). The judge re-ran the checks at step 3:
- R1 (install + zod major is 4) ✅
- R2 (jest suite green + exact 117-test-count invariant) ✗ — "failed tests: 2"
  (the two v3-`ZodError`-shape assertions the task exists to force a real fix of)
- R3 (`tsc --noEmit -p tsconfig.build.json`) ✅

The judge's own verdict was **PROCEED (2/3 criteria), "work in progress, no
regressions"** — a *correct* read of a partially-done multi-step task. The run
nonetheless sealed FAILED (see F-159). So the score is real, but the terminal
state contradicts the judge.

**`brownfield-002` — grade not trustworthy.** The copied-back workspace
contains **only** the task's own probe file
(`src/renderer/__probe__/legacy-gone.probe.ts`) — no `node_modules`, no gitify
source. Grading therefore failed R2/R3/R4 with `Command "vitest"/"tsc" not
found`, i.e. missing tooling, **not** unmet requirements. R1 "passed" only
because `pnpm install` in a near-empty tree reports "Already up to date." The
1/4 is a measurement artifact of a broken grading tree (F-157 recurrence), not
a measure of the agent's work.

Neither run's terminal FAILED is a clean "agent couldn't do it" signal: both
are entangled with F-159 (exit-code escalation). These are genuinely hard tasks
(major-version upgrade; cross-file delete-and-inline refactor) that plausibly
need >3 red→green steps — which the current escalation threshold cannot allow.

## New friction

**F-159 🔴 (scoring-integrity, control-plane) — executor process exit code
overrides the judge verdict; multi-step "fix-until-green" tasks can never
terminally SUCCEED.** `packages/sdk-ts/src/executors/step.ts:167` maps
`proc.exitCode !== 0` directly to `status: "FAILED"` (retriable false). The
`claude-code` executor exits non-zero whenever the agent's own final
verification command (jest/vitest/tsc) returns non-zero — which is *every step*
until the suite is fully green. Three such steps trip the runner's
3-consecutive-failure escalation → terminal FAILED, **discarding the judge's
PROCEED** (bf-001 step 3: judge PROCEED 2/3, run sealed FAILED anyway). Any
benchmark task needing >3 steps of legitimate red→green iteration auto-FAILs.
This directly undermines the "judge in the inner loop is the quality gate"
thesis and **blocks credible rung-4 scoring**. → **spawns a WP** (§7 queue):
step success must be driven by the judge verdict / AC checks, not by the raw
executor exit code — e.g. treat "executor exit non-zero *with* a real diff and
a PROCEED judge" as `IN_PROGRESS`, reserve FAILED for adapter/tooling errors.

**F-160 🟡 (harness) — internal checkpoint commits blocked by target-repo
pre-commit hooks. HAND-FIXED this session (uncommitted).** Repos with husky /
lint-staged (gitify) reject Chikory's per-step checkpoint `git commit`. Added
`--no-verify` to the checkpoint commit in `activities.ts:commitAllRepos`. Sound
and necessary; the checkpoint is Chikory's internal audit anchor, not a
user-facing commit. → hand-fix, no WP (record only).

**F-161 🟡 (harness) — `prepareRun` crashes pre-install on workspaces whose
`pnpm-workspace.yaml` lacks a `packages:` array. HAND-FIXED this session
(uncommitted).** `ensureWorkspaceDeps` (`activities.ts`) now wraps the
`pnpm install` in try/catch so a non-standard workspace config (gitify) no
longer aborts `prepareRun`; the executor / requirement checks install as
needed. Correct but silent (comment documents the swallow). → hand-fix, no WP.

### Recurrences (not new ids)

- **F-157 recurrence 🟠 (grading tree) — the `3791e26` copy-back fix does not
  cover the terminal-FAILED path.** For bf-002 (FAILED) the "copy final
  sandboxed workspace back for grading" step restored only the probe file, so
  grading scored a tree with no `node_modules`/source → false 1/4. The copy-back
  must restore the full post-agent tree (incl. installed deps or a re-install
  step) on *all* terminal states, or grading must run in-sandbox. → fold into the
  F-157 WP (reopen).
- **F-158 recurrence ℹ️→🟡 (stale Temporal retries, escalated).** bf-002 spawned
  **3** run-ids; the 2 non-final ones (`run-5de58efe`, `run-bbf8ec12`) have a
  `journal.db` with **no run row**, and their durable workflows retried
  `writeCheckpoint` **45×** ("no journal run row — was prepareRun skipped?"),
  never terminating and polluting the adapter log. dogfood-108 saw this as a
  benign one-off (F-158, no fix); at 45 retries across orphaned runs it is now
  worth a guard: `writeCheckpoint` should terminate (not infinitely retry) when
  the run row is absent, and orphaned workflows from superseded launch attempts
  should be cancelled. → track-B guard under the F-158 line.

## KPI table (DOGFOODING §1.4)

| KPI | This review | Trailing window |
|---|---|---|
| Max horizon survived | 3 steps / ~12 min (both FAILED at step 3) | 8 steps (dogfood-105) |
| Kill→resume count | 0 | 2 resumes (104–106) |
| Judge true-positives pre-land | 0 (judge voted PROCEED; escalation is runner-level, not a judge catch) | ~1 (dogfood-102/105) |
| Trailing-3 meta:product headline ratio | 0/3 (harness-meta) | 0/3 |
| Per-step reliability (runs ≥5 steps) | N/A (both 3-step) | 95.7% (target 99%+) |
| Ladder rung vs exit | rung-3 mechanism re-exercised (bf-001); **rung-4 NOT climbed** | exit = rung-5 (published numbers) |

## Verdict on the thesis

Mixed, and instructive. The **family-diverse judge worked** — it re-ran the
real checks and returned an accurate PROCEED/2-3 on bf-001. But the run **still
sealed FAILED**, because a pre-judge, executor-exit-code heuristic
(`step.ts:167`) has veto power over the judge. That is the thesis inverted: the
crude signal wins, the judge is decorative. Until F-159 is fixed, the benchmark
cannot produce a credible "Chikory ran the agent to a graded SUCCESS" artifact
on any task that needs sustained red→green iteration — which is most real
brownfield work. **rung-4 is blocked on a real product bug, not on task
authoring.**

## Next

Progression gate = **✅ PROGRESSING** (a thesis axis moved: first real scores on
2 more tasks) with a **⚠️ ladder-pace warning** (rung stuck at 3 across the
trailing 3 headlines). But the binding constraint surfaced this review is
F-159, a 🔴 control-plane correctness bug on the core runner that **blocks
meaningful rung-4 scoring**. Per DOGFOODING §1.2 (product-progress) and §1.3,
the next headline should be the **F-159 fix** — make step success judge-driven,
not exit-code-driven — seeded into the real runner (`step.ts` / the escalation
logic), a maximally-failable cross-file change on the judge-in-the-loop pillar.
That unblocks rung-4 far more than pinning 2 more tasks (track-B research).
Recommend the operator confirm this over "pin 2 more tasks" before spec-writing.
