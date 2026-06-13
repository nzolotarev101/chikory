# Requirements Traceability Matrix

Every requirement in [`project.md`](../project.md), assigned a stable ID, mapped to the work packages (WPs) in [`plan.md`](../plan.md) that satisfy it. **If a requirement has no WP, that's a plan bug — file it.**

- **Phase** = where it is first satisfied (later phases may extend it).
- Status values: `planned` · `in-progress` · `done` · `deferred (reason)`.
- When implementing a WP, reference the requirement IDs it closes in the PR description.

## RT — Routing & vendor neutrality (spec §5.1)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| RT-1 | Sits in front of one or many LLMs; routes tasks | WP-101 | P1 | done |
| RT-2 | Manages retries, handles failures | WP-103 | P1 | done |
| RT-3 | Coordinates multi-agent workflows | WP-121, WP-132 (executor+judge coordination); richer multi-agent in WP-203 sub-agents | P1→P2 | in-progress (executor+judge coordination done; sub-agents P2) |
| RT-4 | Bring-your-own-model, swap freely | WP-101, WP-104 | P1 | done |
| RT-5 | Explicit per-stage policies (planning/coding/review/judge) | WP-104 | P1 | done |
| RT-6 | Dynamic routing layer across providers | WP-103 (failover), WP-104 | P1 | done |
| RT-7 | Teams keep existing observability stack | WP-105 (OTel/OTLP, no proprietary sink) | P1 | done |
| RT-8 | Sits above existing frameworks/coding agents, not replacing them | ADR-003, WP-111, WP-112 | P1 | done |
| RT-9 | Runs locally; cloud only as orchestrated process | WP-004 (local Temporal), constraint on all P4 WPs | P1 | planned |
| RT-10 | Drive CLI coding agents: Claude Code, Codex, Jules, Antigravity | WP-112, WP-113, WP-216 | P1→P2 | in-progress (Claude Code + Codex done; Jules/Antigravity in WP-216, P2) |
| RT-11 | Launch providers: Anthropic, OpenAI, Gemini, open models (OpenAI-compat) | WP-101, WP-102 | P1 | done |

## DX — Durable execution (spec §5.2)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| DX-1 | State, memory, task context across minutes → weeks | WP-121, WP-122; cross-session memory WP-204 | P1→P2 | in-progress |
| DX-2 | Journal/replay: each LLM/tool call a deterministic journaled step | WP-121 | P1 | done |
| DX-3 | Crash → resurrect from point of failure via memoized results | WP-123 | P1 | done |
| DX-4 | Checkpoint per LLM/tool call; pause, inspect, resume | WP-122, WP-141 | P1 | done |
| DX-5 | Branching of execution paths as first-class op | WP-205 | P2 | planned |
| DX-6 | Rollback as first-class op | WP-132 (judge-triggered), WP-205 (manual) | P1→P2 | in-progress (judge-triggered done; manual `chikory branch` P2) |
| DX-7 | Budget-aware continuation | WP-124 (hard gate), WP-207 (reasoned continuation) | P1→P2 | in-progress (hard gate done; reasoned continuation P2) |
| DX-8 | Suspend/resume for HITL; sleep hours/days, resume on approval | WP-206 (full); WP-132 ESCALATE is the P1 stopgap | P2 | planned |

