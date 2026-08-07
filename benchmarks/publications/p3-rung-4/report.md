# P3 Rung-4 Benchmark Publication Report

> [!IMPORTANT]
> **Headline Claim (Statistical Score Ranges)**:
> - **Chikory Directive Arm**: 95% Wilson Score Interval **[83.2%, 100.0%]** for both Immediate Success Rate (I-SR) and Dependency-Adjusted Success Rate (D-SR) across 19 total requirements (19/19 satisfied).
> - **Raw Claude Code Baseline**: 95% Wilson Score Interval **[75.4%, 99.1%]** for I-SR (18/19 satisfied) and **[62.4%, 94.5%]** for D-SR (16/19 dependency-satisfied).
> Point estimates (100.0% vs 94.7% I-SR / 84.2% D-SR) are secondary indicators; the finite 95% confidence intervals represent the primary statistical finding of this five-task evaluation.

## Summary

This document presents the published evaluation results comparing two arms on the 5-task brownfield benchmark corpus (P3 Rung-4):
1. **Chikory Directive Arm**: Chikory control plane orchestration using Gemini (`gemini-cli`) as executor and Codex (`openai-compat`) as judge.
2. **Raw Claude Code Baseline**: Direct execution using raw Claude Code via the `command` adapter.

Both arms successfully verified 5 out of 5 base repositories (`tasksVerified === 5`, `unverifiedTasks === []`) across identical ordered task IDs: `brownfield-001`, `brownfield-002`, `brownfield-003`, `brownfield-004`, and `brownfield-005`.

Raw evidence directories (`benchmarks/results/p3-rung-4/chikory` and `benchmarks/results/p3-rung-4/raw-claude-code`) remain gitignored and stored locally on disk.

---

## Benchmark Configuration & Overview

| Attribute | Chikory Arm | Raw Claude Code Baseline |
|---|---|---|
| **Adapter** | `chikory` | `command` |
| **Executor Family** | Gemini (`gemini-cli`) | Anthropic (`raw-claude-code`) |
| **Judge Family** | Codex (`openai-compat`) | N/A (un-judged raw execution) |
| **Tasks Evaluated / Verified** | 5 / 5 | 5 / 5 |
| **Total Requirements** | 19 | 19 |
| **Satisfied Requirements (I-SR)** | 19 (100.0%) | 18 (94.7%) |
| **Dependency-Satisfied (D-SR)** | 19 (100.0%) | 16 (84.2%) |
| **I-SR 95% Wilson Interval** | **[83.2%, 100.0%]** | **[75.4%, 99.1%]** |
| **D-SR 95% Wilson Interval** | **[83.2%, 100.0%]** | **[62.4%, 94.5%]** |
| **Total Wall-Clock Time** | 44m 17s (2,657,428 ms) | 30m 19s (1,819,195 ms) |
| **Started At (UTC)** | 2026-08-06T20:37:53.243Z | 2026-08-06T00:28:07.228Z |
| **Ended At (UTC)** | 2026-08-06T21:22:10.671Z | 2026-08-06T00:58:26.423Z |
| **Raw Results Path** | `benchmarks/results/p3-rung-4/chikory` | `benchmarks/results/p3-rung-4/raw-claude-code` |

> [!NOTE]
> The raw evidence directories `benchmarks/results/p3-rung-4/chikory` and `benchmarks/results/p3-rung-4/raw-claude-code` are gitignored and local to this environment. The published bundle contains byte-faithful copies of each arm's `summary.json` file and the computed `comparison.json`.

---

## Per-Task Breakdown

The benchmark corpus consists of 5 real-world brownfield software maintenance and upgrade tasks:

### 1. `brownfield-001` (ecyrbe/zodios) — Zod Major Upgrade (v3 → v4)
- **Requirements**: 3 total
- **Chikory Arm**: 3/3 satisfied, 3/3 dependency-satisfied (Wall clock: 460,195 ms (~7m 40s), base verified: `true`).
  - *Details*: Upgraded `zod` 3.22.4 → 4.4.3, with `typescript` 5.2.2 → 5.7.3 and `@types/node` 20.8.9 → 20.17.19 alongside it. The in-loop judge rejected a first attempt (`ROLLBACK`), after which Chikory completed the migration.
- **Raw Claude Code Baseline**: 2/3 satisfied, 0/3 dependency-satisfied (Wall clock: 307,401 ms (~5m 07s), base verified: `true`).
  - *Details*: Left `zod` pin at 3.22.4; primary upgrade requirement failed, causing dependency-adjustment to zero out dependent requirements.

### 2. `brownfield-002` (gitify-app/gitify)
- **Requirements**: 4 total
- **Chikory Arm**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 195,584 ms (~3m 16s), base verified: `true`).
- **Raw Claude Code Baseline**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 612,682 ms (~10m 13s), base verified: `true`).

### 3. `brownfield-003` (colinhacks/zod)
- **Requirements**: 4 total
- **Chikory Arm**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 230,048 ms (~3m 50s), base verified: `true`).
- **Raw Claude Code Baseline**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 235,357 ms (~3m 55s), base verified: `true`).

### 4. `brownfield-004` (react-hook-form)
- **Requirements**: 4 total
- **Chikory Arm**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 989,145 ms (~16m 29s), base verified: `true`).
- **Raw Claude Code Baseline**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 107,393 ms (~1m 47s), base verified: `true`).

### 5. `brownfield-005` (trpc/trpc)
- **Requirements**: 4 total
- **Chikory Arm**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 307,907 ms (~5m 08s), base verified: `true`).
- **Raw Claude Code Baseline**: 4/4 satisfied, 4/4 dependency-satisfied (Wall clock: 471,469 ms (~7m 51s), base verified: `true`).

---

## Evidence Traceability & File Map

The publication bundle is self-contained under `benchmarks/publications/p3-rung-4/`:
- `chikory-summary.json`: Byte-faithful copy of `benchmarks/results/p3-rung-4/chikory/summary.json`.
- `raw-claude-code-summary.json`: Byte-faithful copy of `benchmarks/results/p3-rung-4/raw-claude-code/summary.json`.
- `comparison.json`: Output of `chikory-bench compare` detailing interval bounds and per-arm metrics.
- `report.md`: This comprehensive publication summary.

### Exact suite runs behind these numbers

Each arm's parent directory holds several suite runs. Only the two below produced the published
`summary.json` files; the others are superseded attempts and are **not** the evidence for any number
in this report.

| Arm | Suite run directory | `summary.json` window (UTC) |
|---|---|---|
| Chikory | `benchmarks/results/p3-rung-4/chikory/20260806-203753-chikory` | 2026-08-06T20:37:53.243Z → 21:22:10.671Z |
| Raw Claude Code | `benchmarks/results/p3-rung-4/raw-claude-code/20260806-002807-command` | 2026-08-06T00:28:07.228Z → 00:58:26.423Z |

`comparison.json` records each arm's `rawResultsDir` as a **repo-relative** path, so the pointer
survives being read on another machine and can never cite a Chikory run workspace (which
`scripts/prune-runs.sh` deletes).
