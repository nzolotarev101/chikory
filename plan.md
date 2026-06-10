# Chikory — Master Plan

> Vendor-neutral control plane for long-running, self-correcting software agents.
> This is the single source of truth for **what we build, in what order, and why**.
> Spec: [`project.md`](project.md) · Requirements matrix: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) · Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · How to pick up work: [`docs/TASK-PROTOCOL.md`](docs/TASK-PROTOCOL.md)

**Status**: Phase 0 complete (2026-06-10) — P1 lanes unblocked · **Plan date**: 2026-06-09 · **Stage 1 deadline (per spec §10)**: ~2026-09-07 (90 days)

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

1. **Dogfood proof**: Chikory v0.1 implements one real Phase 2 work package (target: WP-202 Memory Pointer store) end-to-end, with the judge catching at least one genuine issue before it landed.
2. **Durability proof**: `kill -9` mid-run, then `chikory resume` completes the task with no repeated LLM calls for journaled steps.
3. **Neutrality proof**: same task runs with executor=Anthropic/judge=Gemini and executor=OpenAI/judge=Anthropic by changing only config.
4. **Governance proof**: run halts cleanly at budget cap with a resumable checkpoint; no infinite-loop trace exists for terminal-state-returning tools.
5. **Forensics proof**: a person who did not run the task can answer "what happened, what did it cost, why did the judge intervene" from `chikory trace` alone.

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
| WP-101 | Provider adapters: Anthropic, OpenAI, Gemini | 🟡 | WP-002 | One `complete()` interface, three adapters; real-call integration tests (no LLM mocks — CLAUDE.md rule); token counts + cost returned on every call. |
| WP-102 | OpenAI-compat adapter (open models) | 🟢 | WP-101 | Same tests pass against a configurable `baseUrl` (Ollama/vLLM verified manually). |
| WP-103 | Retry & failure policy | 🟡 | WP-101 | Exponential backoff, provider-failover option, every result normalized to explicit SUCCESS/FAILED (invariant #4); chaos test with injected 429/500/timeout. |
| WP-104 | Per-stage routing policy | 🟡 | WP-101 | `RoutingPolicy` maps stage (plan/code/review/judge) → provider+model; swap via config only; test proves zero code change between two policies. |
| WP-105 | OTel spans + accounting | 🟡 | WP-101 | Every LLM call emits an OTel span (provider, model, tokens, cost, latency, stage); spans visible in any OTLP collector. |

### Lane M2 — Executors (`docs/components/executors.md`, ADR-003)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-111 | `ExecutorAdapter` interface + step contract | 🔴 | WP-002 | A "step" = one bounded executor invocation producing a `StepRecord` (workspace diff, tool summary, tokens, terminal state). Contract doc-tested; this is the unit the journal and judge operate on. |
| WP-112 | Claude Code headless adapter | 🔴 | WP-111 | Drives `claude -p` with turn caps in a sandboxed workspace; captures diff, cost, transcript pointer; emits StepRecord; handles agent-hang via timeout → FAILED. Integration test: completes a 3-step toy task. |
| WP-113 | Codex CLI adapter | 🟢 | WP-112 | Same conformance test suite as WP-112 passes (adapter conformance suite is part of WP-111). Stretch goal — may slip to P2 without blocking exit gate. |

### Lane M3 — Durable runner (`docs/components/durable-runner.md`)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-121 | Temporal workflow: journaled agent loop | 🔴 | WP-004, WP-111 | Each executor step + judge call = one Temporal activity; deterministic replay verified; journal entry per step persisted. |
| WP-122 | Checkpointer (git + journal) | 🟡 | WP-121 | Every step checkpoints: git commit in workspace + journal row (step, cost, artifacts). `chikory status` lists checkpoints. |
| WP-123 | Crash recovery | 🟡 | WP-122 | Test: `kill -9` worker mid-run → `chikory resume <run-id>` → run completes; journaled steps are **not** re-executed (assert zero duplicate LLM spend). |
| WP-124 | Budget gate + terminal states | 🟡 | WP-121 | Per-run `budget_usd` enforced before each step; breach → clean HALT with resumable checkpoint; loop-breaker test: tool returning FAILED 3× → escalate, never spin. |

### Lane M4 — Judge (`docs/components/judge.md`, ADR-002)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-131 | Judge harness: evidence → rubric → verdict | 🔴 | WP-002 | Collects `JudgeEvidence` (workspace diff, test run output, acceptance criteria, step history summary); binary per-criterion rubric (pointwise, CoT); outputs `JudgeVerdict ∈ {PROCEED, HALT, ROLLBACK, ESCALATE}` + per-criterion booleans + rationale. Fixture suite: known-bad diffs get non-PROCEED. |
| WP-132 | Verdict gating in runner | 🔴 | WP-121, WP-131 | Judge runs every N steps (config); ROLLBACK restores last PROCEED-ed git checkpoint; HALT stops with resumable state; ESCALATE pauses for human `chikory approve`. Integration test for each verdict path. |
| WP-133 | Family-diversity enforcement | 🟢 | WP-131 | Judge provider family ≠ executor family by default; same-family requires `allow_same_family: true` + loud warning (invariant #2). Unit tested. |
| WP-134 | Judge telemetry | 🟢 | WP-131, WP-105 | Judge passes emit spans; verdict history, judge cost as % of run cost in `chikory trace`. |

### Lane M5 — CLI & dogfood (`docs/components/cli.md`)

| WP | Title | Tag | Depends | Acceptance criteria |
|---|---|---|---|---|
| WP-141 | CLI: `run` / `resume` / `status` / `approve` / `cancel` | 🟡 | WP-005, WP-121 | Each command works against a live local run; `--help` complete. |
| WP-142 | Trajectory renderer: `chikory trace <run-id>` | 🟡 | WP-122, WP-134 | Human-readable forensics from the journal: per-step tokens/cost/duration, decisions count, judge verdicts + rationales, checkpoints. Satisfies exit-gate #5. |
| WP-143 | **Dogfood run** | 🔴 | all P1 | Run WP-202 (P2) through Chikory itself; write `docs/reports/dogfood-001.md`: what worked, judge interventions, cost, friction list → feeds P2 priorities. |
| WP-144 | Quickstart + examples | 🟢 | WP-141 | README quickstart: install devbox → `devbox shell` → first gated run in <10 min on a clean machine (devbox is the only prerequisite); `examples/` with 2 task.yaml files. |

---

## 6. Phase 2 — Reliability & memory (weeks 5–8)

Goal: survive *real* long horizons (days, big contexts, multi-repo) and close every remaining §5 requirement that isn't benchmark- or cloud-shaped. Built **using** v0.1 wherever practical — each WP here is a candidate dogfood run.

| WP | Title | Tag | Notes |
|---|---|---|---|
| WP-201 | Python SDK parity | 🟢 | Mechanical port of frozen TS contracts; conformance suite shared via JSON fixtures. Ideal simpler-model lane; runs parallel to everything. |
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
| `docs/spec/ADR-00*.md` | Decisions: 001 Temporal · 002 judge model/scoring · 003 MVP executor strategy · 004 vertical selection (P5, reserved) |
