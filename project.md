# LLM Agent Orchestration Service — Project Specification

Working title: LLM Agent Orchestration Service
Category statement: A vendor-neutral control plane for long-running, self-correcting software agents
Status: Concept / pre-MVP synthesis
Date: June 7, 2026
Source basis: Consolidates the starting idea note, three independent market-research reports (Claude, ChatGPT, Gemini), and the supplementary feature-ideas note.

---

1. EXECUTIVE SUMMARY

The service is an orchestration layer that sits in front of one or more LLMs and is purpose-built for agents that run for a long time — minutes, hours, days, or weeks — toward a single goal: shipping entire, production-ready applications end-to-end, rather than generating fragments or boilerplate.

Three independent research passes reached the same conclusion. The broad agentic-AI market is crowded and heavily funded, but one specific intersection is genuinely unmet: vendor-neutrality + durable execution + full-application generation + built-in runtime self-evaluation, fused into a single developer-facing control plane. No incumbent currently sells "your agents, your models, our durable judge-and-recover runtime" as its headline.

The strongest single differentiator is Agent-as-a-Judge operating as a real-time, inner-loop gate — a structurally distinct evaluator that inspects an agent's actual trajectory (diffs, tests, logs, UI state) and can halt or roll back a hallucinating agent before it overwrites code, as opposed to today's eval tools that review logs offline after the fact.

The guiding constraint across all research: do not build another framework, another vibe-coding front end, or another LangChain. The wedge is narrower and sharper — make coding agents reliable over long horizons.

---

2. PROBLEM STATEMENT

The market is shifting from stateless, single-turn chatbot interactions toward stateful, long-running agentic workflows, and from fast single-turn "vibe coding" prototypes toward brownfield maintenance and full-application generation. That shift exposes an infrastructure gap, not an intelligence gap.

The deployment paradox. Roughly 79% of enterprises have started AI-agent adoption, but only ~11% have pushed agents into live production. The ~68-point drop-off is fundamentally an orchestration and reliability failure, not a model-capability failure.

The recurring failure modes that cause the drop-off:

- Context rot / drift. Over long sessions, models use their context non-uniformly; performance degrades and errors compound as input length grows. Distractor density (semantically similar but irrelevant content) accelerates the decay. Naively enlarging the context window often makes this worse by overwhelming the attention mechanism. In multi-agent setups, one agent's degraded output is ingested by the next as ground truth, multiplying the failure.
- Compounding error. An agent at 95% per-step reliability lands near 5% end-to-end success over ~60 steps. Production needs ~99%+ per-step.
- Cost explosion / infinite loops. Autonomous agents get stuck re-executing the same failed tool calls, silently burning large token budgets before a human notices.
- Brittle state management. Transient, in-memory execution means a single API timeout can wipe out hours of reasoning.
- Output-only blindness in evaluation. Judges that grade only the final text miss dangerous or wasteful intermediate steps (duplicate tool calls, illogical loops, unauthorized data access).

Developer sentiment reinforces this: high adoption, low trust. Surveys show ~84% using or planning to use AI tools but ~46% actively distrusting output accuracy; the top reason to still ask a human is "when I don't trust AI's answers." Developers are openly hostile to heavy, opaque frameworks ("bloated," "a black box," "5 layers of abstraction to change one detail") and want fewer abstractions, predictable cost, deep tracing, and vendor neutrality.

---

3. MARKET OPPORTUNITY & WHITE SPACE

The current landscape splits into three layers, none of which owns the cross-cutting problem:

AGENT / WORKFLOW FRAMEWORKS
Players: LangGraph, CrewAI, AutoGen → Microsoft Agent Framework, LlamaIndex Workflows, OpenAI Agents SDK, Google ADK, Pydantic AI, Mastra, Inngest AgentKit
What they own: Execution semantics, graph/state control
What they miss: Opinionated, vendor-leaning, perceived bloat; not full-app delivery

AGENTOPS / EVAL / OBSERVABILITY
Players: LangSmith, Langfuse (now ClickHouse), W&B Weave (CoreWeave), Arize, Braintrust, Patronus, Galileo, Helicone (Mintlify, maintenance mode), HumanLayer
What they own: Tracing, offline evals, quality analytics
What they miss: Post-hoc test harnesses; not runtime gates; not durable execution

OUTCOME / APP-GENERATION PRODUCTS
Players: Devin (Cognition), OpenHands, SWE-agent, Replit Agent, Lovable, Bolt, v0, Cursor, Copilot Agent, Claude Code
What they own: Task completion, greenfield app scaffolding
What they miss: Single-vendor or single-vertical; weak on long-horizon brownfield with their own quality gate

