#!/usr/bin/env bash
# Mechanical evidence pack for a finished dogfood run — the scripted half of
# the /dogfood-review skill (phases 1-2). It reconstructs the run, re-runs
# every acceptance check against the working tree, byte-diffs the harvested
# files against the run workspace, and computes the cost-share math, then
# prints one markdown block the reviewer reasons over. It does NOT write the
# report or touch any living doc — judgment stays human (skill phases 3-5).
#
# The acceptance checks are read from the run's OWN journal (`task_json`), not
# a separately-resolved yaml, so the checks always match the run under review.
#
# Usage:
#   devbox run -- bash scripts/dogfood-verify.sh <run-id>  # explicit
#   devbox run dogfood-verify                              # newest run
#
# NOTE: `devbox run` does NOT forward positional args to shell.scripts. Do not
# prefix `devbox run` with an env assignment for the run id: Devbox 0.17.0 can
# make Vitest global setup abort when invoked that way. Use the direct script
# form above, inside devbox. RUN_ID/DOGFOOD_RUN_ID remain legacy fallbacks for
# callers already inside `devbox shell`.
#
# Runs bare toolchain binaries (pnpm/chikory/git/node) — invoke it THROUGH
# devbox (`devbox run dogfood-verify`), never add a nested `devbox run` inside.

set -uo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# ── resolve run-id (positional $1 > env > newest run dir) ────────────────────
RUN_ID="${1:-${DOGFOOD_RUN_ID:-${RUN_ID:-}}}"
if [ -z "$RUN_ID" ]; then
  RUN_ID="$(ls -t .chikory/runs/ 2>/dev/null | head -n 1)"
fi
if [ -z "$RUN_ID" ] || [ ! -d ".chikory/runs/$RUN_ID" ]; then
  echo "Error: run dir .chikory/runs/$RUN_ID not found" >&2
  exit 1
fi
# Keep the legacy selector out of acceptance-check environments. Explicit
# devbox invocation must still use the positional form documented above.
export -n RUN_ID
JOURNAL=".chikory/runs/$RUN_ID/journal.db"
WORKSPACE=".chikory/runs/$RUN_ID/workspace"

# ── pull name / budget / repos / acceptance checks straight from the journal ─
# Prints: "NAME<TAB>...", "BUDGET<TAB>...", "HOSTREPO<TAB>0|1", then
# "CHECK<TAB>id<TAB>cmd" per AC. HOSTREPO=1 when a writable spec repo IS this
# checkout (brownfield — delivery is harvested to the working tree).
read_journal() {
  JOURNAL_PATH="$JOURNAL" REPO_ROOT="$REPO_ROOT" node - <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const { realpathSync } = require("node:fs");
const db = new DatabaseSync(process.env.JOURNAL_PATH);
const row = db.prepare("select task_json from runs limit 1").get();
const spec = JSON.parse(row.task_json);
const out = [];
out.push(`NAME\t${spec.name ?? "(unknown)"}`);
out.push(`BUDGET\t${spec.budgetUsd ?? spec.budget_usd ?? "?"}`);
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const root = real(process.env.REPO_ROOT);
const hostRepo = (spec.repos ?? []).some(
  (repo) => repo.writable && real(repo.url) === root,
);
out.push(`HOSTREPO\t${hostRepo ? 1 : 0}`);
const criteria = spec.acceptanceCriteria ?? spec.acceptance_criteria ?? [];
for (const ac of criteria) {
  out.push(`CHECK\t${ac.id}\t${(ac.check ?? "").replace(/\s+/g, " ").trim()}`);
}
process.stdout.write(out.join("\n") + "\n");
NODE
}

JOURNAL_OUT="$(read_journal 2>/dev/null)"
SPEC_NAME="$(printf '%s\n' "$JOURNAL_OUT" | awk -F'\t' '/^NAME/{print $2}')"
SPEC_BUDGET="$(printf '%s\n' "$JOURNAL_OUT" | awk -F'\t' '/^BUDGET/{print $2}')"
SPEC_HOSTREPO="$(printf '%s\n' "$JOURNAL_OUT" | awk -F'\t' '/^HOSTREPO/{print $2}')"

# F-128: a scaffold-hosted run (no writable spec repo == this checkout) never
# harvests into the host tree, so its ACs only hold inside the run's own
# workspace. Brownfield runs re-verify the working tree (the harvest).
if [ "${SPEC_HOSTREPO:-1}" = "1" ] || [ ! -d "$WORKSPACE" ]; then
  AC_CWD="$REPO_ROOT"
  AC_CWD_LABEL="working tree (brownfield — harvested delivery)"
