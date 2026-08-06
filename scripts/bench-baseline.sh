#!/usr/bin/env bash
# Raw Claude Code BASELINE arm — the honest-ablation row of benchmark.md.
#
#   devbox run bench-baseline
#   devbox run -- bash scripts/bench-baseline.sh --out benchmarks/results/p3-rung-4/raw-claude-code
#
# ⚠️  Claude here is the SYSTEM UNDER MEASUREMENT, not Chikory's executor.
# The standing directive (CLAUDE.md, F-162/F-165) — Gemini executes, Codex
# judges, never Claude — governs the `chikory` adapter, whose families
# `main.ts`'s preflight guards. This arm is the thing that adapter is being
# compared AGAINST: a bare agent CLI with no durable execution, no judge, no
# rotation. Measuring it requires running it. Do not "fix" this to gemini.
#
# Unlike `bench-run.sh` this starts NO services: the `command` adapter spawns a
# CLI directly and never routes through the judge proxy or Temporal.
#
# F-260: this arm used to live as a shell one-liner in an operator runbook, and
# it went stale against the installed CLI. `claude -p` / `--print` is a BOOLEAN
# flag, so the old `claude -p "$(cat {goalFile})" …` passed the goal as a
# positional the CLI never consumed — the agent got an empty prompt, every task
# no-op'd, and the arm burned a 3m41s null run that looked like a real result
# (`20260806-002019-command`). The prompt goes in on STDIN.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v claude >/dev/null 2>&1; then
  echo "bench-baseline: \`claude\` is not on PATH — this arm measures the Claude Code CLI" >&2
  exit 1
fi

# `{goalFile}` / `{taskId}` / `{workspace}` are expanded by `commandAdapter`, not
# by this shell — single quotes are load-bearing.
exec bash scripts/bench.sh run \
  --tasks benchmarks/tasks \
  --adapter command \
  --cmd 'cat {goalFile} | claude -p --permission-mode acceptEdits' \
  --filter brownfield \
  "$@"