## JD — Agent-as-a-Judge (spec §5.3)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| JD-1 | Built-in eval layer: one agent validates another's work | WP-131 | P1 | done |
| JD-2 | Inner loop: evaluates every N actions / at milestones | WP-132 (every N); WP-217 (empty-diff completion milestone — landed `ef4b16f`, dogfood-003); WP-221 (explicit `claimsComplete` signal, dogfood-003 F-11); WP-225 (de-flake the agent-loop test exercising the WP-217 path — waitFor races the verdict journaling, dogfood-007 F-19) | P1→P2 | in-progress (cadence + empty-diff milestone triggers done; explicit completion claim WP-221 — inference still costs one probe step, six data points dogfood-002…007) |
| JD-3 | Gates next action: halt/rollback/branch/escalate before bad change lands | WP-132 (halt/rollback/escalate); branch verdict WP-205 | P1→P2 | in-progress (halt/rollback/escalate done; branch verdict P2) |
| JD-4 | Software-native: PR diffs, tests, UI snapshots, acceptance criteria, security posture, architecture rubric | WP-131 (diffs+tests+criteria); WP-211 (UI); WP-215 (security+architecture) | P1→P2 | in-progress (diffs+tests+criteria done; UI/security/architecture P2) |
| JD-5 | Structurally diversified: different model family / prompt regime / memory than executor | WP-133, ADR-002; WP-222 slice 1 (executor env allowlist — landed `18fae43` via dogfood-006 `run-559ea904`) | P1→P2 | done (declared-family check); seam hardened — `scrubExecutorEnv` gives executor children only their own family key; F-14 closure **confirmed** by dogfood-007 `run-22b337a9` (zero shim noise in the executor transcript); TaskSpec pass-through opt-in rides WP-221's contracts PR |
| JD-6 | Scoring: pointwise + pairwise; CoT/G-Eval; optional debate/specialized evaluator | WP-131 (pointwise+CoT); WP-210 (pairwise+G-Eval); debate deferred (cost — ADR-002) | P1→P2 | in-progress (pointwise+CoT done; pairwise+G-Eval P2) |
| JD-7 | Judge guardrails: binary/low-precision scores, explicit rubrics, drift/reward-hacking awareness, visible latency/cost overhead | WP-131 (binary rubric), WP-134 (cost visibility); drift monitoring extends in WP-306 | P1→P3 | in-progress (binary rubric + cost visibility done; drift monitoring P3) |

## CM — Context & memory (spec §5.4)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| CM-1 | Context-rot mitigation first-class, co-designed with checkpointing | WP-203 | P2 | planned |
| CM-2 | Compaction, structured note-taking, sub-agent architectures as runtime primitives | WP-203 | P2 | planned |
| CM-3 | Memory Pointer Pattern: external storage + short refs in context | WP-202 | P2 | planned |
| CM-4 | Tiered memory (core/archival/recall), memory-poisoning safeguards | WP-204 | P2 | planned |

## CG — Cost governance (spec §5.5)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| CG-1 | Terminal states / deterministic exits break retry loops | WP-103, WP-124 (invariant #4) | P1 | done |
| CG-2 | Spend controls; transparent, predictable, checkpoint-aware budget governance | WP-124, WP-105; WP-218 (token-denominated budgets — USD gate inert on $0-metered runs, dogfood-002 F-9); WP-223 (watch can drop the SUSPENDED-at-cap transition, dogfood-004 F-15 — delivered via dogfood-007 `run-22b337a9`, commit pending review); dashboards in WP-407 | P1→P4 | in-progress (P1 USD gate done; WP-218 pricing/blind-meter-warning slice landed `2a4dd21` via dogfood-004 `run-9edbcd28`, meter proven live on dogfood-005 `run-34926e85` — $2.14/$5.00 metered, judge share 1.9%; WP-223 closes the transparency break — SUSPENDED/AWAITING_APPROVAL lines now derive from durable journal entries, never poll sampling; `budget_tokens` slice rides next contracts PR; dashboards P4) |

## AR — Artifact-centric state (spec §5.6)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| AR-1 | Repo snapshots, task trees, test results, browser state, PR diffs as first-class runtime objects | WP-002 (`ArtifactRef`), WP-122 (snapshots), WP-131 (diff/test evidence), WP-211 (browser state) | P1→P2 | in-progress (contracts, snapshots, diff/test evidence done; browser state P2) |

