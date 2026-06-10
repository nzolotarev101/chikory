# Component: Benchmark (DevAI-extended)

**Phase**: P3 · **WPs**: WP-301..306 · **Requirements**: ST-1..3, NF-5 · **Dir**: `benchmarks/`

## Purpose

The moat that single-vendor incumbents cannot credibly copy (spec §6): an open, vendor-neutral, full-application benchmark with a public leaderboard — and the hedge if providers ship their own judge primitives (spec §11 signal). Also the Stage-1 stop-signal instrument: **beat OpenHands on a 50-task subset by month 6 or revisit the thesis** (spec §10).

## Structure

- **Base**: DevAI's 55 tasks / 365 requirements, runnable under `benchmarks/devai/` via the Chikory harness (WP-301).
- **Extension** (WP-302): grow toward 60–100 multi-hour tasks in two branches:
  - `greenfield/` — full-app builds with verifiable acceptance criteria
  - `brownfield/` — real OSS repos at pinned commits + feature/migration/maintenance tasks (weighted up, per the SWE-bench-saturation signal)
- Task format = Chikory `task.yaml` + verification script (acceptance criteria machine-checkable wherever possible). An **authoring guide** makes adding a task a 🟢 contribution — community-extensible by design.

## Harness (WP-301)

- Runs a matrix: {Chikory + executor X + judge Y} × {baselines: raw Claude Code, OpenHands, native-loop-without-judge}.
- The no-judge native-loop cell isolates Chikory's *contribution* (durability + judge) from underlying agent quality — this is the honest ablation skeptical developers will look for (spec §11 "agent washing" counter).
- Outputs: journal JSON per run (WP-142 interchange format) → scores + cost + loop-count + recovery stats. Every published number links to its raw trace.

## Scoring & reporting (WP-303/304)

- Per-requirement satisfaction (DevAI's unit), end-to-end success, cost per success, judge intervention stats (catches vs false stops), zero-infinite-loop assertion, crash-recovery drill results.
- **Ranges, not points** (NF-5): n≥3 runs per cell, report median + spread. Methodology doc published with the leaderboard; self-reported claims from others never mixed with our measured rows.

## Dataset pipeline (WP-306 — the deeper moat)

Opt-in capture (explicit flag, local-first default) of journals + verdicts + recovery paths + routing/cost patterns into a normalized dataset: how software agents actually fail and recover. Powers future judge tuning (ADR-002 option 3), safer resumption policies, smarter routing. Schema = journal interchange format; starts collecting from our own dogfood runs in P2 so P3 begins with data.
