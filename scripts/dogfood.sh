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
#   CHIKORY_PREFLIGHT_ONLY=1 devbox run run-dogfood
#     — run every launch guard (spec lint, AC dry-run, spec-env contract, window
#       sizing) and exit WITHOUT launching. Zero LLM cost.
#
#   CHIKORY_CHAIN_RESUME_DRILL=1 CHIKORY_SEED_CHAIN_FAIL_NODE=<n> devbox run chain-dogfood
#     — WP-532 / P3-rung-2 two-phase operator-resume drill: phase 1 seals the chain
#       FAILED (heal-by-default OFF), phase 2 `chikory chain resume` recovers it to
#       SUCCESS. --chain only; requires the force-fail seam armed.
#
# Launch guards (all before any build/spend; each has a deliberate override env):
#   exit 3 — WP-266/WP-267 AC hazard (static lint or dynamic dry-run: broken check,
#            file-pin, bare-word negative grep, or no RED-on-HEAD challenge AC)
#   exit 4 — F-121 spec-named env unset, F-120 window sized at executor scale, or
#            F-146/WP-531 a --chain self-heal spec launched with the force-fail seam
#            CHIKORY_SEED_CHAIN_FAIL_NODE unarmed (override CHIKORY_ALLOW_UNARMED_HEAL=1)
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
  # `*` after the run number: specs may carry a descriptive suffix
  # (dogfood-084-wp214-….yaml). The old 3-digit-exact glob silently fell back
  # to the previous bare-named spec and re-ran closed dogfood-083
  # (run-0a285f5b, $3.02). `sort` keeps numeric order since the prefix is
  # zero-padded; a suffixed name sorts after its bare same-number sibling.
  SPEC_FILE=$(ls examples/dogfood/dogfood-[0-9][0-9][0-9]*.yaml 2>/dev/null | sort | tail -n 1)
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

# 1b. Progression preflight (course correction 2026-07-02).
# The progression/format REPORT is advisory (STALLED / off-format surface the
# loop state so the operator sees it before spending; the BINDING progression
# enforcement lives in /dogfood-review phase 5 and /dogfood-assessor).
# BUT the WP-266 loose-AC lint is a HARD REFUSAL (WP-267, F-84): an AC that
# grep-pins a delegated file (F-82) or negative-greps a bare word that also
# matches comments/prose (F-83) is GUARANTEED to false-FAIL a correct delivery
# and burn budget on the phantom (dogfood-075 AND 076 both died this way — the
# lint existed but nothing enforced it). Exit code 3 from the --spec run is
# exactly that hazard; refuse the launch at ZERO LLM cost. Override for a
# deliberate exception: CHIKORY_ALLOW_LOOSE_AC_HAZARD=1.
if [ -f scripts/dogfood-progression.sh ]; then
  set +e
  bash scripts/dogfood-progression.sh --spec "$SPEC_FILE" --preflight
  PROGRESSION_RC=$?
  set -e
  echo
  if [ "$PROGRESSION_RC" -eq 3 ]; then
    if [ "${CHIKORY_ALLOW_LOOSE_AC_HAZARD:-}" = "1" ]; then
      echo "⚠️  WP-266 loose-AC lint ⛔ — OVERRIDDEN by CHIKORY_ALLOW_LOOSE_AC_HAZARD=1. Launching anyway." >&2
    else
      echo "⛔ REFUSING LAUNCH (WP-267): the spec's ACs would false-FAIL a correct delivery or" >&2
      echo "   enforce no challenge at all (WP-266 lint + dry-run above). Fix the AC to grep an" >&2
      echo "   OUTCOME symbol as it appears in CODE — never \`test -f <new-file>\`, never a" >&2
      echo "   bare-word negative grep, never a check that ERRORS instead of failing cleanly," >&2
      echo "   and at least one AC must be RED on HEAD. Then relaunch." >&2
      echo "   Deliberate override: CHIKORY_ALLOW_LOOSE_AC_HAZARD=1 devbox run run-dogfood" >&2
      exit 3
    fi
  fi
fi

