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
| JD-2 | Inner loop: evaluates every N actions / at milestones | WP-132 (every N); WP-217 (empty-diff completion milestone — landed `ef4b16f`, dogfood-003); WP-221 (explicit `claimsComplete` signal, dogfood-003 F-11); WP-225 (de-flaked the agent-loop test exercising the WP-217 path — waitFor now gates on the durable verdict, delivered via dogfood-009 `run-841bc838`, commit pending review; **F-19 closed**, 8/8 host runs) | P1→P2 | **done** (cadence + empty-diff milestone triggers done, milestone test deterministic; explicit completion claim WP-221 complete. **WP-221 Slice A** (dogfood-019 `run-d836635b`): `agent-loop.ts:211`'s trigger is the pure `isCompletionMilestone(record)` ORing `claimsComplete` into the empty-diff condition. **Slice B** (dogfood-021 `run-91eced6b`): the runner reads the marker via pure `claimsCompleteFromSummary` → `StepRecord.claimsComplete` on the SUCCESS branch, judging the productive step directly. **F-11 CLOSED by observation** (dogfood-022 `run-499218ef`): the first marker-emitting real run sealed SUCCESS in ONE step with no empty-diff probe (`components over time: s0 j@0`); the probe-step tax — one inference step across twenty data points dogfood-002…021, cost share 5.4 %–35.1 %, dogfood-017 the sharpest case F-26 — is retired) |
| JD-3 | Gates next action: halt/rollback/branch/escalate before bad change lands | WP-132 (halt/rollback/escalate); branch verdict WP-205 | P1→P2 | in-progress (halt/rollback/escalate done; branch verdict P2) |
| JD-4 | Software-native: PR diffs, tests, UI snapshots, acceptance criteria, security posture, architecture rubric | WP-131 (diffs+tests+criteria); WP-211 (UI); WP-215 (security+architecture) | P1→P2 | in-progress (diffs+tests+criteria done; UI/security/architecture P2) |
| JD-5 | Structurally diversified: different model family / prompt regime / memory than executor | WP-133, ADR-002; WP-222 slice 1 (executor env allowlist — landed `18fae43` via dogfood-006 `run-559ea904`) | P1→P2 | done (declared-family check); seam hardened — `scrubExecutorEnv` gives executor children only their own family key; F-14 closure **confirmed** by dogfood-007 `run-22b337a9` (zero shim noise in the executor transcript); TaskSpec pass-through opt-in rides WP-221's contracts PR |
| JD-6 | Scoring: pointwise + pairwise; CoT/G-Eval; optional debate/specialized evaluator | WP-131 (pointwise+CoT); WP-210 (pairwise+G-Eval); debate deferred (cost — ADR-002) | P1→P2 | in-progress (pointwise+CoT done; pairwise+G-Eval P2) |
| JD-7 | Judge guardrails: binary/low-precision scores, explicit rubrics, drift/reward-hacking awareness, visible latency/cost overhead | WP-131 (binary rubric), WP-134 (cost visibility); drift monitoring extends in WP-306 | P1→P3 | in-progress (binary rubric + cost visibility done; drift monitoring P3) |

## CM — Context & memory (spec §5.4)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| CM-1 | Context-rot mitigation first-class, co-designed with checkpointing | WP-203 | P2 | in-progress — **contract landed (ADR-006, 2026-06-14)**: compaction runs *at* the checkpoint boundary (`writeCheckpoint`, CM-1 co-design point); pure `planCompaction` decides what folds, the LLM digest + journal write are the non-pure wiring. Digest-wiring slice (S2) now dogfoodable. |
| CM-2 | Compaction, structured note-taking, sub-agent architectures as runtime primitives | WP-203 | P2 | in-progress — `CompactionPolicy.keepLastN` keeps recent summaries verbatim, structured `ContextBundle.notes` survive compaction verbatim by construction (ADR-006); `planCompaction` pure core + tests landed. Sub-agent architectures still P2. |
| CM-3 | Memory Pointer Pattern: external storage + short refs in context | WP-202 | P2 | planned |
| CM-4 | Tiered memory (core/archival/recall), memory-poisoning safeguards | WP-204 | P2 | planned |

## CG — Cost governance (spec §5.5)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| CG-1 | Terminal states / deterministic exits break retry loops | WP-103, WP-124 (invariant #4) | P1 | done |
| CG-2 | Spend controls; transparent, predictable, checkpoint-aware budget governance | WP-124, WP-105; WP-218 (token-denominated budgets — USD gate inert on $0-metered runs, dogfood-002 F-9); WP-223 (watch can drop the SUSPENDED-at-cap transition, dogfood-004 F-15 — delivered via dogfood-007 `run-22b337a9`, commit pending review); dashboards in WP-407 | P1→P4 | in-progress (P1 USD gate done; WP-218 pricing/blind-meter-warning slice landed `2a4dd21` via dogfood-004 `run-9edbcd28`, meter proven live on dogfood-005 `run-34926e85` — $2.14/$5.00 metered, judge share 1.9%; WP-223 closes the transparency break — SUSPENDED/AWAITING_APPROVAL lines now derive from durable journal entries, never poll sampling; `budget_tokens` slice: **token gate landed end-to-end by hand 2026-06-14** — pure `estimateNextStepTokens`/`tokenBudgetBreached` in `runner/budget.ts` + the agent-loop pre-step gate (armed on `budgetTokens`; breach records a token HALT via the additive `budget_event` `cause: "tokens"`/`remainingTokens` shape, then seals a resumable FAILED — hard cap, no token top-up channel) + an integration test. Makes the gate real on $0-metered runs where the USD gate reads $0 (F-9). WP-218 complete; dashboards P4) |

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
| OB-6 | Human-observable metrics: tokens, decisions, checks, feedback frequency | WP-142, WP-209 | P1→P2 | in-progress (trace totals/footer done — tokens/decisions/checks/feedback-frequency render today; WP-209 slice 1 added the issues-found:changes-made footer line via dogfood-010, run `run-c9df353b`, commit pending review; WP-209 slice 2 added the components-over-time timeline line via dogfood-011, run `run-59e0166c`, commit pending review — both SE-3 footer halves now render) |

## FA — Full-application scope (spec §5.8)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| FA-1 | Entire production-ready apps: brownfield, multi-repo, migrations, long-horizon | ADR-003 (capability via wrapped agents); WP-219 (goal decomposition & run chaining — the long-horizon gap, dogfood-002 F-10); WP-220 (`chikory land` — the per-slice landing primitive chaining calls between runs, delivered via dogfood-005 `run-34926e85`); WP-214 (multi-repo); P3 brownfield benchmark proves it | P1→P3 | in-progress (landing primitive done; **ADR-005 accepted + WP-219 S1 contracts landed `d56f35a`**; S3 pure core now has `readyNodes` landed via dogfood-015 and `hasDependencyCycle` delivered via dogfood-016 `run-2418f473`; **S2 planner function contract landed by hand 2026-06-14** — `PlanInput`/`GoalPlanner.decompose` + pure `planCoverageGaps` (CONTRACTS §7a, ADR-005 §S2); **S2 prompt half delivered** (dogfood-022 `run-499218ef`) — pure `PLANNER_SYSTEM_PROMPT`/`PLAN_RESPONSE_SCHEMA`/`buildPlannerMessages` in `src/planner/prompt.ts`, mirroring `judge/prompt.ts`; **S2 assembly half delivered** (dogfood-023 `run-2d40ded5`) — pure `buildPlan(reply, input, opts): Plan` + `BuildPlanOptions` in `src/planner/assemble.ts`, mirroring `buildVerdict` (three structural checks → frozen `Plan`); **S2's pure surface complete**, next is the pure S2b plan meta-judge prompt half `buildPlanJudgeMessages` (dogfood-024, mirroring `judge/prompt.ts`; `PlanVerdict`+`planCoverageGaps` landed), then the non-pure `decompose` impl + non-pure plan-judge harness) |
| FA-2 | Reliable, redundant execution; fluent restart on failure | WP-123 | P1 | done |
| FA-3 | Token awareness + intelligent pacing during planning AND execution (batch size, test count, checkpoint cadence, breaks) | WP-207; inputs from WP-105 accounting | P2 | planned |

## SE — Orchestrator self-evaluation (spec §5.9)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| SE-1 | Checkpoint notifications at judge milestones | WP-208 | P2 | in-progress — **pure delivery layer complete**: slice 1 `notificationsFor` derivation (`JournalEntry[]` + `NotificationPolicy` → `Notification[]`, dogfood-012); slice 2 `slackPayloadFor` (`Notification` → Slack `{ text }`, dogfood-013); slice 3 pure half `desktopPayloadFor` (`Notification` → `{ title, body }`, dogfood-014, landed `3e1336f`). Remaining: the side-effectful Slack/desktop delivery + runner call-site — non-pure, rides the chain/runner work. |
| SE-2 | Window-fit reasoning for implementation and judging passes | WP-207 | P2 | planned |
| SE-3 | Process metrics: components over time; issues found vs changes made | WP-209 | P2 | in-progress (both trace-footer halves done — issues-found:changes-made via WP-209 slice 1 / dogfood-010, run `run-c9df353b`; components-over-time via WP-209 slice 2 / dogfood-011, run `run-59e0166c`; both commit pending review on `main`. OTel metric emission deferred to a later WP-209 slice) |

## IF — Interface & architecture (spec §8)

| ID | Requirement | WP(s) | Phase | Status |
|---|---|---|---|---|
| IF-1 | Thin TypeScript SDK | P1 lanes M1–M5 | P1 | planned |
| IF-2 | Thin Python SDK | WP-201 | P2 | in-progress (slice 1 — contracts + shared conformance suite — landed `eb5c57e` via dogfood-002) |
| IF-3 | Durable workflows on existing engine (Temporal) — partner, don't rebuild | ADR-001, WP-004, WP-121 | P0–P1 | done |
| IF-4 | CLI surface | WP-141, WP-142; WP-220 (`chikory land`); WP-223 (durable watch transitions); WP-224 (`land --verify` + git-stderr seam); WP-227 (final journal drain at terminal boundary — landed `26b9964`); WP-229 (surface the ESCALATE reason in `--watch` — **delivered** dogfood-018 `run-59115f35`); WP-228 (launch baseline-satisfied precheck, dogfood-017 F-25) | P1→P2 | in-progress (core CLI, trace, land, durable transition rendering done; WP-227 terminal-boundary drain done; **WP-229 done** — `followRun` now renders `judge escalated: <reason>` before AWAITING_APPROVAL on the watch stream, F-27 closed; redundant-spec guard WP-228 still open) |
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
| NF-6 | No LLM-layer mocks in integration tests; test code held to the same type contract as `src/` | CI policy (WP-003), CLAUDE.md. **WP-230 done** (dogfood-020 `run-3575ba23`): `typecheck` now runs a second `tsc -p tsconfig.test.json` pass over `src/**`+`test/**`; verified it trips on a bad fixture (`TS2353`). dogfood-019 F-29 (contract-violating test fixtures shipping green) closed. |
