# Glossary

Canonical meanings. Docs and code comments use these terms exactly.

| Term | Meaning |
|---|---|
| **Run** | One durable workflow execution of a TaskSpec. Has run-id, journal, checkpoints, budget ledger, explicit terminal status. |
| **Step** | Atomic unit of execution/journaling/judging/checkpointing: one bounded executor invocation (caps: turns/time/cost) in a workspace, producing a `StepRecord`. |
| **Executor** | The thing doing software work inside a step. MVP: wrapped CLI coding agent (ADR-003); also native router-driven loop (P2). |
| **Judge / Agent-as-a-Judge** | Different-model-family evaluator running in the inner loop every N steps; inspects evidence (diffs, judge-run tests, criteria) and yields a binding verdict. |
| **Verdict** | `PROCEED` / `ROLLBACK` / `HALT` / `ESCALATE` (/ `BRANCH` P2+). Computed by code from the judge's binary form answers. |
| **Evidence** | What the judge sees: diffs, test results it ran itself, acceptance criteria + history, compacted summaries. Never the executor's prompt stream. |
| **Acceptance criterion** | Upfront success condition in TaskSpec; ideally machine-checkable via a `check` command the judge executes. |
| **Checkpoint** | Git commit(s) + journal index + compacted context snapshot + spend marker. Unit of resume/rollback/branch. `lastGood` = most recent PROCEED-ed. |
| **Journal** | Append-only per-run event log; the single ground truth. Exported as **JIF** (journal interchange format). |
| **JIF** | Versioned JSON form of a journal (docs/spec/journal-format.md). Consumed by trace CLI, benchmark, dataset, trace browser. |
| **Artifact / ArtifactRef** | Bulk runtime object (diff, transcript, test log, screenshot) stored outside context; only the short ref + summary enters context (Memory Pointer Pattern). |
| **Context rot** | Degradation of model performance over long sessions as context grows/pollutes. Mitigated by compaction-at-checkpoint, notes, sub-agents, pointers. |
| **Compaction** | Journaled rewrite of older step history into a structured digest at a checkpoint boundary. What's checkpointed is what's resumed. |
| **Notes** | Key-value memory the executor writes; survives compaction verbatim; core context tier. |
| **Tiered memory** | Core (always, verbatim) / Recall (recent summaries) / Archival (everything, fetch-on-demand). |
| **Terminal state** | Explicit `SUCCESS`/`FAILED` on every tool/step/router/run result. Invariant #4; the infinite-loop breaker. |
| **Budget ledger** | Per-run spend accumulator (executor + judge), checkpoint-aware; powers gates, status, pricing meters. |
| **Pacing / window-fit** | Pre-step reasoning sizing the next batch against context window + remaining budget; journaled decision (P2). |
| **Escalate / HITL** | Run pauses for human approval (signal); P2 sleeps durably for hours/days at zero compute. |
| **Lane** | A set of WPs that never share files with another lane; the parallelism unit for multi-worker execution. |
| **WP (work package)** | One PR-sized unit in plan.md with acceptance criteria + verification command. Tags: 🔴 architect / 🟡 builder / 🟢 mechanical. |
| **Dogfood run** | A Chikory WP implemented *by* Chikory; journal kept; report feeds plan reprioritization. |
| **Conformance suite** | Shared test set every implementation of an interface must pass (executor adapters, providers, contracts fixtures). |
| **Vertical pack** | Stage-3 layer: blueprint + criteria library + rubrics + playbooks + SLOs for one app class. Data, not new runtime. |
| **Steward** | Stage-3 recurring maintenance schedule for a deployed app (upgrades, CVE patches, bug-fix runs). |
| **Stop signal** | Month-6 test: beat OpenHands on 50-task DevAI-extended subset or revisit the thesis. |
| **I-SR / D-SR** | Benchmark requirement-satisfaction rates (DevAI methodology): **I-SR** = independent (each requirement graded on its own); **D-SR** = dependency-adjusted (a requirement counts only if its prerequisites are satisfied too). Reported by the WP-301 harness. |
| **Dataset record** | One run's journal normalized for the WP-306 failure/recovery dataset: JIF run + totals + entries plus derived recovery paths (rollback → recovered?). Produced only by explicit `chikory dataset export`; local-first, secret-scanned. |
| **Quota window** | A provider-imposed usage window on a subscription endpoint (rolling-5h, weekly), declared on the WP-307 endpoint descriptor. Capacity is never vendor-declared — it is learned from observed limit hits. |
| **Consumption ledger** | Cross-run SQLite record (`<dataDir>/ledger/endpoints.db`, WP-310) of per-step token/cost burn per endpoint plus observed limit hits. Lives beside `runs/` because a weekly quota window outlives any single run and is shared by concurrent runs on one subscription. |
| **Pacing governor** | The WP-310 pre-step decision (`decideLimitPacing`): observed burn vs sustainable quota pace vs the task-horizon required pace → push / steady / throttle (durable `source:"pace"` sleep) / predict-limit (hands the step to the WP-308 response path before the provider fires a real 429). Distinct from context-window pacing (see **Pacing / window-fit**). |

## ID families

Coined identifiers used across `plan.md`, reports, and specs. Per
[`COMMS.md`](COMMS.md) Rule 1, gloss each on first use in any artifact.

| ID | Family | Meaning |
|---|---|---|
| `WP-n` | Work package | One PR-sized planned unit in `plan.md` with acceptance criteria + verification command. |
| `F-n` | Friction | A problem a dogfood run surfaced. Global, sequential numbering across all runs. |
| `rung-N` | Horizon-ladder rung | Run difficulty tier (WP-265 ladder); higher = longer/harder horizon. `0` = off-ladder. |
| `C-n` | Chain-autonomy ladder rung | Autonomy tier (ADR-008 ladder); higher = less the user must author. Distinct from `rung-N` (run horizon): `rung-N` measures how long a run survives, `C-n` how little input it needs. C-1 chain e2e → C-5 tech-spec-only input. |
| `§n` | plan.md section | A numbered section of `plan.md` (e.g. `§6` = the work queue). |
| `RT-n` | Requirement — routing | LLM-routing requirement in `REQUIREMENTS.md`. |
| `DX-n` | Requirement — durability | Durable-execution requirement. |
| `JD-n` | Requirement — judge | Agent-as-a-Judge requirement (judge-trust pillar). |
| `CM-n` | Requirement — memory | Context/memory requirement. |
| `CG-n` | Requirement — cost | Cost/budget requirement. |
| `dogfood-NNN` | Dogfood run | A self-hosting run (Chikory building Chikory); paired spec + report. |
| `run-<id>` | Run id | A single durable workflow execution's identifier. |

## Status words

| Term | Meaning |
|---|---|
| **Harvest** | Land a completed run's diff as a normal PR. `un-harvested` = run succeeded, diff not yet landed. |
| **Hollow / non-hollow** | A step that did trivial/no real work (hollow) vs. a distinct non-trivial diff (non-hollow). |
| **Prescribed / loose spec** | `prescribed` goal dictates exact files/symbols/diff; `loose` goal states outcome + constraints, layout left to the executor. |
