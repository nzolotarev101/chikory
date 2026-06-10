# Component: Durable Runner

**Phase**: P1 (lane M3), extended P2 · **WPs**: WP-121..124, WP-205..207, WP-212, WP-214 · **Requirements**: DX-1..8, FA-2, CG-2 · **ADR**: 001 (Temporal)
**Code**: `packages/sdk-ts/src/runner.ts`, `packages/sdk-ts/src/workflow/`

## Purpose

Owns the control loop and all state. Guarantees: a run survives any process/machine/API failure and resumes from the exact point of failure without re-spending tokens (DX-2/3); every step is checkpointed, inspectable, rollback-able (DX-4/6); spend is bounded (DX-7).

## Temporal mapping (WP-121)

| Chikory concept | Temporal primitive |
|---|---|
| Run | Workflow execution (`workflowId = run-id`) |
| Executor step / judge pass / checkpoint write | Activity (memoized in event history = the replay journal) |
| Crash recovery | Worker restart → deterministic replay from history (DX-3 for free) |
| ESCALATE / HITL approval | Signal (`approve` / `reject`); P2: durable timer for day-scale sleep (DX-8) |
| Mid-run correction (WP-212) | Signal (`inject`), drained into next step's context |
| Budget/steps status | Query handler (`chikory status` reads live without disturbing the run) |
| Branch (WP-205) | New workflow started from a checkpoint's journal prefix + git worktree fork |

**Determinism rules**: workflow code contains zero I/O, zero `Date.now()`/random outside Temporal APIs; all side effects in activities. Activities are idempotent where re-execution is possible (checkpoint writes keyed by step index).

Local dev: `devbox run temporal-dev` (temporal-cli is pinned in `devbox.json`; never use a host-installed Temporal). The `DurableRunner` interface in `types.ts` is the substrate seam — if Temporal proves too heavy for solo devs (ADR-001 revisit trigger), a lighter engine can implement it.

## The loop (pseudocode, P1)

```
while (true) {
  if (budgetLedger.remaining < estimateNextStep()) {                             // CG-2
    journal(budget_event: halt); status = SUSPENDED                              // resumable
    await signal(topUp); journal(budget_event: top_up); continue                 // resume --add-budget
  }
  instruction = nextPlanItem()                                                   // P2: paced batch (WP-207)
  record = activity.executeStep(adapter, instruction, ctx)                       // journaled
  if (stepIndex % judgeCadence == 0 || planMilestone()) {
    verdict = activity.judge(evidenceSince(lastVerdict))                         // journaled
    switch (verdict) {
      PROCEED  → (checkpoint below is written lastGood)
      ROLLBACK → activity.restore(lastGoodCheckpoint); ctx.addJudgeFeedback(verdict)  // WP-132
      HALT     → halt(JUDGE)                                                     // terminal, resumable (WP-132)
      ESCALATE → await signal(approve|reject)                                    // DX-8 (WP-132)
    }
  }
  checkpoint = activity.checkpoint(record, lastGood = verdict==PROCEED)          // git commit + journal row
  if (allAcceptanceCriteriaMet(verdict)) → succeed()                             // explicit terminal
  if (record.status == FAILED) { failures++; if (failures >= 3) → escalate() }   // CG-1: no loops
}
```

The checkpoint is written **after** the (optional) judge pass so the persisted `lastGood` flag reflects the verdict that covers exactly that state — WP-132's ROLLBACK restores the latest `lastGood` checkpoint. The WP-124 loop-breaker escalation is runner-sourced: it journals a `verdict` entry with `source: "runner"` and no JudgeForm (journal-format.md §3), then awaits `approve` (status `AWAITING_APPROVAL`); rejection seals an explicit FAILED terminal.

Every terminal is an explicit `SUCCESS` or `FAILED(reason, lastCheckpoint)` journal seal — runs never end ambiguously.

## Journal (WP-121/122)

- Append-only SQLite db per run (`.chikory/runs/<run-id>/journal.db`) — inspectable with any SQLite client, no server dependency, fits local-first (RT-9). Temporal history handles *replay*; the journal is the *product-facing* record (traces, metrics, benchmark dataset derive from it).
- `journal_entries(idx, ts, kind, payload_json, cost_delta_usd, tokens_in, tokens_out, artifact_refs)` where `kind ∈ {step, judge, checkpoint, verdict, injection, budget_event, compaction, terminal}`.
- Writes go through one activity; payloads >8KB are stored as artifacts with refs inline (CM-3 discipline from day 1).

## Checkpoints (WP-122)

`Checkpoint = { journalIdx, gitCommit, contextSnapshotRef, budgetSpentUsd }`.
- Workspace is a git worktree; checkpointer commits all changes after each step (`chikory: step <n>` messages on a run-private branch — user repos never see these until the run's final PR/diff is exported).
- `chikory status <run-id>` lists checkpoints; `chikory resume` continues from the workflow's own state; `chikory branch <id>@<idx>` (P2) forks.
- P2 (WP-203): compaction happens **at checkpoint boundaries** — the context snapshot stored is the compacted one, so resume never rehydrates rotted context (CM-1 co-design point).

## Crash recovery test (WP-123, exit-gate #2)

Automated test: start run → wait 2 steps → `kill -9` worker → restart worker → assert run completes, and journal cost total equals sum of unique steps (no duplicate spend). Also covered: API-timeout mid-step (activity retry policy), machine-clock skew (Temporal handles).

## Budget gate (WP-124)

- `budgetLedger` accumulates from every `StepRecord.costUsd` + judge call costs (judge cost is visible, JD-7).
- Pre-step check uses a conservative estimate (rolling mean of last 5 steps, ×1.5). Breach → `HALT(BUDGET)` with resumable checkpoint; `chikory resume --add-budget 5.00` continues (DX-7). P2's WP-207 upgrades this from a hard gate to reasoned continuation (finish-the-criterion vs stop-now decisions).

## Multi-repo (WP-214, P2)

`TaskSpec.repos[]` → one worktree per repo under the workspace root; checkpoints record a commit per repo atomically; evidence diffs are per-repo.
