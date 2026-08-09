#!/usr/bin/env bash
# test-scripts.sh — run every scripts/test-*.sh in one place.
#
# `devbox run test` used to call test-harvest-chain.sh directly, so
# test-dogfood-ac-preflight.sh and test-dogfood-landed-scope.sh existed but were
# never executed by any task or by CI. This aggregator is what `devbox run test`
# and `devbox run test-scripts` both call, so a new script test is covered the
# moment it is named `scripts/test-*.sh`.
#
# Runs bare toolchain binaries — invoke THROUGH devbox, never nest `devbox run`.

set -uo pipefail
cd "$(dirname "$0")/.."

FAILURES=0
RESULTS=""

for t in scripts/test-*.sh; do
  # Skip self.
  [ "$(basename "$t")" = "test-scripts.sh" ] && continue
  echo
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  $t"
  echo "══════════════════════════════════════════════════════════════════════"
  if bash "$t"; then
    RESULTS="${RESULTS}PASS  $t
"
  else
    RC=$?
    RESULTS="${RESULTS}FAIL  $t (exit $RC)
"
    FAILURES=$((FAILURES + 1))
  fi
done

echo
echo "══════════════════════════════════════════════════════════════════════"
printf '%s' "$RESULTS"
if [ "$FAILURES" -eq 0 ]; then
  echo "script tests: ALL PASS"
else
  echo "script tests: $FAILURES FAILED"
fi
exit "$FAILURES"
