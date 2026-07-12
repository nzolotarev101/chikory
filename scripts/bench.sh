#!/usr/bin/env bash
# WP-301 benchmark harness entry point. Runs inside devbox only.
#
#   devbox run bench                          # no args: validate shipped corpora ($0 guard)
#   devbox run -- bash scripts/bench.sh <chikory-bench args...>
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm --filter @chikory/benchmarks --silent build

if [ "$#" -eq 0 ]; then
  exec node benchmarks/harness/dist/bin.js validate benchmarks/devai/instances benchmarks/tasks
fi
exec node benchmarks/harness/dist/bin.js "$@"
