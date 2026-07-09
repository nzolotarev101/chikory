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
#   bash scripts/dogfood-progression.sh                        # trend report + verdict
#   bash scripts/dogfood-progression.sh --spec <yaml>          # + lint a candidate spec
#   bash scripts/dogfood-progression.sh --spec <yaml> --preflight
#                                       # + launch-strict: ALSO refuse when the dry-run
#                                       #   finds NO RED-on-HEAD AC (no armed challenge)
#
# Data source: docs/reports/dogfood-ledger.csv — one row per terminal run,
# appended by /dogfood-review phase 4 (columns: run,wp,mode,outcome,steps,
# cost_usd,spec_format,class,resumes,judge_catches,rung,rollbacks).
#   spec_format: loose (outcome+ACs) | prescribed (diff dictated in goal)
#   class:       product (router/executors/runner/judge/chain/memory runtime)
#                | meta (scripts/, examples/dogfood/, launch prechecks,
#                        spec hygiene, verifier plumbing) — DOGFOODING §1.5
#   rung:        highest WP-265 horizon-ladder rung this run satisfied (0 = none)
#   rollbacks:   judge ROLLBACK verdicts in the run (`chikory trace` totals) —
#                feeds the §1.4 per-step reliability KPI. Rows before dogfood-084
#                predate the column; they are EXCLUDED from the KPI (not read
#                as 0 — absence of data is not evidence of reliability).
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
# Exit code: 0 = PROGRESSING, 1 = STALLED (callers can gate on it), 2 = usage,
#            3 = candidate-spec AC lint ⛔ (WP-266: loose AC file-pins / prose-greps /
#                broken checks found by the dynamic dry-run; under --preflight also
#                a spec with zero RED-on-HEAD ACs — no armed challenge).

set -euo pipefail

LEDGER="docs/reports/dogfood-ledger.csv"
SPEC=""
PREFLIGHT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC="${2:?--spec requires a path}"; shift 2 ;;
    --preflight) PREFLIGHT=1; shift ;;
    *) echo "Usage: $0 [--spec <yaml>] [--preflight]" >&2; exit 2 ;;
  esac
