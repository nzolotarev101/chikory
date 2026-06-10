# Component: Cost Governance

**Phase**: P1, extended P2/P4 · **WPs**: WP-103, WP-124, WP-207, WP-407 · **Requirements**: CG-1, CG-2, DX-7, FA-3
**Code**: lives inside router (accounting), runner (ledger + gates), no separate package — governance is a property of the loop, not a service.

## Purpose

Spec §2: cost explosion and infinite loops are a top-five failure mode; §9: buyers resist *unpredictability* more than price. Chikory's stance: every dollar is attributed, every stop is clean and resumable, no loop spins silently.

## Terminal states (CG-1, invariant #4)

- Every tool/executor/router result is explicit `SUCCESS`/`FAILED` — enforced at the type level (`StepRecord.status`, `RouterError`), tested in conformance suites.
- Loop breakers in the runner: 3 identical consecutive failures → ESCALATE (never silent retry #4); judge HALT verdict for goal-drift; per-step `maxTurns`/`maxSeconds` caps in `StepInput.limits`.
- Spec's cited result (terminal states collapse double-digit redundant calls to single executions) is a benchmark assertion in P3: loop-trace count must be zero across the suite.

## Budget ledger (CG-2, WP-124)

- Single per-run ledger in the journal: every `LLMCallResult.cost`, every `StepRecord.costUsd`, every judge pass. Attribution dimensions: stage (plan/code/review/judge), step index, provider/model.
- Pre-step gate: conservative estimate (rolling mean × 1.5) vs remaining budget → `HALT(BUDGET)` with resumable checkpoint *before* overspend, not after.
- Checkpoint-aware: `chikory resume --add-budget` continues exactly where money ran out — a budget stop costs zero progress (the spec's "checkpoint-aware budget governance").
- Transparency surfaces: `chikory status` (live spend), `chikory trace` (per-step + judge share), OTel metrics (P4 dashboards reuse the same ledger).

## Budget-aware continuation (DX-7 → WP-207, P2)

P1 gate is binary. P2 upgrades the pre-step decision to reasoned: near-budget, the pacer chooses between *finish current acceptance criterion then stop clean* vs *stop now*, and journals the reasoning. Resume decisions consider remaining budget when sizing batches.

## Estimation honesty

CLI-agent costs may be estimates (flagged `costEstimated` in StepRecord); the ledger tracks estimated vs exact separately and `trace` displays the distinction — never present an estimate as a measurement (NF-5 spirit applies internally too).

## Out of scope here

Pricing/billing of Chikory itself (WP-405/407, P4). This component is about *the user's* LLM spend.
