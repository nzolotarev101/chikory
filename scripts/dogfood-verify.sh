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

# ── args: [<run-id>] [--facts [<path>]] ─────────────────────────────────────
# --facts additionally writes every number this script already computes as JSON,
# so the report scaffold and the ledger row stop being retyped by hand. The
# markdown on stdout is unchanged either way.
ARG_RUN_ID=""
FACTS_PATH=""
WANT_FACTS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --facts)
      WANT_FACTS=1
      case "${2:-}" in
        ""|--*) shift ;;
        *) FACTS_PATH="$2"; shift 2 ;;
      esac
      ;;
    -h|--help)
      echo "Usage: $0 [<run-id>] [--facts [<path>]]" >&2; exit 0 ;;
    --*)
      echo "Error: unknown flag $1 (expected --facts)" >&2; exit 2 ;;
    *)
      [ -z "$ARG_RUN_ID" ] || { echo "Error: unexpected extra argument $1" >&2; exit 2; }
      ARG_RUN_ID="$1"; shift ;;
  esac
done

# ── resolve run-id (positional > env > newest run dir) ───────────────────────
RUN_ID="${ARG_RUN_ID:-${DOGFOOD_RUN_ID:-${RUN_ID:-}}}"
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
[ "$WANT_FACTS" -eq 1 ] && [ -z "$FACTS_PATH" ] && FACTS_PATH=".chikory/review/$RUN_ID.facts.json"

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
  // F-193: the check MUST keep its newlines. Collapsing whitespace turns a
  // multi-line `check: |` block into one line, which (a) folds a `//` JS
  // comment over the rest of a `node -e` script (SyntaxError: Unexpected end
  // of input) and (b) glues consecutive shell commands into one argv. Both
  // report a FALSE FAIL for a delivery the judge's own (newline-preserving)
  // runner passes. One line per record, so the body travels base64.
  out.push(`CHECK\t${ac.id}\t${Buffer.from(ac.check ?? "", "utf8").toString("base64")}`);
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

# ── facts the report header and the ledger row are otherwise retyped from ────
# All of it already lives in the trace header + totals lines this script owns.
TRACE_HEAD="$(printf '%s\n' "$TRACE_OUT" | grep -E "^run $RUN_ID ·" | head -n 1)"
TERMINAL="$(printf '%s\n' "$TRACE_HEAD" | grep -oE '· (SUCCESS|FAILED|RUNNING|PARKED|HALTED) ·' | head -n 1 | tr -d '· ')"
WALL_CLOCK="$(printf '%s\n' "$TRACE_HEAD" | grep -oE '· ([0-9]+h )?([0-9]+m )?[0-9]+s ·' | head -n 1 | sed 's/^· //; s/ ·$//')"
EXECUTOR="$(printf '%s\n' "$TRACE_HEAD" | grep -oE 'executor [^·]+' | head -n 1 | sed 's/^executor //; s/ *$//')"
JUDGE_FAMILY="$(printf '%s\n' "$TRACE_HEAD" | grep -oE 'judge [^·]+' | head -n 1 | sed 's/^judge //; s/ *$//')"
totals_num() { printf '%s\n' "$TRACE_OUT" | grep -oE "$1 [0-9]+" | head -n 1 | grep -oE '[0-9]+$'; }
ROLLBACKS="$(totals_num rollbacks)"; ESCALATIONS="$(totals_num escalations)"
CHECKPOINTS="$(totals_num checkpoints)"; INJECTIONS="$(totals_num injections)"
JUDGE_PASSES="$(totals_num 'judge passes')"
# A resume re-executes a step, journalled as `resumed` — absent on clean runs.
# Word-anchored: `resume` appears in judge rationales and must not inflate this.
RESUMES="$(printf '%s\n' "$TRACE_OUT" | grep -cwE 'resumed' || true)"

# ── 2. per-step salient lines (diff bytes · cost · checkpoint · judge) ───────
echo "## 2. Per-step evidence (diff bytes · cost · checkpoint · judge)"
PROBE_STEP=""
PROBE_COST=""
PRECISE_TOTAL=0   # sum of step + judge costs (exact denominator for cost-share)
STEP_ROWS=""      # n \t cost \t diffBytes \t tokens \t wall \t verdict  (for --facts)
for ((n=1; n<=STEPS; n++)); do
  S="$(trace "$RUN_ID" --step "$n")"
  HEAD_LINE="$(printf '%s\n' "$S" | grep -E "^step $n ·" | head -n 1)"
  STEP_COST="$(printf '%s\n' "$HEAD_LINE" | grep -oE '\$[0-9]+\.[0-9]+' | head -n 1 | tr -d '$')"
  DIFF_BYTES="$(printf '%s\n' "$S" | grep -E '^diff:' | grep -oE '[0-9]+ bytes' | head -n 1 | grep -oE '[0-9]+')"
  DIFF_BYTES="${DIFF_BYTES:-?}"
  STEP_TOKENS="$(printf '%s\n' "$HEAD_LINE" | grep -oE '[0-9.]+k?/[0-9.]+k? tokens' | head -n 1 | sed 's/ tokens$//')"
  STEP_WALL="$(printf '%s\n' "$HEAD_LINE" | grep -oE '· ([0-9]+h )?([0-9]+m )?[0-9]+s ·' | head -n 1 | sed 's/^· //; s/ ·$//')"
  STEP_VERDICT="$(printf '%s\n' "$S" | grep -E '^verdict:' | head -n 1 | sed 's/^verdict: *//')"
  STEP_ROWS="${STEP_ROWS}${n}	${STEP_COST:-}	${DIFF_BYTES}	${STEP_TOKENS:-}	${STEP_WALL:-}	${STEP_VERDICT:-}
