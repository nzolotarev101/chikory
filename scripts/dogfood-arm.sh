#!/usr/bin/env bash
# dogfood-arm.sh — arm a candidate spec's acceptance oracle, both directions.
#
# WHY THIS EXISTS
# `dogfood-progression.sh --spec` dry-runs the ACs but DELIBERATELY skips
# suite-shaped ones (`tsc`/`vitest`/`pnpm exec`) because they run for minutes
# and are legitimately green pre-delivery. Those are exactly the BEHAVIORAL ACs
# the /dogfood-review skill then requires be hand-verified in BOTH directions
# with wall-clock recorded against the 120 s judge cap. That gap is what forced
# a throwaway extract-and-time script to be rewritten in every review.
#
# This script runs EVERY AC, suite-shaped included, and reports exit code +
# wall-clock + % of the judge cap.
#
#   RED pass   (on HEAD, before any delivery):  every new-work AC must exit 1.
#   GREEN pass (against a reference impl):      every AC must exit 0.
# An AC verified in only one direction may be unsatisfiable, and the run burns
# before anyone finds out (dogfood-113).
#
# Usage:
#   devbox run -- bash scripts/dogfood-arm.sh <spec.yaml>              # RED pass
#   devbox run -- bash scripts/dogfood-arm.sh <spec.yaml> --green      # GREEN pass
#   devbox run -- bash scripts/dogfood-arm.sh <spec.yaml> --table      # markdown block
#   devbox run -- bash scripts/dogfood-arm.sh <spec.yaml> --discard    # revert the reference
#   devbox run -- bash scripts/dogfood-arm.sh <spec.yaml> --only AC-2  # one AC
#
# Results accumulate in .chikory/review/arm-<spec-basename>.json across passes,
# so --table can emit the finished block after both directions have run.
#
# Runs bare toolchain binaries — invoke THROUGH devbox, never nest `devbox run`.

set -uo pipefail
cd "$(dirname "$0")/.."

JUDGE_CAP_SECONDS=120   # the per-check cap the judge enforces at run time

SPEC=""
MODE="red"
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --green) MODE="green"; shift ;;
    --table) MODE="table"; shift ;;
    --discard) MODE="discard"; shift ;;
    --only) ONLY="${2:?--only requires an AC id}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" >&2; exit 0 ;;
    --*) echo "Error: unknown flag $1" >&2; exit 2 ;;
    *) SPEC="$1"; shift ;;
  esac
done

if [ -z "$SPEC" ]; then
  # Same selector scripts/dogfood.sh uses for the launch spec.
  SPEC="$(ls examples/dogfood/dogfood-[0-9][0-9][0-9]*.yaml 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SPEC" ] || [ ! -f "$SPEC" ]; then
  echo "Error: spec not found: ${SPEC:-<none>}" >&2
  exit 1
fi

SPEC_BASE="$(basename "$SPEC" .yaml)"
STATE=".chikory/review/arm-$SPEC_BASE.json"
mkdir -p .chikory/review

# ── extract the AC checks ───────────────────────────────────────────────────
# Same extractor dogfood-progression.sh uses (the `yaml` package resolved out of
# packages/sdk-ts/node_modules), except the check body is preserved BYTE-EXACT:
# collapsing whitespace folds a `//` comment over the rest of a `node -e` script
# and glues shell commands together (F-193). Bodies travel base64, one per line.
extract_acs() {
  SPEC_PATH="$SPEC" node - <<'NODE'
const fs = require("node:fs"), path = require("node:path");
const yaml = require(path.resolve("packages/sdk-ts/node_modules/yaml"));
const spec = yaml.parse(fs.readFileSync(process.env.SPEC_PATH, "utf8"));
for (const ac of spec.acceptance_criteria ?? spec.acceptanceCriteria ?? []) {
  const check = String(ac.check ?? "");
  if (!check.trim()) continue;
  console.log(`${ac.id}\t${Buffer.from(check, "utf8").toString("base64")}`);
}
NODE
}

if [ "$MODE" = "discard" ]; then
  echo "Reverting tracked modifications (the reference implementation):"
  git status --short
  echo
  read -r -p "git checkout -- . on the paths above? [y/N] " CONFIRM
  case "$CONFIRM" in
    y|Y) git checkout -- . && echo "✅ reverted." ;;
    *) echo "Aborted — nothing reverted." ;;
  esac
  exit 0
fi

if [ "$MODE" = "table" ]; then
  if [ ! -f "$STATE" ]; then
    echo "Error: no arming results yet for $SPEC_BASE — run the RED and GREEN passes first." >&2
    exit 1
  fi
  STATE_PATH="$STATE" CAP="$JUDGE_CAP_SECONDS" node - <<'NODE'
const s = JSON.parse(require("node:fs").readFileSync(process.env.STATE_PATH, "utf8"));
const cap = Number(process.env.CAP);
const ids = [...new Set([...Object.keys(s.red ?? {}), ...Object.keys(s.green ?? {})])].sort();
const cell = (r) =>
  r ? `${r.exit === 1 ? "✅ exit **1**" : r.exit === 0 ? "✅ exit 0" : `⛔ exit ${r.exit}`}, **${r.seconds}s**` : "—";
