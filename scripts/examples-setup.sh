#!/usr/bin/env bash
# Creates the sample git repos the examples/*.yaml task specs point at
# (WP-144). Idempotent: wipes and recreates .chikory-examples/.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/.chikory-examples"

init_repo() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "chikory-examples"
  git -C "$dir" config user.email "examples@chikory.local"
}

# ── hello-greenfield: empty playground for the greenfield toy task ──────────
greenfield="$out/hello-greenfield"
init_repo "$greenfield"
cat > "$greenfield/README.md" <<'EOF'
# hello-greenfield

Empty playground for `examples/hello-greenfield.yaml` — the agent builds a
small module + tests from scratch here. The judge runs `node --test`.
EOF
git -C "$greenfield" add -A
git -C "$greenfield" commit -qm "init: empty greenfield playground"

# ── fix-failing-test: small node project with one planted bug ───────────────
brownfield="$out/fix-failing-test"
init_repo "$brownfield"
cat > "$brownfield/package.json" <<'EOF'
{
  "name": "sample-stats",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
EOF
mkdir -p "$brownfield/lib" "$brownfield/test"
cat > "$brownfield/lib/stats.js" <<'EOF'
/** Tiny stats helpers. */

export function mean(values) {
  if (values.length === 0) throw new RangeError("mean of empty array");
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values) {
  if (values.length === 0) throw new RangeError("median of empty array");
  // BUG: median must not depend on input order.
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid];
  return (values[mid - 1] + values[mid]) / 2;
}
EOF
cat > "$brownfield/test/stats.test.js" <<'EOF'
import assert from "node:assert/strict";
import { test } from "node:test";

import { mean, median } from "../lib/stats.js";

test("mean", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
});

test("median of odd-length unsorted input", () => {
  assert.equal(median([3, 1, 2]), 2);
});

test("median of even-length unsorted input", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("median does not mutate its input", () => {
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2]);
});
EOF
git -C "$brownfield" add -A
git -C "$brownfield" commit -qm "init: stats lib with a failing test"

echo "sample repos ready:"
echo "  $greenfield"
echo "  $brownfield   (npm test fails — that's the task)"
