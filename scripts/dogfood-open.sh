#!/usr/bin/env bash
# dogfood-open.sh — phase 0 of /dogfood-review in ONE command.
#
# Replaces the three separately-approved steps (harvest → evidence pack →
# progression gate) plus the manual "is this run harvested yet?" reasoning that
# preceded them. Idempotent: safe to re-run on a review that already landed.
#
# Usage:
#   devbox run -- bash scripts/dogfood-open.sh [<run-id>] [--no-harvest]
#   devbox run dogfood-open                       # newest run
#
# Runs bare toolchain binaries (pnpm/git/node) — invoke it THROUGH devbox, never
# add a nested `devbox run` inside (CLAUDE.md; dogfood-105 hung a node on it).

set -uo pipefail
cd "$(dirname "$0")/.."

RUN_ID=""
NO_HARVEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-harvest) NO_HARVEST=1; shift ;;
    -h|--help) echo "Usage: $0 [<run-id>] [--no-harvest]" >&2; exit 0 ;;
    --*) echo "Error: unknown flag $1" >&2; exit 2 ;;
    *) RUN_ID="$1"; shift ;;
  esac
done

if [ -z "$RUN_ID" ]; then
  RUN_ID="$(ls -t .chikory/runs/ 2>/dev/null | head -n 1)"
fi
if [ -z "$RUN_ID" ] || [ ! -d ".chikory/runs/$RUN_ID" ]; then
  echo "Error: run dir .chikory/runs/$RUN_ID not found" >&2
  exit 1
fi

FACTS=".chikory/review/$RUN_ID.facts.json"

echo "# dogfood-open — $RUN_ID"
echo

# ── 1. harvest, but only when it is unambiguously safe ──────────────────────
# Landing the delivery FIRST is the standing rule (the review re-verifies the
# harvested tree, not the run's own workspace). Two conditions make it safe:
# no commit already references this run, and the tree carries no unrelated work
# that a harvest would be applied on top of.
HARVEST_COMMIT="$(git log --grep "$RUN_ID" --oneline | head -n 1)"
DIRTY="$(git status --short)"

echo "## 1. Harvest"
if [ -n "$HARVEST_COMMIT" ]; then
  echo "ℹ️  already landed — \`$HARVEST_COMMIT\`"
  echo "    nothing to harvest; the working tree is reviewed as-is."
elif [ "$NO_HARVEST" -eq 1 ]; then
  echo "ℹ️  --no-harvest given; skipping."
elif [ -n "$DIRTY" ]; then
  echo "⛔ working tree is DIRTY and this run has no landed commit — refusing to harvest"
  echo "   over work that is not this run's. Resolve, then re-run (or pass --no-harvest):"
  printf '%s\n' "$DIRTY" | sed 's/^/     /'
  exit 1
else
  echo "→ harvesting $RUN_ID onto a clean tree…"
  if ! bash scripts/harvest.sh "$RUN_ID" main; then
    echo "⛔ harvest FAILED — stopping before the evidence pack (it would review an empty delivery)." >&2
    exit 1
  fi
  echo "✅ harvested."
fi
echo

# ── 2. mechanical evidence pack (+ machine-readable facts) ──────────────────
echo "## 2. Evidence pack"
echo
bash scripts/dogfood-verify.sh "$RUN_ID" --facts "$FACTS"
VERIFY_RC=$?
echo

# ── 3. progression gate — binds what the NEXT headline may be ───────────────
echo "## 3. Progression gate"
echo
PROGRESSION_OUT="$(bash scripts/dogfood-progression.sh 2>&1)"
printf '%s\n' "$PROGRESSION_OUT"
echo

# ── 4. state of play — the four facts phase 1 otherwise reconstructs by hand ─
echo "## 4. State of play"
if [ -f "$FACTS" ]; then
  FACTS_PATH="$FACTS" node - <<'NODE'
const f = JSON.parse(require("node:fs").readFileSync(process.env.FACTS_PATH, "utf8"));
const acs = f.acceptanceChecks.map((a) => `${a.id} ${a.status}`).join(" · ") || "(none)";
const harvest =
  f.harvestIdentical === null
    ? "n/a (already committed — nothing uncommitted to byte-diff)"
    : f.harvestIdentical
      ? `byte-IDENTICAL ${f.harvest.length}/${f.harvest.length}`
      : `⚠ DIFFERS — ${f.harvest.filter((h) => h.status === "DIFFERS").map((h) => h.path).join(", ")}`;
console.log(`- terminal:   ${f.terminal} · ${f.steps} step(s) · ${f.wallClock}`);
console.log(`- cost:       $${f.cost.exact} / $${f.cost.budget} (${f.cost.budgetPct}%) · judge share ${f.cost.judgeShare}`);
console.log(`- families:   executor ${f.executor} · judge ${f.judge}`);
console.log(`- verdicts:   rollbacks ${f.totals.rollbacks} · escalations ${f.totals.escalations} · resumes ${f.totals.resumes}`);
console.log(`- ACs:        ${acs}`);
console.log(`- harvest:    ${harvest}`);
console.log(`- landed:     ${f.harvestCommit ?? "(not yet committed)"}`);
NODE
fi
PROG_VERDICT="$(printf '%s\n' "$PROGRESSION_OUT" | grep -E '^(⛔|✅|🔴) ' | head -n 1)"
echo "- progression: ${PROG_VERDICT:-（see §3）}"
echo
echo "Facts: \`$FACTS\`"
echo
echo "Next (judgment — not scripted): read every step transcript and judge pass"
echo "(\`pnpm chikory trace $RUN_ID --step <n>\`), review the landed diff against the"
echo "spec goal line by line, then walk the phase-3 anomaly checklist."

exit "$VERIFY_RC"
