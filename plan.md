# Chikory — Master Plan

> Vendor-neutral control plane for long-running, self-correcting software agents.
> This is the single source of truth for **what we build, in what order, and why**.
> Spec: [`project.md`](project.md) · Requirements matrix: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) · Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · How to pick up work: [`docs/TASK-PROTOCOL.md`](docs/TASK-PROTOCOL.md)

**Status**: Phase 0 complete (2026-06-10); **Phase 1 complete (2026-06-11)** — all lanes M1–M5 done, dogfood-001 SUCCESS (`docs/reports/dogfood-001.md`) · **P2 underway**: WP-201 slice 1 landed via dogfood-002 (`docs/reports/dogfood-002.md`); WP-217 landed via dogfood-003 (`docs/reports/dogfood-003.md`, run `run-b2f3504d`, commit `ef4b16f`), which queued WP-221; WP-218 slice 1 delivered via dogfood-004 (`docs/reports/dogfood-004.md`, run `run-9edbcd28`, commit pending — F-15 flake aborted harvest), which queued WP-222/WP-223 · **Plan date**: 2026-06-09 · **Stage 1 deadline (per spec §10)**: ~2026-09-07 (90 days)

---

## 1. The one decision that shapes everything: the MVP

### 1.1 What the MVP is

The MVP (**v0.1, "dogfood release"**) is the thinnest product that delivers the core thesis end-to-end:

> Run a long-horizon coding agent **durably** (crash → resume, never lose progress), with a **real-time Agent-as-a-Judge gate** (different model family) that inspects actual diffs and test results every N steps and can halt/rollback **before** a bad change lands — all **vendor-neutral**, with full trajectory observability and a hard budget cap.

Concretely, after v0.1 you can do this:

```bash
chikory run task.yaml          # task: goal + acceptance criteria + budget + routing policy
# → drives a CLI coding agent (Claude Code headless) in journaled steps on Temporal
# → judge (Gemini or GPT — different family) gates every N steps: PROCEED | HALT | ROLLBACK | ESCALATE
# → kill -9 it, laptop dies, API times out…
chikory resume <run-id>        # → continues from last checkpoint, zero lost work
chikory trace <run-id>         # → full human-readable trajectory: every step, token, cost, verdict
```

### 1.2 Why this MVP (and not something else)

1. **It is the differentiator, not a feature of it.** Per spec §6, the defensible wedge is runtime-embedded judge + durable execution fused together. The MVP is exactly that fusion and nothing else.
2. **It makes you the user immediately.** The MVP's executor is a wrapped CLI coding agent (ADR-003). We do not build app-generation capability — Claude Code / Codex already have it. Chikory adds the reliability shell around it. That means **v0.1 can build the rest of Chikory** — every Phase 2+ work package is a dogfood run.
3. **It honors the spec's hard constraints.** Not a framework, not a vibe-coder, minimal abstraction, sits *above* existing coding agents (spec §5.1: "use claude code, codex cli, …").

### 1.3 MVP cutline

| ✅ In v0.1 | ❌ Not in v0.1 (and where it lands) |
|---|---|
| Router: Anthropic, OpenAI, Gemini, OpenAI-compat; retries; per-stage policies | Python SDK (P2 — parity port once contracts are stable) |
| Executor: Claude Code headless adapter (+ Codex CLI if time allows) | Jules / Antigravity adapters (P2), native raw-LLM loop executor (P2) |
| Durable runner on Temporal: journaled steps, checkpoint per step, crash-resume | Branching as first-class op, HITL suspend-for-days (P2) |
| Judge v1: diff + test evidence, binary pointwise rubric, 4 verdicts, family-diversity enforcement | Pairwise/G-Eval/debate scoring, UI-snapshot & security judging (P2) |
| Budget cap + terminal states + cost/token accounting | Pacing/window-fit reasoning, budget-aware *continuation* heuristics (P2) |
| OTel spans on everything; CLI trajectory viewer | Trace browser web UI (P4), checkpoint notifications (P2) |
| Git-snapshot checkpoints, single repo | Multi-repo workspaces (P2), Memory Pointer / tiered memory (P2) |
| TS SDK + CLI, MIT licensed | Cloud control plane, hosted anything, pricing (P4) |

### 1.4 MVP exit gate (all must pass)