else
  AC_CWD="$WORKSPACE"
  AC_CWD_LABEL="run workspace (scaffold-hosted — delivery never harvested, F-128)"
fi

# strip the SQLite experimental-warning noise chikory trace emits
trace() { pnpm chikory trace "$@" 2>/dev/null | grep -vE '^\(node:|ExperimentalWarning|--trace-warnings|Running script|^\$ chikory'; }

echo "# dogfood-verify"
echo
echo "- run-id:  \`$RUN_ID\`"
echo "- spec:    \`${SPEC_NAME:-?}\` (from journal task_json — checks below are the run's own)"
echo "- budget:  \$${SPEC_BUDGET:-?}"
echo "- HEAD:    \`$(git log --oneline -1)\`"
HARVEST_COMMIT="$(git log --grep "$RUN_ID" --oneline | head -n 1)"
HARVEST_REF="${HARVEST_COMMIT%% *}"
echo "- harvest: ${HARVEST_COMMIT:-'(none — uncommitted on working tree)'}"
echo

# ── 1. trace ────────────────────────────────────────────────────────────────
echo "## 1. Trace (header · rows · totals)"
echo '```'
TRACE_OUT="$(trace "$RUN_ID")"
echo "$TRACE_OUT"
echo '```'
echo

STEPS="$(printf '%s\n' "$TRACE_OUT" | grep -oE '· [0-9]+ steps? ·' | grep -oE '[0-9]+' | head -n 1)"
TOTAL_COST="$(printf '%s\n' "$TRACE_OUT" | grep -oE '\$[0-9]+\.[0-9]+ / \$' | head -n 1 | grep -oE '[0-9]+\.[0-9]+')"
BUDGET="$(printf '%s\n' "$TRACE_OUT" | grep -oE '/ \$[0-9]+\.[0-9]+' | head -n 1 | grep -oE '[0-9]+\.[0-9]+')"
JUDGE_SHARE="$(printf '%s\n' "$TRACE_OUT" | grep -oE 'judge passes [0-9]+ \(\$[0-9.]+, [0-9.]+%\)' | grep -oE '[0-9.]+%' | head -n 1)"
STEPS="${STEPS:-0}"

# ── 2. per-step salient lines (diff bytes · cost · checkpoint · judge) ───────
echo "## 2. Per-step evidence (diff bytes · cost · checkpoint · judge)"
PROBE_STEP=""
PROBE_COST=""
PRECISE_TOTAL=0   # sum of step + judge costs (exact denominator for cost-share)
for ((n=1; n<=STEPS; n++)); do
  S="$(trace "$RUN_ID" --step "$n")"
  HEAD_LINE="$(printf '%s\n' "$S" | grep -E "^step $n ·" | head -n 1)"
  STEP_COST="$(printf '%s\n' "$HEAD_LINE" | grep -oE '\$[0-9]+\.[0-9]+' | head -n 1 | tr -d '$')"
  DIFF_BYTES="$(printf '%s\n' "$S" | grep -E '^diff:' | grep -oE '[0-9]+ bytes' | head -n 1 | grep -oE '[0-9]+')"
  DIFF_BYTES="${DIFF_BYTES:-?}"
  # exact-cost accumulation: this step + any judge passes it carries
  JUDGE_COSTS="$(printf '%s\n' "$S" | grep -E '^judge pass' | grep -oE '\$[0-9]+\.[0-9]+' | tr -d '$' | paste -sd' ' -)"
  PRECISE_TOTAL="$(awk -v t="$PRECISE_TOTAL" -v s="${STEP_COST:-0}" -v j="$JUDGE_COSTS" 'BEGIN{ x=t+s; split(j,a," "); for(i in a) x+=a[i]; printf "%.4f", x }')"
  echo
  echo "### step $n  —  cost \$${STEP_COST:-?}  ·  diff ${DIFF_BYTES} bytes"
  echo '```'
  printf '%s\n' "$S" | grep -E '^step [0-9]|^diff: |^checkpoint: |^judge pass|^verdict: |^rationale: |^  criteria:|^  rubric:|^    [✓✗]' | head -n 40
  echo '```'
  if [ "$DIFF_BYTES" = "0" ]; then
    PROBE_STEP="$n"; PROBE_COST="$STEP_COST"
  fi
done
echo

