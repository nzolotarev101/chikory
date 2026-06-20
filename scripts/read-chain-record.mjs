#!/usr/bin/env node
// Read-only chain.db projection for chain-aware harvest. Kept independent of
// packages/sdk-ts/dist so harvest does not depend on a stale/missing CLI trace
// branch before its own post-apply build step.
import { DatabaseSync } from "node:sqlite";

export function readChainRecord(dbPath, chainId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const chain = db
      .prepare("SELECT plan_json, status FROM chains WHERE chain_id = ?")
      .get(chainId);
    if (chain === undefined) throw new Error(`chain ${chainId} has no chain row`);

    const entries = db
      .prepare(
        "SELECT kind, payload_json FROM chain_entries WHERE kind IN ('node_started', 'node_sealed') ORDER BY idx",
      )
      .all();
    const nodeRuns = {};
    const nodeOutcomes = {};
    for (const entry of entries) {
      const payload = JSON.parse(entry.payload_json);
      if (entry.kind === "node_started") nodeRuns[payload.nodeId] = payload.childRunId;
      else nodeOutcomes[payload.nodeId] = payload.outcome;
    }
    const plan = JSON.parse(chain.plan_json);
    return { chainId, planId: plan.id, plan, nodeRuns, nodeOutcomes, status: chain.status };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dbPath, chainId] = process.argv.slice(2);
  if (dbPath === undefined || chainId === undefined) {
    console.error("usage: read-chain-record.mjs <chain.db> <chain-id>");
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(readChainRecord(dbPath, chainId))}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