# 1c. Spec-referenced env contract (F-121, dogfood-091). run-7fca16bc's journal proves the
# armed `CHIKORY_CONTEXT_WINDOW_TOKENS` seam NEVER reached the workflow (`runs.task_json`
# carries no `debug` key; the pacing denominator was the 400k model default, not the
# "armed" 1.2M) — the run's entire challenge silently no-op'd and NOTHING surfaced it.
# Any CHIKORY_* env the spec text names is therefore a LAUNCH CONTRACT: every one must be
# exported in the launching shell or the launch is refused at zero LLM cost.
# Deliberate exception: CHIKORY_ALLOW_MISSING_ENV=1.
LAUNCHER_INTERNAL_ENVS='^CHIKORY_(ALLOW_LOOSE_AC_HAZARD|ALLOW_MISSING_ENV|ALLOW_UNARMED_HEAL|ALLOW_WINDOW_SIZE|PREFLIGHT_ONLY|CHAIN_MAX_REPLANS)$'
SPEC_ENVS=$(grep -oE 'CHIKORY_[A-Z0-9_]+' "$SPEC_FILE" | sort -u | grep -vE "$LAUNCHER_INTERNAL_ENVS" || true)
MISSING_ENVS=""
for VAR in $SPEC_ENVS; do
  if [ -z "${!VAR:-}" ]; then
    MISSING_ENVS="$MISSING_ENVS $VAR"
  else
    echo "Setup: spec env armed: $VAR=${!VAR}"
  fi
done
if [ -n "$MISSING_ENVS" ]; then
  if [ "${CHIKORY_ALLOW_MISSING_ENV:-}" = "1" ]; then
    echo "⚠️  Spec names unset env(s):$MISSING_ENVS — OVERRIDDEN by CHIKORY_ALLOW_MISSING_ENV=1." >&2
  else
    echo "⛔ REFUSING LAUNCH (F-121): the spec names env var(s) that are NOT set in this shell:" >&2
    echo "  $MISSING_ENVS" >&2
    echo "   An env-armed challenge seam that is not exported silently NO-OPs (dogfood-091: the" >&2
    echo "   window seam never reached the workflow, the run never folded, nothing warned)." >&2
    echo "   Export the var(s) per the spec's launch note, then relaunch." >&2
    echo "   Deliberate override: CHIKORY_ALLOW_MISSING_ENV=1 devbox run run-dogfood" >&2
    exit 4
  fi
fi

# 1d. F-120 window-sizing sanity (dogfood-091). The pacing window compares Chikory's OWN
# ASSEMBLED-CONTEXT tokens (projected ≈2.1k–3.0k on run-7fca16bc) against
# `contextWindowTokens * 0.8` — NOT the executor's internal 400k–900k token burn. A
# window at executor scale can NEVER fold (091 undershot: 3k/1.2M ≈ 0.25%).
if [ -n "${CHIKORY_CONTEXT_WINDOW_TOKENS:-}" ]; then
  W="$CHIKORY_CONTEXT_WINDOW_TOKENS"
  case "$W" in
    ''|*[!0-9]*)
      echo "⛔ REFUSING LAUNCH: CHIKORY_CONTEXT_WINDOW_TOKENS='$W' is not a positive integer." >&2
      exit 4
      ;;
  esac
  echo "Setup: context-window seam: window=$W tokens → COMPACTS when projected > $((W * 8 / 10)), PARKS when one step's estimate > $W"
  echo "       (denominator = Chikory's assembled-context tokens, single-digit-k in practice — F-120)."
  if [ "$W" -ge 20000 ]; then
    if [ "${CHIKORY_ALLOW_WINDOW_SIZE:-}" = "1" ]; then
      echo "⚠️  Window $W ≥ 20000 (executor-scale) — OVERRIDDEN by CHIKORY_ALLOW_WINDOW_SIZE=1." >&2
    else
      echo "⛔ REFUSING LAUNCH (F-120): CHIKORY_CONTEXT_WINDOW_TOKENS=$W is sized at EXECUTOR scale." >&2
      echo "   The pacing denominator is Chikory's ASSEMBLED-CONTEXT token count (~2.1k–3.0k" >&2
      echo "   observed), so a $W-token window never approaches the compact threshold and the" >&2
      echo "   run cannot fold. Size it a bit above observed-projected × 0.8 (e.g. 2000)." >&2
      echo "   Deliberate override: CHIKORY_ALLOW_WINDOW_SIZE=1 devbox run run-dogfood" >&2
      exit 4
    fi
  fi
