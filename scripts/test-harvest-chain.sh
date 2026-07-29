#!/usr/bin/env bash
# Integration coverage for chain-aware harvest resolution and ordered deltas.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/chikory-harvest-chain.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/repo/scripts" "$TMP/fake-bin"
cp "$ROOT/scripts/harvest.sh" "$TMP/repo/scripts/harvest.sh"
cp "$ROOT/scripts/read-chain-record.mjs" "$TMP/repo/scripts/read-chain-record.mjs"
chmod +x "$TMP/repo/scripts/harvest.sh"

git -C "$TMP/repo" init -q -b main
git -C "$TMP/repo" config user.name test
git -C "$TMP/repo" config user.email test@chikory.local
printf '# harvest fixture\n' > "$TMP/repo/README.md"
git -C "$TMP/repo" add README.md
git -C "$TMP/repo" commit -q -m init

cat > "$TMP/fake-bin/devbox" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP/fake-bin/devbox"

node1="$TMP/repo/.chikory/runs/chain-test-node-N-1/workspace"
node2="$TMP/repo/.chikory/runs/chain-test-node-N-2/workspace"
node3="$TMP/repo/.chikory/runs/chain-test-node-N-3/workspace"
mkdir -p "$(dirname "$node1")" "$(dirname "$node2")" "$(dirname "$node3")" "$TMP/repo/.chikory/chains/chain-test"
touch "$TMP/repo/.chikory/chains/chain-test/chain.db"

git clone -q "$TMP/repo" "$node1"
git -C "$node1" config user.name chikory
git -C "$node1" config user.email runner@chikory.local
git -C "$node1" checkout -q -b chikory/run-chain-test-node-N-1
git -C "$node1" tag chikory-base
mkdir -p "$node1/packages"
printf 'node one\n' > "$node1/packages/a.txt"
git -C "$node1" add -A
git -C "$node1" commit -q -m 'chikory: step 0'

git clone -q "$TMP/repo" "$node2"
git -C "$node2" config user.name chikory
git -C "$node2" config user.email runner@chikory.local
git -C "$node2" checkout -q -b chikory/run-chain-test-node-N-2
git -C "$node2" tag chikory-base
mkdir -p "$node2/packages"
printf 'node two\n' > "$node2/packages/b.txt"
git -C "$node2" add -A
git -C "$node2" commit -q -m 'chikory: step 0'

git clone -q --no-tags "$node1" "$node3"
git -C "$node3" config user.name chikory
git -C "$node3" config user.email runner@chikory.local
git -C "$node3" checkout -q -b chikory/run-chain-test-node-N-3
git -C "$node3" fetch -q "$node2" HEAD
git -C "$node3" cherry-pick FETCH_HEAD >/dev/null
git -C "$node3" tag chikory-base
printf 'node three\n' > "$node3/packages/c.txt"
git -C "$node3" add -A
git -C "$node3" commit -q -m 'chikory: step 0'

export PATH="$TMP/fake-bin:$PATH"
export HARVEST_CHAIN_JSON='{"chainId":"chain-test","planId":"plan-test","status":"SUCCESS","plan":{"nodes":[{"id":"N-1","dependsOn":[]},{"id":"N-2","dependsOn":[]},{"id":"N-3","dependsOn":["N-1","N-2"]}]},"nodeRuns":{"N-1":"chain-test-node-N-1","N-2":"chain-test-node-N-2","N-3":"chain-test-node-N-3"},"nodeOutcomes":{"N-1":{"status":"SUCCESS"},"N-2":{"status":"SUCCESS"},"N-3":{"status":"SUCCESS"}}}'

# Populate a real minimal chain journal and exercise the production read helper
# on the successful path (the env override below is retained only for the
# fail-fast topology case).
node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const record = JSON.parse(process.env.HARVEST_CHAIN_JSON);
  const db = new DatabaseSync(process.argv[1]);
  db.exec("CREATE TABLE chains (chain_id TEXT PRIMARY KEY, plan_json TEXT, started_at TEXT, ended_at TEXT, status TEXT); CREATE TABLE chain_entries (idx INTEGER PRIMARY KEY, ts TEXT, kind TEXT, payload_json TEXT)");
  db.prepare("INSERT INTO chains VALUES (?, ?, ?, ?, ?)").run(record.chainId, JSON.stringify(record.plan), "now", "now", record.status);
  let idx = 0;
  for (const node of record.plan.nodes) {
    db.prepare("INSERT INTO chain_entries VALUES (?, ?, ?, ?)").run(idx++, "now", "node_started", JSON.stringify({ nodeId: node.id, childRunId: record.nodeRuns[node.id] }));
    db.prepare("INSERT INTO chain_entries VALUES (?, ?, ?, ?)").run(idx++, "now", "node_sealed", JSON.stringify({ nodeId: node.id, outcome: record.nodeOutcomes[node.id] }));
  }
  db.close();