The durable-execution primitives layer (Temporal, Inngest, Restate, DBOS, Hatchet, plus LangGraph checkpointers) has consolidated faster than the agent layer — deterministic replay and checkpointing are becoming table stakes. But durable replay alone does not address context rot, error compounding, or cost explosion, and no one has fused durable execution with inter-agent evaluation at the runtime layer.

The white space (consensus): a platform that sits above frameworks and below finished app builders — a vendor-neutral execution and control plane that runs long-lived software agents with first-class durability, software-native judgment, cost governance, and operational forensics. Today a team must Frankenstein this together (e.g., LangGraph for orchestration + Inngest for durability + Braintrust for eval + a custom agent-computer interface), incurring latency, state mismatch, and integration overhead.

Market sizing (use ranges; sources conflict by ~25x):
- Worldwide AI spend ~$2.52T in 2026 (+44% YoY); AI infrastructure ~$394–401B by 2030.
- Agentic AI embedded spend (Gartner): ~$201.9B in 2026 → ~$752.7B by 2029.
- Standalone agentic AI: ~$7–10B in 2025–2026 → tens to hundreds of billions by 2030–2034 (40–55% CAGRs across analysts).
- Bottom-up seat proxy: ~48.4M developers globally at ~$20–100/seat/mo implies a low-tens-of-billions seat-only envelope before compute.
- Washout risk: Gartner projects >40% of agentic-AI projects cancelled by 2027; only ~130 of "thousands" of agentic vendors judged "real."

---

4. CORE CONCEPT & POSITIONING

Most LLM tooling is optimized for short, stateless interactions. This service flips that: it assumes agents must run for extended periods, maintain context, make decisions, self-evaluate, and iterate toward a complete, working artifact.

- Category: neutral control plane for long-running software agents.
- Primary promise: fewer failed runs, fewer silent regressions, lower supervision cost, and clearer cost governance than current agent stacks.
- Architectural stance: minimal abstraction + maximal observability. Lead with transparency and control, never "magic."
- What it is NOT: another IDE, another vibe-coder, another framework. Those axes are saturated with incumbents at hundreds of millions in ARR.

---

5. FEATURE SPECIFICATION

This consolidates every feature named across the idea note, the three research reports, and the supplementary note.

5.1 Vendor-neutral orchestration & model routing
- Sits in front of one or many LLMs; routes tasks, manages retries, handles failures, coordinates multi-agent workflows.
- Bring-your-own-model, swap freely, route by task type with explicit per-stage policies (planning / coding / review / judge steps).
- Dynamic routing layer across providers; lets teams keep their existing observability stack rather than forcing migration.
- Designed to sit above existing agent frameworks/coding agents rather than replace them.

5.2 Durable execution & long-running session management
- Maintains agent state, memory, and task context across long execution windows (minutes → hours → days → weeks).
- Journal/replay durable-execution pattern: each LLM/tool call wrapped as a deterministic, journaled step; on crash, resurrects from the point of failure using memoized results rather than restarting.
- Checkpointing: pause, inspect, and resume long-running tasks without losing progress; checkpoint per LLM/tool call.
- Branching and rollback of execution paths as first-class operations.
- Budget-aware continuation: resume decisions consider remaining budget.
- Suspend/resume primitives for human-in-the-loop: serialize state and sleep for hours/days without burning compute, then resume instantly on an approval event — solving the HITL-bypass problem that stateless architectures cannot.

5.3 Agent-as-a-Judge (the core differentiator)
- A built-in evaluation layer where one agent critiques, scores, or validates another's work, enabling self-correcting pipelines without a human at every step.
- Runs in the inner loop, not offline: evaluates intermediate steps (e.g., after every N actions / at milestones) and can gate the next action — halting, rolling back, branching, or escalating — before a bad change lands (e.g., before overwriting a critical codebase).
- Software-native, not text-native: inspects PR diffs, runs tests, compares UI snapshots, verifies acceptance criteria, checks security posture, and assesses architecture against a rubric — not just "is this answer good?"
- Structurally diversified to mitigate bias: judge uses a different model family / prompt regime / memory than the executor, countering self-preference, position, and verbosity biases documented in the research.
- Configurable scoring methodologies: pointwise rubric scoring and pairwise comparison; support for chain-of-thought / form-filling (G-Eval-style) and, optionally, specialized evaluator models or multi-agent debate (ChatEval / DEBATE / CourtEval) where the compute overhead is justified.
- Guardrails on the judge itself: strict binary/low-precision scoring with detailed explicit rubrics; awareness of inter-model disagreement, evaluator drift, reward hacking, and the latency/cost overhead of extra judging passes.

