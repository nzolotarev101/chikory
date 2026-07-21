# dogfood-108 — WP-530 P3-rung-3 CLIMBED (first benchmark task scored end-to-end)

- **WP:** WP-530 (P3 proof ladder, `plan.md` §7) rung 3 · benchmark task WP-302 (`brownfield-003`, pinned dogfood-107)
- **Date:** 2026-07-21
- **Not an `examples/dogfood/` spec** — this is a `benchmarks/harness/` run (`devbox run bench`), Chikory's own `chikory` adapter used as the agent-under-test, not the operator driving Chikory directly. Harness run folder `benchmarks/results/20260721-013438-chikory`; Chikory run-id `run-2118efd2-83c9-47c9-9449-93f0cc4e87b0` (journal at `benchmarks/results/20260721-013438-chikory/brownfield-003/.chikory`).
- **Outcome:** ✅ **P3-rung-3 CLIMBED** — `brownfield-003` scored 4/4 (I-SR 100%, D-SR 100%) through the real `chikory` adapter + a real different-family judge. Took 6 launch attempts; the first 5 found 3 real gaps in the benchmark harness / executor, all fixed same-session.

## Plain lead

P3-rung-3 (score one real benchmark task end-to-end through Chikory itself,
with a genuine pass/fail score — not a dry run) is climbed. The pinned
`colinhacks/zod` Map/Set-default bug (dogfood-107) went from "the checks work
by hand" to "Chikory's own `claude-code` executor diagnosed and fixed the bug
autonomously, and Chikory's own judge graded it" — 1 step, $0.65, 4/4
requirements green. Getting there took 6 attempts: the first 5 surfaced 3 real
bugs (2 in Chikory's core executor, 1 in the benchmark harness) that a normal
`examples/dogfood/` run never would have, because this is the first time
Chikory has run an agent **headless, unattended, needing to execute shell
commands mid-step** against an **external, non-Chikory repo**.

## Benchmark run summary

| Metric | Value |
|---|---|
| Harness run folder | `20260721-013438-chikory` |
| Chikory run-id | `run-2118efd2-83c9-47c9-9449-93f0cc4e87b0` |
| Status | 🟢 SUCCESS |
| Chikory-internal run duration | 2m 51s (`01:34:39.640Z`→`01:37:30.698Z`, journal `startedAt`/`endedAt`) |
| Adapter wall-clock (incl. CLI startup) | 188.7s (`brownfield-003.json` `run.wallClockMs`) |
| Total harness task duration | 3m 40s (`startedAt`/`endedAt` in `brownfield-003.json`, incl. grading + workspace copy-back) |
| Executor | `claude-code` (anthropic family), via keyless `openai-compat` proxy for plan/review/judge stages |
| Judge | `openai-compat` family (different from executor family — bias-mitigation invariant held) |
| Steps | 1 (`toolCalls: 20` inside the step) |
| Tokens | input 946,525 / output 7,071 (step: 943,193 / 6,566; judge: 3,332 / 505) |
| Cost | $0.649 total (executor step only; judge cost $0 — proxy) |
| Judge verdict | PROCEED, 4/4 criteria + all 6 rubric items pass, 0 concerns |
| I-SR / D-SR | 100% / 100% (4/4 satisfied, 4/4 dependency-satisfied) |

## Grading criteria (`benchmarks/tasks/brownfield-003-bug-archaeology.yaml`)

| id | check | result |
|---|---|---|
| R1 | `pnpm install --frozen-lockfile` clean | 🟢 PASS |
| R2 | new/modified test reproduces the reported Map-default bug and passes | 🟢 PASS — landed in `packages/zod/src/v4/classic/tests/default.test.ts` |
| R3 | full pre-existing zod suite green | 🟢 PASS |
| R4 | root-cause discriminator (independently probes the unreported `Set` sibling) | 🟢 PASS |

The executor's own summary (step transcript) independently named the root
cause correctly: `shallowClone()` (`packages/zod/src/v4/core/util.ts:399`)
only cloned plain objects/arrays; it added `Map`/`Set` cloning generally, not
a narrow `Map`-only patch — exactly what R4 exists to catch a narrower fix
missing.

## Delivery quality (human review, post-landing)

The 4 grading requirements passing on the copied-back workspace is not
sufficient on its own — it only proves the checks ran, not that the harness
was scoring the *agent's* work rather than an artifact of a broken pipeline.
Independently confirmed:

- `git show` on the 5 harness-fix commits (`1fce9d9`, `4e856db`, `f57f53b`,
  `1bdfd94`, `3791e26`, already committed + pushed to `main` before this
  review) — each is a small, single-purpose diff, no scope creep.
- The workspace-copy fix (`3791e26`) picks `readdirSync(runsDir).filter(n =>
  n.startsWith("run-"))[0]` — the FIRST matching dir, not necessarily the
  run just executed. Harmless today (one run per `outDir`, confirmed by
  inspecting `benchmarks/results/20260721-013438-chikory/brownfield-003/`),
  but fragile if a future retry path ever leaves >1 run dir under the same
  `dataDir` — noted as a friction item (F-157) rather than blocking landing.
- Re-ran `chikory trace run-2118efd2-… --data-dir
  benchmarks/results/20260721-013438-chikory/brownfield-003/.chikory --json`
  directly against the harvested journal (not the harness's own summary) and
  confirmed the same terminal SUCCESS, same judge form, same 4/4 — the
  benchmark's reported score matches the run's own ground truth.

## New friction (global numbering continues from F-155)

- 🟡 **F-156 — headless bash-requiring tasks need a new executor seam.**
  `createClaudeCodeAdapter`'s default `allowedTools` (`["Read","Edit","Write",
  "Glob","Grep"]`, `packages/sdk-ts/src/executors/claude-code.ts:34`) has
  **never** included `Bash`, and the default `--permission-mode` was
  `acceptEdits` — fine for a normal dogfood spec, where the judge (not the
  executor) runs acceptance checks. `brownfield-003` needs the AGENT itself
  to install deps and run `vitest` mid-step to diagnose a bug it wasn't told
  the location of — with no operator present to answer an interactive
  permission prompt, every headless attempt without Bash either produced no
  diff or hung. Fixed (`4e856db` + `1bdfd94`): a new `CHIKORY_ALLOW_BASH=1`
  env seam adds `Bash` to `allowedTools` and switches `--permission-mode` to
  `auto` (all prompts auto-approved). **This is a genuine executor capability
  gap for any future autonomous, unattended, bash-needing task — not
  brownfield-benchmark-specific** — worth a WP if a second consumer needs it
  (currently only `chikoryAdapter` sets the env). Scoped tightly: only fires
  when the operator explicitly opts in via the env var; a normal dogfood
  launch is unaffected.
- 🟠 **F-157 — silent false-negative grading (harness bug, now fixed).**
  Before `3791e26`, `chikoryAdapter` graded `ctx.workspaceDir` — the
  harness's own empty pre-provisioned directory — never the sandboxed
  `.chikory/runs/<id>/workspace` where the executor's edits actually landed.
  Attempt `20260721-012233-chikory` scored 1/4 (only the trivially-true R1)
  purely from this: the agent likely did fix the bug, but the grader was
  checking an unmodified clone. **This is the most severe class of harness
  bug — a benchmark that silently under-reports Chikory's real capability**
  — caught only because 1/4 was suspicious enough to keep debugging rather
  than accepted as "the agent failed." Fixed by copying the run's final
  workspace back before grading.
- ℹ️ **F-158 — stale Temporal workflow retries forever against a fresh
  dataDir (operational, not fixed, no WP).** Attempt `20260721-011213-chikory`
  logged 9+ minutes of `Activity failed … has no journal run row — was
  prepareRun skipped?` retries (visible in `adapter.log`) — an orphaned
  workflow/task-queue entry from an earlier interrupted attempt kept retrying
  against a run-id whose fresh per-attempt `dataDir` never got a matching
  journal row. Not a Chikory correctness bug (a genuinely fresh launch works);
  a benchmark-harness operating discipline gap — kill stray local Temporal
  workers/workflows between repeated `devbox run bench` attempts against the
  same task. Track-B note only.

None of the three are 🔴 loop-integrity (nothing corrupted a journal or
produced a wrong terminal verdict that survived to the final scored run) —
F-157 came closest (wrong verdict) but was caught and fixed before landing,
so it doesn't trigger the friction-budget headline-veto. **Class = product**
for the ledger row: the substantive fix (F-156) touched
`packages/sdk-ts/src/executors/claude-code.ts`, a core executor file, not
just harness scaffolding.

## KPI table (DOGFOODING §1.4, trailing window incl. this run)

| KPI | Value |
|---|---|
| Max horizon survived (steps / wall-clock) | 1 step / 2m 51s — a single-step run; horizon KPI unmoved this run (WP-530 rung KPI is separate, see below) |
| Kill→resume count | 0 (no park/resume this run) |
| Judge true-positives pre-land | 0 (clean 1-step SUCCESS, no catch) |
| Trailing-3-run meta:product headline ratio | 0/3 (this run classed `product` — see above) |
| Per-step reliability (runs ≥5 steps) | unchanged, 95.7% (this run has 1 step, excluded from the ≥5-step cohort) |
| Current-phase (P3) ladder rung vs exit gate | **rung 3 of 5** (P3-rung-5 = published leaderboard, `plan.md` §7) |

Progression gate (`scripts/dogfood-progression.sh`) re-run after appending
this row: **✅ PROGRESSING** (ladder rung moved 2→3 in the trailing-3 window,
directly answering the prior review's "rung has not advanced" warning).

## Verdict on the thesis

P3-rung-3 is climbed for real, not just unblocked. This is the first time a
Chikory-run agent has: (a) run fully headless/unattended against (b) a real
external OSS repo it has never seen, (c) diagnosed a bug from an issue report
alone (no file/symbol pins — `brownfield-003`'s goal names no files), and
(d) had that work graded by a structurally different judge model family,
producing a genuine DevAI-style I-SR/D-SR artifact. The 5 failed attempts
before the green one are exactly the kind of finding the benchmark ladder
exists to surface — 2 of 3 fixes (F-156, F-157) touch real product code paths
(executor capability, harness grading correctness), not scaffolding.

## Next

P3-rung-4 (`plan.md` §7) needs **≥5 pinned brownfield tasks** scored against
both `chikory` and a baseline adapter (raw Claude Code / OpenHands),
producing a score RANGE. Only 1 of 3 drafted tasks (`brownfield-003`) is
pinned; `brownfield-001`/`002` are still `TBD`, and rung 4 needs 2+ more
beyond that — each pin requires the same real-repo research process as
dogfood-107 (not fabricable). This is a materially larger lift than a single
spec — recommend confirming scope/pace with the operator before committing to
it as the next headline, rather than launching more multi-hour external-repo
research autonomously in this session.

Edits left uncommitted for review: `docs/reports/dogfood-108.md` (new),
`docs/reports/dogfood-ledger.csv` (row 108 appended), `plan.md`,
`docs/DOGFOODING.md`, `docs/PLAN-HISTORY.md`. (The 5 harness/executor fix
commits `1fce9d9`/`4e856db`/`f57f53b`/`1bdfd94`/`3791e26` are already
committed and pushed — landed mid-session before this review started.)
