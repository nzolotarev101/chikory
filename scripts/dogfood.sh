#!/usr/bin/env bash
# Orchestrates a dogfooding run for Chikory.
# It handles the setup (building the SDK, starting Temporal dev server,
# and starting the local OpenAI-compat judge proxy) and then executes the spec.
#
# Usage:
#   devbox run run-dogfood     — launch the latest spec as a single `chikory run`
#   devbox run chain-dogfood   — launch the latest spec as a durable `chikory chain`
#   bash scripts/dogfood.sh --run|--chain [<spec-path>]
#   (spec defaults to the latest created spec in examples/dogfood/)
#
# The LAUNCH MODE is now EXPLICIT (--run / --chain), chosen by the operator.
# The old auto-detection (grep the spec for "chikory chain") was BROKEN: every
# single-run spec's header warns "NOT `chikory chain`", so the grep matched the
# warning and chained the run — the F-72/F-74 5-run mis-launch bleed
# (dogfood-067/068/069/070/071). Picking the mode by hand removes the heuristic.

set -euo pipefail

# Make sure we run from the repo root
cd "$(dirname "$0")/.."
mkdir -p .chikory

# 0. Parse the explicit launch mode (authoritative — no heuristic).
MODE=""
case "${1:-}" in
  --run) MODE="run"; shift ;;
  --chain) MODE="chain"; shift ;;
esac
if [ -z "$MODE" ]; then
  echo "Error: launch mode required. Use 'devbox run run-dogfood' (single \`chikory run\`)" >&2
  echo "       or 'devbox run chain-dogfood' (durable \`chikory chain\`)." >&2
  echo "       (direct: bash scripts/dogfood.sh --run|--chain [<spec-path>])" >&2
  exit 1
fi

# 1. Identify the spec file
SPEC_FILE="${1:-}"
if [ -z "$SPEC_FILE" ]; then
  SPEC_FILE=$(ls examples/dogfood/dogfood-[0-9][0-9][0-9].yaml 2>/dev/null | sort | tail -n 1)
  if [ -z "$SPEC_FILE" ]; then
    echo "Error: No dogfood spec file found in examples/dogfood/" >&2
    exit 1
  fi
fi

if [ ! -f "$SPEC_FILE" ]; then
  echo "Error: Spec file not found at $SPEC_FILE" >&2
  exit 1
fi

echo "Dogfooding: Using spec file $SPEC_FILE"

# 1b. Progression preflight (course correction 2026-07-02 — advisory, never
# blocks: the BINDING enforcement lives in /dogfood-review phase 5 and
# /dogfood-assessor; this surfaces a STALLED loop / off-format spec at launch
# time so the operator sees it before spending).
if [ -f scripts/dogfood-progression.sh ]; then
  bash scripts/dogfood-progression.sh --spec "$SPEC_FILE" || true
  echo
fi

# 2. Rebuild the SDK (stale dist can run old code)
echo "Setup: Rebuilding Chikory SDK..."
pnpm -r build

# 3. Check/Start Temporal Dev Server
ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
PORT="${ADDRESS##*:}"
TEMPORAL_STARTED=false
TEMPORAL_PID=""

if temporal operator cluster health --address "$ADDRESS" >/dev/null 2>&1; then
  echo "Setup: Temporal server is already running at $ADDRESS"
else
  echo "Setup: Starting ephemeral Temporal dev server on port $PORT..."
  temporal server start-dev --headless --port "$PORT" --log-level error >.chikory/temporal.log 2>&1 &
  TEMPORAL_PID=$!
  TEMPORAL_STARTED=true

  # Wait for Temporal to start up
  for i in $(seq 1 30); do
    if temporal operator cluster health --address "$ADDRESS" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$TEMPORAL_PID" 2>/dev/null; then
      echo "Error: Temporal dev server exited early" >&2
      exit 1
    fi
    sleep 1
  done
fi

# 4. Check/Start CLI Judge Proxy
PROXY_PORT=8787
PROXY_STARTED=false
PROXY_PID=""

# Determine backend from the spec file. Gemini-family judge models now route
# through the Antigravity CLI (`agy`) — Google retired the standalone `gemini`
# CLI's free OAuth.
if grep -q "model:.*gemini" "$SPEC_FILE"; then
  BACKEND="agy"
elif grep -q "model:.*gpt" "$SPEC_FILE" || grep -q "model:.*codex" "$SPEC_FILE"; then
  BACKEND="codex"
else
  BACKEND="agy" # default fallback
fi

# Use node to check if the port is already in use
PROXY_HEALTHY=false
if node -e "require('net').connect($PROXY_PORT, '127.0.0.1').on('error', () => process.exit(1)).on('connect', () => process.exit(0))" 2>/dev/null; then
  echo "Setup: Proxy port $PROXY_PORT is in use. Probing health..."
  if curl -s -o /dev/null --connect-timeout 2 --max-time 3 http://127.0.0.1:$PROXY_PORT; then
    echo "Setup: Proxy is responding and healthy."
    PROXY_HEALTHY=true
  else
    echo "Setup: Proxy is non-responsive. Clearing port $PROXY_PORT..."
    PID_TO_KILL=$(lsof -t -i :$PROXY_PORT || true)
    if [ -n "$PID_TO_KILL" ]; then
      echo "Setup: Killing stale process(es) on port $PROXY_PORT (PIDs: $PID_TO_KILL)"
      kill -9 $PID_TO_KILL 2>/dev/null || true
      sleep 1
    fi
  fi
fi

if [ "$PROXY_HEALTHY" = "false" ]; then
  echo "Setup: Starting cli-judge-proxy on port $PROXY_PORT with backend '$BACKEND'..."
  node scripts/cli-judge-proxy.mjs "$PROXY_PORT" "$BACKEND" >.chikory/cli-judge-proxy.log 2>&1 &
  PROXY_PID=$!
  PROXY_STARTED=true

  # Wait for proxy to start up
  for i in $(seq 1 10); do
    if curl -s -o /dev/null --connect-timeout 1 http://127.0.0.1:$PROXY_PORT; then
      break
    fi
    sleep 0.5
  done
fi

# Setup cleanup traps
cleanup() {
  echo "Cleaning up background services..."
  if [ "$PROXY_STARTED" = "true" ] && [ -n "$PROXY_PID" ]; then
    echo "Stopping cli-judge-proxy (PID: $PROXY_PID)..."
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  if [ "$TEMPORAL_STARTED" = "true" ] && [ -n "$TEMPORAL_PID" ]; then
    echo "Stopping Temporal dev server (PID: $TEMPORAL_PID)..."
    kill "$TEMPORAL_PID" 2>/dev/null || true
    wait "$TEMPORAL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT SIGINT SIGTERM

# 5. Run the dogfood spec
export OPENAI_COMPAT_BASE_URL="http://127.0.0.1:$PROXY_PORT"

echo "Running Chikory dogfooding command: pnpm chikory $MODE ..."
pnpm chikory "$MODE" "$SPEC_FILE" --watch
