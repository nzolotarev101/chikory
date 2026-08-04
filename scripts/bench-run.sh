#!/usr/bin/env bash
# One-stop bench launcher. Brings up the two services a `chikory` benchmark arm
# needs — a Temporal dev server (durable execution) and the keyless codex judge
# proxy — then runs the suite with the directive-compliant arm: **Gemini
# executes, Codex judges, never Claude** (CLAUDE.md / F-162/F-165).
#
# `scripts/bench.sh` deliberately does NOT start these (unlike dogfood.sh), so
# chaining the raw `devbox run temporal-dev` / `judge-proxy` / `bench` scripts by
# hand can't work: each service script blocks in the foreground, and
# backgrounding them races Devbox 0.17.0's concurrent-`devbox run` startup. This
# script runs everything inside ONE process instead.
#
#   devbox run bench-run                         # runnable brownfield corpus (default)
#   devbox run -- bash scripts/bench-run.sh --filter brownfield-003
#   devbox run -- bash scripts/bench-run.sh --tasks benchmarks/tasks --suite my-suite
#
# Any args are forwarded verbatim to `chikory-bench run` AFTER the defaults, so
# the last --flag wins (e.g. pass --filter to override the default). Only the
# services THIS script starts are torn down on exit; a pre-existing Temporal
# server or proxy is left running.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .chikory

ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
PORT="${ADDRESS##*:}"
PROXY_PORT="${CHIKORY_JUDGE_PROXY_PORT:-8787}"
# Directive: Codex judges. The bench arm has no spec file to sniff a backend
# from, so the judge backend is fixed to codex (keyless ChatGPT OAuth, GPT-5).
BACKEND=codex

TEMPORAL_STARTED=false
TEMPORAL_PID=""
PROXY_STARTED=false
PROXY_PID=""

cleanup() {
  if [ "$PROXY_STARTED" = "true" ] && [ -n "$PROXY_PID" ]; then
    echo "bench-run: stopping cli-judge-proxy (PID $PROXY_PID)"
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  if [ "$TEMPORAL_STARTED" = "true" ] && [ -n "$TEMPORAL_PID" ]; then
    echo "bench-run: stopping Temporal dev server (PID $TEMPORAL_PID)"
    kill "$TEMPORAL_PID" 2>/dev/null || true
    wait "$TEMPORAL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT SIGINT SIGTERM

# 1. Temporal dev server — reuse a healthy one, else start an ephemeral one.
if temporal operator cluster health --address "$ADDRESS" >/dev/null 2>&1; then
  echo "bench-run: Temporal already running at $ADDRESS"
else
  echo "bench-run: starting ephemeral Temporal dev server on port $PORT..."
  temporal server start-dev --headless --port "$PORT" --log-level error >.chikory/temporal.log 2>&1 &
  TEMPORAL_PID=$!
  TEMPORAL_STARTED=true
  for _ in $(seq 1 30); do
    if temporal operator cluster health --address "$ADDRESS" >/dev/null 2>&1; then break; fi
    if ! kill -0 "$TEMPORAL_PID" 2>/dev/null; then
      echo "bench-run: Temporal dev server exited early (see .chikory/temporal.log)" >&2
      exit 1
    fi
    sleep 1
  done
fi

# 2. Codex judge proxy — reuse a healthy one on PROXY_PORT, else start it.
if curl -s -o /dev/null --connect-timeout 2 --max-time 3 "http://127.0.0.1:$PROXY_PORT"; then
  echo "bench-run: reusing healthy judge proxy on port $PROXY_PORT"
else
  # Clear a dead listener squatting the port, if any.
  PID_TO_KILL=$(lsof -t -i ":$PROXY_PORT" 2>/dev/null || true)
  if [ -n "$PID_TO_KILL" ]; then
    echo "bench-run: clearing stale process(es) on port $PROXY_PORT (PIDs: $PID_TO_KILL)"
    kill -9 $PID_TO_KILL 2>/dev/null || true
    sleep 1
  fi
  echo "bench-run: starting cli-judge-proxy on port $PROXY_PORT with backend '$BACKEND'..."
  node scripts/cli-judge-proxy.mjs "$PROXY_PORT" "$BACKEND" >.chikory/cli-judge-proxy.log 2>&1 &
  PROXY_PID=$!
  PROXY_STARTED=true
  PROXY_UP=false
  for _ in $(seq 1 20); do
    if curl -s -o /dev/null --connect-timeout 1 "http://127.0.0.1:$PROXY_PORT"; then PROXY_UP=true; break; fi
    if ! kill -0 "$PROXY_PID" 2>/dev/null; then
      echo "bench-run: judge proxy exited early (see .chikory/cli-judge-proxy.log — is codex logged in?)" >&2
      exit 1
    fi
    sleep 0.5
  done
  if [ "$PROXY_UP" != "true" ]; then
    echo "bench-run: judge proxy never became healthy on port $PROXY_PORT (see .chikory/cli-judge-proxy.log)" >&2
    exit 1
  fi
fi

# 3. Route the judge/plan/review stages through the codex proxy. The gemini-cli
# executor runs the code stage directly, so execution stays on Gemini.
export OPENAI_COMPAT_BASE_URL="http://127.0.0.1:$PROXY_PORT"

# 4. Run the suite. Defaults target the runnable brownfield corpus with the
# gemini executor; forwarded args come AFTER so a passed --flag overrides.
# `--agent-classes` (F-253/WP-585) is what lets a quota wall rotate to a peer
# instead of parking — p3-rung-4 ran without it and parked on all 5 walls. It
# points at the BENCH class file, not the root `agent-classes.yaml`: the root one
# lists Claude fallbacks, and rotating an arm onto Claude both violates the
# directive and publishes an I-SR measured on a mixed executor (the preflight
# refuses it). Probe every member at $0 first:
#   devbox run -- node scripts/probe-agent-classes.mjs benchmarks/agent-classes.bench.yaml
echo "bench-run: launching bench (executor gemini · judge codex via $OPENAI_COMPAT_BASE_URL)"
exec bash scripts/bench.sh run \
  --tasks benchmarks/tasks \
  --adapter chikory \
  --executor gemini \
  --agent-classes benchmarks/agent-classes.bench.yaml \
  --filter brownfield \
  "$@"