# ── 3. acceptance checks — re-run where the delivery lives (F-128) ───────────
echo "## 3. Acceptance checks (the run's own, re-run in the $AC_CWD_LABEL)"
echo
echo "cwd: \`$AC_CWD\`"
echo
AC_FAILED=0
CHECK_LINES="$(printf '%s\n' "$JOURNAL_OUT" | grep '^CHECK')"
if [ -z "$CHECK_LINES" ]; then
  echo "_(no acceptance_criteria found in journal task_json)_"
fi
while IFS=$'\t' read -r _tag ID CHECK; do
  [ -z "${ID:-}" ] && continue
  set +e
  OUT="$(cd "$AC_CWD" && bash -c "$CHECK" 2>&1)"
  RC=$?
  set -u
  if [ "$RC" -eq 0 ]; then STAT="PASS"; else STAT="FAIL"; AC_FAILED=1; fi
  echo "**$ID — $STAT** (exit $RC)"
  echo '```'
  echo "\$ $CHECK"
  printf '%s\n' "$OUT" | grep -vE '^\(node:|ExperimentalWarning|--trace-warnings|Running script|webpack |Workflow bundle|optional modules|__temporal|asset workflow|modules by path|runtime modules|\+ [0-9]+ modules|\[built\]' | tail -n 8
  echo '```'
  echo
done <<< "$CHECK_LINES"

# ── 4. scope ─────────────────────────────────────────────────────────────────
echo "## 4. Scope (git status --short)"
echo '```'
git status --short
echo '```'
echo

# ── 5. harvest byte-diff (working tree vs run workspace) ─────────────────────
echo "## 5. Harvest byte-diff (working tree vs $WORKSPACE)"
echo '```'
(git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard) | sort -u | grep -E '^(packages|services|benchmarks)/' | while read -r f; do
  if [ -f "$WORKSPACE/$f" ]; then
    if diff -q "$f" "$WORKSPACE/$f" >/dev/null 2>&1; then
      echo "IDENTICAL: $f"
    else
      echo "DIFFERS:   $f  (working tree ≠ run workspace — investigate)"
    fi
  else
    echo "not-in-workspace: $f  (file the run did not produce — e.g. review docs)"
  fi
done
echo '```'
echo

# ── 6. landed commit scope (run workspace diff vs landed commit) ─────────────
echo "## 6. Landed commit scope"
echo '```'
if [ -n "$HARVEST_COMMIT" ]; then
  echo "landed commit lookup: $HARVEST_COMMIT"
  bash scripts/dogfood-landed-scope.sh "$WORKSPACE" "$HARVEST_REF" || true
else
  echo "no landed commit found for run id $RUN_ID"
  echo "manual check: bash scripts/dogfood-landed-scope.sh \"$WORKSPACE\" <commit-or-ref>"
fi
echo '```'
echo

# ── 7. cost-share ────────────────────────────────────────────────────────────
echo "## 7. Cost-share"
echo '```'
echo "total (header)    : \$${TOTAL_COST:-?} / budget \$${BUDGET:-?}"
echo "total (exact sum) : \$${PRECISE_TOTAL}  (steps + judge passes — cost-share denominator)"
if [ -n "$TOTAL_COST" ] && [ -n "$BUDGET" ]; then
  awk -v t="$TOTAL_COST" -v b="$BUDGET" 'BEGIN{ if(b>0) printf "budget used       : %.1f%%\n", t/b*100 }'
fi
echo "judge share       : ${JUDGE_SHARE:-?} (from totals line)"
if [ -n "$PROBE_STEP" ]; then
  echo "probe step        : step $PROBE_STEP (empty diff) — \$$PROBE_COST"
  if [ -n "$PROBE_COST" ]; then
    awk -v p="$PROBE_COST" -v t="$PRECISE_TOTAL" 'BEGIN{ if(t>0) printf "probe share       : %.1f%% of run cost  ← F-11 (WP-221) data point\n", p/t*100 }'
  fi
else
  echo "probe step        : none detected (no empty-diff step) — F-11 did not recur this run"
fi
echo '```'
echo

# ── verdict line ─────────────────────────────────────────────────────────────
if [ "$AC_FAILED" -eq 0 ]; then
  echo "_All acceptance checks PASS. Mechanical pack clean — proceed to skill phases 3-5 (anomaly hunt, report, living docs, next spec). Phase 2's line-by-line diff-vs-goal review and the phase-3 anomaly checklist are still done by hand._"
else
  echo "_⚠ One or more acceptance checks FAILED — investigate before writing the report._"
fi
