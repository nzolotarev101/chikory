# ADR-001: Durable Execution Substrate

**Status**: Open  
**Date**: 2026-06-09

## Context

Stage 1 requires wrapping the agent loop as a durable, journaled workflow. Two candidates:

| | Temporal | LangGraph checkpointers |
|---|---|---|
| Maturity | Production-proven at scale | Newer, LLM-native |
| Lock-in | Temporal infra dependency | LangGraph/LangChain ecosystem |
| LLM-aware | No — generic workflow | Yes — graph/state model |
| Self-hosting | Yes | Yes |
| Cloud offering | Temporal Cloud | LangSmith |

## Decision

TBD. Lean: **Temporal** for Stage 1 (better deterministic replay guarantees, broader production evidence). Evaluate LangGraph checkpointers for Stage 2 if Temporal adds friction for solo-dev users.

## Consequences

- Temporal: must run a Temporal server locally or use Temporal Cloud during dev
- LangGraph: couples us to LangChain ecosystem perception ("not another LangChain")

## Open questions

- Can we abstract the substrate behind a `DurableRunner` interface thin enough to swap later?
- Is Temporal overkill for indie-dev first beachhead?
