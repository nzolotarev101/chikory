#!/usr/bin/env bash
# Self-contained fixture tests for scripts/dogfood-landed-scope.sh.

set -uo pipefail

cd "$(dirname "$0")/.."
SCRIPT="$PWD/scripts/dogfood-landed-scope.sh"

TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/dogfood-landed-scope-test.XXXXXX")"
trap 'rm -rf "$TMPROOT"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

init_host() {
  dir="$1"
  git init -q "$dir"
  git -C "$dir" config user.email "dogfood@example.invalid"
  git -C "$dir" config user.name "Dogfood Test"
  mkdir -p "$dir/src"
  printf 'base\n' >"$dir/src/a.txt"
  printf 'keep\n' >"$dir/src/keep.txt"
  git -C "$dir" add .
  git -C "$dir" commit -q -m "base"
}

make_run_workspace() {
  host="$1"
  run="$2"
  git clone -q "$host" "$run"
  base="$(git -C "$host" rev-parse HEAD)"
  git -C "$run" branch chikory-base "$base"
  printf 'run final\n' >"$run/src/a.txt"
  printf 'run b\n' >"$run/src/b.txt"
  git -C "$run" add .
  git -C "$run" commit -q -m "run final"
}

run_scope() {
  host="$1"
  run="$2"
  ref="$3"
  output="$4"

  set +e
  (cd "$host" && bash "$SCRIPT" "$run" "$ref") >"$output" 2>&1
  rc=$?
  set -u
  return "$rc"
}

assert_grep() {
  pattern="$1"
  file="$2"
  if ! grep -q "$pattern" "$file"; then
    echo "Output was:" >&2
    cat "$file" >&2
    fail "expected pattern '$pattern' in $file"
  fi
}

test_exact_match() {
  host="$TMPROOT/exact-host"
  run="$TMPROOT/exact-run"
  out="$TMPROOT/exact.out"
  init_host "$host"
  make_run_workspace "$host" "$run"

  cp "$run/src/a.txt" "$host/src/a.txt"
  cp "$run/src/b.txt" "$host/src/b.txt"
  git -C "$host" add .
  git -C "$host" commit -q -m "land run"

  run_scope "$host" "$run" HEAD "$out" || fail "exact match should exit 0"
  assert_grep '^MATCH$' "$out"
}

test_extra_path() {
  host="$TMPROOT/extra-host"
  run="$TMPROOT/extra-run"
  out="$TMPROOT/extra.out"
  init_host "$host"
  make_run_workspace "$host" "$run"

  cp "$run/src/a.txt" "$host/src/a.txt"
  cp "$run/src/b.txt" "$host/src/b.txt"
  printf 'manual\n' >"$host/src/manual.txt"
  git -C "$host" add .
  git -C "$host" commit -q -m "land run with extra"

  if run_scope "$host" "$run" HEAD "$out"; then
    fail "extra path should exit nonzero"
  fi
  assert_grep '^EXTRA_IN_COMMIT$' "$out"
  assert_grep 'src/manual.txt' "$out"
}

test_missing_path() {
  host="$TMPROOT/missing-host"
  run="$TMPROOT/missing-run"
  out="$TMPROOT/missing.out"
  init_host "$host"
  make_run_workspace "$host" "$run"

  cp "$run/src/a.txt" "$host/src/a.txt"
  git -C "$host" add .
  git -C "$host" commit -q -m "land partial run"

  if run_scope "$host" "$run" HEAD "$out"; then
    fail "missing path should exit nonzero"
  fi
  assert_grep '^MISSING_IN_COMMIT$' "$out"
  assert_grep 'src/b.txt' "$out"
}

test_different_content() {
  host="$TMPROOT/different-host"
  run="$TMPROOT/different-run"
  out="$TMPROOT/different.out"
  init_host "$host"
  make_run_workspace "$host" "$run"

  printf 'manual rewrite\n' >"$host/src/a.txt"
  cp "$run/src/b.txt" "$host/src/b.txt"
  git -C "$host" add .
  git -C "$host" commit -q -m "land altered run"

  if run_scope "$host" "$run" HEAD "$out"; then
    fail "different content should exit nonzero"
  fi
  assert_grep '^DIFFERS_FROM_RUN$' "$out"
  assert_grep 'src/a.txt' "$out"
}

test_exact_match
test_extra_path
test_missing_path
test_different_content

echo "PASS: dogfood-landed-scope fixture tests"