1. **Dogfood proof**: Chikory v0.1 implements one real Phase 2 work package (target: WP-202 Memory Pointer store) end-to-end, with the judge catching at least one genuine issue before it landed. — ✅ **passed 2026-06-11**: dogfood-001 run 4 SUCCESS; run 1's judge made a true-positive catch (missing JSDoc) on real code (`docs/reports/dogfood-001.md`).
2. **Durability proof**: `kill -9` mid-run, then `chikory resume` completes the task with no repeated LLM calls for journaled steps. — ✅ **passed**: WP-123 automated test (journal holds exactly one entry per step; cost == Σ unique steps).
3. **Neutrality proof**: same task runs with executor=Anthropic/judge=Gemini and executor=OpenAI/judge=Anthropic by changing only config. — ✅ **passed**: dogfood-001 swapped executor claude(anthropic)/judge GPT → executor codex(openai)/judge Gemini editing only the TaskSpec; WP-104 tests prove zero-code-change policy swaps.
4. **Governance proof**: run halts cleanly at budget cap with a resumable checkpoint; no infinite-loop trace exists for terminal-state-returning tools. — ✅ **passed**: WP-124 tests (halt → `resume --add-budget` → continue; loop-breaker never spins) + dogfood run 3 (judge HALT on stuck criterion at $0.00 burned).
5. **Forensics proof**: a person who did not run the task can answer "what happened, what did it cost, why did the judge intervene" from `chikory trace` alone. — ✅ **passed**: the dogfood-001 report's run reconstructions are raw `chikory trace` output (per-step cost, judge form, rationales, checkpoints).

---

## 2. Phase map

```
P0 Foundations ──► P1 MVP (dogfood) ──► P2 Reliability & Memory ──► P3 Benchmark & Launch ──► P4 Control Plane ──► P5 Vertical
   week 0            weeks 1–4             weeks 5–8                   weeks 9–13              months 4–9         months 9–18
                                  └──────────── spec Stage 1 (90 days, OSS + published numbers) ───────────┘      Stage 2 → 3
```

Spec stage mapping: **P0–P3 = Stage 1**, **P4 = Stage 2**, **P5 = Stage 3**.

Kill/pivot criteria (spec §10–11, check at every phase boundary):
- Month 6: if we can't beat OpenHands on a 50-task extended-DevAI subset → technical thesis not differentiated; revisit.
- Frontier models >90% SWE-bench Verified → double down brownfield (P3 task authoring already weights brownfield for this reason).
- Anthropic/OpenAI ship first-class judge primitive → pivot moat to benchmark (P3 exists precisely as the hedge).

---

## 3. How work is sliced (read before picking up a task)

This plan is written to be executed by **multiple workers — humans, strong models, and simpler models — in parallel and in sequence**. Rules:

1. **Contracts first.** WP-002 freezes the core TypeScript interfaces. After that, every lane codes against `types.ts`, not against each other's internals. Interface changes require a contracts PR reviewed against `docs/REQUIREMENTS.md`.
2. **One work package = one PR = one concern.** Every WP below has explicit acceptance criteria and a verification command. A WP is done when its checks pass, not when its code exists.
3. **Complexity tags route work to the right worker:**
   - 🔴 **Architect** — design-heavy, ambiguity, cross-component. Strong model or human required. Do not parallelize two 🔴 WPs in the same component.
   - 🟡 **Builder** — well-specified implementation against frozen contracts. Any competent model.
   - 🟢 **Mechanical** — porting, adapters-from-pattern, docs, CI. Safe for simpler models; spec is complete in the component doc.
4. **Lanes never share files.** Each milestone below is a lane (router / executors / runner / judge / CLI). Within a lane, WPs are sequential; across lanes, parallel.
5. **Everything runs through devbox.** Build, lint, test, Temporal, benchmarks — `devbox shell` or `devbox run <script>` only; host toolchains are unsupported. `devbox.json` pins the toolchain and defines the canonical task scripts; CI runs the same scripts.
6. **Full protocol** (branch naming, handoff notes, verification, invariants checklist): [`docs/TASK-PROTOCOL.md`](docs/TASK-PROTOCOL.md). The five never-break invariants live there and in `CLAUDE.md` — judge-≠-executor-family, router-only LLM calls, OTel everywhere, terminal states, no secrets.

---

