#!/usr/bin/env bash
# WP-301 benchmark harness entry point. Runs inside devbox only.
#
#   devbox run bench                          # no args: validate shipped corpora ($0 guard)
#   devbox run -- bash scripts/bench.sh <chikory-bench args...>
set -euo pipefail
cd "$(dirname "$0")/.."

# The chikory adapter spawns `chikory` from PATH; two bench dirs were burned on
# "chikory: command not found" before the operator learned the PATH incantation.
export PATH="$PWD/node_modules/.bin:$PATH"

# The chikory adapter runs the sdk's dist (node_modules/.bin/chikory ->
# packages/sdk-ts/dist/cli/bin.js); build BOTH so a bench run can never load a
# stale runner (the "is WP-nnn in the dist?" preflight class, dogfood-110/111).
pnpm --filter @chikory/sdk --silent build
pnpm --filter @chikory/benchmarks --silent build

if [ "$#" -eq 0 ]; then
  exec node benchmarks/harness/dist/bin.js validate benchmarks/devai/instances benchmarks/tasks
fi

# Orphaned-workflow guard (F-158): a killed bench run leaves its agentLoop
# workflow Running on the dev server's shared "chikory-runs" queue; the next
# bench launch spins a worker on that queue and silently RESUMES the orphan's
# token spend alongside the new run (3 run-ids in one dataDir, dogfood-110
# bf-002). Refuse to launch runs while orphans exist.
if [ "$1" = "run" ] && [ "${CHIKORY_BENCH_ALLOW_ORPHANS:-0}" != "1" ]; then
  orphans=$(temporal workflow list --address "${TEMPORAL_ADDRESS:-127.0.0.1:7233}" \
    --query "ExecutionStatus='Running'" -o json 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const w=JSON.parse(d);console.log(w.map(x=>x.execution.workflowId).join(' '))}catch{console.log('')}})" \
    || true)
  if [ -n "$orphans" ]; then
    echo "bench: REFUSING to launch — Running workflow(s) on the Temporal server would re-attach to the new worker and resume spending:" >&2
    for w in $orphans; do echo "  - $w   (terminate: temporal workflow terminate --workflow-id $w)" >&2; done
    echo "Override (you are sure they belong to a concurrent run you own): CHIKORY_BENCH_ALLOW_ORPHANS=1" >&2
    exit 2
  fi
fi

exec node benchmarks/harness/dist/bin.js "$@"
