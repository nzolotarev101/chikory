#!/usr/bin/env bash
# test-dogfood-ac-preflight.sh — deterministic checks for the WP-266 dynamic AC
# dry-run (dogfood-progression.sh --spec --preflight) and the dogfood.sh launch
# guards (F-121 spec-env contract, F-120 window sizing, CHIKORY_PREFLIGHT_ONLY).
#
# Style follows scripts/test-dogfood-landed-scope.sh: fixture specs in a temp
# dir, run from the repo root, PASS/FAIL per case, non-zero exit on any FAIL.

set -uo pipefail
cd "$(dirname "$0")/.."

TMPDIR_FIXTURES=$(mktemp -d)
trap 'rm -rf "$TMPDIR_FIXTURES"' EXIT

FAILURES=0
check() { # <name> <expected-exit> <actual-exit>
  if [ "$3" -eq "$2" ]; then
    echo "PASS: $1 (exit $3)"
  else
    echo "FAIL: $1 — expected exit $2, got $3"
    FAILURES=$((FAILURES + 1))
  fi
}

# ---- fixture 1: BROKEN check (F-119 class the STATIC lint cannot see) --------
# `test "$(echo two words)" -ge 2` errors `integer expression expected` (exit 2)
# on every pass — no grep -c involved, so only EXECUTION catches it.
cat > "$TMPDIR_FIXTURES/broken.yaml" <<'EOF'
name: fixture-broken-check
goal: >
  Deliver an outcome; the AC check below ERRORS at runtime regardless of the
  delivery, which must be refused.
acceptance_criteria:
  - id: AC-1
    description: arithmetically broken check
    check: test "$(echo two words)" -ge 2
EOF

# ---- fixture 2: NO CHALLENGE (every executable AC already green on HEAD) -----
cat > "$TMPDIR_FIXTURES/all-green.yaml" <<'EOF'
name: fixture-all-green
goal: >
  Deliver an outcome; the only AC below already passes on HEAD, so the run
  would enforce nothing.
acceptance_criteria:
  - id: AC-1
    description: already true on HEAD
    check: grep -rq 'export' packages/sdk-ts/src/index.ts
EOF

# ---- fixture 3: HEALTHY (one RED-on-HEAD challenge + one verify-suite AC) ----
cat > "$TMPDIR_FIXTURES/healthy.yaml" <<'EOF'
name: fixture-healthy
goal: >
  Deliver an outcome named by a net-new symbol that does not exist on HEAD.
acceptance_criteria:
  - id: AC-1
    description: net-new symbol absent on HEAD
    check: grep -rq 'thisSymbolDoesNotExistAnywhereOnHead' packages/sdk-ts/src/
  - id: AC-2
    description: full suite green
    check: cd packages/sdk-ts && pnpm exec vitest run
EOF

# ---- fixture 4: F-119 static regression (grep -rc into arithmetic test) ------
cat > "$TMPDIR_FIXTURES/f119-static.yaml" <<'EOF'
name: fixture-f119-static
goal: >
  Deliver an outcome; AC pipes a grep -rc count into an arithmetic test.
acceptance_criteria:
  - id: AC-1
    description: unsatisfiable count idiom
    check: test "$(grep -rc 'someSymbol' packages/sdk-ts/src/)" -ge 2
EOF

set +e
bash scripts/dogfood-progression.sh --spec "$TMPDIR_FIXTURES/broken.yaml" --preflight >/dev/null 2>&1
check "dynamic dry-run refuses a BROKEN check (F-119 class, static-invisible)" 3 $?

bash scripts/dogfood-progression.sh --spec "$TMPDIR_FIXTURES/all-green.yaml" --preflight >/dev/null 2>&1
check "--preflight refuses when NO AC is RED-on-HEAD (no armed challenge)" 3 $?

bash scripts/dogfood-progression.sh --spec "$TMPDIR_FIXTURES/all-green.yaml" >/dev/null 2>&1
RC=$?
[ "$RC" -eq 3 ] && { echo "FAIL: all-green without --preflight must stay advisory (got refuse 3)"; FAILURES=$((FAILURES+1)); } \
  || echo "PASS: all-green without --preflight is advisory (exit $RC)"

bash scripts/dogfood-progression.sh --spec "$TMPDIR_FIXTURES/healthy.yaml" --preflight >/dev/null 2>&1
RC=$?
[ "$RC" -eq 3 ] && { echo "FAIL: healthy spec refused (exit 3)"; FAILURES=$((FAILURES+1)); } \
  || echo "PASS: healthy spec passes preflight (exit $RC = ledger verdict, not a lint refuse)"

bash scripts/dogfood-progression.sh --spec "$TMPDIR_FIXTURES/f119-static.yaml" --preflight >/dev/null 2>&1
check "F-119 static lint still refuses grep -rc arithmetic" 3 $?

