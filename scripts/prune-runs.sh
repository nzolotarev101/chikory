#!/usr/bin/env bash
# Reclaims disk from `.chikory/runs/` without losing run evidence (F-236).
#
# A run directory holds three things:
#   journal.db   the run's authoritative record — every dogfood report cites it
#   artifacts/   context snapshots and diffs the journal refers to
#   workspace/   a full git clone of the target, plus node_modules
#
# Only `workspace/` is bulk, and only `workspace/` is reproducible: it is a
# checkout at a commit the journal already records. So the prune keeps every
# journal and every artifact forever, and reclaims workspaces.
#
# dogfood-122 (2026-08-01) launched onto a volume at 98% with `.chikory/` at
# 95 G over 198 run dirs; a single rung-4 node workspace was 8 G. The run died
# with `chikory: unable to open database file`.
#
#   devbox run prune-runs                      # dry run — prints what it would free
#   devbox run -- bash scripts/prune-runs.sh --apply
#   devbox run -- bash scripts/prune-runs.sh --keep 5 --apply
#
# The newest --keep chains (default 10) and the newest --keep standalone runs
# are left completely untouched, workspace included, so recent work stays
# re-inspectable by hand.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd -P)"
RUNS="$ROOT/.chikory/runs"

KEEP=10
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    --keep) KEEP="${2:?--keep needs a count}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "prune-runs: unknown argument '$1'" >&2; exit 2 ;;
  esac
done
case "$KEEP" in ''|*[!0-9]*) echo "prune-runs: --keep must be a number, got '$KEEP'" >&2; exit 2 ;; esac

[ -d "$RUNS" ] || { echo "prune-runs: no $RUNS — nothing to do"; exit 0; }

# ── 1. Choose what to protect ────────────────────────────────────────
# Recency comes from `journal.db`, the last thing a run writes — NOT from the
# run directory's own mtime, which a bulk `touch`/copy flattens across hundreds
# of dirs at once (every standalone run dir here shares one Jul-29 timestamp).
mtime_of() {
  local d="$1" f="$1/journal.db"
  [ -f "$f" ] || f="$d"
  stat -f %m "$f" 2>/dev/null || stat -c %Y "$f"
}

# Rank chains by the newest journal among their node run dirs, so a chain whose
# last node ran recently is protected even if it started days ago.
protected_chains() {
  for d in "$RUNS"/chain-*-node-*; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    printf '%s\t%s\n' "$(mtime_of "$d")" "${base%%-node-*}"
  done | sort -rn | awk -F'\t' '!seen[$2]++ {print $2}' | head -n "$KEEP"
}

protected_runs() {
  for d in "$RUNS"/run-*; do
    [ -d "$d" ] || continue
    printf '%s\t%s\n' "$(mtime_of "$d")" "$(basename "$d")"
  done | sort -rn | head -n "$KEEP" | cut -f2
}

KEEP_LIST="$(mktemp)"
trap 'rm -f "$KEEP_LIST"' EXIT
protected_chains > "$KEEP_LIST"
protected_runs >> "$KEEP_LIST"

is_protected() {
  local base="$1" id="$1"
  case "$base" in chain-*-node-*) id="${base%%-node-*}" ;; esac
  grep -qxF "$id" "$KEEP_LIST"
}

# ── 2. Collect the workspaces to reclaim ─────────────────────────────
# Guard: only ever a path named `workspace` directly under `.chikory/runs/<id>/`.
TARGETS="$(mktemp)"
trap 'rm -f "$KEEP_LIST" "$TARGETS"' EXIT
for d in "$RUNS"/*; do
  [ -d "$d/workspace" ] || continue
  base="$(basename "$d")"
  is_protected "$base" && continue
  real="$(cd "$d/workspace" && pwd -P)"
  case "$real" in
    "$RUNS"/*/workspace) printf '%s\n' "$d/workspace" >> "$TARGETS" ;;
    *) echo "prune-runs: refusing '$d/workspace' — resolves outside $RUNS (to $real)" >&2 ;;
  esac
done

COUNT="$(wc -l < "$TARGETS" | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then
  echo "prune-runs: nothing to reclaim — every run dir is inside the newest $KEEP chains/runs"
  exit 0
fi

echo "prune-runs: protecting the newest $KEEP chains and $KEEP standalone runs:"
sed 's/^/  keep  /' "$KEEP_LIST"
echo "prune-runs: $COUNT workspace(s) to reclaim (journal.db and artifacts/ are kept in every case):"
FREED=0
while IFS= read -r ws; do
  sz="$(du -sk "$ws" 2>/dev/null | cut -f1)"
  FREED=$((FREED + sz))
  printf '  %-8s %s\n' "$(du -sh "$ws" 2>/dev/null | cut -f1)" "${ws#"$ROOT"/}"
done < "$TARGETS"
echo "prune-runs: total reclaimable $((FREED / 1024 / 1024)) GiB"

# ── 3. Apply ─────────────────────────────────────────────────────────
if [ "$APPLY" -ne 1 ]; then
  echo "prune-runs: DRY RUN — nothing deleted. Re-run with --apply to reclaim."
  exit 0
fi

while IFS= read -r ws; do
  rm -rf "$ws"
done < "$TARGETS"
echo "prune-runs: reclaimed $((FREED / 1024 / 1024)) GiB from $COUNT workspace(s)"
df -h "$ROOT" | tail -n +1
