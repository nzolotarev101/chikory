# ADR-001: Durable Execution Substrate

**Status**: Accepted (Temporal)  
**Date**: 2026-06-09 (accepted 2026-06-09 during master-plan synthesis — see `plan.md` WP-004)

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

**Temporal** for Stage 1: better deterministic replay guarantees, broader production evidence, and the dev server (`devbox run temporal-dev`, temporal-cli pinned in `devbox.json`) keeps local-first friction acceptable. The substrate hides behind the `DurableRunner` interface (frozen in WP-002) so it can be swapped.

**Revisit trigger**: if dogfood/early-user feedback shows Temporal setup is the top onboarding friction by end of Phase 2, evaluate LangGraph checkpointers or a lighter `DurableRunner` implementation. Avoid the "not another LangChain" perception cost unless the friction evidence is strong.

## Consequences

- Temporal: must run a Temporal server locally or use Temporal Cloud during dev
- LangGraph: couples us to LangChain ecosystem perception ("not another LangChain")

## Open questions

- Can we abstract the substrate behind a `DurableRunner` interface thin enough to swap later?
- Is Temporal overkill for indie-dev first beachhead?
