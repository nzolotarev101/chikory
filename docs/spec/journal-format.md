# Journal Interchange Format (JIF)

The persisted/exported form of a run's journal. Single format consumed by: `chikory trace --json` (WP-142), benchmark harness (WP-301), dataset pipeline (WP-306), Stage-2 trace browser (WP-403). Versioned; consumers must tolerate unknown fields (forward-compat).

## 1. Storage vs interchange

- **Storage** (P1): SQLite `.chikory/runs/<run-id>/journal.db`, table `journal_entries(idx INTEGER PK, ts TEXT, kind TEXT, payload_json TEXT, cost_delta_usd REAL, tokens_in INTEGER, tokens_out INTEGER, artifact_refs_json TEXT)` + `runs` metadata table.
- **Interchange**: one JSON document (below), or JSONL (one entry per line, header as line 1) for streaming. `chikory trace --json` emits the document form.

## 2. Document shape

```jsonc
{
  "jif": 1,                                  // format version
  "run": {
    "runId": "7f3a…",
    "task": { /* full TaskSpec, secrets redacted (env names kept, values never present) */ },
    "startedAt": "2026-07-02T14:03:11Z",
    "endedAt": "2026-07-02T16:17:40Z",       // null while running
    "status": "SUCCESS",                      // RunStatus
    "executor": { "adapter": "claude-code", "family": "anthropic" },
    "judge": { "family": "gemini", "model": "…", "cadence": 3 },
    "totals": {
      "steps": 42, "judgePasses": 14, "rollbacks": 1, "escalations": 0,
      "costUsd": 11.30, "judgeCostUsd": 1.71, "tokens": { "input": 812345, "output": 174210 },
      "costEstimatedUsd": 2.10               // estimated portion, tracked separately
    }
  },
  "entries": [ /* JournalEntry[], ordered by idx */ ],
  "checkpoints": [ /* Checkpoint[] */ ],
  "artifacts": [ /* ArtifactRef[] index; bulk content NOT embedded — fetch via store */ ]
}
```

## 3. Entry payloads by `kind`

| kind | payload |
|---|---|
| `step` | `StepRecord` (refs only, no bulk) + `instruction`, `planItem` |
| `judge` | `JudgeEvidence` refs + `JudgeForm` + model + cost |
| `verdict` | `{ judgeIndex, atStep, verdict: JudgeVerdict }` (judge-sourced), or the runner-sourced loop-breaker escalation `{ escalationIndex, source: "runner", atStep, verdict: { kind: "ESCALATE", rationale, escalateReason } }` — no JudgeForm/judgeModel because no judge ran (WP-124) |
| `checkpoint` | `Checkpoint` |
| `injection` | `{ source: "human", text, atStep }` |
| `budget_event` | `{ event: "estimate"\|"halt"\|"top_up", remainingUsd, details }` + WP-218 additive token fields `cause?: "usd"\|"tokens"` (absent ⇒ `"usd"`, back-compatible) and `remainingTokens?` on a token HALT; token figures (`spentTokens`/`budgetTokens`/`estimateTokens`) ride `details`. The USD path omits both, so pre-WP-218 journals stay byte-identical |
| `compaction` | `{ tokensBefore, tokensAfter, digestRef }` (WP-203 — emitted at the checkpoint boundary; see CONTRACTS.md §6a) |
| `pacing` | `{ decision, batchSize, reasoning }` (P2) |
| `terminal` | `{ status: "SUCCESS"\|"FAILED"\|"CANCELLED", reason, lastCheckpoint }` |

Every payload carries enough human rationale to render the decision tree without external lookups (NF-2).

## 4. Guarantees & tests

1. **Append-only**: idx strictly monotonic; rewriting history is forbidden — corrections are new entries.
2. **Cost conservation**: `run.totals.costUsd == Σ entries.costDeltaUsd` (crash-recovery test WP-123 asserts this to prove no duplicate spend).
3. **Replayable narrative**: from entries alone, `chikory trace` must render fully (renderer has no other input — enforced by construction).
4. **Redaction**: no API keys, no env values, no user PII beyond what the task itself contains. Dataset pipeline (WP-306) applies a second scrub pass + opt-in gate before anything leaves the machine.
5. Fixture suite: `fixtures/jif/*.json` valid/invalid docs; TS + Python parsers round-trip identically (CONTRACTS.md §10).

## 5. Versioning

`jif` integer bumps only on breaking change; additive fields free. Benchmark results and the WP-306 dataset record the `jif` version per document; migrators live in `benchmarks/tools/`.