fi

# 1d-bis. WP-531 / F-146: a CHAIN spec that tests self-heal — it names the force-fail
# seam CHIKORY_SEED_CHAIN_FAIL_NODE or reads the `node_replanned` recovery journal —
# MUST have the seam armed, or NO node fails, the default halt-and-replan never fires,
# and the chain seals SUCCESS while proving NOTHING on its recovery KPI (dogfood-104:
# a $5.51 / 56m chain sealed SUCCESS with 0 `node_replanned` because the seam was unset).
# This is a DISTINCT guard with its OWN override on purpose: dogfood-104 slipped because
# the spec's header names PROSE-only precedent seams (CHIKORY_SEED_BAD_DIFF_*,
# CHIKORY_LIMIT_AT_STEP) that F-121 (1c) demands be set, so the operator reached for the
# blanket CHIKORY_ALLOW_MISSING_ENV=1 — which ALSO un-armed the one real seam. The coarse
# missing-env override must NOT be able to silence this. Deliberate exception (e.g. a
# green-path chain that only BUILDS recovery code): CHIKORY_ALLOW_UNARMED_HEAL=1.
if [ "$MODE" = "chain" ] && grep -qE 'CHIKORY_SEED_CHAIN_FAIL_NODE|node_replanned' "$SPEC_FILE"; then
  if [ -z "${CHIKORY_SEED_CHAIN_FAIL_NODE:-}" ]; then
    if [ "${CHIKORY_ALLOW_UNARMED_HEAL:-}" = "1" ]; then
      echo "⚠️  Chain self-heal spec launched with CHIKORY_SEED_CHAIN_FAIL_NODE UNARMED — OVERRIDDEN by CHIKORY_ALLOW_UNARMED_HEAL=1." >&2
    else
      echo "⛔ REFUSING LAUNCH (F-146/WP-531): this is a CHAIN self-heal spec (it names the" >&2
      echo "   CHIKORY_SEED_CHAIN_FAIL_NODE force-fail seam or the node_replanned recovery" >&2
      echo "   journal), but the seam is NOT set in this shell. Without it NO node fails, the" >&2
      echo "   default halt-and-replan never fires, and the chain seals SUCCESS while proving" >&2
      echo "   NOTHING on its recovery KPI (dogfood-104: \$5.51 / 56m, 0 node_replanned)." >&2
      echo "   Arm it to the node id the planner will force-fail, e.g.:" >&2
      echo "     CHIKORY_SEED_CHAIN_FAIL_NODE=B devbox run chain-dogfood" >&2
      echo "   Deliberate override (a green-path chain that only BUILDS recovery code):" >&2
      echo "     CHIKORY_ALLOW_UNARMED_HEAL=1 devbox run chain-dogfood" >&2
      exit 4
    fi
  else
    echo "Setup: heal seam armed: CHIKORY_SEED_CHAIN_FAIL_NODE=$CHIKORY_SEED_CHAIN_FAIL_NODE (chain self-heal will be exercised)."
  fi
fi

# 1d-ter. WP-532 / P3-rung-2: the two-phase operator-resume drill (CHIKORY_CHAIN_RESUME_DRILL=1)
# validates its own preconditions at ZERO cost, alongside the other guards, so a mis-launched
# drill is refused before any build/spend (and CHIKORY_PREFLIGHT_ONLY=1 exercises it too):
#   - it is --chain only (phase 2 issues `chikory chain resume`, meaningless for a single run);
#   - the force-fail seam MUST be armed so phase 1 can seal FAILED — the whole point is to reach
#     a sealed-FAILED chain and then resume it (1d-bis already enforces this for a self-heal spec,
#     but the drill re-asserts it so a non-self-heal spec launched as a drill still refuses here).
if [ "${CHIKORY_CHAIN_RESUME_DRILL:-}" = "1" ]; then
  if [ "$MODE" != "chain" ]; then
    echo "⛔ REFUSING LAUNCH (WP-532): CHIKORY_CHAIN_RESUME_DRILL=1 requires --chain" >&2
    echo "   (devbox run chain-dogfood). Phase 2 issues \`chikory chain resume\`." >&2
    exit 4
  fi
  if [ -z "${CHIKORY_SEED_CHAIN_FAIL_NODE:-}" ]; then
    echo "⛔ REFUSING LAUNCH (WP-532): the resume drill needs the force-fail seam armed" >&2
    echo "   (CHIKORY_SEED_CHAIN_FAIL_NODE=<node-id|dispatch-index>) so phase 1 seals FAILED." >&2
    echo "   Arm it, e.g.: CHIKORY_SEED_CHAIN_FAIL_NODE=1 CHIKORY_CHAIN_RESUME_DRILL=1 devbox run chain-dogfood" >&2
    exit 4
  fi
  echo "Setup: WP-532 resume drill ARMED — phase 1 seals FAILED (maxReplans 0), phase 2 chikory chain resume."