# ---- dogfood.sh launch guards (all stop before any build/spend) --------------
# F-121: spec names CHIKORY_CONTEXT_WINDOW_TOKENS, env NOT set → exit 4.
cat > "$TMPDIR_FIXTURES/env-contract.yaml" <<'EOF'
name: fixture-env-contract
goal: >
  Deliver an outcome named by a net-new symbol; the run vehicle needs
  CHIKORY_CONTEXT_WINDOW_TOKENS armed at launch.
acceptance_criteria:
  - id: AC-1
    description: net-new symbol absent on HEAD
    check: grep -rq 'thisSymbolDoesNotExistAnywhereOnHead' packages/sdk-ts/src/
EOF

env -u CHIKORY_CONTEXT_WINDOW_TOKENS bash scripts/dogfood.sh --run "$TMPDIR_FIXTURES/env-contract.yaml" >/dev/null 2>&1
check "dogfood.sh refuses launch when a spec-named env is unset (F-121)" 4 $?

CHIKORY_CONTEXT_WINDOW_TOKENS=1200000 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --run "$TMPDIR_FIXTURES/env-contract.yaml" >/dev/null 2>&1
check "dogfood.sh refuses an executor-scale window (F-120)" 4 $?

CHIKORY_CONTEXT_WINDOW_TOKENS=2000 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --run "$TMPDIR_FIXTURES/env-contract.yaml" >/dev/null 2>&1
check "dogfood.sh preflight-only passes with env armed + sane window" 0 $?

# ---- WP-531 / F-146: --chain self-heal spec must arm CHIKORY_SEED_CHAIN_FAIL_NODE ----
# The seam is NOT in the AC checks — it's a header/goal launch contract — so only the
# semantic guard (not F-121's spec-env grep alone) enforces it against the coarse
# ALLOW_MISSING_ENV override that un-armed dogfood-104. Fixture names the recovery
# journal (node_replanned) without ever mentioning CHIKORY_*, isolating the new guard.
cat > "$TMPDIR_FIXTURES/heal-chain.yaml" <<'EOF'
name: fixture-heal-chain
goal: >
  A 3-node chain whose middle node fails its first incarnation; the chain journal
  must show a node_replanned entry and recover to SUCCESS.
acceptance_criteria:
  - id: AC-1
    description: net-new symbol absent on HEAD
    check: grep -rq 'thisSymbolDoesNotExistAnywhereOnHead' packages/sdk-ts/src/
EOF

env -u CHIKORY_SEED_CHAIN_FAIL_NODE CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --chain "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "dogfood.sh refuses a --chain self-heal spec with the seam UNARMED (F-146/WP-531)" 4 $?

# The SAME coarse missing-env override that slipped dogfood-104 must NOT silence it.
env -u CHIKORY_SEED_CHAIN_FAIL_NODE CHIKORY_ALLOW_MISSING_ENV=1 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --chain "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "ALLOW_MISSING_ENV=1 does NOT silence the unarmed-heal guard (the F-146 hole)" 4 $?

# Armed → preflight passes.
CHIKORY_SEED_CHAIN_FAIL_NODE=B CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --chain "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "dogfood.sh preflight-only passes when the heal seam IS armed" 0 $?

# Deliberate override → preflight passes even unarmed.
env -u CHIKORY_SEED_CHAIN_FAIL_NODE CHIKORY_ALLOW_UNARMED_HEAL=1 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --chain "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "CHIKORY_ALLOW_UNARMED_HEAL=1 overrides the unarmed-heal guard" 0 $?

# Same spec as a --run (not a chain) must NOT trip the chain-only guard.
env -u CHIKORY_SEED_CHAIN_FAIL_NODE CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --run "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "the heal guard is --chain-only (a --run of the same spec passes)" 0 $?

# ---- WP-532 / P3-rung-2: the two-phase operator-resume drill precondition guard (1d-ter) ----
# CHIKORY_CHAIN_RESUME_DRILL=1 validates at $0: --chain only, and the force-fail seam armed.
CHIKORY_CHAIN_RESUME_DRILL=1 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --run "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "resume drill refuses --run mode (WP-532, chain-only)" 4 $?

env -u CHIKORY_SEED_CHAIN_FAIL_NODE CHIKORY_CHAIN_RESUME_DRILL=1 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --chain "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "resume drill refuses when the force-fail seam is UNARMED (WP-532)" 4 $?

CHIKORY_SEED_CHAIN_FAIL_NODE=1 CHIKORY_CHAIN_RESUME_DRILL=1 CHIKORY_PREFLIGHT_ONLY=1 \
  bash scripts/dogfood.sh --chain "$TMPDIR_FIXTURES/heal-chain.yaml" >/dev/null 2>&1
check "resume drill preflight passes when --chain + seam armed (WP-532)" 0 $?
set -e

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES case(s) FAILED"
  exit 1
fi
echo "All AC-preflight guard cases passed."
