# Chikory Benchmark Suite

Extension of DevAI (55-task / 365-requirement full-app-generation benchmark).

## Goal

Score openly against Cognition/Devin, OpenHands, and Claude Code on a vendor-neutral leaderboard. Target: 60–100 multi-hour tasks spanning greenfield and brownfield branches.

## Structure

```
benchmarks/
  devai/instances/  DevAI originals: 55 upstream task JSONs + manifest.json
                    (pinned upstream blob shas; refetch: devbox run bench fetch-devai)
  tasks/            Authored task YAMLs (greenfield + brownfield) — format v1,
                    frozen; authoring guide in tasks/AUTHORING.md (WP-302)
  harness/          Evaluation harness (WP-301): @chikory/benchmarks workspace
                    package — loaders, runner adapters, requirement grading,
                    results artifacts
  results/          Per-suite-run artifacts (gitignored raw; summaries copied
                    out deliberately when published)
```

## Running

All via devbox (never host toolchains):

```
devbox run bench                 # validate both corpora ($0 guard — also what CI gets)
devbox run -- bash scripts/bench.sh list benchmarks/devai/instances
devbox run -- bash scripts/bench.sh run \
  --tasks benchmarks/devai/instances --adapter command \
  --cmd 'claude -p "$(cat {goalFile})" --permission-mode acceptEdits' \
  --judge-cmd 'claude -p "$(cat {promptFile})"'
```

- Adapters are the matrix cells (`docs/components/benchmark.md`): `chikory`
  (full loop — durability + in-loop judge) vs `command` (any CLI agent as a
  baseline row, including the native-loop-without-judge honest ablation).
- Judge-graded DevAI requirements are graded post-hoc by a **different-family**
  judge; `--judge-cmd` makes that a keyless CLI-subscription call (no API keys
  on the machine — the CLI-auth constraint holds).
- Scoring reports both DevAI rates: **I-SR** (independent requirement
  satisfaction) and **D-SR** (dependency-adjusted — a requirement counts only
  if its prerequisites are satisfied too).

## Metrics

- End-to-end task success rate
- Per-requirement satisfaction (I-SR / D-SR)
- Per-step reliability
- Recovery rate after judge-triggered rollback
- Cost per successful task completion
- Time-to-completion distribution

Publication rules (WP-303/304): ranges not points, n≥3 per cell, every number
links to its raw trace. `benchmarks/results/` raw output never lands in git.

## Status

- WP-301 harness: **landed** — 55/55 DevAI instances + 3 authored drafts load
  and validate (365 upstream requirements exactly); command + chikory adapters;
  I-SR/D-SR grading; results artifacts.
- WP-302 authoring: format v1 frozen against the harness loader; guide in
  `tasks/AUTHORING.md`; three brownfield drafts pending repo pins.
- Baselines (WP-304) not started; leaderboard (WP-303) not started.

### Scored suites (chikory adapter)

| Suite | Date | Arm | Tasks | Result | Report |
|---|---|---|---|---|---|
| `20260723-222341-chikory` | 2026-07-23 | ⚠️ `claude-code`/anthropic (F-165 — wrong arm) | 2 | 7/7, I-SR/D-SR 100%, $2.7075 | [`bench-brownfield-20260723-222341.md`](../docs/reports/bench-brownfield-20260723-222341.md) |
| `20260725-130418-chikory` | 2026-07-25 | ✅ `gemini-cli` executes · codex judges (directive) | 2 (+1 blocked) | 7/7, I-SR/D-SR 100%, 36m 56s | [`bench-brownfield-20260725-130418.md`](../docs/reports/bench-brownfield-20260725-130418.md) |

**These are not publishable numbers.** n=1 per cell, 2 tasks, no baseline arm —
the publication rule above (ranges not points, n≥3 per cell) is not met. The
runnable corpus is **2 of 5**: `brownfield-002` is `status: blocked` (F-163,
target pins node≥24 vs devbox node 22 → WP-534) and `brownfield-004/005` do not
exist yet (WP-302).

Launch a suite with `devbox run bench-run` — it brings up Temporal and the
keyless codex judge proxy and runs the directive arm in one process.
Target: publish within 90 days of SDK launch (~2026-09-08).
