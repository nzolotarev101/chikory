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
| `control_event` | `{ controlEventIndex, event: "suspend"\|"resume", source: "operator"\|"soak"\|"limit"\|"pace"\|"failed_seal", atStep, details? }` — `source: "failed_seal"` (WP-520) marks a resumable-FAILED reopen: `chikory resume` re-started the workflow over this journal, and a later re-seal appends its terminal entry after this boundary; `source: "limit"` (WP-308) resumes a durable park after a limit-reset timer; `source: "pace"` (WP-310) resumes a governor throttle sleep (`details.sleepMs`) |
| `budget_event` | `{ event: "estimate"\|"halt"\|"top_up", remainingUsd, details }` + WP-218 additive token fields `cause?: "usd"\|"tokens"` (absent ⇒ `"usd"`, back-compatible) and `remainingTokens?` on a token HALT; token figures (`spentTokens`/`budgetTokens`/`estimateTokens`) ride `details`. The USD path omits both, so pre-WP-218 journals stay byte-identical |
| `compaction` | `{ tokensBefore, tokensAfter, digestRef }` (WP-203 — emitted at the checkpoint boundary; see CONTRACTS.md §6a) |
| `pacing` | `{ decision, batchSize, reasoning }` (P2) |
| `capability` | `{ capabilityIndex: 0, stages: ResolvedEndpointCapabilities }` (WP-307) — per-stage resolved endpoint descriptors journaled once at run start |
| `limit_observation` | `{ endpointCapabilityId, atStep, stage, signal: ClassifiedLimitSignal, observation: EndpointResetObservation }` (WP-308) — replay-safe reset-learning row keyed by endpoint capability id; additive alongside `limit_signal` |
| `limit_signal` | `{ limitSignalIndex, atStep, stage, signal: ClassifiedLimitSignal, limitResponse, chosenResponse }` (WP-308) — one classified provider/executor limit and the ordered work-conserving response chosen |
| `limit_pace` | `{ limitPaceEventIndex, atStep, action: "push"\|"steady"\|"throttle"\|"predict-limit", interStepDelayMs, limitingWindow?, observedTokensPerHour, sustainableTokensPerHour?, requiredTokensPerHour, paceConflict, windows }` (WP-310) — one pacing-governor decision against the declared quota windows (rolling-5h, weekly); throttle/predict-limit always journaled, push/steady snapshots on the judge cadence |
| `remediation` | `{ remediationIndex, atStep, trigger, brief, rollbackTo? }` (WP-519, ADR-009 D3) — one bounded heal attempt: the rule-3 HALT `trigger`, the judge-diagnosis `brief` the retry works against, and the last-good checkpoint restored |
| `terminal` | `{ status: "SUCCESS"\|"FAILED"\|"CANCELLED", reason, lastCheckpoint, handoff?, resumable?, remediation? }`; successful chain nodes attach their artifact-backed `ChainNodeHandoff` and bundle refs. `resumable: true` (WP-520, ADR-009 D4) marks a healable FAILED seal — `chikory resume` re-enters it (reopen `control_event`, evidence carried as feedback); `remediation: { attempts, brief }` preserves the exhausted heal. A reopened run appends a NEW terminal entry per incarnation — the LAST one is the current seal |

**Chain-scope kinds** (emitted to the chain store, not the run journal): `plan`, `plan_verdict`, `node_started`, `node_sealed`, `node_replanned`, `chain_completion_review`, `control_event`, `terminal`. The chain `control_event` payload is `{ event: "resume", source: "chain_failed_seal", failedNodeId? }` (WP-521(c)) — the chain analog of the run-level `failed_seal` reopen: `chikory chain resume` re-started `chainLoop` over this chain journal and granted the failed node one fresh heal attempt; a later re-seal appends its terminal entry after this boundary. The chain `terminal` payload is `{ status, reason?, resumable? }`; `resumable: true` marks a node-failure FAILED that `chikory chain resume` can re-enter (a malformed/unsatisfiable-dependency FAILED is dead — no `resumable`).

Every payload carries enough human rationale to render the decision tree without external lookups (NF-2).

## 4. Guarantees & tests

1. **Append-only**: idx strictly monotonic; rewriting history is forbidden — corrections are new entries.
2. **Cost conservation**: `run.totals.costUsd == Σ entries.costDeltaUsd` (crash-recovery test WP-123 asserts this to prove no duplicate spend).
3. **Replayable narrative**: from entries alone, `chikory trace` must render fully (renderer has no other input — enforced by construction).
4. **Redaction**: no API keys, no env values, no user PII beyond what the task itself contains. Dataset pipeline (WP-306) applies a second scrub pass + opt-in gate before anything leaves the machine.
5. Fixture suite: `fixtures/jif/*.json` valid/invalid docs; TS + Python parsers round-trip identically (CONTRACTS.md §10).

## 5. Versioning

`jif` integer bumps only on breaking change; additive fields free. Benchmark results and the WP-306 dataset record the `jif` version per document; migrators live in `benchmarks/tools/`.
