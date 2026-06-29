#!/usr/bin/env bash
# Orchestrates a dogfooding run for Chikory.
# It handles the setup (building the SDK, starting Temporal dev server,
# and starting the local OpenAI-compat judge proxy) and then executes the spec.
#
# Usage:
#   devbox run dogfood [<spec-path>]
#   (defaults to the latest created spec in examples/dogfood/)

set -euo pipefail

# Make sure we run from the repo root
cd "$(dirname "$0")/.."
mkdir -p .chikory

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

CHIKORY_CMD="run"
if grep -q "chikory chain" "$SPEC_FILE"; then
  CHIKORY_CMD="chain"
fi

echo "Running Chikory dogfooding command: pnpm chikory $CHIKORY_CMD ..."
pnpm chikory "$CHIKORY_CMD" "$SPEC_FILE" --watch
