#!/usr/bin/env bash
# Audit: did every dogfood run's result actually land in git history?
# For each run, take the files it changed and check whether each file's FINAL
# workspace content exists as a committed git blob. If a SUCCESS run's file
# content was never committed (and isn't pending in the working tree), it is a
# candidate silent drop — exactly the failure mode the old harvest had (F-20).
#
# Usage:
#   devbox run harvest-audit          # SUCCESS runs only (the ones meant to land)
#   bash scripts/harvest-audit.sh --all   # every run (incl. aborted/failed)
#
# Verdicts per changed file whose exact content is NOT in the object store:
#   PENDING-WT  applied in the working tree, not yet committed (fine)
#   HEAD-differs path exists in HEAD but content evolved/superseded (usually fine)
#   ABSENT      path not in HEAD at all — strongest drop signal (investigate)

set -uo pipefail
cd "$(dirname "$0")/.."

ALL=0
[ "${1:-}" = "--all" ] && ALL=1

# run_id -> "status<TAB>name" from each journal
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
node - <<'NODE' > "$TMP" 2>/dev/null
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
for (const d of fs.readdirSync(".chikory/runs")) {
  const j = `.chikory/runs/${d}/journal.db`;
  if (!fs.existsSync(j)) continue;
  try {
    const r = new DatabaseSync(j).prepare("select status,task_json from runs limit 1").get();
    const name = (JSON.parse(r.task_json).name) || "?";
    process.stdout.write(`${d}\t${r.status}\t${name}\n`);
  } catch { process.stdout.write(`${d}\tERR\t-\n`); }
}
NODE

printf '%-12s %-52s %s\n' "VERDICT" "FILE" "RUN / SPEC"
echo "---------------------------------------------------------------------------------------------------"
DROPS=0; ABSENTS=0; CHECKED=0
while IFS=$'\t' read -r rid rstat name; do
  if [ "$ALL" -eq 0 ] && [ "$rstat" != "SUCCESS" ]; then continue; fi
  ws=".chikory/runs/$rid/workspace"
  { [ -d "$ws/.git" ] || [ -f "$ws/.git" ]; } || continue
  base=chikory-base
  git -C "$ws" rev-parse --verify -q chikory-base >/dev/null 2>&1 || base=main
  while IFS=$'\t' read -r stt f rest; do
    [ -z "$stt" ] && continue
    case "$stt" in A*|M*) tgt="$f" ;; R*) tgt="$rest" ;; *) continue ;; esac
    [ -f "$ws/$tgt" ] || continue
    CHECKED=$((CHECKED+1))
    h=$(git hash-object "$ws/$tgt")
    git cat-file -e "$h" 2>/dev/null && continue          # exact content committed → landed
    if [ -f "$tgt" ] && cmp -s "$tgt" "$ws/$tgt"; then v="PENDING-WT"
    elif git cat-file -e "HEAD:$tgt" 2>/dev/null; then v="HEAD-differs"
    else v="ABSENT"; ABSENTS=$((ABSENTS+1)); fi
    DROPS=$((DROPS+1))
    printf '%-12s %-52s %s\n' "$v" "$tgt" "${rid#run-} / $name"
  done <<< "$(git -C "$ws" diff --name-status "$base"..HEAD 2>/dev/null)"
done < "$TMP"
echo "---------------------------------------------------------------------------------------------------"
echo "checked $CHECKED changed files · $DROPS not-in-history ($ABSENTS ABSENT — investigate; PENDING-WT/HEAD-differs usually benign)"
