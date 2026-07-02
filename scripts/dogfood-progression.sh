#!/usr/bin/env bash
# dogfood-progression.sh — mechanical progression gate for the dogfood loop
# (course correction 2026-07-02, plan.md §6; DOGFOODING §1.4/§1.5/§6.1).
#
# The loop's proven failure mode is drift: run targets stop getting more
# meaningful, friction fixes headline forever, and prose rules don't execute
# (the one-step-streak KPI retirement was flagged urgent twice and sat for a
# month). This script makes "is the loop progressing toward the thesis?" a
# COMPUTED verdict over the machine-readable run ledger, not a judgment call.
#
# Usage:
#   bash scripts/dogfood-progression.sh                 # trend report + verdict
#   bash scripts/dogfood-progression.sh --spec <yaml>   # + lint a candidate spec
#
# Data source: docs/reports/dogfood-ledger.csv — one row per terminal run,
# appended by /dogfood-review phase 4 (columns: run,wp,mode,outcome,steps,
# cost_usd,spec_format,class,resumes,judge_catches,rung).
#   spec_format: loose (outcome+ACs) | prescribed (diff dictated in goal)
#   class:       product (router/executors/runner/judge/chain/memory runtime)
#                | meta (scripts/, examples/dogfood/, launch prechecks,
#                        spec hygiene, verifier plumbing) — DOGFOODING §1.5
#   rung:        highest WP-265 horizon-ladder rung this run satisfied (0 = none)
#
# Verdict semantics (binding on /dogfood-review phase 5 and /dogfood-assessor):
#   ✅ PROGRESSING — the trailing-3 window beats the prior-3 window on at least
#      one thesis axis: max steps survived, ladder rung, a real resume, a loose
#      spec where there was none.
#   ⛔ STALLED — no thesis axis moved. The ONLY permitted next headline is the
#      current WP-265 ladder rung; new 🔴 friction is hand-fixed (TASK-PROTOCOL
#      §4), it does NOT headline.
#   Additionally: 🔴 CAP BUSTED when >1 harness-meta headline in the trailing 3
#      (DOGFOODING §1.5) — the next headline MUST be class=product.
#
# Exit code: 0 = PROGRESSING, 1 = STALLED (callers can gate on it), 2 = usage.

set -euo pipefail

LEDGER="docs/reports/dogfood-ledger.csv"
SPEC=""
if [ "${1:-}" = "--spec" ]; then
  SPEC="${2:?--spec requires a path}"
fi

if [ ! -f "$LEDGER" ]; then
  echo "Error: ledger not found at $LEDGER" >&2
  exit 2
fi

echo "## Dogfood progression report ($(date +%F))"
echo