"
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
AC_ROWS=""        # id \t PASS|FAIL \t exit  (for --facts)
CHECK_LINES="$(printf '%s\n' "$JOURNAL_OUT" | grep '^CHECK')"
if [ -z "$CHECK_LINES" ]; then
  echo "_(no acceptance_criteria found in journal task_json)_"
fi
while IFS=$'\t' read -r _tag ID CHECK_B64; do
  [ -z "${ID:-}" ] && continue
  # F-193: decode back to the EXACT bytes the judge ran, newlines included.
  CHECK="$(printf '%s' "$CHECK_B64" | base64 -d)"
  set +e
  OUT="$(cd "$AC_CWD" && bash -c "$CHECK" 2>&1)"
  RC=$?
  set -u
  if [ "$RC" -eq 0 ]; then STAT="PASS"; else STAT="FAIL"; AC_FAILED=1; fi
  AC_ROWS="${AC_ROWS}${ID}	${STAT}	${RC}
"
  # F-419 (dogfood-161): the tail below is a SUMMARY, not the evidence. A red
  # VERIFY-SUITE check prints its counts in the last lines and the failing test's
  # NAME hundreds of lines earlier, so `tail -n 8` threw away the only thing the
  # reviewer needed. Persist the full output the way `dogfood-arm.sh` already
  # does, and print the path.
  AC_LOG=".chikory/review/ac-$RUN_ID-$ID.log"
  mkdir -p "$(dirname "$AC_LOG")"
  printf '%s\n' "$OUT" > "$AC_LOG"
  echo "**$ID — $STAT** (exit $RC)"
  echo '```'
  echo "\$ $CHECK"
  printf '%s\n' "$OUT" | grep -vE '^\(node:|ExperimentalWarning|--trace-warnings|Running script|webpack |Workflow bundle|optional modules|__temporal|asset workflow|modules by path|runtime modules|\+ [0-9]+ modules|\[built\]' | tail -n 8
  echo '```'
  if [ "$RC" -ne 0 ]; then
    # The failure lines, hoisted out of the full log so a red check names what broke.
    echo "_failure lines (full output: \`$AC_LOG\`)_"
    echo '```'
    grep -nE '(^|[[:space:]])(FAIL|×|✕|AssertionError|Error:|error TS[0-9]|SyntaxError|Cannot find module)' "$AC_LOG" \
      | grep -vE 'ExperimentalWarning|--trace-warnings' | head -n 20
    echo '```'
  else
    echo "_full output: \`$AC_LOG\`_"
  fi
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
# Captured (not piped straight to stdout) so --facts can report the same verdicts
# without re-walking the tree — a pipeline `while` runs in a subshell and would
# lose them.
HARVEST_ROWS="$(
  (git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard) \
    | sort -u | grep -E '^(packages|services|benchmarks)/' | while read -r f; do
    if [ -f "$WORKSPACE/$f" ]; then
      if diff -q "$f" "$WORKSPACE/$f" >/dev/null 2>&1; then
        printf 'IDENTICAL\t%s\n' "$f"
      else
        printf 'DIFFERS\t%s\n' "$f"
      fi
    else
      printf 'not-in-workspace\t%s\n' "$f"
    fi
  done
)"
printf '%s\n' "$HARVEST_ROWS" | awk -F'\t' 'NF>1{
  if ($1 == "IDENTICAL")            printf "IDENTICAL: %s\n", $2;
  else if ($1 == "DIFFERS")         printf "DIFFERS:   %s  (working tree ≠ run workspace — investigate)\n", $2;
  else                              printf "not-in-workspace: %s  (file the run did not produce — e.g. review docs)\n", $2;
}'
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