5.4 Context & memory management
- Context-rot mitigation as a first-class primitive, co-designed with checkpointing — not left as a "pattern."
- Compaction, structured note-taking, and sub-agent architectures shipped as runtime primitives.
- Memory Pointer Pattern: store large/verbose tool outputs in external state (vector DB / blob storage) and pass only short reference pointers into the active context, cutting per-call token consumption dramatically while preserving fidelity over long horizons.
- Tiered memory (core / archival / recall) for durable cross-session state, with attention to memory correctness and poisoning risks.

5.5 Cost governance
- Terminal states / deterministic exits: explicit SUCCESS/FAILED flags in tool responses to break infinite negotiation and retry loops (shown to collapse redundant tool calls from double digits to single executions).
- Spend controls and budget-aware execution, with transparent, predictable, checkpoint-aware budget governance — a product requirement, not a nice-to-have, given documented buyer backlash to unpredictable bills.

5.6 Artifact-centric state
- Treat repo snapshots, task trees, test results, browser state, and PR diffs as first-class runtime objects, so the runtime (and the judge) reason about software artifacts directly rather than about text alone.

5.7 Observability & developer utilities
- Observe agent reasoning; trace decision trees; inject corrections mid-run; set success criteria upfront.
- OTel-compliant traces by default so teams keep their existing observability stack.
- Trajectory-level observability that makes the full agent path debuggable by humans after the fact (operational forensics), spanning the whole trajectory rather than just the final answer.
- Token count, number of decisions, number of checks, feedback frequency, and other relevant metrics should be observable by humans.

5.8 Full-application generation scope
- Drives agents toward shipping entire, production-ready applications — explicitly including brownfield maintenance, multi-repo feature work, migrations, and long-horizon builds, not just greenfield prototypes.
- Targets the gap none of the three competitor camps own: "did the agent build and ship a maintainable application end-to-end with verified behavior?"
- Reliable and redundant execution, in case of failure of existing exercise the process can fluently be restarted to continue working on the exercise.

5.9 Orchestrator self-evaluation & process metrics (from the supplementary note)
- Checkpoint notifications: notify the user to review checkpoints at Agent-as-a-Judge milestones.
- Window-fit reasoning: iterative/circular reasoning about how much work is feasible within the current LLM context window — for both implementation and judging passes.
- Orchestrator process metrics:
  - Number of logical components produced over time
  - Issues/gaps identified relative to number of changes made

---

6. DIFFERENTIATION & DEFENSIBILITY

Four white-space vectors, in order of defensibility:

1. Runtime-embedded Agent-as-a-Judge — the single most defensible technical wedge. Every eval vendor today is an offline/async test harness; none is the in-loop judge that gates the next action. Research support: agent-judges reach ~90% alignment with human evaluation vs. ~60–70% for LLM-as-judge.
2. Durable execution + context-rot mitigation as a unified primitive — no one ships compaction, note-taking, and sub-agent architecture co-designed with checkpointing.
3. Vendor neutrality as the headline — "BYO model, swap freely, route by task" is genuinely underserved at the orchestration layer.
4. The full-app / brownfield / long-horizon axis — unclaimed by Devin (autonomy), the vibe-coders (greenfield UI), or the IDE pair-programmers (developer augmentation).

The deeper moat is the feedback loop, not the runtime. Capturing long-lived execution traces, acceptance criteria, eval outcomes, recovery paths, cost patterns, and routing decisions across many software tasks builds a proprietary dataset on how software agents actually fail and recover — which in turn powers better judges, safer resumption policies, and smarter routing. Single-vendor incumbents structurally cannot replicate a vendor-neutral version of this.

Benchmark as moat. Publish an open extension of DevAI (the 55-task / 365-requirement full-app-generation benchmark), expanded to ~60–100 multi-hour tasks across greenfield and brownfield branches, and score openly against Cognition, OpenHands, and Claude Code. A vendor-neutral leaderboard is something single-vendor incumbents cannot credibly compete on.

---

7. TARGET USERS