OUT=$(awk -F, '
  NR == 1 { next }
  { n += 1
    run[n]=$1; wp[n]=$2; mode[n]=$3; outcome[n]=$4; steps[n]=$5+0
    cost[n]=$6+0; fmt[n]=$7; cls[n]=$8; res[n]=$9+0; catch[n]=$10+0; rung[n]=$11+0 }
  END {
    if (n < 2) { printf "ℹ️  Ledger has <2 rows — no trend yet.\nFLAG:1\n"; exit }
    a0 = (n >= 3) ? n-2 : 1               # trailing-3 window start
    lo = (n >= 6) ? n-5 : 1               # prior-3 window start (best effort)

    printf "| run | WP | mode | outcome | steps | cost $ | format | class | resumes | catches | rung |\n"
    printf "|---|---|---|---|---|---|---|---|---|---|---|\n"
    for (i = (n >= 8 ? n-7 : 1); i <= n; i++)
      printf "| %s | %s | %s | %s | %d | %.2f | %s | %s | %d | %d | %d |\n",
        run[i], wp[i], mode[i], outcome[i], steps[i], cost[i], fmt[i], cls[i],
        res[i], catch[i], rung[i]

    maxA=0; maxB=0; rungA=0; rungB=0; looseA=0; looseB=0; resA=0; metaA=0
    for (i = a0; i <= n; i++) {
      if (steps[i] > maxA) maxA = steps[i]
      if (rung[i]  > rungA) rungA = rung[i]
      if (fmt[i] == "loose") looseA += 1
      if (cls[i] == "meta")  metaA  += 1
      resA += res[i]
    }
    for (i = lo; i < a0; i++) {
      if (steps[i] > maxB) maxB = steps[i]
      if (rung[i]  > rungB) rungB = rung[i]
      if (fmt[i] == "loose") looseB += 1
    }

    printf "\n**Trailing-3 vs prior-3:** max steps %d vs %d · ladder rung %d vs %d · loose specs %d vs %d · resumes %d · harness-meta headlines %d/3\n\n",
      maxA, maxB, rungA, rungB, looseA, looseB, resA, metaA

    if (metaA > 1)
      printf "🔴 **CAP BUSTED (DOGFOODING §1.5):** %d harness-meta headlines in the trailing 3 (cap is ≤1). Next headline MUST be class=product.\n\n", metaA

    progressing = (maxA > maxB) || (rungA > rungB) || (resA > 0) || (looseA > looseB)
    if (progressing) {
      printf "✅ **PROGRESSING** — a thesis axis moved. Next headline: the next WP-265 ladder rung (plan.md §6 queue).\n"
      printf "FLAG:0\n"
    } else {
      printf "⛔ **STALLED** — no thesis axis (horizon, ladder rung, resume, spec looseness) moved over the last 3 runs.\n"
      printf "BINDING: the next headline MUST be the current WP-265 ladder rung (plan.md §6 queue); new 🔴 friction is HAND-FIXED (TASK-PROTOCOL §4), it does not headline.\n"
      printf "FLAG:1\n"
    }
  }' "$LEDGER")

echo "${OUT%$'\n'FLAG:*}"
EXIT_FLAG="${OUT##*FLAG:}"

# ---------- candidate-spec lint ----------
if [ -n "$SPEC" ]; then
  echo
  echo "## Candidate spec lint: $SPEC"
  echo
  if [ ! -f "$SPEC" ]; then
    echo "Error: spec not found at $SPEC" >&2
    exit 2
  fi
  PRESCRIBED=0
  grep -qE '^[[:space:]]*FILE [0-9]+ *(—|:|-)' "$SPEC" && PRESCRIBED=1
  grep -qE '^[[:space:]]{4,}(import |const |export |return |await )' "$SPEC" && PRESCRIBED=1
  grep -qE 'Rewrite .* body|Change exactly ONE existing file' "$SPEC" && PRESCRIBED=1
  if [ "$PRESCRIBED" -eq 1 ]; then
    if grep -qiE '^# *(Format|Track): *(track-B|prescribed)' "$SPEC"; then
      echo "ℹ️  PRESCRIBED format, declared track-B — OK for parity ports / hand-off verification."
    else
      echo "⚠️  PRESCRIBED-diff spec (goal dictates files/symbols/code) with NO '# Format: track-B'"
      echo "    declaration. Headline specs must be LOOSE — outcome + ACs (DOGFOODING §3)."
      echo "    Either add the declaration or rewrite the goal as an outcome."
    fi
  else
    echo "🟢 LOOSE format — outcome-shaped goal (headline-eligible)."
  fi
  if grep -qiE '^# *Ladder-rung: *[0-9]' "$SPEC"; then
    echo "🟢 $(grep -iE '^# *Ladder-rung:' "$SPEC" | head -1)"
  else
    echo "⚠️  No '# Ladder-rung: <N>' header (0 = off-ladder; headline specs should climb the ladder)."
  fi
  if grep -qiE '^# *Thesis-KPI:' "$SPEC"; then
    echo "🟢 $(grep -iE '^# *Thesis-KPI:' "$SPEC" | head -1)"
  else
    echo "⚠️  No '# Thesis-KPI: <§1.4 KPI this run pushes>' header."
  fi
fi

exit "$EXIT_FLAG"