# ── facts blob (--facts) ─────────────────────────────────────────────────────
# Everything above, machine-readable, so `dogfood-docs.sh scaffold`/`ledger` do
# not retype it. Values travel through the environment (never string-interpolated
# into the node source) so a spec name or commit subject with quotes is safe.
if [ "$WANT_FACTS" -eq 1 ]; then
  mkdir -p "$(dirname "$FACTS_PATH")"
  BUDGET_PCT=""
  if [ -n "$TOTAL_COST" ] && [ -n "$BUDGET" ]; then
    BUDGET_PCT="$(awk -v t="$TOTAL_COST" -v b="$BUDGET" 'BEGIN{ if(b>0) printf "%.1f", t/b*100 }')"
  fi
  F_RUN_ID="$RUN_ID" F_SPEC="${SPEC_NAME:-}" F_BUDGET="${SPEC_BUDGET:-}" \
  F_TERMINAL="${TERMINAL:-}" F_STEPS="$STEPS" F_WALL="${WALL_CLOCK:-}" \
  F_COST_HEADER="${TOTAL_COST:-}" F_COST_EXACT="${PRECISE_TOTAL:-}" \
  F_BUDGET_PCT="${BUDGET_PCT:-}" F_JUDGE_SHARE="${JUDGE_SHARE:-}" \
  F_EXECUTOR="${EXECUTOR:-}" F_JUDGE="${JUDGE_FAMILY:-}" \
  F_ROLLBACKS="${ROLLBACKS:-0}" F_ESCALATIONS="${ESCALATIONS:-0}" \
  F_CHECKPOINTS="${CHECKPOINTS:-0}" F_INJECTIONS="${INJECTIONS:-0}" \
  F_JUDGE_PASSES="${JUDGE_PASSES:-0}" F_RESUMES="${RESUMES:-0}" \
  F_HARVEST_COMMIT="${HARVEST_COMMIT:-}" F_HEAD="$(git log --oneline -1)" \
  F_AC_FAILED="$AC_FAILED" F_AC_CWD_LABEL="$AC_CWD_LABEL" \
  F_PROBE_STEP="${PROBE_STEP:-}" F_PROBE_COST="${PROBE_COST:-}" \
  F_STEP_ROWS="$STEP_ROWS" F_AC_ROWS="$AC_ROWS" F_HARVEST_ROWS="$HARVEST_ROWS" \
  F_OUT="$FACTS_PATH" node - <<'NODE'
const { writeFileSync } = require("node:fs");
const e = process.env;
const rows = (raw, keys) =>
  (raw ?? "").split("\n").filter((l) => l.trim() !== "").map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""]));
  });
const num = (v) => (v === "" || v === undefined ? null : Number(v));
const facts = {
  runId: e.F_RUN_ID,
  spec: e.F_SPEC || null,
  head: e.F_HEAD || null,
  harvestCommit: e.F_HARVEST_COMMIT || null,
  harvested: Boolean(e.F_HARVEST_COMMIT),
  terminal: e.F_TERMINAL || null,
  steps: num(e.F_STEPS),
  wallClock: e.F_WALL || null,
  cost: {
    header: num(e.F_COST_HEADER),
    exact: num(e.F_COST_EXACT),
    budget: num(e.F_BUDGET),
    budgetPct: num(e.F_BUDGET_PCT),
    judgeShare: e.F_JUDGE_SHARE || null,
  },
  executor: e.F_EXECUTOR || null,
  judge: e.F_JUDGE || null,
  totals: {
    judgePasses: num(e.F_JUDGE_PASSES),
    rollbacks: num(e.F_ROLLBACKS),
    escalations: num(e.F_ESCALATIONS),
    checkpoints: num(e.F_CHECKPOINTS),
    injections: num(e.F_INJECTIONS),
    resumes: num(e.F_RESUMES),
  },
  probeStep: e.F_PROBE_STEP ? { step: num(e.F_PROBE_STEP), costUsd: num(e.F_PROBE_COST) } : null,
  acCwdLabel: e.F_AC_CWD_LABEL || null,
  acAllPass: e.F_AC_FAILED === "0",
  perStep: rows(e.F_STEP_ROWS, ["step", "costUsd", "diffBytes", "tokens", "wallClock", "verdict"]),
  acceptanceChecks: rows(e.F_AC_ROWS, ["id", "status", "exit"]),
  harvest: rows(e.F_HARVEST_ROWS, ["status", "path"]),
};
// null = nothing to compare (the delivery is already committed, so the working
// tree is clean) — distinct from false, which means a file genuinely DIFFERS.
facts.harvestIdentical =
  facts.harvest.length === 0 ? null : facts.harvest.every((h) => h.status === "IDENTICAL");
writeFileSync(e.F_OUT, JSON.stringify(facts, null, 2) + "\n");
process.stderr.write(`facts written: ${e.F_OUT}\n`);
NODE
  echo
  echo "_facts: \`$FACTS_PATH\` (machine-readable — feeds \`dogfood-docs.sh scaffold\`/\`ledger\`)_"
  echo
fi

# ── verdict line ─────────────────────────────────────────────────────────────
if [ "$AC_FAILED" -eq 0 ]; then
  echo "_All acceptance checks PASS. Mechanical pack clean — proceed to skill phases 3-5 (anomaly hunt, report, living docs, next spec). Phase 2's line-by-line diff-vs-goal review and the phase-3 anomaly checklist are still done by hand._"
else
  echo "_⚠ One or more acceptance checks FAILED — investigate before writing the report._"
fi