## OB — Observability (spec §5.7)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| OB-1 | Observe reasoning; trace decision trees | WP-142 | P1 | done |
| OB-2 | Inject corrections mid-run | WP-212 | P2 | planned |
| OB-3 | Set success criteria upfront | WP-005 (acceptance_criteria in TaskSpec) | P0 | done |
| OB-4 | OTel-compliant traces by default | WP-105, WP-134 (invariant #3) | P1 | in-progress |
| OB-5 | Trajectory-level forensics, whole path debuggable after the fact | WP-122 (journal), WP-142 (renderer), WP-403 (web) | P1→P4 | in-progress (P1 journal + renderer done; web browser P4) |
| OB-6 | Human-observable metrics: tokens, decisions, checks, feedback frequency | WP-142, WP-209 | P1→P2 | in-progress (trace totals/footer done; process metrics WP-209 P2) |

## FA — Full-application scope (spec §5.8)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| FA-1 | Entire production-ready apps: brownfield, multi-repo, migrations, long-horizon | ADR-003 (capability via wrapped agents); WP-219 (goal decomposition & run chaining — the long-horizon gap, dogfood-002 F-10); WP-220 (`chikory land` — the per-slice landing primitive chaining calls between runs, delivered via dogfood-005 `run-34926e85`); WP-214 (multi-repo); P3 brownfield benchmark proves it | P1→P3 | in-progress (landing primitive done; decomposition ADR-005 next) |
| FA-2 | Reliable, redundant execution; fluent restart on failure | WP-123 | P1 | done |
| FA-3 | Token awareness + intelligent pacing during planning AND execution (batch size, test count, checkpoint cadence, breaks) | WP-207; inputs from WP-105 accounting | P2 | planned |

## SE — Orchestrator self-evaluation (spec §5.9)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| SE-1 | Checkpoint notifications at judge milestones | WP-208 | P2 | planned |
| SE-2 | Window-fit reasoning for implementation and judging passes | WP-207 | P2 | planned |
| SE-3 | Process metrics: components over time; issues found vs changes made | WP-209 | P2 | planned |

## IF — Interface & architecture (spec §8)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| IF-1 | Thin TypeScript SDK | P1 lanes M1–M5 | P1 | planned |
| IF-2 | Thin Python SDK | WP-201 | P2 | in-progress (slice 1 — contracts + shared conformance suite — landed `eb5c57e` via dogfood-002) |
| IF-3 | Durable workflows on existing engine (Temporal) — partner, don't rebuild | ADR-001, WP-004, WP-121 | P0–P1 | done |
| IF-4 | CLI surface | WP-141, WP-142; WP-220 (`chikory land`, delivered via dogfood-005 `run-34926e85`, commit pending review); WP-223 (watch transition fidelity — delivered via dogfood-007 `run-22b337a9`, commit pending review; F-15 closed, three clean full-suite runs post-fix); WP-224 (`land --verify` + git-stderr seam, dogfood-005 F-17/F-18 — delivered via dogfood-008 `run-86c4b628`, commit pending review; AC-1/2/3 green on independent rerun) | P1→P2 | satisfied pending commit (watch fidelity fixed by WP-223; F-17/F-18 closed by WP-224 — `land --verify` reruns build/lint/typecheck/test on the fresh commit, git stderr now captured + surfaced) |
| IF-5 | Cloud control plane: hosted judges, checkpointers, trace browser | WP-401–408 (full design: components/control-plane.md) | P4 | planned |

## ST — Strategy, moat, business (spec §6, §9, §10)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| ST-1 | DevAI-extended benchmark: 60–100 multi-hour tasks, greenfield + brownfield, open leaderboard | WP-301–304 | P3 | planned |
| ST-2 | Feedback-loop dataset: traces, eval outcomes, recovery paths, cost/routing patterns | WP-306 | P3 | planned |
| ST-3 | MIT open source; publish own DevAI-extended numbers within 90 days | WP-304, WP-305 | P3 | planned |
| ST-4 | Unit/usage pricing, generous free tier, $29–199 mid-tiers, enterprise SSO/audit | WP-405–407 | P4 | planned |
| ST-5 | Stage 3 vertical with measurable SLOs | WP-501–507 (design: components/vertical-agent.md; vertical choice = ADR-004, data-gated on Stage 2) | P5 | planned |

## Non-functional constraints (spec §4, §11, CLAUDE.md)

| ID | Constraint | Enforced by |
|---|---|---|
| NF-1 | Not a framework / vibe-coder / LangChain wrapper; minimal abstraction, maximal observability | Plan §1.2; ADR-003; review checklist in TASK-PROTOCOL.md |
| NF-2 | No magic: transparency and control lead | Trajectory journal is append-only ground truth; every automated decision (verdict, retry, compaction) is journaled with rationale |
| NF-3 | No provider lock-in anywhere in core path | Invariant #1; WP-104 swap test |
| NF-4 | Governance/compliance designed in for regulated buyers (ZDR caveat) | docs/SECURITY.md (threat model + compliance trajectory); WP-406; local-first default (RT-9) |
| NF-5 | Communicate market/benchmark figures in ranges | WP-303 methodology, WP-304 |
| NF-6 | No LLM-layer mocks in integration tests | CI policy (WP-003), CLAUDE.md |
