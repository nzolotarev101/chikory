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
