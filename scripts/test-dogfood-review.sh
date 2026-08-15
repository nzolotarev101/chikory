#!/usr/bin/env bash
# test-dogfood-review.sh — deterministic checks for the scripted half of
# /dogfood-review: dogfood-docs.mjs (bounded blocks, ledger, README index,
# report scaffold, close-out checks) and dogfood-arm.sh (AC arming).
#
# Style follows scripts/test-dogfood-ac-preflight.sh: fixtures in a temp dir,
# PASS/FAIL per case, non-zero exit on any FAIL. Nothing here touches the real
# living docs — every case runs against a throwaway copy of the repo layout.

set -uo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

FAILURES=0
check() { # <name> <expected-exit> <actual-exit>
  if [ "$3" -eq "$2" ]; then
    echo "PASS: $1 (exit $3)"
  else
    echo "FAIL: $1 — expected exit $2, got $3"
    FAILURES=$((FAILURES + 1))
  fi
}
contains() { # <name> <needle> <haystack-file>
  # `--` guards a needle that starts with a dash (e.g. a `--flag` in the help text).
  if grep -qF -- "$2" "$3"; then
    echo "PASS: $1"
  else
    echo "FAIL: $1 — output did not contain: $2"
    echo "      ---- output ----"
    sed 's/^/      /' "$3" | head -n 20
    FAILURES=$((FAILURES + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── a throwaway repo with the same doc layout the real one has ──────────────
FAKE="$WORK/repo"
mkdir -p "$FAKE/docs/reports" "$FAKE/examples/dogfood" "$FAKE/scripts" "$FAKE/src"
cp scripts/dogfood-docs.mjs "$FAKE/scripts/"
git -C "$FAKE" init -q -b main
git -C "$FAKE" config user.email t@chikory.local
git -C "$FAKE" config user.name t

cat > "$FAKE/plan.md" <<'EOF'
# Plan

**Current status — bounded rolling block (<=30 lines)**

- **Phase:** P3
- **Latest / next:** old latest line that will be displaced
- **KPIs (single source: DOGFOODING §1.4):** stuff

---

## 6. Work packages

| WP | Title | Tag | Notes |
|---|---|---|---|
| WP-1 | thing | ✅ | dogfood-900 landed |
EOF

cat > "$FAKE/docs/DOGFOODING.md" <<'EOF'
# Dogfooding guide

**Status (2026-08-01, bounded — REPLACE this block, <=15 lines).**
🟢 **dogfood-899 old block line one
old block line two

Related docs: nothing.
EOF

printf '# history\n' > "$FAKE/docs/PLAN-HISTORY.md"
printf '# requirements\n\n| ST-1 | thing | dogfood-900 |\n' > "$FAKE/docs/REQUIREMENTS.md"
printf 'run,wp,mode,outcome,steps,cost_usd,spec_format,class,resumes,judge_catches,rung,rollbacks\n899,WP-0,run,SUCCESS,1,0.01,loose,product,0,0,4,0\n' \
  > "$FAKE/docs/reports/dogfood-ledger.csv"
cat > "$FAKE/examples/dogfood/README.md" <<'EOF'
# index

| spec | what | outcome | report |
|---|---|---|---|
| [`dogfood-899-thing.yaml`](dogfood-899-thing.yaml) | old campaign | 🟢 SUCCESS | [dogfood-899.md](../../docs/reports/dogfood-899.md) |
EOF
printf 'line1\nline2\nline3\n' > "$FAKE/src/thing.ts"
git -C "$FAKE" add -A >/dev/null 2>&1
git -C "$FAKE" commit -q -m base >/dev/null 2>&1

DOCS() { (cd "$FAKE" && node scripts/dogfood-docs.mjs "$@"); }

# ── 1. block: refuses an over-cap replacement ───────────────────────────────
seq 1 20 | sed 's/^/line /' > "$WORK/toobig.md"
set +e
DOCS block --target dogfooding --block "$WORK/toobig.md" > "$WORK/out" 2>&1
check "block refuses an over-cap replacement" 1 $?
set -e
contains "over-cap refusal names the cap" "caps at 15" "$WORK/out"
contains "over-cap refusal forbids raising the cap" "do NOT raise the cap" "$WORK/out"

# ── 2. block: replaces and overflows verbatim to PLAN-HISTORY ───────────────
# The replacement carries its OWN `**Status (…)` header: F-346 moved the block
# anchor onto that header, so the header is inside the replaced range.
printf '**Status (2026-08-02, bounded — REPLACE this block, <=15 lines).**\n🟢 **dogfood-900 brand new block\nsecond line\n' > "$WORK/ok.md"
set +e
DOCS block --target dogfooding --block "$WORK/ok.md" --note "test" > "$WORK/out" 2>&1
check "block replaces a within-cap block" 0 $?
set -e
contains "new block landed" "dogfood-900 brand new block" "$FAKE/docs/DOGFOODING.md"
contains "displaced prose moved verbatim" "old block line two" "$FAKE/docs/PLAN-HISTORY.md"
if grep -qF "old block line two" "$FAKE/docs/DOGFOODING.md"; then
  echo "FAIL: displaced prose was left behind in DOGFOODING.md"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: displaced prose removed from the live block"
fi
# F-346's own regression: exactly ONE status header survives a replacement. When
# the anchor sat on the 🟢 body line, every review stacked another header above
# the block (three deep before dogfood-141 caught it).
HDRS=$(grep -c '^\*\*Status (' "$FAKE/docs/DOGFOODING.md")
if [ "$HDRS" -eq 1 ]; then
  echo "PASS: the status header is replaced, not stacked (F-346)"
else
  echo "FAIL: $HDRS status headers in DOGFOODING.md — expected exactly 1 (F-346 stacking)"
  FAILURES=$((FAILURES + 1))
fi

# ── 3. ledger: derives from facts, validates, refuses duplicates ────────────
cat > "$WORK/facts.json" <<'EOF'
{
  "runId": "run-abc",
  "terminal": "SUCCESS",
  "steps": 3,
  "cost": { "exact": 0.42, "budget": 15 },
  "totals": { "resumes": 1, "rollbacks": 2 }
}
EOF
set +e
DOCS ledger 900 --facts "$WORK/facts.json" --wp WP-1 --catches 0 --rung 4 > "$WORK/out" 2>&1
check "ledger appends a derived row" 0 $?
set -e
contains "ledger row derives steps/cost/resumes/rollbacks from facts" \
  "900,WP-1,run,SUCCESS,3,0.42,loose,product,1,0,4,2" "$FAKE/docs/reports/dogfood-ledger.csv"

set +e
DOCS ledger 900 --facts "$WORK/facts.json" --wp WP-1 --catches 0 --rung 4 > "$WORK/out" 2>&1
check "ledger refuses a duplicate run number" 1 $?
contains "duplicate refusal explains one-row-per-run" "refusing to duplicate" "$WORK/out"

DOCS ledger 901 --facts "$WORK/facts.json" --wp WP-1 --catches 0 --rung 4 --class nonsense > "$WORK/out" 2>&1
check "ledger refuses a bad enum" 1 $?
contains "bad enum names the allowed values" "product|meta" "$WORK/out"

DOCS ledger 902 --facts "$WORK/facts.json" --wp WP-1 --rung 4 > "$WORK/out" 2>&1
check "ledger refuses a missing judgment column" 1 $?
contains "missing judgment column is explained" "not derivable" "$WORK/out"
set -e

# ── 4. index: updates an existing row, inserts a new one ────────────────────
printf '🟢 **SUCCESS** — run-abc, 3 steps' > "$WORK/outcome.md"
set +e
DOCS index 899 --outcome "$WORK/outcome.md" > "$WORK/out" 2>&1
check "index updates an existing campaign row" 0 $?
set -e
contains "index wrote the outcome cell" "🟢 **SUCCESS** — run-abc, 3 steps" "$FAKE/examples/dogfood/README.md"

printf '| [`dogfood-900-new.yaml`](dogfood-900-new.yaml) | new campaign | ⏳ not yet run. | — |\n' > "$WORK/row.md"
set +e
DOCS index 900 --row "$WORK/row.md" > "$WORK/out" 2>&1
check "index inserts a new campaign row" 0 $?
DOCS index 900 --row "$WORK/row.md" > "$WORK/out" 2>&1
check "index refuses to insert a duplicate row" 1 $?
set -e

# ── 5. scaffold: pre-fills the trace from facts ─────────────────────────────
set +e
DOCS scaffold 900 --facts "$WORK/facts.json" --out "$WORK/report.md" > "$WORK/out" 2>&1
check "scaffold writes a report skeleton" 0 $?
set -e
contains "scaffold pre-fills the terminal + steps" "🟢 SUCCESS · 3 steps" "$WORK/report.md"
contains "scaffold pre-fills the cost line" "**\$0.42** of \$15 budget" "$WORK/report.md"
contains "scaffold leaves the prose as TODO" "TODO: 1–2 jargon-free sentences" "$WORK/report.md"

# ── 6. check: citation lint catches a bad line range ────────────────────────
# src/thing.ts has 3 lines; cite line 99.
cat > "$FAKE/docs/reports/dogfood-900.md" <<'EOF'
# dogfood-900
The fix landed at `src/thing.ts:99`.
EOF
set +e
(cd "$FAKE" && node scripts/dogfood-docs.mjs check 900) > "$WORK/out" 2>&1
check "check fails on a citation past end-of-file" 1 $?
set -e
contains "citation failure names the real length" "has 3 lines" "$WORK/out"

cat > "$FAKE/docs/reports/dogfood-900.md" <<'EOF'
# dogfood-900
The fix landed at `src/thing.ts:2`.
EOF
set +e
(cd "$FAKE" && node scripts/dogfood-docs.mjs check 900) > "$WORK/out" 2>&1
CHECK_RC=$?
set -e
contains "a valid citation resolves" "citations: 1/1 resolve" "$WORK/out"

# ── 7. check: F-81 guard on the plan.md WP table header ────────────────────
sed -i.bak 's/| WP | Title | Tag | Notes |/| WP | Title | Tag | Status |/' "$FAKE/plan.md"
set +e
(cd "$FAKE" && node scripts/dogfood-docs.mjs check) > "$WORK/out" 2>&1
check "check catches an F-81 Status column" 1 $?
set -e
contains "F-81 failure explains the inverted staleness gate" "F-81" "$WORK/out"
mv "$FAKE/plan.md.bak" "$FAKE/plan.md"

# ── 8. arm: classifies RED, GREEN and BROKEN, and times each ───────────────
ARM_SPEC="$WORK/spec.yaml"
cat > "$ARM_SPEC" <<'EOF'
name: fixture-arm
goal: fixture
acceptance_criteria:
  - id: AC-RED
    description: exits 1
    check: |
      exit 1
  - id: AC-GREEN
    description: exits 0
    check: |
      exit 0
  - id: AC-BROKEN
    description: errors
    check: |
      exit 3
EOF
set +e
bash scripts/dogfood-arm.sh "$ARM_SPEC" > "$WORK/out" 2>&1
check "arm exits non-zero when an AC is not RED on HEAD" 1 $?
set -e
contains "arm marks a clean exit 1 as armed" "RED-on-HEAD (clean exit 1)" "$WORK/out"
contains "arm flags a green-on-HEAD AC" "GREEN-on-HEAD" "$WORK/out"
contains "arm flags a broken check" "BROKEN CHECK (exit 3)" "$WORK/out"
contains "arm reports the judge cap share" "% of 120s judge cap" "$WORK/out"

set +e
bash scripts/dogfood-arm.sh "$ARM_SPEC" --green > "$WORK/out" 2>&1
check "arm --green exits non-zero when an AC does not pass" 1 $?
bash scripts/dogfood-arm.sh "$ARM_SPEC" --table > "$WORK/table" 2>&1
check "arm --table renders after both passes" 0 $?
set -e
contains "table carries the worst-case cap share" "of the 120s judge cap" "$WORK/table"
rm -f ".chikory/review/arm-$(basename "$ARM_SPEC" .yaml).json"

# ── 8b. arm: a check that DIED is never reported as armed (dogfood-133) ─────
# The exit code alone cannot tell a genuine RED from a check that never ran:
# `node -e '<bad syntax>'` exits 1, and dogfood-133 got "🟢 RED-on-HEAD (clean
# exit 1) — challenge armed" for an AC that could never pass in either direction.
BROKEN_SPEC="$WORK/spec-broken.yaml"
cat > "$BROKEN_SPEC" <<'EOF'
name: fixture-arm-broken
goal: fixture
acceptance_criteria:
  - id: AC-DIES
    description: exits 1 from a SyntaxError, not an assertion
    check: |
      node --input-type=module -e 'const x = `unterminated'
EOF
BROKEN_BASE="$(basename "$BROKEN_SPEC" .yaml)"
set +e
bash scripts/dogfood-arm.sh "$BROKEN_SPEC" > "$WORK/out" 2>&1
check "arm exits non-zero on a check that died" 1 $?
set -e
contains "arm calls a SyntaxError-exit-1 a BROKEN CHECK" "BROKEN CHECK" "$WORK/out"
contains "arm names the offending line" "SyntaxError" "$WORK/out"
# The banner also says "challenge armed", so assert on the per-AC VERDICT marker.
if grep -qF "🟢 RED-on-HEAD" "$WORK/out"; then
  echo "FAIL: arm reported a DIED check as RED-on-HEAD — the dogfood-133 defect"
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: arm never reports a DIED check as RED-on-HEAD"
fi
contains "arm points at --extract for the full output" "--extract AC-DIES" "$WORK/out"
contains "arm prints the kept log path" "full output:" "$WORK/out"
if [ -s ".chikory/review/arm-$BROKEN_BASE-red-AC-DIES.log" ]; then
  echo "PASS: arm keeps the full check output on disk"
else
  echo "FAIL: arm deleted the check output — diagnosis needs a throwaway extractor again"
  FAILURES=$((FAILURES + 1))
fi

set +e
bash scripts/dogfood-arm.sh "$BROKEN_SPEC" --table > "$WORK/table" 2>&1
set -e
contains "table renders a died check as BROKEN, not verified" "⛔ BROKEN" "$WORK/table"
contains "table refuses to call it verified" "NOT verified in both directions" "$WORK/table"

# ── 8c. arm --extract: the check body comes back byte-exact and runnable ────
set +e
bash scripts/dogfood-arm.sh "$ARM_SPEC" --extract AC-RED > "$WORK/out" 2>&1
check "arm --extract succeeds for a known AC" 0 $?
bash scripts/dogfood-arm.sh "$ARM_SPEC" --extract AC-NOPE > "$WORK/out2" 2>&1
check "arm --extract fails for an unknown AC" 1 $?
set -e
EXTRACTED=".chikory/review/arm-$(basename "$ARM_SPEC" .yaml)-AC-RED.sh"
contains "extracted body is the check itself" "exit 1" "$EXTRACTED"
rm -f ".chikory/review/arm-$BROKEN_BASE".json ".chikory/review/arm-$BROKEN_BASE"-*.log \
      ".chikory/review/arm-$(basename "$ARM_SPEC" .yaml)".json \
      ".chikory/review/arm-$(basename "$ARM_SPEC" .yaml)"-*.log "$EXTRACTED"

# ── 9. open: refuses to harvest over a dirty tree ──────────────────────────
# Exercised against the real script with a fabricated run dir, in the fake repo
# (never the live one) — the guard is the property under test, not harvesting.
mkdir -p "$FAKE/.chikory/runs/run-fixture/workspace" "$FAKE/scripts"
cp scripts/dogfood-open.sh "$FAKE/scripts/"
printf 'dirty\n' > "$FAKE/untracked-change.txt"
set +e
(cd "$FAKE" && bash scripts/dogfood-open.sh run-fixture) > "$WORK/out" 2>&1
check "open refuses to harvest over a dirty tree" 1 $?
set -e
contains "dirty-tree refusal explains itself" "refusing to harvest" "$WORK/out"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "test-dogfood-review: ALL PASS"
else
  echo "test-dogfood-review: $FAILURES FAILED"
fi
exit "$FAILURES"
