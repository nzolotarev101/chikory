# Chikory Benchmark Suite

Extension of DevAI (55-task / 365-requirement full-app-generation benchmark).

## Goal

Score openly against Cognition/Devin, OpenHands, and Claude Code on a vendor-neutral leaderboard. Target: 60–100 multi-hour tasks spanning greenfield and brownfield branches.

## Structure (planned)

```
benchmarks/
  tasks/          Task definitions (greenfield + brownfield)
  harness/        Evaluation harness
  results/        Scored run outputs (gitignored raw JSON, committed summaries)
  README.md       This file
```

## Metrics

- End-to-end task success rate
- Per-step reliability
- Recovery rate after judge-triggered rollback
- Cost per successful task completion
- Time-to-completion distribution

## Status

Task authoring started 2026-07-04: three brownfield drafts in `tasks/`
(format + design rules in `tasks/README.md`), doubling as long-horizon
dogfood spec sources for the WP-265 ladder. Harness (WP-301) not started.
Target: publish within 90 days of SDK launch.
