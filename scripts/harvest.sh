#!/usr/bin/env bash
# Harvests a Chikory dogfood result onto the host repo (DOGFOODING.md §6).
#
# Usage:
#   devbox run harvest
#   devbox run -- bash scripts/harvest.sh [<run-id|chain-id>] [<branch-name>]
#
# A run contributes its final file versions relative to `chikory-base`. A
# successful linear chain contributes each child run's delta in dependency
# order: the terminal child's base already includes its predecessor, so using
# only the terminal diff would silently omit earlier nodes. Non-linear chain
# merge semantics are deliberately fail-closed pending WP-239.

set -euo pipefail

cd "$(dirname "$0")/.."

# ── 1. Locate the run or chain ───────────────────────────────────────
TARGET_ID="${1:-}"
if [ -z "$TARGET_ID" ]; then
  LATEST_DIR=$(ls -td .chikory/runs/run-* .chikory/runs/chain-* .chikory/chains/chain-* 2>/dev/null | head -n 1)
  [ -n "$LATEST_DIR" ] && [ -d "$LATEST_DIR" ] || {
    echo "Error: no run or chain artifact under .chikory/" >&2
    exit 1
  }
  TARGET_ID=$(basename "$LATEST_DIR")
fi

# A terminal child directory is commonly newer than its owning chain
# directory. Promote it back to the chain so bare `devbox run harvest` cannot
# accidentally harvest only the last node.
if [ ! -f ".chikory/chains/$TARGET_ID/chain.db" ] && [[ "$TARGET_ID" == chain-*-node-* ]]; then
  CANDIDATE_CHAIN_ID="${TARGET_ID%%-node-*}"
  if [ -f ".chikory/chains/$CANDIDATE_CHAIN_ID/chain.db" ]; then
    TARGET_ID="$CANDIDATE_CHAIN_ID"
  fi
fi

SOURCE_RUN_IDS=()
if [ -f ".chikory/chains/$TARGET_ID/chain.db" ]; then
  CHAIN_ID="$TARGET_ID"
  echo "Harvesting: chain-id $CHAIN_ID"
  if [ -n "${HARVEST_CHAIN_JSON:-}" ]; then
    CHAIN_JSON="$HARVEST_CHAIN_JSON"
  else
    CHAIN_JSON=$(node scripts/read-chain-record.mjs ".chikory/chains/$CHAIN_ID/chain.db" "$CHAIN_ID")
  fi
  SOURCE_RUNS_STR=$(node -e '
    const record = JSON.parse(process.argv[1]);
    if (record.status !== "SUCCESS") {
      throw new Error(`chain ${record.chainId ?? record.planId} is ${record.status}; only SUCCESS chains can be harvested`);
    }
    const nodes = record.plan.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const expected = i === 0 ? [] : [nodes[i - 1].id];
      if (JSON.stringify(nodes[i].dependsOn) !== JSON.stringify(expected)) {
        throw new Error("chain harvest v1 supports one linear dependency path only; fan-in/fan-out/independent merges require WP-239");
      }
      if (record.nodeOutcomes[nodes[i].id]?.status !== "SUCCESS") {
        throw new Error(`node ${nodes[i].id} is not SUCCESS`);
      }
      const runId = record.nodeRuns[nodes[i].id];
      if (!runId) throw new Error(`node ${nodes[i].id} has no child run id`);
      process.stdout.write(`${runId}\n`);
    }
  ' "$CHAIN_JSON") || {
    echo "Error: chain is not safely harvestable" >&2
    exit 1
  }
  while IFS= read -r child_run_id; do
    [ -n "$child_run_id" ] && SOURCE_RUN_IDS+=("$child_run_id")
  done <<< "$SOURCE_RUNS_STR"
  [ "${#SOURCE_RUN_IDS[@]}" -gt 0 ] || {
    echo "Error: chain has no child runs" >&2
    exit 1
  }
else
  RUN_ID="$TARGET_ID"
  [ -d ".chikory/runs/$RUN_ID" ] || {
    echo "Error: neither run nor chain found for '$TARGET_ID'" >&2
    exit 1
  }
  SOURCE_RUN_IDS+=("$RUN_ID")
  echo "Harvesting: run-id $RUN_ID"
fi

# ── 2. Target branch ──────────────────────────────────────────────
BRANCH_NAME="${2:-main}"
echo "Target branch: $BRANCH_NAME"
if git show-ref --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Checking out existing branch '$BRANCH_NAME'..."
  git checkout "$BRANCH_NAME"
else
  echo "Creating branch '$BRANCH_NAME'..."
  git checkout -b "$BRANCH_NAME"
fi

