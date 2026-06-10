# ADR-003: MVP Executor Strategy — Wrap CLI Coding Agents

**Status**: Accepted
**Date**: 2026-06-09

## Context

Chikory's loop needs an executor that does the actual software work. Two paths:

1. **Native loop**: build our own router-driven agent loop (plan → act → tool calls) from raw LLM calls.
2. **Wrapped CLI agents**: drive existing CLI coding agents (Claude Code, Codex CLI, Jules, Antigravity) as bounded, journaled subprocess invocations.

The spec is explicit that Chikory "sits above existing agent frameworks/coding agents rather than replace them" (§5.1) and must "be able to use claude code, codex cli, jules cli, antigravity cli" (§5.1). The MVP goal is dogfooding within weeks: using Chikory to build Chikory.

## Decision

**MVP executors are wrapped CLI coding agents; Claude Code headless is the reference adapter (WP-112).** The native loop (option 1) ships in Phase 2 (WP-213) for benchmark ablations and CLI-less environments — it is a control instrument, not the product's path to capability.

The journal/judge/checkpoint unit is the **bounded invocation** ("step"): one CLI-agent run with explicit scope and turn/time/cost caps, in a git worktree, producing a `StepRecord` (see `docs/components/executors.md`).

## Rationale

- **Differentiate where the thesis is.** App-building capability is commoditized in CLI agents; Chikory's wedge is durability + inner-loop judging + governance *around* an executor. Building our own executor first would spend the MVP budget on the saturated axis the spec forbids (§4 "what it is NOT").
- **Fastest path to being our own user.** Claude Code headless can already do full-app, brownfield work — wrapping it means dogfooding in week 4 instead of quarter 2.
- **Step granularity is judgeable.** Per-action gating inside a CLI agent is impossible without forking it; bounded invocations give the judge meaningful evidence (a coherent diff) at a granularity rollback can handle (one checkpoint per step).

## Consequences

- Chikory's quality floor depends on the wrapped agent; the benchmark must ablate this (no-judge native-loop cell, WP-301).
- CLI interfaces change under us → adapter conformance suite (WP-111) is the regression net; native executor is the long-term hedge.
- Internals of a step are opaque (no per-tool-call spans inside CLI agents); step-level spans + transcript artifacts are the observability answer.
- Executor cost may be estimated rather than exact for some CLIs → ledger tracks `costEstimated` distinctly.