fi

# 1e. Preflight-only mode: run every launch guard above, then stop WITHOUT building,
# starting Temporal/proxy, or spending a cent. The one-command answer to "is the next
# run's hypothesis + challenge actually armed?":
#   CHIKORY_PREFLIGHT_ONLY=1 [spec envs...] devbox run run-dogfood
if [ "${CHIKORY_PREFLIGHT_ONLY:-}" = "1" ]; then
  echo
  echo "✅ Preflight OK (CHIKORY_PREFLIGHT_ONLY=1) — spec lint, AC dry-run, env contract, and"
  echo "   window sizing all pass. Not launching."
  exit 0
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
  # Directive: Codex judges (Gemini executes). Default the judge backend to
  # codex when the spec does not pin a judge model family.
  BACKEND="codex" # default fallback
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

# WP-532 / P3-rung-2: two-phase operator-resume drill (the WP-531 analog — the chain
# self-heal ladder's harness sibling). `chikory chain resume` (WP-521c substrate) is
# committed but never yet exercised on a REAL dogfood chain. This mode does it in one
# launch, deterministically:
#   Phase 1 — launch the chain with heal-by-default OFF (CHIKORY_CHAIN_MAX_REPLANS=0)
#             while the force-fail seam is armed → a node fails, nothing auto-heals,
#             the chain seals FAILED (resumable). The 1d-bis guard already enforces the
#             seam is armed, so an unarmed drill can't reach here.
#   Phase 2 — `chikory chain resume <chain-id>` re-enters the sealed-FAILED chain; the
#             failed node gets one fresh heal attempt and the chain recovers to SUCCESS.
# Records the chain-scope kill→resume KPI (§1.4) on a live dogfood chain. --chain only.
if [ "${CHIKORY_CHAIN_RESUME_DRILL:-}" = "1" ]; then
  # Preconditions (--chain, seam armed) were enforced at $0 in guard 1d-ter.
  PHASE1_LOG="$(mktemp)"
  echo "=== WP-532 resume drill — PHASE 1: sealing the chain FAILED (heal-by-default OFF) ==="
  echo "Running: CHIKORY_CHAIN_MAX_REPLANS=0 pnpm chikory chain $SPEC_FILE --watch"
  set +e
  CHIKORY_CHAIN_MAX_REPLANS=0 pnpm chikory chain "$SPEC_FILE" --watch 2>&1 | tee "$PHASE1_LOG"
  PHASE1_RC=${PIPESTATUS[0]}
  set -e

  CHAIN_ID=$(grep -oE 'chain-id: [A-Za-z0-9-]+' "$PHASE1_LOG" | head -n 1 | awk '{print $2}')
  rm -f "$PHASE1_LOG"
  if [ -z "$CHAIN_ID" ]; then
    echo "Error: WP-532 drill could not read the chain-id from phase 1 output." >&2
    exit 1
  fi
  if [ "$PHASE1_RC" -eq 0 ]; then
    echo "Error: WP-532 drill phase 1 sealed SUCCESS (exit 0) — nothing to resume." >&2
    echo "       The chain must seal FAILED: check the force-fail seam actually fired on a node." >&2
    exit 1
  fi
  echo
  echo "=== WP-532 resume drill — PHASE 2: chikory chain resume $CHAIN_ID ==="
  pnpm chikory chain resume "$CHAIN_ID" --watch
  exit $?
fi

echo "Running Chikory dogfooding command: pnpm chikory $MODE ..."
pnpm chikory "$MODE" "$SPEC_FILE" --watch
