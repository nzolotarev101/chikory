# AGENTS.md — Chikory

Instructions for all AI coding agents (Codex, Claude Code, Antigravity, Jules, Gemini CLI, etc.).

## What this project is

Chikory is a vendor-neutral orchestration control plane for long-running software agents. It is NOT a framework, IDE, or vibe-coder. The differentiator is Agent-as-a-Judge running in the inner execution loop as a real-time gate, combined with durable execution and context-rot mitigation.

Read `project.md` for the full spec. Read `CLAUDE.md` for working conventions.

## Repo structure

```
packages/sdk-ts/        TypeScript SDK (primary)
packages/sdk-py/        Python SDK
services/control-plane/ Cloud control plane
docs/spec/              Architecture decision records (ADRs)
benchmarks/             DevAI-extended benchmark suite
```

## Current stage: Stage 1 (0–3 months)

Three deliverables only:
1. `packages/sdk-ts` — vendor-neutral LLM router (Anthropic / OpenAI / Gemini)
2. Durable agent loop wrapping Temporal or LangGraph
3. Default Agent-as-a-Judge step (different model family than executor)

Do not build beyond these until Stage 1 is complete.

## Language rules

**TypeScript**
- ESM modules, strict mode on
- Named exports only (no default exports in lib code)
- No `any`; use `unknown` + type guards
- Async/await throughout; no callbacks

**Python**
- 3.11+ minimum
- Fully type-annotated (`from __future__ import annotations`)
- Async-first (`asyncio`, `httpx` not `requests`)
- Format/lint: `ruff`

## Testing rules

- Integration tests must hit real LLM endpoints or recorded cassettes — no mocked LLM responses
- Unit tests for pure logic only (routing decisions, cost math, context-size calculations)
- Benchmark runs tracked against DevAI-extended task set

## Commit format

`type(scope): message`

Types: `feat`, `fix`, `chore`, `docs`, `test`, `bench`
Scopes: `sdk-ts`, `sdk-py`, `control-plane`, `judge`, `bench`, `router`

Example: `feat(router): add Gemini provider with retry backoff`

## Key invariants — never break these

1. **No provider lock-in**: all LLM calls go through the vendor-neutral router interface
2. **Judge uses different model**: executor and judge must use structurally different model families
3. **OTel spans on every LLM/tool call**: observability is non-negotiable from day 1
4. **Terminal states in tool responses**: every tool must return explicit SUCCESS/FAILED to prevent infinite loops
5. **No secrets in code**: API keys via env only; never hardcoded

## Architecture decisions in progress

See `docs/spec/` for ADRs. Open questions:
- Primary durable execution substrate: Temporal vs. LangGraph checkpointers
- Judge scoring: pointwise rubric vs. pairwise comparison (default)
- First target segment: indie devs vs. AI-native startups vs. enterprise

## Reference

- Full product spec: `project.md`
- Working conventions: `CLAUDE.md`
- Benchmark: `benchmarks/README.md` (to be created in Stage 1)