console.log("| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |");
console.log("|---|---|---|---|");
let worst = 0;
for (const id of ids) {
  const red = s.red?.[id], green = s.green?.[id];
  const secs = Math.max(red?.seconds ?? 0, green?.seconds ?? 0);
  worst = Math.max(worst, secs);
  console.log(`| ${id} | ${cell(red)} | ${cell(green)} | ${Math.round((secs / cap) * 100)} % |`);
}
console.log();
console.log(`Worst case **${worst}s = ${Math.round((worst / cap) * 100)}% of the ${cap}s judge cap**.`);
const missing = ids.filter((id) => !s.red?.[id] || !s.green?.[id]);
if (missing.length) {
  console.log();
  console.log(`⚠️  verified in only ONE direction: ${missing.join(", ")} — an AC proven one way may be unsatisfiable.`);
}
NODE
  exit 0
fi

# ── run every AC, timed ─────────────────────────────────────────────────────
AC_TSV="$(extract_acs)"
if [ -z "$AC_TSV" ]; then
  echo "Error: no acceptance_criteria with a check found in $SPEC" >&2
  exit 1
fi

echo "# dogfood-arm — $SPEC_BASE (${MODE^^} pass)"
echo
echo "spec:  $SPEC"
echo "tree:  $(git log --oneline -1)"
if [ "$MODE" = "red" ]; then
  DIRTY="$(git status --short)"
  if [ -n "$DIRTY" ]; then
    echo
    echo "⚠️  The tree is DIRTY. A RED pass must run against HEAD — an uncommitted"
    echo "    delivery makes 'RED on HEAD' meaningless:"
    printf '%s\n' "$DIRTY" | sed 's/^/      /'
  fi
  echo
  echo "expecting: every AC exits **1** (challenge armed). Exit 0 = cannot gate new"
  echo "work; exit ≥2 = broken check that can never pass (F-119 class)."
else
  echo
  echo "expecting: every AC exits **0** against the reference implementation."
fi
echo

RESULTS=""   # id \t exit \t seconds \t suiteShaped
FAILED_EXPECTATION=0
while IFS="$(printf '\t')" read -r AC_ID AC_B64; do
  [ -z "${AC_ID:-}" ] && continue
  if [ -n "$ONLY" ] && [ "$AC_ID" != "$ONLY" ]; then continue; fi

  CHECK_FILE="$(mktemp)"
  printf '%s' "$AC_B64" | base64 -d > "$CHECK_FILE"
  SUITE=0
  if grep -qE '(vitest|tsc|eslint|pnpm (run|exec|-r)|pytest|ruff)' "$CHECK_FILE"; then SUITE=1; fi

  OUT_FILE="$(mktemp)"
  START="$(date +%s)"
  bash "$CHECK_FILE" > "$OUT_FILE" 2>&1
  RC=$?
  SECS=$(( $(date +%s) - START ))
  rm -f "$CHECK_FILE"

  if [ "$MODE" = "red" ]; then
    case "$RC" in
      1) MARK="🟢 RED-on-HEAD (clean exit 1) — challenge armed" ;;
      0) MARK="⚠️  GREEN-on-HEAD — passes with NO delivery; cannot gate new work"; FAILED_EXPECTATION=1 ;;
      *) MARK="⛔ BROKEN CHECK (exit $RC) — errors instead of failing cleanly (F-119 class)"; FAILED_EXPECTATION=1 ;;
    esac
  else
    case "$RC" in
      0) MARK="🟢 GREEN vs reference (exit 0)" ;;
      *) MARK="⛔ exit $RC — the AC does NOT pass against the reference; it may be unsatisfiable"; FAILED_EXPECTATION=1 ;;
    esac
  fi

  PCT=$(( SECS * 100 / JUDGE_CAP_SECONDS ))
  echo "## $AC_ID  —  ${SECS}s (${PCT}% of ${JUDGE_CAP_SECONDS}s judge cap)$([ "$SUITE" -eq 1 ] && echo '  ·  VERIFY-SUITE')"
  echo "$MARK"
  if [ "$SECS" -ge "$JUDGE_CAP_SECONDS" ]; then
    echo "⛔ OVER THE JUDGE CAP — this check will be killed at run time. Shrink it."
    FAILED_EXPECTATION=1
  fi
  echo '```'
  # The assertion that fired is the useful line; keep the tail short.
  grep -m3 -E '^(FAIL|Error|error|⛔)' "$OUT_FILE" 2>/dev/null || tail -n 3 "$OUT_FILE"
  echo '```'
  echo
  rm -f "$OUT_FILE"

  RESULTS="${RESULTS}${AC_ID}	${RC}	${SECS}	${SUITE}
"
done <<EOF_AC
$AC_TSV
EOF_AC

# ── merge this pass into the spec's arming state ────────────────────────────
STATE_PATH="$STATE" PASS="$MODE" ROWS="$RESULTS" SPEC_NAME="$SPEC" node - <<'NODE'
const fs = require("node:fs");
const p = process.env.STATE_PATH;
const state = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
state.spec = process.env.SPEC_NAME;
state[process.env.PASS] = state[process.env.PASS] ?? {};
for (const line of (process.env.ROWS ?? "").split("\n")) {
  if (!line.trim()) continue;
  const [id, exit, seconds, suite] = line.split("\t");
  state[process.env.PASS][id] = {
    exit: Number(exit),
    seconds: Number(seconds),
    verifySuite: suite === "1",
    at: new Date().toISOString(),
  };
}
fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
NODE

echo "results: \`$STATE\`"
if [ "$MODE" = "red" ]; then
  echo "next:    apply a throwaway reference implementation, then \`--green\`, then \`--table\`."
else
  echo "next:    \`--table\` for the report block, then \`--discard\` to revert the reference."
fi

exit "$FAILED_EXPECTATION"
