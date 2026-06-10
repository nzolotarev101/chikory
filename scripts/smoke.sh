#!/usr/bin/env bash
# WP-004 smoke: boot an ephemeral Temporal dev server, run the hello-world
# workflow in packages/smoke, and tear the server down. Run via `devbox run smoke`.
set -euo pipefail

cd "$(dirname "$0")/.."

ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
PORT="${ADDRESS##*:}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "smoke: starting ephemeral Temporal dev server on port ${PORT}…"
temporal server start-dev --headless --port "$PORT" --log-level error &
SERVER_PID=$!

for i in $(seq 1 60); do
  if temporal operator cluster health --address "$ADDRESS" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "smoke: Temporal dev server exited early" >&2
    exit 1
  fi
  sleep 1
done

temporal operator cluster health --address "$ADDRESS" >/dev/null

echo "smoke: server up, running hello-world workflow…"
pnpm --filter @chikory/smoke run smoke
