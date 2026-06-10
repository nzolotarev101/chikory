# Chikory

Vendor-neutral control plane for long-running, self-correcting software agents.

> Don't build another framework. Build the neutral orchestration layer that makes coding agents reliable over long horizons — guaranteeing durable state and enforcing real-time, Agent-as-a-Judge quality gates.

## The problem

79% of enterprises have started AI-agent adoption. Only ~11% have pushed agents to production. The ~68-point drop-off is an orchestration and reliability failure, not a model-capability failure.

Root causes:
- **Context rot** — model perf degrades over long sessions; errors compound
- **Compounding error** — 95% per-step reliability → ~5% end-to-end over 60 steps
- **Cost explosion** — stuck agents silently burn token budgets in infinite loops
- **Brittle state** — single API timeout wipes hours of reasoning

## What Chikory does

1. **Vendor-neutral LLM routing** — Anthropic, OpenAI, Gemini, open models; swap freely
2. **Durable execution** — journal/replay pattern; crash → resume from exact failure point
3. **Agent-as-a-Judge (inner loop)** — a structurally different model evaluates intermediate steps and can halt, rollback, or branch *before* a bad change lands

## What Chikory is NOT

- Not another framework (LangChain, CrewAI, AutoGen)
- Not a vibe-coder or IDE
- Not an offline eval harness

## Status

Stage 1 — pre-MVP. See [project.md](./project.md) for the full spec and **[plan.md](./plan.md) for the master plan** (MVP cutline, phases, work packages).

## Repo layout

```
packages/sdk-ts/         TypeScript SDK
packages/sdk-py/         Python SDK
services/control-plane/  Cloud control plane
docs/spec/               Architecture decision records
benchmarks/              DevAI-extended benchmark suite
```

## Development

All tasks run via [devbox](https://www.jetify.com/devbox) — the only prerequisite. `devbox shell` to enter the pinned toolchain; canonical scripts: `devbox run test` / `devbox run lint` / `devbox run temporal-dev`. Host-installed toolchains are unsupported.

## For contributors and AI agents

- Start here: [`plan.md`](./plan.md) (what to build) → [`docs/TASK-PROTOCOL.md`](./docs/TASK-PROTOCOL.md) (how to pick up a work package)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system shape; [`docs/components/`](./docs/components/) — per-component technical specs
- [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md) — every spec requirement traced to a work package
- [`docs/spec/CONTRACTS.md`](./docs/spec/CONTRACTS.md) — frozen core interfaces; [`docs/SECURITY.md`](./docs/SECURITY.md) — threat model; [`docs/PRODUCT.md`](./docs/PRODUCT.md) — pricing/GTM/enterprise readiness; [`docs/GLOSSARY.md`](./docs/GLOSSARY.md) — terms
- Read `AGENTS.md` for working conventions and invariants
- Read `CLAUDE.md` for Claude Code–specific guidance
- Full product spec: `project.md`