done

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
    cost[n]=$6+0; fmt[n]=$7; cls[n]=$8; res[n]=$9+0; catch[n]=$10+0; rung[n]=$11+0
    roll[n] = (NF >= 12) ? $12+0 : -1 }   # -1 = row predates the rollbacks column
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

    # §1.4 per-step reliability — steps sealed without a judge ROLLBACK ÷ total
    # steps, over runs ≥5 steps that carry rollback data. The thesis number
    # (target 99%+): computed, not recalled, and honest about missing data.
    relSteps=0; relRolls=0; relRuns=0
    for (i = 1; i <= n; i++)
      if (roll[i] >= 0 && steps[i] >= 5) { relSteps += steps[i]; relRolls += roll[i]; relRuns += 1 }
    if (relRuns > 0)
      printf "**Per-step reliability (§1.4):** %.1f%% (%d rollbacks over %d steps, %d runs ≥5 steps) — target 99%%+\n\n",
        100 * (relSteps - relRolls) / relSteps, relRolls, relSteps, relRuns
    else
      printf "**Per-step reliability (§1.4):** unmeasured — no ≥5-step run with rollback data yet (column starts dogfood-084).\n\n"

    if (metaA > 1)
      printf "🔴 **CAP BUSTED (DOGFOODING §1.5):** %d harness-meta headlines in the trailing 3 (cap is ≤1). Next headline MUST be class=product.\n\n", metaA

    # §1.5 ladder pace (advisory): steps/resumes can keep PROGRESSING green
    # while the rung sits still — the second incrementalism era. Flag it.
    if (n >= 6 && rungA > 0 && rungA <= rungB)
      printf "⚠️  **LADDER PACE (§1.5):** the rung has not advanced across the trailing 3 headlines (still %d). Next headline should climb rung %d or the review must record why not.\n\n", rungA, rungA + 1

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

  # ---------- WP-266: loose-spec AC-check lint (F-82 file-pin + F-83 prose-grep) ----------
  # A LOOSE spec delegates file layout AND implementation to the executor, so its ACs must
  # anchor on OUTCOME SYMBOLS the goal NAMES — never file-exist-pin a delegated path (F-82,
  # dogfood-075) and never negative-grep a BARE WORD that also matches comments/strings/prose
  # (F-83, dogfood-076: `! grep 'execFile|spawn'` matched the comment "…is spawned").
  LINT_HIT=0
  if [ "$PRESCRIBED" -eq 0 ]; then
    AC_BLOCK=$(awk '/^acceptance_criteria:/{f=1} f' "$SPEC")
    if printf '%s\n' "$AC_BLOCK" | grep -qE 'test +-[fe] '; then
      echo "⛔ F-82: an AC \`check\` uses \`test -f\`/\`test -e\` — a LOOSE spec must not pin a file"
      echo "    the goal delegates; grep an OUTCOME symbol the goal NAMES instead."
      printf '%s\n' "$AC_BLOCK" | grep -nE 'test +-[fe] ' | sed 's/^/      /'
      LINT_HIT=1
    fi
    NEG=$(printf '%s\n' "$AC_BLOCK" | grep -E '(! *grep|grep +-[a-zA-Z]*v)' || true)
    # A bare-word negated pattern = quoted pattern of only [A-Za-z0-9|_-] (no `(` / `\b` / `=`
    # code anchor) — it will fire on the term wherever it appears, comments and prose included.
    if [ -n "$NEG" ] && printf '%s\n' "$NEG" | grep -qE "'[A-Za-z0-9|_-]+'"; then
      echo "⛔ F-83: a negative AC grep matches a BARE WORD — it also fires on the term in COMMENTS,"
      echo "    STRINGS, or prose (dogfood-076). Anchor to a call form (e.g. \`\\bspawn\\(\`) or scope"
      echo "    out comments; a negative grep over source must never test a plain identifier/word."
      printf '%s\n' "$NEG" | sed 's/^/      /'
      LINT_HIT=1
    fi
    # F-119 (dogfood-091): a `grep -c`/`grep -rc` count piped into an arithmetic `test` is
    # UNSATISFIABLE over a delegated (loose) path — `grep -rc <dir>` emits one `path:count`
    # line PER FILE, so `test "$(...)" -ge N` gets a MULTI-LINE string → `integer expression
    # expected` → exit ≠0 on EVERY judge pass no matter how correct the delivery. That turns the
    # judge's "AC failed 3+ consecutive → HALT" budget-waste guard into a guaranteed false-FAILED.
    # Match PER LINE (the count-grep and the arithmetic `test` on ONE line — how a folded `check:`
    # scalar renders) so a `grep -rc` mentioned in an AC `description:` prose does NOT false-trip
    # (F-83's own lesson). The safe idioms `grep -roh`/`grep -rl … | wc -l` have no `c` flag.
    F119=$(printf '%s\n' "$AC_BLOCK" | grep -nE 'test .*grep +-[a-zA-Z]*c\b.*-(ge|le|eq|ne|lt|gt)\b' || true)
    if [ -n "$F119" ]; then
      echo "⛔ F-119: an AC pipes a \`grep -c\`/\`grep -rc\` count into an arithmetic \`test\` —"
      echo "    over a LOOSE (delegated) path this is MULTI-LINE (\`path:count\` per file) and"
      echo "    \`test -ge\` fails with 'integer expression expected' on EVERY pass → false-HALT."
      echo "    Use an occurrence count \`grep -roh PAT PATH | wc -l\` or file count"
      echo "    \`grep -rl PAT PATH | wc -l\` piped into \`test\` instead."
      printf '%s\n' "$F119" | sed 's/^/      /'
      LINT_HIT=1
    fi
    if [ "$LINT_HIT" -eq 0 ]; then
      echo "🟢 AC checks: no F-82 file-pin / F-83 prose-grep hazard (WP-266 lint)."
    fi
  fi

  # ---------- WP-266 dynamic AC dry-run (F-119/F-121 class — EXECUTE every check) ----------
  # The static patterns above only catch KNOWN bad idioms, and each new class (F-82, F-83,
  # F-114, F-119) arrived one burned run at a time. Executing every AC `check` against the
  # CURRENT TREE before any LLM spend is the GENERIC guard — it classifies each check by
  # what a sound spec must look like BEFORE its delivery exists:
  #   exit 1  → RED-on-HEAD    🟢 the challenge is armed (a new-work AC must start red)
  #   exit 0  → GREEN-on-HEAD  ⚠️ can't gate new work (F-90/F-114 false-green hazard,
  #             unless it is a deliberate regression guard)
  #   exit ≥2 → BROKEN CHECK   ⛔ the check ERRORS instead of failing cleanly (F-119's
  #             `integer expression expected` was exit 2) — it can NEVER gate correctly;
  #             fatal in EVERY context (also catches multi-line folds the static regex,
  #             which matches one physical line, cannot see)
  # Suite-shaped checks (vitest/tsc/eslint/pnpm/pytest/ruff) are NOT executed — they run
  # minutes and are legitimately green pre-delivery (regression ACs); labeled VERIFY-SUITE.
  # Under --preflight (the scripts/dogfood.sh launch path) a spec whose executable ACs are
  # ALL green/absent is REFUSED: zero RED-on-HEAD ACs means the run has NO enforced
  # challenge — the F-121 lesson generalized (a challenge that silently isn't armed).
  echo
  echo "### AC dry-run against the current tree (WP-266 dynamic)"
  AC_TSV=""
  if command -v node >/dev/null 2>&1; then
    AC_TSV=$(node -e '
      const fs = require("fs"), path = require("path");
      const yaml = require(path.resolve("packages/sdk-ts/node_modules/yaml"));
      const spec = yaml.parse(fs.readFileSync(process.argv[1], "utf8"));
      for (const ac of spec.acceptance_criteria ?? []) {
        const check = String(ac.check ?? "").replace(/\s+/g, " ").trim();
        if (check) console.log(`${ac.id}\t${check}`);
      }' "$SPEC" 2>/dev/null || true)
  fi
  if [ -z "$AC_TSV" ]; then
    echo "⚠️  Could not extract AC checks (node/yaml unavailable or spec unparsable) — dry-run SKIPPED."
  else
    RED_ACS=0
    EXECUTED_ACS=0
    while IFS="$(printf '\t')" read -r AC_ID AC_CHECK; do
      [ -z "$AC_ID" ] && continue
      if printf '%s' "$AC_CHECK" | grep -qE '(vitest|tsc --noEmit|eslint|pnpm (run|exec|-r)|pytest|ruff)'; then
        echo "ℹ️  $AC_ID: VERIFY-SUITE — not dry-run (minutes-long; legitimately green pre-delivery)."
        continue
      fi
      ERR_FILE=$(mktemp)
      set +e
      # alarm(2) survives execve, so the 60s watchdog rides into bash; SIGALRM → exit 142.
      perl -e 'alarm 60; exec "bash", "-c", $ARGV[0]' "$AC_CHECK" >/dev/null 2>"$ERR_FILE"
      AC_RC=$?
      set -e
      EXECUTED_ACS=$((EXECUTED_ACS + 1))
      if [ "$AC_RC" -eq 0 ]; then
        echo "⚠️  $AC_ID: GREEN-on-HEAD — already passes with NO delivery (F-90/F-114 false-green"
        echo "    hazard unless this AC is a deliberate regression guard)."
      elif [ "$AC_RC" -eq 1 ]; then
        RED_ACS=$((RED_ACS + 1))
        echo "🟢 $AC_ID: RED-on-HEAD (clean exit 1) — challenge armed."
      elif [ "$AC_RC" -eq 142 ]; then
        echo "⚠️  $AC_ID: TIMEOUT (60s) — dry-run inconclusive; keep non-suite checks fast."
      else
        STDERR_SNIP=$(head -c 200 "$ERR_FILE" | tr '\n' ' ')
        echo "⛔ $AC_ID: BROKEN CHECK (exit $AC_RC${STDERR_SNIP:+; stderr: $STDERR_SNIP}) — the check"
        echo "    ERRORS instead of failing cleanly (F-119 class): it can NEVER pass, and 3+"
        echo "    consecutive reds convert the judge's budget-waste HALT guard into a guaranteed"
        echo "    false FAILED. Fix the check before launching."
        LINT_HIT=1
      fi
      rm -f "$ERR_FILE"
    done <<EOF_AC
$AC_TSV
EOF_AC
    if [ "$EXECUTED_ACS" -eq 0 ]; then
      echo "⚠️  No executable (non-suite) AC to dry-run — the challenge is UNVERIFIABLE pre-launch."
    elif [ "$RED_ACS" -eq 0 ]; then
      if [ "$PREFLIGHT" -eq 1 ]; then
        echo "⛔ NO CHALLENGE ARMED: every executable AC is ALREADY GREEN on the current tree —"
        echo "    the run could seal SUCCESS having delivered NOTHING. A sound new-work AC must"
        echo "    start RED (exit 1) and flip green only when the delivery lands. Refusing."
        LINT_HIT=1
      else
        echo "⚠️  No RED-on-HEAD AC — at launch (--preflight) this REFUSES: the run would have no"
        echo "    enforced challenge. (Advisory here: the tree may already contain the delivery.)"
      fi
    else
      echo "🟢 Challenge armed: $RED_ACS RED-on-HEAD AC(s) will flip green only when the delivery lands."
    fi
  fi

  if [ "$LINT_HIT" -eq 1 ]; then
    EXIT_FLAG=3
  fi
fi

exit "$EXIT_FLAG"
