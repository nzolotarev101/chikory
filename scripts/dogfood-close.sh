#!/usr/bin/env bash
# dogfood-close.sh — the gate between a finished review and a landed commit.
#
# Runs every mechanical close-out check in one approval, then commits and pushes
# ONLY if all of them are green. The standing rule is harvest FIRST (see
# dogfood-open.sh) and commit + push everything LAST, once the suite is green.
#
# Usage:
#   devbox run -- bash scripts/dogfood-close.sh <nnn> [--run-id <id>] [--check-only]
#                                               [--message <subject>] [--no-push]
#
# Gates, in order — each is a defect this loop has actually shipped:
#   1. structural  — bounded blocks within cap (a 16-line DOGFOODING block
#                    survived three manual corrections in the dogfood-128 review)
#                    and the plan.md WP table header schema (F-81)
#   2. citations   — every `path:line` in the report resolves to a real range
#                    (the dogfood-128 report cited three ranges that did not exist)
#   3. coverage    — report, plan.md, REQUIREMENTS, DOGFOODING, README and the
#                    ledger all carry this campaign
#   4. suite       — devbox run test
#
# Runs bare toolchain binaries — invoke THROUGH devbox, never nest `devbox run`.

set -uo pipefail
cd "$(dirname "$0")/.."

NNN=""
RUN_ID=""
CHECK_ONLY=0
NO_PUSH=0
MESSAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="${2:?--run-id requires a value}"; shift 2 ;;
    --message) MESSAGE="${2:?--message requires a value}"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --no-push) NO_PUSH=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" >&2; exit 0 ;;
    --*) echo "Error: unknown flag $1" >&2; exit 2 ;;
    *) NNN="$1"; shift ;;
  esac
done
if ! printf '%s' "$NNN" | grep -qE '^[0-9]{3}$'; then
  echo "Usage: $0 <nnn> [--run-id <id>] [--check-only] [--message <subject>] [--no-push]" >&2
  exit 2
fi

FAILED=0

echo "# dogfood-close — dogfood-$NNN"
echo

# ── 1-3. structural + citations + coverage ──────────────────────────────────
echo "## Gates 1-3: structure, citations, living-doc coverage"
echo
if ! node scripts/dogfood-docs.mjs check "$NNN"; then
  FAILED=1
fi
echo

# ── 4. full suite ───────────────────────────────────────────────────────────
echo "## Gate 4: full test suite"
echo
if [ "$FAILED" -eq 1 ]; then
  echo "⏭  skipped — earlier gates are red; fix them first (the suite takes minutes)."
else
  SUITE_LOG="$(mktemp)"
  # Already inside devbox (CLAUDE.md: never nest `devbox run`), so drive the
  # same commands `devbox run test` does — which is the AGGREGATOR
  # scripts/test-scripts.sh, not one hand-picked script test. F-347
  # (dogfood-142): this gate called test-harvest-chain.sh directly and so ran
  # NONE of the other scripts/test-*.sh; dogfood-141 landed `aafb762` with a red
  # test-dogfood-review.sh under a commit trailer that read "full suite green".
  # Keep this list byte-identical to devbox.json `shell.scripts.test`.
  if pnpm -r test > "$SUITE_LOG" 2>&1 \
     && (cd packages/sdk-py && uv run pytest >> "$SUITE_LOG" 2>&1) \
     && bash scripts/test-scripts.sh >> "$SUITE_LOG" 2>&1; then
    grep -E 'Tests +[0-9]+ passed|passed in |script tests: ALL PASS' "$SUITE_LOG" | tail -5
    echo "✅ suite green"
  else
    echo "⛔ suite RED — tail:"
    tail -n 25 "$SUITE_LOG"
    FAILED=1
  fi
  rm -f "$SUITE_LOG"
fi
echo

if [ "$FAILED" -ne 0 ]; then
  echo "⛔ close-out BLOCKED — nothing committed."
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "✅ every gate green (--check-only: nothing committed)."
  exit 0
fi

# ── 5. land it ──────────────────────────────────────────────────────────────
echo "## Landing"
echo
if [ -z "$(git status --short)" ]; then
  echo "ℹ️  working tree already clean — nothing to commit."
  exit 0
fi

git add -A
SUBJECT="${MESSAGE:-"docs: dogfood-$NNN review — report, living docs, ledger row"}"
MSG_FILE="$(mktemp)"
{
  printf '%s\n\n' "$SUBJECT"
  [ -n "$RUN_ID" ] && printf 'Ref: run-id: %s\n\n' "$RUN_ID"
  printf 'Gates: bounded blocks within cap · report citations resolve · living-doc\n'
  printf 'coverage complete · ledger row present · full suite green.\n\n'
  printf 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n'
} > "$MSG_FILE"
git commit -q -F "$MSG_FILE"
rm -f "$MSG_FILE"
COMMIT="$(git log --oneline -1)"
echo "✅ committed: $COMMIT"

if [ "$NO_PUSH" -eq 1 ]; then
  echo "ℹ️  --no-push: not pushing."
  exit 0
fi
if git push; then
  echo "✅ pushed."
else
  echo "⛔ push FAILED — the commit is local. Resolve and push by hand." >&2
  exit 1
fi
