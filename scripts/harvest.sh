#!/usr/bin/env bash
# Harvests and applies the result of the latest Chikory dogfooding run.
# Following docs/DOGFOODING.md §6.
#
# Usage:
#   devbox run harvest [<run-id>] [<branch-name>]

set -euo pipefail

# Make sure we run from the repo root
cd "$(dirname "$0")/.."

# 1. Locate the run-id
RUN_ID="${1:-}"
if [ -z "$RUN_ID" ]; then
  # Find the latest modified run directory
  LATEST_DIR=$(ls -td .chikory/runs/run-* 2>/dev/null | head -n 1)
  if [ -z "$LATEST_DIR" ] || [ ! -d "$LATEST_DIR" ]; then
    echo "Error: No dogfood run directory found in .chikory/runs/" >&2
    exit 1
  fi
  RUN_ID=$(basename "$LATEST_DIR")
fi

RUN_DIR=".chikory/runs/$RUN_ID"
if [ ! -d "$RUN_DIR" ]; then
  echo "Error: Run directory not found at $RUN_DIR" >&2
  exit 1
fi

echo "Harvesting: Using run-id $RUN_ID"

# 2. Determine target branch name if not provided
BRANCH_NAME="${2:-main}"
if [ -z "$BRANCH_NAME" ]; then
  # Find the latest spec file in examples/dogfood to extract the name
  SPEC_FILE=$(ls examples/dogfood/dogfood-[0-9][0-9][0-9].yaml 2>/dev/null | sort | tail -n 1)
  if [ -n "$SPEC_FILE" ] && [ -f "$SPEC_FILE" ]; then
    SPEC_NAME=$(grep -E "^name:" "$SPEC_FILE" | head -n 1 | sed 's/name:[[:space:]]*//' | tr -d '"'\''')
    # Remove "dogfood-003-" prefix to get the clean branch/package name
    BRANCH_NAME=$(echo "$SPEC_NAME" | sed -E 's/^dogfood-[0-9]{3}-//')
  fi
  
  if [ -z "$BRANCH_NAME" ]; then
    # Fallback to run-id name
    BRANCH_NAME="harvest-$RUN_ID"
  fi
fi

echo "Target branch: $BRANCH_NAME"

# 3. Apply the diff from the run workspace
ws="$RUN_DIR/workspace"
if [ ! -d "$ws" ]; then
  echo "Error: Workspace not found inside the run directory at $ws" >&2
  exit 1
fi

# Show the commits in the run workspace for context
echo "Commits in the run workspace ($ws) since main:"
git -C "$ws" log --oneline main..HEAD || echo "No new commits or unable to read history."

# Checkout/create target branch
if git show-ref --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Checking out existing branch '$BRANCH_NAME'..."
  git checkout "$BRANCH_NAME"
else
  echo "Creating and checking out new branch '$BRANCH_NAME'..."
  git checkout -b "$BRANCH_NAME"
fi

# Apply the diff
echo "Applying diff from $ws to host repository..."
DIFF_CMD="diff chikory-base..HEAD"
if ! git -C "$ws" rev-parse --verify chikory-base >/dev/null 2>&1; then
  echo "Warning: 'chikory-base' ref not found in run workspace. Attempting diff against main branch..."
  DIFF_CMD="diff main..HEAD"
fi

DIFF_CONTENT=$(git -C "$ws" $DIFF_CMD)
if [ -z "$DIFF_CONTENT" ]; then
  echo "No changes found between the run workspace and base branch."
else
  echo "$DIFF_CONTENT" | git apply
fi

# 4. Verify the changes (lint, typecheck, tests)
# Build first: the chikory bin runs from dist/, and the dogfood script's
# build predates the run — without this, post-harvest forensics render with
# yesterday's code (dogfood-004 F-16).
echo "Running verification checks: build, lint, typecheck, test..."
devbox run build
devbox run lint
devbox run typecheck
devbox run test

# 5. Output guidance on committing & PR review
echo ""
echo "=========================================================="
echo "Successfully applied changes from run $RUN_ID!"
echo "=========================================================="
echo "Next steps:"
echo "1. Commit your changes:"
echo "   git add -A"
echo "   git commit -m \"feat(<scope>): <message>\""
echo ""
echo "2. Propose a PR with references to the run:"
echo "   - Include the Run ID: $RUN_ID"
echo "   - Include verification details and checks executed."
echo ""
echo "3. Run the mandatory post-run review using the Antigravity skill:"
echo "   agy /dogfood-review $RUN_ID"
echo "=========================================================="
