#!/usr/bin/env bash
# Compare a dogfood run workspace diff with a landed commit/ref.
#
# Usage:
#   bash scripts/dogfood-landed-scope.sh <run-workspace-path> <landed-commit-or-ref>
#
# The expected diff is the run workspace's chikory-base..HEAD. The landed diff
# is computed in the current host repository against that same base commit.

set -uo pipefail

usage() {
  echo "Usage: $0 <run-workspace-path> <landed-commit-or-ref>" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

RUN_WORKSPACE="$1"
LANDED_REF="$2"

if ! git -C "$RUN_WORKSPACE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run workspace is not a git worktree: $RUN_WORKSPACE" >&2
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: current directory is not inside the host git repository" >&2
  exit 2
fi

BASE_COMMIT="$(git -C "$RUN_WORKSPACE" rev-parse --verify chikory-base^{commit} 2>/dev/null)"
if [ -z "$BASE_COMMIT" ]; then
  echo "Error: run workspace does not have a chikory-base commit" >&2
  exit 2
fi

RUN_HEAD="$(git -C "$RUN_WORKSPACE" rev-parse --verify HEAD^{commit} 2>/dev/null)"
if [ -z "$RUN_HEAD" ]; then
  echo "Error: run workspace HEAD is not a commit" >&2
  exit 2
fi

LANDED_COMMIT="$(git rev-parse --verify "$LANDED_REF^{commit}" 2>/dev/null)"
if [ -z "$LANDED_COMMIT" ]; then
  echo "Error: landed ref is not a commit in the host repository: $LANDED_REF" >&2
  exit 2
fi

if ! git cat-file -e "$BASE_COMMIT^{commit}" 2>/dev/null; then
  echo "Error: run chikory-base commit is not present in the host repository: $BASE_COMMIT" >&2
  exit 2
fi

TMPDIR="${TMPDIR:-/tmp}"
WORKDIR="$(mktemp -d "$TMPDIR/dogfood-landed-scope.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

RUN_PATHS="$WORKDIR/run-paths"
LANDED_PATHS="$WORKDIR/landed-paths"
EXTRA_PATHS="$WORKDIR/extra"
MISSING_PATHS="$WORKDIR/missing"
COMMON_PATHS="$WORKDIR/common"
DIFFERENT_PATHS="$WORKDIR/different"

git -C "$RUN_WORKSPACE" diff --name-only "$BASE_COMMIT..$RUN_HEAD" | sort >"$RUN_PATHS"
git diff --name-only "$BASE_COMMIT..$LANDED_COMMIT" | sort >"$LANDED_PATHS"

comm -13 "$RUN_PATHS" "$LANDED_PATHS" >"$EXTRA_PATHS"
comm -23 "$RUN_PATHS" "$LANDED_PATHS" >"$MISSING_PATHS"
comm -12 "$RUN_PATHS" "$LANDED_PATHS" >"$COMMON_PATHS"
: >"$DIFFERENT_PATHS"

blob_id() {
  repo="$1"
  rev="$2"
  path="$3"

  if git -C "$repo" cat-file -e "$rev:$path" 2>/dev/null; then
    git -C "$repo" rev-parse "$rev:$path"
  else
    echo "__ABSENT__"
  fi
}

while IFS= read -r path; do
  [ -z "$path" ] && continue
  RUN_BLOB="$(blob_id "$RUN_WORKSPACE" "$RUN_HEAD" "$path")"
  LANDED_BLOB="$(blob_id "." "$LANDED_COMMIT" "$path")"
  if [ "$RUN_BLOB" != "$LANDED_BLOB" ]; then
    printf '%s\n' "$path" >>"$DIFFERENT_PATHS"
  fi
done <"$COMMON_PATHS"

echo "# dogfood-landed-scope"
echo "- run-workspace: $RUN_WORKSPACE"
echo "- base: $BASE_COMMIT"
echo "- run-head: $RUN_HEAD"
echo "- landed: $LANDED_COMMIT"
echo

if [ ! -s "$EXTRA_PATHS" ] && [ ! -s "$MISSING_PATHS" ] && [ ! -s "$DIFFERENT_PATHS" ]; then
  echo "MATCH"
  exit 0
fi

echo "EXTRA_IN_COMMIT"
if [ -s "$EXTRA_PATHS" ]; then
  sed 's/^/  /' "$EXTRA_PATHS"
else
  echo "  (none)"
fi
echo

echo "MISSING_IN_COMMIT"
if [ -s "$MISSING_PATHS" ]; then
  sed 's/^/  /' "$MISSING_PATHS"
else
  echo "  (none)"
fi
echo

echo "DIFFERS_FROM_RUN"
if [ -s "$DIFFERENT_PATHS" ]; then
  sort "$DIFFERENT_PATHS" | sed 's/^/  /'
else
  echo "  (none)"
fi

exit 1