## 4. Phase 0 — Foundations (week 0)

Goal: nothing in P1 is blocked on tooling, contracts, or undecided architecture.

| WP | Title | Tag | Depends | Deliverable & acceptance criteria |
|---|---|---|---|---|
| WP-001 | Repo scaffold | 🟢 | — | ✅ **Done** (`f9bfab9`) |
| WP-002 | Contracts v1 | 🟡 | — | ✅ **Done** — CONTRACTS.md transcribed into `types.ts` + strict zod schemas; 25 valid / 14 invalid shared fixtures in `fixtures/contracts/` round-trip byte-identically. |
| WP-003 | CI pipeline | 🟢 | WP-004 | ✅ **Done** — `.github/workflows/ci.yml` runs `devbox run bootstrap/lint/typecheck/test/smoke` (identical to local); `ci` check required on `main` (red blocks merge). |
| WP-004 | Dev environment (devbox) + substrate | 🟡 | — | ✅ **Done** — `devbox run smoke` boots an ephemeral Temporal dev server and completes a hello-world workflow (`packages/smoke`); devbox is the only prerequisite (verified in CI on a clean runner). |
| WP-005 | Task spec format | 🟢 | WP-002 | ✅ **Done** — `parseTaskSpec` (zod + yaml) with all §9 rules; YAML fixtures in `fixtures/taskspec/`, one failing fixture per validation rule. |

---

## 5. Phase 1 — MVP (weeks 1–4)

Five parallel lanes after WP-002/WP-005 land. Lane docs contain full technical detail.

