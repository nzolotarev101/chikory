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

Not started. Begins in Stage 1 (target: publish within 90 days of SDK launch).
