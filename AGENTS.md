# AGENTS.md — Chikory

Instructions for all AI coding agents (Codex, Claude Code, Antigravity, Jules, Gemini CLI, etc.).

## What this project is

Chikory is a vendor-neutral orchestration control plane for long-running software agents. It is NOT a framework, IDE, or vibe-coder. The differentiator is Agent-as-a-Judge running in the inner execution loop as a real-time gate, combined with durable execution and context-rot mitigation.

Read `project.md` for the full spec. Read `CLAUDE.md` for working conventions.

## Dev environment — devbox ONLY (hard rule)

Every project task runs inside [devbox](https://www.jetify.com/devbox) — build, lint, test, Temporal, benchmarks, everything.

- `devbox shell` to enter, or `devbox run <script>` / `devbox run -- <command>` for one-offs
- Canonical scripts are defined in `devbox.json` (`devbox run test`, `devbox run lint`, `devbox run temporal-dev`)
- **Run Devbox commands sequentially, never in parallel** — Devbox 0.17.0 races on `.devbox/gen/scripts/.cmd.sh` during concurrent startup
- **Already inside devbox? Do NOT nest another `devbox run`.** When `DEVBOX_SHELL_ENABLED=1` (the Chikory run harness always launches the executor inside an activated devbox), the pinned toolchain is already on `PATH` — run tools **directly**: `pnpm exec vitest …`, `pnpm exec tsc --noEmit`, `pnpm exec eslint …`. A nested `devbox run` cold-starts a fresh Nix env on **every** call; repeating that across an inner verify loop makes a single step exceed its `maxSeconds` wall-clock cap and get killed (dogfood-105: 50+ nested `devbox run` verify calls hung node N-B). Direct invocation here is NOT "host toolchain" — `PATH` already points at the devbox-pinned binaries.
- **Never** call host toolchains directly (`pnpm`, `node`, `python`, `pytest`, `ruff`, `temporal`) — versions are pinned only in `devbox.json`. (Being *inside* an activated devbox satisfies this: bare `pnpm`/`node` there ARE the pinned versions.)
- Need a new tool? `devbox add <pkg>` and commit the updated `devbox.json` + `devbox.lock`; no global installs
- CI runs the same devbox scripts; commands not expressed as devbox scripts are not supported

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

## Architecture decisions

See `docs/spec/` for ADRs. Settled:
- ADR-001: durable substrate = **Temporal** (behind `DurableRunner` interface)
- ADR-002: judge = different provider family; pointwise binary rubric + CoT by default
- ADR-003: MVP executor = wrapped CLI coding agents (Claude Code headless first)

Open:
- First target segment: indie devs vs. AI-native startups vs. enterprise

## Communication Style and User Output Conventions

To ensure the developer can quickly digest your output, follow these communication guidelines for every response, report, or status update:

1. **Simplified Summary First**: Always start with a brief, high-level summary explaining *what* happened, *why* it matters, and *what* the next steps are, using clear and simple language. Avoid immediate jargon.
2. **Conserve Context Fully**: Never omit critical technical details or values. You must keep and present exact:
   - Run IDs, commit SHAs, file paths, line numbers/ranges
   - Cost metrics (USD, token count, duration, percentage of budget)
   - Specific failure errors or test exit codes
3. **Structured Visual Presentation**: Use tables for comparisons (e.g., comparing runs, metrics, budgets, or file diffs). Use visual indicators (like `🟢`, `🟡`, `🔴`, `⚠️`, `ℹ️`) and structured bullet points to break up text and avoid walls of prose.
4. **Explain in Great Detail**: When discussing complex architectures, domain concepts, or technical terms (e.g., "Compounding errors", "Context rot", "OTel span", "Temporal workflows"), explain them clearly and thoroughly so the reader does not have to guess or look up background context.

## Reference

- Master plan (what to build, work packages): `plan.md`
- How to pick up a work package: `docs/TASK-PROTOCOL.md`
- Requirements traceability: `docs/REQUIREMENTS.md`
- Architecture: `docs/ARCHITECTURE.md`; component specs: `docs/components/`
- Frozen interfaces: `docs/spec/CONTRACTS.md`; task.yaml: `docs/spec/task-spec.md`; journal format: `docs/spec/journal-format.md`
- Threat model: `docs/SECURITY.md`; product/pricing: `docs/PRODUCT.md`; terms: `docs/GLOSSARY.md`
- Full product spec: `project.md`
- Working conventions: `CLAUDE.md`
- Benchmark: `benchmarks/README.md` (to be created in Stage 1)