- Primary buyer: platform-engineering, AI-engineering, or developer-productivity teams already experimenting with coding agents but lacking a robust orchestration layer for multi-day work.
- Initial use cases: multi-repo feature implementation, maintenance automation, migration work, and internal-tool generation for technical teams.
- Open question to resolve: indie developers vs. AI-native startups vs. enterprise teams as the true first beachhead. (Enterprise has the clearest willingness-to-pay signal per OpenHands' own fundraising thesis, but the longest sales cycle.)

---

8. INTERFACE & ARCHITECTURE (PROPOSED)

- Primary surface: a thin TypeScript + Python SDK plus a cloud control plane (hosted judges, hosted checkpointers, hosted trace browser). CLI/API-gateway surfaces are open options.
- Execution substrate: run agents as durable workflows on an existing engine (Temporal or LangGraph) rather than rebuilding durability — partner on infra, differentiate at the agent + judge + benchmark layer.
- Open configuration questions:
  - Is the judge the same model, a different family, or a fine-tuned evaluator? (Lean: structurally different family by default.)
  - Which providers at launch (Anthropic / OpenAI / Gemini / open models)?
  - Where does the orchestrator boundary sit relative to a customer's existing framework?

---

9. PRICING CONSIDERATIONS

The research is consistent: buyers resist unpredictability more than they resist paying for AI. Observed models and signals:

Hybrid seat + usage (LangSmith $39/seat + per-trace, Langfuse, W&B Weave): Most accepted in the infra stack; predictable line item + pass-through compute.
Flat platform fee, unlimited seats (Braintrust ~$249/mo): Gaining vs. seat-based; enables cross-functional access.
Unit / per-event (Langfuse tiers): Cleanest scaling story.
Quota + credits + top-ups (Devin, Lovable): Intuitive ("tasks done") but hides economics.
Pure usage / token / effort / ACU (Bolt tokens, Replit effort, Devin ~$2.25/ACU ≈ 15 min work): Reflects machine labor; strongest buyer resistance from retries/mistakes.
Outcome / per-conversation (Salesforce Agentforce): Significant pushback; generally avoid.

Implication: lead with a generous free tier and unit/usage-based pricing (per agent-run + per judge-call) with transparent, checkpoint-aware spend controls. Per-seat licensing is increasingly illogical when an autonomous agent is the primary consumer of the software 24/7.

---

10. PHASED PLAN (MVP → MOAT)

Stage 1 — Validate the wedge (0–3 mo). Thin TS+Python SDK that (a) routes LLM calls through a vendor-neutral interface; (b) runs the agent loop as a Temporal/LangGraph durable workflow with checkpointing; (c) ships a default Agent-as-a-Judge step after every N actions, using a different model family than the executor. Open-source under MIT. Publish own DevAI-extended numbers within 90 days.

Stage 2 — Productize the judge (3–9 mo). Managed cloud control plane: hosted judges, hosted checkpointers, hosted trace browser. Unit-based pricing, generous free tier, $29–199 mid-tiers, enterprise contracts for SSO/audit. Stop signal: if you can't beat OpenHands on a 50-task extended-DevAI subset by month 6, the technical thesis isn't differentiated enough.

Stage 3 — Vertical specialization (9–18 mo). Pick one full-app vertical underserved by the vibe-coders (internal admin tools, B2B SaaS dashboards, regulated/audit-trail industries) and ship a templated agent that generates and maintains that app class with measurable SLOs.

---

11. RISKS, OPEN QUESTIONS & STRATEGY-CHANGING SIGNALS

Strategy-changing signals to watch:
- Frontier models cross ~90% on SWE-bench Verified before mid-2026 → double down on brownfield/maintenance; patch generation will be commoditized.
- Cognition releases a credible model-neutral SDK → accelerate the eval-as-runtime wedge (single-vendor incumbents can't ship it credibly).
- Anthropic/OpenAI ship a first-class Agent-as-a-Judge primitive in their official SDKs (12–18 month risk) → pivot to the brownfield benchmark as the moat.
- Temporal et al. ship native LLM-aware primitives → partner on infra, differentiate at agent + judge + benchmark.

Risks & caveats:
- The space changes weekly; funding/ARR/benchmark figures go stale within a quarter and many ARR claims are self-reported — always communicate in ranges.
- METR's task-horizon trend may not extrapolate (it cautions the curve could plateau).
- Agent-as-a-Judge generalizability beyond DevAI is unproven; betting on it as a runtime primitive requires ongoing benchmark/eval R&D as a moat.
- "Agent washing" skepticism is high; over-index on technical differentiation visible to skeptical developers.
- Anthropic's Managed Agents (session/harness/sandbox virtualization) show server-side state can disqualify Zero-Data-Retention/HIPAA paths — governance/compliance must be designed in for regulated buyers.

Open product questions:
- Primary interface: SDK, API gateway, or CLI (and in what order)?
- Judge configuration: same model / different family / fine-tuned evaluator?
- Billing model for long-running sessions (reconcile predictability vs. true compute cost).
- First target user segment (indie / AI-native startup / enterprise).

---

12. ONE-LINE THESIS

Don't build another framework or app builder. Build the neutral orchestration layer that makes coding agents reliable over long horizons — guaranteeing durable state and enforcing real-time, Agent-as-a-Judge quality gates — and own the open benchmark that proves it.

