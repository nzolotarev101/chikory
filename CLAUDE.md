# CLAUDE.md — Chikory

## Project

**Chikory**: vendor-neutral control plane for long-running, self-correcting software agents.

Core thesis: make coding agents reliable over long horizons via durable execution + real-time Agent-as-a-Judge quality gates.

Full spec: `project.md`

## Stage

Pre-MVP (Stage 1). Building:
1. Vendor-neutral LLM routing SDK (TS + Python)
2. Durable workflow execution (Temporal/LangGraph substrate)
3. Agent-as-a-Judge step (structurally different model family from executor)

## Repo layout

```
packages/
  sdk-ts/       TypeScript SDK
  sdk-py/       Python SDK
services/
  control-plane/ Cloud control plane (hosted judges, checkpointers, trace browser)
docs/
  spec/         Architecture decision records
benchmarks/     DevAI-extended benchmark suite
```

## Tech stack

- **TypeScript** (primary SDK language, strict mode, ESM)
- **Python** (secondary SDK, type-annotated, 3.11+)
- **Temporal** (durable execution substrate for Stage 1)
- **OTel** (traces — all agent runs emit OTel-compliant spans)
- LLM providers at launch: Anthropic, OpenAI, Gemini, open models via OpenAI-compat

## Key constraints

- Never build another framework/vibe-coder/LangChain wrapper — the wedge is narrower
- Minimal abstraction + maximal observability — no magic
- Agent-as-a-Judge runs **in the inner loop**, not offline/async
- Judge uses structurally different model family from executor (bias mitigation)
- Vendor-neutral: no provider lock-in anywhere in core path

## Dev environment — devbox ONLY

All project tasks (build, lint, test, run, Temporal, scripts) run **inside devbox** — never against host-installed toolchains.

- Enter the environment: `devbox shell` — or prefix one-offs: `devbox run <script>` / `devbox run -- <command>`
- Canonical task entry points live in `devbox.json` `shell.scripts` (e.g., `devbox run test`, `devbox run lint`, `devbox run temporal-dev`)
- Run Devbox commands sequentially. Concurrent `devbox run` startup races on `.devbox/gen/scripts/.cmd.sh` under Devbox 0.17.0.
- Never invoke `pnpm`, `node`, `python`, `pytest`, `ruff`, `temporal`, etc. directly on the host — toolchain versions are pinned in `devbox.json`, host versions are not supported
- Adding a tool = `devbox add <pkg>` (updates `devbox.json` + lock), never a global install
- CI uses the same `devbox run` scripts — if it isn't runnable via devbox, it doesn't exist

## Working conventions

- TypeScript: strict, ESM, named exports, no default exports in lib code
- Python: type-annotated, async-first, `ruff` for lint/format
- Tests: real integrations over mocks where possible (context rot and error compounding cannot be caught by mocks)
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- PRs: one concern per PR; include benchmark deltas when touching agent/judge logic

## Critical concepts (read project.md for full detail)

- **Context rot**: model perf degrades over long sessions; first-class mitigation required
- **Compounding error**: 95% per-step → ~5% end-to-end over 60 steps; target 99%+
- **Memory Pointer Pattern**: store large tool outputs externally, pass short refs into context
- **Terminal states**: explicit SUCCESS/FAILED in tool responses to break infinite loops
- **Agent-as-a-Judge**: inspects diffs, runs tests, compares UI snapshots — not text grading

## Do not

- Run project commands outside devbox (no host pnpm/node/python/temporal)
- Add abstractions beyond current stage requirements
- Mock the LLM layer in integration tests (masks real failure modes)
- Hardcode any provider API keys
- Build UI/frontend until SDK API is stable