# ── 3. Apply each source run's delta in dependency order ──────────────────────
TOTAL_NEW=0; TOTAL_MOD=0; TOTAL_DEL=0; TOTAL_NOOP=0
for RUN_ID in "${SOURCE_RUN_IDS[@]}"; do
  RUN_DIR=".chikory/runs/$RUN_ID"
  ws="$RUN_DIR/workspace"
  [ -d "$ws" ] || { echo "Error: workspace not found at $ws" >&2; exit 1; }
  BASE=chikory-base
  if ! git -C "$ws" rev-parse --verify -q "$BASE" >/dev/null 2>&1; then
    echo "Error: '$BASE' ref absent in workspace $RUN_ID" >&2
    exit 1
  fi

  echo "Source run: $RUN_ID"
  echo "Commits since $BASE:"
  git -C "$ws" log --oneline "$BASE"..HEAD 2>/dev/null || echo "  (no history)"
  CHANGES_STR=$(git -C "$ws" diff --name-status "$BASE"..HEAD)
  if [ -z "$CHANGES_STR" ]; then
    echo "Error: no changes for source run $RUN_ID; refusing an incomplete harvest" >&2
    exit 1
  fi

  # Bash 3.2 compatible: no mapfile/associative arrays. Reconcile each source
  # immediately so later dependent nodes may safely update the same path.
  N_NEW=0; N_MOD=0; N_DEL=0; N_NOOP=0; N_WARN=0
  EXPECT_PRESENT=(); EXPECT_ABSENT=()
  echo "Applying changes:"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    st=${line%%$'\t'*}; rest=${line#*$'\t'}
    src=""; tgt="$rest"
    case "$st" in R*) src=${rest%%$'\t'*}; tgt=${rest#*$'\t'} ;; esac

    if [ "${st:0:1}" = "D" ]; then
      if [ -e "$tgt" ]; then
        echo "  del  $tgt"; rm -f "$tgt"; N_DEL=$((N_DEL+1))
      fi
      EXPECT_ABSENT+=("$tgt")
      continue
    fi

    if [ ! -f "$ws/$tgt" ]; then
      echo "  WARN $tgt — present in diff but missing in workspace; skipping" >&2
      N_WARN=$((N_WARN+1))
      continue
    fi
    if [ -f "$tgt" ] && cmp -s "$tgt" "$ws/$tgt"; then
      echo "  ok   $tgt (already current)"; N_NOOP=$((N_NOOP+1))
    elif [ -e "$tgt" ]; then
      echo "  mod  $tgt"; mkdir -p "$(dirname "$tgt")"; cp -p "$ws/$tgt" "$tgt"; N_MOD=$((N_MOD+1))
    else
      echo "  new  $tgt"; mkdir -p "$(dirname "$tgt")"; cp -p "$ws/$tgt" "$tgt"; N_NEW=$((N_NEW+1))
    fi
    EXPECT_PRESENT+=("$tgt")
    if [ -n "$src" ] && [ -e "$src" ]; then
      echo "  del  $src (rename source)"; rm -f "$src"; EXPECT_ABSENT+=("$src")
    fi
  done <<< "$CHANGES_STR"

  echo "Reconciling host against $RUN_ID..."
  FAILED=0
  for f in ${EXPECT_PRESENT[@]+"${EXPECT_PRESENT[@]}"}; do
    if ! { [ -f "$f" ] && cmp -s "$f" "$ws/$f"; }; then
      echo "  MISMATCH (not applied): $f" >&2; FAILED=$((FAILED+1))
    fi
  done
  for f in ${EXPECT_ABSENT[@]+"${EXPECT_ABSENT[@]}"}; do
    if [ -e "$f" ]; then
      echo "  STILL PRESENT (not deleted): $f" >&2; FAILED=$((FAILED+1))
    fi
  done

  echo "Summary: $N_NEW new · $N_MOD modified · $N_DEL deleted · $N_NOOP already-current · $N_WARN warning(s)."
  if [ "$FAILED" -ne 0 ] || [ "$N_WARN" -ne 0 ]; then
    echo "ERROR: harvest INCOMPLETE — $FAILED unreconciled, $N_WARN missing-in-workspace." >&2
    echo "Nothing was silently skipped; the files above need manual attention." >&2
    exit 1
  fi
  echo "Reconciliation OK for $RUN_ID."
  echo "Staging applied changes..."
  for f in ${EXPECT_PRESENT[@]+"${EXPECT_PRESENT[@]}"}; do git add "$f"; done
  for f in ${EXPECT_ABSENT[@]+"${EXPECT_ABSENT[@]}"}; do
    git rm --cached -rf "$f" >/dev/null 2>&1 || true
  done

  TOTAL_NEW=$((TOTAL_NEW+N_NEW)); TOTAL_MOD=$((TOTAL_MOD+N_MOD))
  TOTAL_DEL=$((TOTAL_DEL+N_DEL)); TOTAL_NOOP=$((TOTAL_NOOP+N_NOOP))
done
echo "Chain/run total: $TOTAL_NEW new · $TOTAL_MOD modified · $TOTAL_DEL deleted · $TOTAL_NOOP already-current."

# ── 4. Verify (build first — the CLI runs from dist/, dogfood-004 F-16) ───────────
echo "Running verification checks: build, lint, typecheck, test..."
devbox run build
devbox run lint
devbox run typecheck
devbox run test

# ── 5. Guidance ─────────────────────────────────────────────────
echo ""
echo "=========================================================="
echo "Harvest complete and reconciled for $TARGET_ID."
echo "Source runs: ${SOURCE_RUN_IDS[*]}"
echo "=========================================================="
echo "Next:"
echo "1. Review the applied diff:  git status && git diff"
echo "2. Commit:                   git commit -m \"feat(<scope>): <message>\""
echo "   (cite chain/run id: $TARGET_ID and the verification checks above)"
echo "3. Post-run review:          /dogfood-review $TARGET_ID"
echo "=========================================================="
