# Chikory Architecture

System shape for Stage 1 (local-first SDK + CLI). Stage 2 control plane extends this without changing the core loop ([control-plane.md](components/control-plane.md)).

## 1. System overview

```
                        ┌────────────────────────────────────────────────────┐
                        │                  chikory CLI / SDK                 │
                        │   run · resume · status · trace · approve · inject │
                        └────────────────────────┬───────────────────────────┘
                                                 │ TaskSpec (task.yaml)
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DURABLE RUNNER  (Temporal workflow)                       │
│                                                                              │
│   ┌──────────── the gated loop (one iteration = one journaled step) ─────┐   │
│   │                                                                      │   │
│   │   plan next step ──► EXECUTOR step ──► checkpoint ──► every N steps: │   │
│   │   (window-fit,       (activity)       (git+journal)   JUDGE pass     │   │
│   │    budget check)         │                             (activity)    │   │
│   │        ▲                 │                                 │         │   │
│   │        └── PROCEED ◄─────┴──── verdict: HALT / ROLLBACK / ─┘         │   │
│   │                                ESCALATE / PROCEED                    │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
└──────┬──────────────────┬──────────────────┬──────────────────┬─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌────────────┐   ┌─────────────────┐   ┌────────────┐   ┌──────────────────┐
│  EXECUTORS │   │     ROUTER      │   │ ARTIFACT & │   │  OBSERVABILITY   │
│ (adapters) │   │ vendor-neutral  │   │ CHECKPOINT │   │                  │
│ claude code│   │ anthropic       │   │ STORE      │   │ OTel spans       │
│ codex cli  │   │ openai          │   │ git snaps  │   │ journal (truth)  │
│ jules …    │   │ gemini          │   │ blobs/refs │   │ trace renderer   │
│ native loop│   │ openai-compat   │   │ journal db │   │ metrics          │
└────────────┘   └─────────────────┘   └────────────┘   └──────────────────┘
```

Key relationships:

- **Everything that talks to an LLM goes through the Router** (invariant #1). The judge and the native executor use it directly; CLI-agent executors bring their own model access, but their *routing choice* (which CLI, which model flag) is still set by the per-stage `RoutingPolicy`.
- **The Durable Runner owns control flow**; executors and the judge are stateless activities. All state lives in the journal + artifact store, never in process memory (DX-1..4).
- **The journal is the ground truth.** Traces, resume, rollback, cost accounting, and the P3 benchmark dataset are all derived views of the journal.

## 2. Core concepts & data model

Full interface definitions: [spec/CONTRACTS.md](spec/CONTRACTS.md) (WP-002 transcribes them into `packages/sdk-ts/src/types.ts`; mirrored to Python in WP-201).

| Concept | What it is |
|---|---|
| `TaskSpec` | The user's contract: goal, repo(s), acceptance criteria, budget, judge cadence, routing policy. Success criteria are upfront and machine-checkable where possible (OB-3). |
| **Step** | The atomic unit of execution, journaling, checkpointing, and judging. One bounded executor invocation. Produces a `StepRecord`. |
| `StepRecord` | What happened in a step: workspace diff ref, tool-call summary, tokens in/out, cost, duration, terminal state (`SUCCESS`/`FAILED`), transcript pointer. |
| `JournalEntry` | Append-only row per event (step, judge pass, checkpoint, verdict, injection, budget event). Includes monotonic index, timestamps, cost deltas. |
| **Checkpoint** | Git commit (workspace state) + journal index + context snapshot ref. The unit you resume from, roll back to, or branch from. |
| `ArtifactRef` | Short pointer to first-class runtime objects stored outside context: repo snapshot, diff, test results, browser screenshot, large tool output (AR-1, CM-3). |
| `JudgeEvidence` | Bundle handed to the judge: diff(s) since last verdict, test run output, acceptance criteria, compacted step history, relevant artifact refs. |
| `JudgeVerdict` | `PROCEED` · `HALT` · `ROLLBACK` (+ target checkpoint) · `ESCALATE` (+ reason). Plus per-criterion binary scores and CoT rationale. |
| **Run** | One durable workflow execution of a TaskSpec. Has an ID, journal, checkpoints, budget ledger, terminal status. |

## 3. Run lifecycle

```
chikory run task.yaml
  1. Validate TaskSpec; resolve RoutingPolicy; enforce judge-family ≠ executor-family (or explicit opt-in)
  2. Start Temporal workflow (run-id); workspace prepared (clone/worktree); journal opened
  3. LOOP until terminal:
     a. Budget check (CG-2): remaining < step estimate → HALT(BUDGET) w/ resumable checkpoint
     b. Pace/plan (P2: window-fit reasoning sizes the next step batch)
     c. Executor step (activity, journaled): bounded CLI-agent invocation or native loop turn
     d. Checkpoint: git commit + journal entry + artifact refs
     e. If stepIndex % N == 0 or milestone: Judge pass (activity, journaled)
        - PROCEED  → continue
        - ROLLBACK → git reset to last PROCEED checkpoint, journal the fork, continue with judge feedback in context
        - HALT     → terminal FAILED-with-checkpoint (resumable after human review)
        - ESCALATE → workflow waits on approval signal (P1: process waits; P2: durable sleep, zero compute)
     f. Acceptance criteria all green per judge → terminal SUCCESS
  4. Terminal: journal sealed with explicit SUCCESS/FAILED — never ambiguous (CG-1)

chikory resume <run-id>   → Temporal replays journaled steps from memoized results (zero duplicate LLM spend), continues at 3
chikory trace <run-id>    → renders journal: steps, costs, tokens, verdicts, rationales, checkpoints
chikory inject <run-id> … → journaled correction, enters context at next step (P2)
```

## 4. Component index

| Component | Doc | Owns | Phase |
|---|---|---|---|
| Router | [components/router.md](components/router.md) | Provider adapters, retries/failover, per-stage routing, call accounting | P1 |
| Executors | [components/executors.md](components/executors.md) | `ExecutorAdapter` contract, CLI-agent adapters, native loop | P1 |
| Durable runner | [components/durable-runner.md](components/durable-runner.md) | Temporal workflow, journal, checkpoints, resume, budget gate | P1 |
| Judge | [components/judge.md](components/judge.md) | Evidence collection, rubrics, verdicts, diversity enforcement | P1 |
| CLI | [components/cli.md](components/cli.md) | All user-facing commands, trajectory renderer | P1 |
| Context & memory | [components/context-memory.md](components/context-memory.md) | Memory pointers, compaction, notes, tiered memory | P2 |
| Cost governance | [components/cost-governance.md](components/cost-governance.md) | Budget ledger, terminal-state policy, pacing inputs | P1–P2 |
| Artifacts | [components/artifacts.md](components/artifacts.md) | ArtifactRef store, git snapshotting, blob storage | P1–P2 |
| Observability | [components/observability.md](components/observability.md) | OTel emission, metrics, forensics | P1 |
| Benchmark | [components/benchmark.md](components/benchmark.md) | DevAI-extended harness, leaderboard, dataset | P3 |
| Control plane | [components/control-plane.md](components/control-plane.md) | Hosted services, API, data model, auth, billing, ops | P4 |
| Vertical agent | [components/vertical-agent.md](components/vertical-agent.md) | Vertical packs, playbooks, steward, SLO reporting | P5 |

Cross-cutting specs: [spec/CONTRACTS.md](spec/CONTRACTS.md) (frozen interfaces) · [spec/task-spec.md](spec/task-spec.md) (task.yaml) · [spec/journal-format.md](spec/journal-format.md) (JIF) · [SECURITY.md](SECURITY.md) (threat model) · [GLOSSARY.md](GLOSSARY.md).

## 5. Architectural rules

1. **Minimal abstraction.** No plugin systems, no DI containers, no abstraction built before a second concrete implementation needs it (the `ExecutorAdapter` and `DurableRunner` interfaces exist because spec/ADRs name the second implementation). CLAUDE.md "Do not" list applies.
2. **Stateless activities, durable workflow.** Anything that can fail must be re-runnable from journal state. No in-memory state survives a step boundary by design — that's how DX-3 is free.
3. **Derived views, single truth.** Trace output, metrics, benchmark results, and dashboards are derived from journal + artifact store. Never write the same fact to two places.
4. **Explicit over inferred.** Verdicts, terminal states, budget events, compaction events are explicit journal entries with rationales — "no magic" (NF-2).
5. **Local-first forever.** Every Stage 2 hosted service has a local fallback; the cloud orchestrates, it never gatekeeps (RT-9).

## 6. Technology choices (settled)

| Choice | Decision | Where decided |
|---|---|---|
| Durable substrate | Temporal (dev server locally; swappable behind `DurableRunner`) | ADR-001 |
| Judge diversity | Different provider family by default, same-family = explicit opt-in + warning | ADR-002 |
| Judge scoring default | Pointwise binary rubric with CoT | ADR-002 |
| MVP executor | Wrapped CLI coding agents (Claude Code first) | ADR-003 |
| SDK languages | TS primary (strict, ESM, named exports), Python parity (3.11+, async, ruff) | CLAUDE.md |
| Tracing | OTel on every LLM/tool call, OTLP-exportable | invariant #3 |
| Journal store (P1) | SQLite next to workspace (simple, inspectable); revisit at P4 | durable-runner.md |
| Dev environment | Devbox only — toolchain pinned in `devbox.json`, all tasks via `devbox run`; host toolchains unsupported | CLAUDE.md / AGENTS.md |