' "$TMP/repo/.chikory/chains/chain-test/chain.db"
unset HARVEST_CHAIN_JSON

(cd "$TMP/repo" && bash scripts/harvest.sh chain-test main >/dev/null)
cmp -s "$TMP/repo/packages/a.txt" "$node1/packages/a.txt"
cmp -s "$TMP/repo/packages/b.txt" "$node2/packages/b.txt"
cmp -s "$TMP/repo/packages/c.txt" "$node3/packages/c.txt"
staged=$(git -C "$TMP/repo" diff --cached --name-only)
printf '%s\n' "$staged" | grep -qx 'packages/a.txt'
printf '%s\n' "$staged" | grep -qx 'packages/b.txt'
printf '%s\n' "$staged" | grep -qx 'packages/c.txt'

# A cyclic topology must fail before applying any deltas.
export HARVEST_CHAIN_JSON='{"chainId":"chain-test","planId":"plan-test","status":"SUCCESS","plan":{"nodes":[{"id":"N-1","dependsOn":["N-2"]},{"id":"N-2","dependsOn":["N-1"]}]},"nodeRuns":{"N-1":"chain-test-node-N-1","N-2":"chain-test-node-N-2"},"nodeOutcomes":{"N-1":{"status":"SUCCESS"},"N-2":{"status":"SUCCESS"}}}'
if (cd "$TMP/repo" && bash scripts/harvest.sh chain-test main >/dev/null 2>&1); then
  echo "expected cyclic chain harvest to fail" >&2
  exit 1
fi

unset HARVEST_CHAIN_JSON

# ── F-222: a sealed-SUCCESS node of a FAILED chain is harvestable BY NAME ─────
# dogfood-120 died with `N-1-r1-r2` sealed SUCCESS inside a FAILED chain. The
# chain path (rightly) refuses a non-SUCCESS chain, and the node id used to be
# promoted to that chain id, so the delivery had no harvest path at all.
failnode="$TMP/repo/.chikory/runs/chain-fail-node-N-1/workspace"
mkdir -p "$(dirname "$failnode")" "$TMP/repo/.chikory/chains/chain-fail"
git clone -q "$TMP/repo" "$failnode"
git -C "$failnode" config user.name chikory
git -C "$failnode" config user.email runner@chikory.local
git -C "$failnode" checkout -q -b chikory/run-chain-fail-node-N-1
git -C "$failnode" tag chikory-base
mkdir -p "$failnode/packages"
printf 'sealed inside a failed chain\n' > "$failnode/packages/d.txt"
git -C "$failnode" add -A
git -C "$failnode" commit -q -m 'chikory: step 0'

node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(process.argv[1]);
  db.exec("CREATE TABLE chains (chain_id TEXT PRIMARY KEY, plan_json TEXT, started_at TEXT, ended_at TEXT, status TEXT); CREATE TABLE chain_entries (idx INTEGER PRIMARY KEY, ts TEXT, kind TEXT, payload_json TEXT)");
  const plan = { nodes: [{ id: "N-1", dependsOn: [] }] };
  db.prepare("INSERT INTO chains VALUES (?, ?, ?, ?, ?)").run("chain-fail", JSON.stringify(plan), "now", "now", "FAILED");
  db.prepare("INSERT INTO chain_entries VALUES (?, ?, ?, ?)").run(0, "now", "node_started", JSON.stringify({ nodeId: "N-1", childRunId: "chain-fail-node-N-1" }));
  db.prepare("INSERT INTO chain_entries VALUES (?, ?, ?, ?)").run(1, "now", "node_sealed", JSON.stringify({ nodeId: "N-1", outcome: { status: "SUCCESS" } }));
  db.close();
' "$TMP/repo/.chikory/chains/chain-fail/chain.db"

(cd "$TMP/repo" && bash scripts/harvest.sh chain-fail-node-N-1 main >/dev/null)
cmp -s "$TMP/repo/packages/d.txt" "$failnode/packages/d.txt"

# The chain id itself still refuses — only SUCCESS chains harvest whole.
if (cd "$TMP/repo" && bash scripts/harvest.sh chain-fail main >/dev/null 2>&1); then
  echo "expected FAILED chain harvest to be refused" >&2
  exit 1
fi

# And the bare default still promotes a node dir to its chain (so
# `devbox run harvest` cannot silently harvest only the last node).
touch "$(dirname "$failnode")"
if (cd "$TMP/repo" && bash scripts/harvest.sh >/dev/null 2>&1); then
  echo "expected the bare default to promote to the FAILED chain and refuse" >&2
  exit 1
fi

echo "chain-aware harvest integration: PASS"