### Lane M1 — Router (`docs/components/router.md`)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-101 | Provider adapters: Anthropic, OpenAI, Gemini | 🟡 | WP-002 | ✅ **Done** — one `complete()` interface, three adapters; real-call integration tests (no LLM mocks — CLAUDE.md rule), skipped when key absent; token counts + cost on every call. |
| WP-102 | OpenAI-compat adapter (open models) | 🟢 | WP-101 | ✅ **Done** — same conformance tests run against `OPENAI_COMPAT_BASE_URL` (Ollama/vLLM verified manually). |
| WP-103 | Retry & failure policy | 🟡 | WP-101 | ✅ **Done** — exponential backoff, per-stage failover, every result normalized to explicit SUCCESS/FAILED (invariant #4); chaos tests with injected 429/500/timeout/4xx via local fake HTTP servers. |
| WP-104 | Per-stage routing policy | 🟡 | WP-101 | ✅ **Done** — `RoutingPolicy` maps stage (plan/code/review/judge) → provider+model; test runs identical task code under two policies, zero code change. |
| WP-105 | OTel spans + accounting | 🟡 | WP-101 | ✅ **Done** — every `complete()` emits `chikory.llm.call` (stage, provider, model, tokens, cost, latency, retries, outcome); asserted via in-memory exporter; OTLP export via standard env config. |

### Lane M2 — Executors (`docs/components/executors.md`, ADR-003)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-111 | `ExecutorAdapter` interface + step contract | 🔴 | WP-002 | ✅ **Done** — shared CLI-step machinery (`runCliStep`: bounded subprocess, diff+transcript artifacts, explicit SUCCESS/FAILED, `chikory.step` span), minimal local-FS artifact store (artifacts.md P1 slice), adapter conformance suite (5 properties + span assertion), contract↔doc drift test. |
| WP-112 | Claude Code headless adapter | 🔴 | WP-111 | ✅ **Done** — drives `claude -p` (stream-json, turn caps, user settings isolated, file-ops-only tool allowlist); exact cost from result event; conformance suite green on fake wire; real-CLI e2e completes the 3-step toy task (gated `CHIKORY_E2E_CLAUDE=1`, verified locally). |
| WP-113 | Codex CLI adapter | 🟢 | WP-112 | ✅ **Done** — `codex exec --json` (workspace-write sandbox, user config isolated); same conformance suite as WP-112 green; cost estimated from pricing table (`costEstimated: true` — no cost on the wire); real-CLI e2e completes the 3-step toy task (gated `CHIKORY_E2E_CODEX=1`, verified locally). |

### Lane M3 — Durable runner (`docs/components/durable-runner.md`)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-121 | Temporal workflow: journaled agent loop | 🔴 | WP-004, WP-111 | ✅ **Done** — deterministic `agentLoop` workflow (zero I/O; every side effect an activity); executor step + judge pass = one activity each, memoized + journaled to per-run SQLite (`node:sqlite`, JIF schema); replay verified via `Worker.runReplayHistory`; judge activity stub replaced by the real harness in WP-131/132. |
| WP-122 | Checkpointer (git + journal) | 🟡 | WP-121 | ✅ **Done** — every step: git commit on run-private branch (`chikory: step <n>`, `--allow-empty`) + checkpoint journal row + context-snapshot artifact + `chikory.checkpoint` span; `RunHandle.status()` lists checkpoints (the `chikory status` data source — CLI command itself is WP-141, Lane M5); `lastGood` reflects the covering PROCEED verdict. |
| WP-123 | Crash recovery | 🟡 | WP-122 | ✅ **Done** — automated test: worker subprocess `kill -9`'d mid-run → fresh worker → run completes via deterministic replay; journal holds exactly one entry per step, checkpoint, terminal; cost total == Σ unique steps (zero duplicate LLM spend). 1s activity heartbeats + 15s heartbeatTimeout give fast dead-worker detection. |
| WP-124 | Budget gate + terminal states | 🟡 | WP-121 | ✅ **Done** — pre-step gate (rolling mean of last 5 step costs ×1.5, judge spend counted); breach → journaled `budget_event` halt, SUSPENDED on the last checkpoint, `resume --add-budget` signals top-up and continues; loop-breaker: 3 consecutive FAILED steps → runner-sourced ESCALATE awaiting `approve` (approve continues, reject seals explicit FAILED) — tested to never spin. |

### Lane M4 — Judge (`docs/components/judge.md`, ADR-002)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-131 | Judge harness: evidence → rubric → verdict | 🔴 | WP-002 | ✅ **Done** — `judge/` module: `collectEvidence` (git diff since last verdict; criterion `check` commands executed BY the judge, JD-4), standing binary rubric with destructive-item flags, judge-only prompt regime (JD-5), deterministic `computeVerdict` per CONTRACTS §4 (LLM fills the form, code decides — JD-7); router failure / invalid form → ESCALATE verdict, never a throw. Fixture suite (key-gated `@integration`): secret-introducing and test-deleting diffs must get non-PROCEED across judge families. |
| WP-132 | Verdict gating in runner | 🔴 | WP-121, WP-131 | ✅ **Done** — `judgeStep` is the real harness (stub gone), journaled as `judge` + `verdict` entries with crash-window form-reuse (zero duplicate judge spend); ROLLBACK hard-resets to the last PROCEED-ed checkpoint (or the `chikory-base`-tagged run base) via the `restoreCheckpoint` activity; HALT seals resumable FAILED; ESCALATE parks AWAITING_APPROVAL for `chikory approve`; SUCCESS requires PROCEED **and** all criteria passing; non-PROCEED rationale rides into the next step as `judgeFeedback`. All four paths integration-tested through the real activity over a fake openai-compat wire, incl. git-restore proofs. |
| WP-133 | Family-diversity enforcement | 🟢 | WP-131 | ✅ **Done** — `enforceFamilyDiversity` re-checked at the judge boundary (parse-time check already in WP-005's `parseTaskSpec`); catches paper-only diversity (judge stage routed back at the executor's provider); same-family without `allow_same_family` throws; opt-in warns loudly on every pass AND journals the warning. Unit + direct-activity tested. |
| WP-134 | Judge telemetry | 🟢 | WP-131, WP-105 | ✅ **Done** — `chikory.judge.pass` span per pass (verdict, criteria/rubric pass-fail counts, tokens, cost absolute + share, evidence bytes); `runTotals()` derives JIF §2 totals (verdict mix, judgeCostUsd, judgeCostShare) from the journal — the WP-142 `chikory trace` footer data source; `judge.maxCostShare` breach warns + flags the span. |

### Lane M5 — CLI & dogfood (`docs/components/cli.md`)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-141 | CLI: `run` / `resume` / `status` / `approve` / `cancel` | 🟡 | WP-005, WP-121 | ✅ **Done** — `chikory` bin (`src/cli/`, node:util parseArgs — no CLI framework); run/resume host the worker in-process and follow to the terminal state (exit code mirrors it); status = workflow query with journal-first fast path for sealed runs (offline-capable); `--json` everywhere; actionable errors; every command integration-tested against a live local run (SUCCESS, escalate+reject, budget halt+top-up, cancel). |
| WP-142 | Trajectory renderer: `chikory trace <run-id>` | 🟡 | WP-122, WP-134 | ✅ **Done** — header (status/steps/spend/duration/families), per-step tokens+cost+verdict rows with non-PROCEED rationales inline, JIF totals footer; `--step <n>` drill-down (diff/transcript refs, judge form booleans + justifications, checkpoint); `--json` raw journal. Exit-gate #5 demonstrated in dogfood-001 (the report's run reconstructions are trace output). |
| WP-143 | **Dogfood run** | 🔴 | all P1 | ✅ **Done** — WP-202's P1 slice implemented through Chikory itself (run 4: SUCCESS, 2 steps, 1 judge pass, 3/3 judge-executed checks); 4 runs exercised every gate live (ESCALATE→reject, loop-breaker→cancel, deterministic HALT at $0 waste, PROCEED→SUCCESS); judge made a true-positive catch across model families; 2 real bugs found+fixed; zero-secrets CLI-auth setup (codex/gemini OAuth via `scripts/cli-judge-proxy.mjs`). Report: `docs/reports/dogfood-001.md` (7-item friction list → P2). |
| WP-144 | Quickstart + examples | 🟢 | WP-141 | ✅ **Done** — README quickstart (devbox → bootstrap/build → temporal-dev → keys → `pnpm chikory run examples/fix-failing-test.yaml --watch`); `examples/hello-greenfield.yaml` + `examples/fix-failing-test.yaml` with `scripts/examples-setup.sh` generating the sample repos (planted bug verified failing). |

---

## 6. Phase 2 — Reliability & memory (weeks 5–8)

Goal: survive *real* long horizons (days, big contexts, multi-repo) and close every remaining §5 requirement that isn't benchmark- or cloud-shaped. Built **using** v0.1 wherever practical — each WP here is a candidate dogfood run.

**Queue order**: dogfood findings outrank the original listing — ~~WP-217~~ (done), ~~WP-218 slice 1~~ (done, commit pending), WP-220 (small, unblock cheap/honest dogfooding of everything else), WP-222 + WP-223 (seam hygiene + watch fidelity, both small), then WP-219's ADR; WP-221 + WP-218 slice 2 (`budget_tokens`) ride with the next architect-reviewed contracts PR. Rationale: `docs/reports/dogfood-002.md` (F-8/F-9/F-10) + `docs/reports/dogfood-003.md` (F-11/F-12/F-13) + `docs/reports/dogfood-004.md` (F-14/F-15/F-16).

| WP | Title | Tag | Notes |
|---|---|---|---|
| WP-217 | Completion signal → off-cadence judge pass | 🟡 | ✅ **Done** (dogfood-003 run `run-b2f3504d`, landed `ef4b16f`): SUCCESS + empty diff triggers an immediate judge pass; milestone PROCEED rationale rides forward as judgeFeedback. The deferred `claimsComplete` half split out → WP-221. |
| WP-218 | Token-denominated budget + honest $0 metering | 🟡 | **Slice 1 done** (dogfood-004 run `run-9edbcd28`, commit pending — F-15 flake aborted harvest pre-commit): pricing table prices `gpt-5.5`/`gpt-5.5-mini`/`gemini-3.1-pro-preview`/`gemini-3.1-flash` (version `2026-06-12`); trace flags `UNPRICED` steps and warns `⚠ cost meter blind` on the run header when `costEstimated` ∧ cost=$0 ∧ tokens>0. Remaining slice: `budget_tokens` cap in TaskSpec enforced by the pre-step gate — contracts change, architect-reviewed, rides with WP-221. Makes CG-2 real on subscription/zero-secrets runs. |
| WP-219 | Goal decomposition & run chaining (ADR-005) | 🔴 | **Design next (dogfood-002 F-10a) — the objective gap.** Today a goal bigger than 1–3 steps is sliced by a human into hand-written yamls; nothing plans *across* runs (WP-207 paces *within* one). ADR-005 first: goal → plan tree → sequenced judge-gated slices, each an ordinary TaskSpec run; context carried via WP-202 refs + WP-203 compaction. Prereq for the P2 exit gate (a 24h run is a chain, not a step loop) and for "full-application engine" generally. Implementation slices fall out of the ADR. |
| WP-220 | `chikory land <run-id>` | 🟢 | **Next up (dogfood-002 F-10b).** Automates DOGFOODING §6: run workspace → branch + squashed conventional commit citing run-id + verification commands; optional `--pr` via gh. Also what WP-219's chaining calls between slices. Urgency reinforced by dogfood-003 F-13 (hand-harvest mixed human tooling into `ef4b16f`, breaking commit ≍ run-diff auditability). |
| WP-221 | Explicit `claimsComplete` completion signal | 🟡 | **Queued (dogfood-003 F-11).** WP-217's empty-diff inference still costs one full probe step (~155–211k input tokens/slice: 155k in run-2899005b, 211k in run-b2f3504d, 158k in run-9edbcd28) before the trigger can fire. Add `claimsComplete: boolean` to `StepRecord` (contracts PR, architect-reviewed — ride the next contracts change), populate from executor adapters' final-summary signal, OR it into the WP-217 trigger so the *productive* step is judged directly. |
| WP-222 | Executor subprocess env allowlist | 🟡 | **Next up (dogfood-004 F-14).** The dogfood launch's `OPENAI_COMPAT_BASE_URL` (judge shim) leaked into the codex executor's child env; the executor's in-workspace test run un-skipped `providers.integration.test.ts`, which called the live judge shim (`gemini -m llama3.2` → 404, twice). Executor adapters must spawn CLIs with provider/judge env vars scrubbed (allowlist, not blocklist); pass-through becomes an explicit TaskSpec opt-in. Protects the family-diversity seam (JD-5) and keeps in-workspace test runs deterministic. |
| WP-223 | Watch renders journal transitions, never sampled state | 🟡 | **Next up (dogfood-004 F-15).** `run --watch` missed printing `SUSPENDED at the budget cap` when a resume landed between polls — a budget suspension can vanish from watch output (CG-2 transparency break), and the assertion flake aborted `devbox run harvest` pre-commit. Derive watch lines from journal/status *transitions* so every state change prints exactly once; de-flakes `cli.test.ts > budget halt`. |
| WP-201 | Python SDK parity | 🟢 | **Slice 1 done** (`eb5c57e`, dogfood-002 run `run-2899005b`): contracts port + shared fixture conformance suite (40 tests; pyright/ruff clean). Remaining slices (router/runtime client parity) deferred until something needs them. |
| WP-202 | Memory Pointer store | 🟡 | Large tool outputs → blob store (local FS first), short `ArtifactRef` into context. **The designated dogfood-001 task.** |
| WP-203 | Compaction + structured note-taking primitives | 🔴 | Context-rot mitigation co-designed with checkpoints: compaction occurs *at* checkpoint boundaries so a resume never rehydrates rotted context. |
| WP-204 | Tiered memory (core/archival/recall) | 🔴 | Cross-session state; poisoning safeguards (provenance on every memory write). |
| WP-205 | Branching & rollback as first-class ops | 🟡 | `chikory branch <run-id>@<step>`; journal forks + git worktrees; judge can recommend BRANCH. |
| WP-206 | HITL suspend/resume | 🟡 | Temporal signals; sleep hours/days at zero compute; resume on approval event. Closes ESCALATE loop properly. |
| WP-207 | Pacing & window-fit reasoning v1 | 🔴 | Planner reasons about context-window fit + token budget to size work batches, test frequency, checkpoint cadence; "take a break and resume" decision. Spec §5.8/§5.9 — needs dogfood-001 data first. |
| WP-208 | Checkpoint notifications | 🟢 | Webhook/Slack/desktop ping at judge milestones & ESCALATE. |
| WP-209 | Process metrics | 🟢 | Components-over-time, issues-found:changes-made ratio, feedback frequency — in trace output + OTel metrics. |
| WP-210 | Pairwise + G-Eval scoring modes | 🟡 | Adds to judge harness behind `scoringMethod`; debate mode explicitly deferred (cost). |
| WP-211 | UI-snapshot judging | 🟡 | Playwright screenshot capture as `ArtifactRef`; judge compares against acceptance criteria. |
| WP-212 | Mid-run correction injection | 🟡 | `chikory inject <run-id> "guidance"` → next step's context, journaled. |
| WP-213 | Native raw-LLM loop executor | 🟡 | Router-driven loop with tools, for benchmark control runs & environments without CLI agents. |
| WP-214 | Multi-repo workspaces | 🟡 | TaskSpec accepts N repos; checkpoints span all; per-repo diffs in evidence. |
| WP-215 | Security & architecture rubric checks | 🟡 | Judge evidence adds dependency/secret scan + architecture-rubric pass. |
| WP-216 | Jules / Antigravity CLI adapters | 🟢 | Pattern established by WP-112/113 + conformance suite. |

Phase 2 exit: a 24h+ multi-session brownfield run on a real repo completes with ≥1 suspend/resume, compaction events in trace, and no context-rot-shaped failure.

---

## 7. Phase 3 — Benchmark & open launch (weeks 9–13)

Goal: the moat. Publish DevAI-extended numbers within Stage 1's 90 days (spec §10) and ship the vendor-neutral leaderboard nobody single-vendor can copy (spec §6).

| WP | Title | Tag | Notes |
|---|---|---|---|
| WP-301 | DevAI harness integration | 🟡 | Original 55 tasks / 365 requirements runnable under `benchmarks/`; results as artifacts. |
| WP-302 | Brownfield task authoring | 🔴 | Extend toward 60–100 multi-hour tasks, greenfield + brownfield branches; authoring guide so tasks can be added by any contributor (parallelizable per-task 🟢 after guide exists). |
| WP-303 | Leaderboard + methodology | 🟡 | Static site; full methodology + raw traces published (skeptical-developer credibility, spec §11). |
| WP-304 | Baseline runs & publication | 🔴 | Score Chikory vs OpenHands vs raw Claude Code; publish ranges not point claims. **This is the month-6 stop-signal measurement.** |
| WP-305 | OSS launch polish | 🟢 | MIT license headers, versioning, CONTRIBUTING, security policy, release automation. |
| WP-306 | Trace-dataset capture pipeline | 🟡 | Opt-in capture of traces/verdicts/recovery-paths → the proprietary failure/recovery dataset (spec §6 "deeper moat"). Designed now, grows forever. |

---

## 8. Phase 4 — Control plane / Stage 2 (months 4–9)

Productize the judge (spec §10 Stage 2). Full design (service architecture, API, data model, ops): [`docs/components/control-plane.md`](docs/components/control-plane.md). Security/compliance constraints: [`docs/SECURITY.md`](docs/SECURITY.md) §T6/T7. Pricing/GTM: [`docs/PRODUCT.md`](docs/PRODUCT.md). Constraint carried from spec: local-first must keep working; cloud is an *orchestrated* option, never a requirement (RT-9). Entry criteria: P3 shipped, ≥3 external local users, month-6 stop signal passed.

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-401 | run-service (state-only) + hosted ArtifactStore | 🔴 | P3 | Run with `backend: cloud` survives machine loss; `resume` works from another machine; residency=local artifacts never uploaded |
| WP-402 | judge-service | 🟡 | WP-401 | Verdict parity with local harness on fixture suite; keys vaulted, never logged (log-scrub test); family enforcement server-side |
| WP-403 | Trace browser + HITL inbox | 🟡 | WP-401 | Renders any valid JIF; permalinks; approve/reject ESCALATE with audit entry; parity vs `chikory trace` |
| WP-404 | api-gateway: orgs/projects, OIDC, RBAC, OpenAPI | 🔴 | — (parallel) | Role matrix tested (viewer can't approve); audit log on every mutating call; OpenAPI generated + contract-reviewed |
| WP-405 | meter-service + usage API | 🟡 | WP-401 | Meters reconcile exactly with journal totals (property test); per-project/day usage visible pre-bill |
| WP-406 | Enterprise: SSO/SCIM, audit export, residency, SOC 2 groundwork | 🔴 | WP-404 | SAML+SCIM live; per-artifact-kind residency enforced at API; region pinning; SOC 2 Type I evidence collection running |
| WP-407 | Billing + spend dashboards | 🟡 | WP-405 | Stripe usage records from meters; free-tier caps enforced; dashboards match `/v1/usage` exactly; pass-through model costs itemized |
| WP-408 | Operations: deploy, SLOs, DR, runbooks | 🟡 | WP-401 | SLOs monitored + alerting before GA; DR drill passed (RPO ≤5min / RTO ≤4h); cloud outage doesn't stop local runs (degradation mode) |

Stage-2 exit (→ P5): paying customers on unit pricing; ≥1 enterprise contract live (SSO in prod); SLOs held a quarter; SOC 2 Type I issued; [enterprise checklist](docs/PRODUCT.md) complete.

## 9. Phase 5 — Vertical / Stage 3 (months 9–18)

Full design: [`docs/components/vertical-agent.md`](docs/components/vertical-agent.md). The vertical *choice* is data-gated on Stage 2 (ADR-004 at P5 start; selection rubric pre-defined now). The architecture is fixed now: a **vertical pack** = blueprint + machine-checkable criteria/SLO library + judge rubric packs + TaskSpec playbooks — data layered on the existing runtime, no new execution machinery (NF-1 holds at Stage 3).

| WP | Title | Tag | Notes |
|---|---|---|---|
| WP-501 | Vertical selection (ADR-004) | 🔴 | Weighted rubric (vertical-agent.md §2) filled with WP-306 dataset + pipeline evidence; prior: internal admin tools |
| WP-502 | Pack format + loader | 🟡 | Packs are data, not code plugins |
| WP-503 | Blueprint + criteria/SLO library | 🔴 | Every criterion machine-checkable; this is the moat work |
| WP-504 | Playbook generators | 🟡 | new-app / add-feature / migrate / fix → ordinary task.yaml |
| WP-505 | Steward (maintenance schedules) | 🟡 | Recurring brownfield runs; cross-session memory (WP-204) earns its keep |
| WP-506 | SLO reporting | 🟢 | JIF-derived, contractual format |
| WP-507 | Design-partner program | 🔴 | 3–5 partners, SLOs in contracts; renewals = Stage-3 exit metric |

Stage-3 exit = the enterprise-product bar: ≥1 pack GA with contractual SLOs; steward runs dominate usage (recurring); partners renew; sales repeatable.

---

## 10. Risks this plan actively manages

| Risk | Mitigation in plan |
|---|---|
| Judge adds latency/cost that annoys users | WP-134 makes judge cost visible from day 1; cadence configurable; binary rubrics keep passes cheap |
| Temporal too heavy for solo devs | `DurableRunner` interface (WP-002) keeps substrate swappable; ADR-001 records the revisit trigger |
| Wrapped CLI agents change under us | Adapter conformance suite (WP-111) catches breakage; native executor (WP-213) is the hedge |
| Judge generalizability unproven beyond DevAI | P3 brownfield authoring + WP-306 dataset are the standing R&D loop |
| Plan drift across many workers | Contracts freeze, REQUIREMENTS.md traceability, TASK-PROTOCOL.md handoffs, invariants in CLAUDE.md |

---

## 11. Document map

| Doc | Purpose |
|---|---|
| `plan.md` (this) | What/when/who-shaped — phases, WPs, cutlines, gates |
| `docs/REQUIREMENTS.md` | Every spec requirement → ID → WP → phase (traceability) |
| `docs/ARCHITECTURE.md` | System shape, data flow, run lifecycle |
| `docs/components/*.md` | Per-component technical specs, P1→P5 (incl. control-plane and vertical-agent designs) |
| `docs/spec/CONTRACTS.md` | Full frozen interface set — WP-002 is transcription of this |
| `docs/spec/task-spec.md` | task.yaml schema (WP-005 spec) |
| `docs/spec/journal-format.md` | JIF — journal interchange format (trace/benchmark/dataset/browser) |
| `docs/SECURITY.md` | Threat model + compliance trajectory, all stages |
| `docs/PRODUCT.md` | Personas, pricing, GTM, success metrics, enterprise-readiness checklist |
| `docs/GLOSSARY.md` | Canonical terms |
| `docs/TASK-PROTOCOL.md` | How any human/agent picks up, verifies, and hands off a WP |
| `docs/DOGFOODING.md` | **How to run a P2+ WP through Chikory itself** — setup, task.yaml field-by-field, supervision, harvesting the result |
| `docs/spec/ADR-00*.md` | Decisions: 001 Temporal · 002 judge model/scoring · 003 MVP executor strategy · 004 vertical selection (P5, reserved) |
