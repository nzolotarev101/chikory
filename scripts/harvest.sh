#!/usr/bin/env bash
# Harvests the result of a Chikory dogfooding run onto the host repo.
# Following docs/DOGFOODING.md §6.
#
# Usage:
#   devbox run harvest [<run-id>] [<branch-name>]
#
# Apply model (F-20 fix): every file the run changed is made to match the run
# workspace's FINAL version (cp for add/modify/rename-dest, rm for delete).
# No `git apply` patch-context fragility, and no per-file "differs → skip"
# heuristic — that silently dropped MODIFIED files in non-interactive harvests
# (the host's pre-run version always differs from the run's final version, so
# the old cmp check mis-classified every real edit as a conflict and skipped
# it). After applying, a RECONCILIATION pass asserts the host matches the
# workspace for every changed file; any mismatch is a hard error (exit 1) —
# the script can no longer claim success while having applied nothing.

set -euo pipefail

cd "$(dirname "$0")/.."

# ── 1. Locate the run ───────────────────────────────────────────────────────
RUN_ID="${1:-}"
if [ -z "$RUN_ID" ]; then
  LATEST_DIR=$(ls -td .chikory/runs/run-* .chikory/runs/chain-* 2>/dev/null | head -n 1)
  [ -n "$LATEST_DIR" ] && [ -d "$LATEST_DIR" ] || { echo "Error: no run dir in .chikory/runs/" >&2; exit 1; }
  RUN_ID=$(basename "$LATEST_DIR")
fi
RUN_DIR=".chikory/runs/$RUN_ID"
[ -d "$RUN_DIR" ] || { echo "Error: run dir not found at $RUN_DIR" >&2; exit 1; }
ws="$RUN_DIR/workspace"
[ -d "$ws" ] || { echo "Error: workspace not found at $ws" >&2; exit 1; }
echo "Harvesting: run-id $RUN_ID"

# ── 2. Target branch ────────────────────────────────────────────────────────
BRANCH_NAME="${2:-main}"
if [ -z "$BRANCH_NAME" ]; then
  SPEC_FILE=$(ls examples/dogfood/dogfood-[0-9][0-9][0-9].yaml 2>/dev/null | sort | tail -n 1)
  if [ -n "$SPEC_FILE" ] && [ -f "$SPEC_FILE" ]; then
    SPEC_NAME=$(grep -E "^name:" "$SPEC_FILE" | head -n 1 | sed 's/name:[[:space:]]*//' | tr -d '"'\''')
    BRANCH_NAME=$(echo "$SPEC_NAME" | sed -E 's/^dogfood-[0-9]{3}-//')
  fi
  [ -n "$BRANCH_NAME" ] || BRANCH_NAME="harvest-$RUN_ID"
fi
echo "Target branch: $BRANCH_NAME"

# ── 3. Determine the run's base and changed files ───────────────────────────
BASE=chikory-base
if ! git -C "$ws" rev-parse --verify -q chikory-base >/dev/null 2>&1; then
  echo "Warning: 'chikory-base' ref absent in workspace; diffing against 'main'."
  BASE=main
fi

echo "Commits in the run workspace since $BASE:"
git -C "$ws" log --oneline "$BASE"..HEAD 2>/dev/null || echo "  (no history)"

if git show-ref --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Checking out existing branch '$BRANCH_NAME'..."; git checkout "$BRANCH_NAME"
else
  echo "Creating branch '$BRANCH_NAME'..."; git checkout -b "$BRANCH_NAME"
fi

# bash 3.2 compatible (macOS default) — no `mapfile`. Here-string keeps the
# loop in the current shell so the EXPECT_* arrays persist.
CHANGES_STR=$(git -C "$ws" diff --name-status "$BASE"..HEAD)
if [ -z "$CHANGES_STR" ]; then
  echo "No changes between the run workspace and $BASE. Nothing to harvest."
else
  # ── 3a. Apply: host's changed files := workspace final version ────────────
  N_NEW=0; N_MOD=0; N_DEL=0; N_NOOP=0; N_WARN=0
  EXPECT_PRESENT=(); EXPECT_ABSENT=()
  echo "Applying changes:"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    st=${line%%$'\t'*}; rest=${line#*$'\t'}
    src=""; tgt="$rest"
    case "$st" in R*) src=${rest%%$'\t'*}; tgt=${rest#*$'\t'} ;; esac

    if [ "${st:0:1}" = "D" ]; then
      if [ -e "$tgt" ]; then echo "  del  $tgt"; rm -f "$tgt"; N_DEL=$((N_DEL+1)); fi
      EXPECT_ABSENT+=("$tgt"); continue
    fi

    if [ ! -f "$ws/$tgt" ]; then
      echo "  WARN $tgt — present in diff but missing in workspace; skipping" >&2
      N_WARN=$((N_WARN+1)); continue
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

  # ── 3b. Reconciliation — makes silent drops structurally impossible ───────
  echo "Reconciling host against workspace..."
  FAILED=0
  for f in ${EXPECT_PRESENT[@]+"${EXPECT_PRESENT[@]}"}; do
    if ! { [ -f "$f" ] && cmp -s "$f" "$ws/$f"; }; then
      echo "  MISMATCH (not applied): $f" >&2; FAILED=$((FAILED+1))
    fi
  done
  for f in ${EXPECT_ABSENT[@]+"${EXPECT_ABSENT[@]}"}; do
    if [ -e "$f" ]; then echo "  STILL PRESENT (not deleted): $f" >&2; FAILED=$((FAILED+1)); fi
  done

  echo "Summary: $N_NEW new · $N_MOD modified · $N_DEL deleted · $N_NOOP already-current · $N_WARN warning(s)."
  if [ "$FAILED" -ne 0 ] || [ "$N_WARN" -ne 0 ]; then
    echo "ERROR: harvest INCOMPLETE — $FAILED unreconciled, $N_WARN missing-in-workspace." >&2
    echo "Nothing was silently skipped; the files above need manual attention." >&2
    exit 1
  fi
  echo "Reconciliation OK: every changed file matches the run workspace."
  echo "Staging applied changes..."
  for f in ${EXPECT_PRESENT[@]+"${EXPECT_PRESENT[@]}"}; do
    git add "$f"
  done
  for f in ${EXPECT_ABSENT[@]+"${EXPECT_ABSENT[@]}"}; do
    git rm --cached -rf "$f" >/dev/null 2>&1 || true
  done
fi

# ── 4. Verify (build first — chikory bin runs from dist/, dogfood-004 F-16) ──
echo "Running verification checks: build, lint, typecheck, test..."
devbox run build
devbox run lint
devbox run typecheck
devbox run test

# ── 5. Guidance ─────────────────────────────────────────────────────────────
echo ""
echo "=========================================================="
echo "Harvest complete and reconciled for run $RUN_ID."
echo "=========================================================="
echo "Next:"
echo "1. Review the applied diff:  git status && git diff"
echo "2. Commit:                   git commit -m \"feat(<scope>): <message>\""
echo "   (cite Run ID: $RUN_ID and the verification checks above)"
echo "3. Post-run review:          /dogfood-review $RUN_ID"
echo "=========================================================="
