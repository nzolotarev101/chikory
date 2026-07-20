# dogfood-106 — WP-532 chikory chain resume drill, resume history in trace (P3 rung-2)

- **WP:** WP-532 (two-phase chain-resume drill) headline · WP-521(c) (chikory chain resume substrate, already landed) exercised end-to-end for the first time · WP-522 (`chikory chain trace`, already landed) gets a resume-history renderer
- **Date:** 2026-07-20
- **Spec:** `examples/dogfood/dogfood-106-wp521c-chain-resume.yaml`
- **Headline run-id (2nd launch, the one that landed):** `chain-babfabb0-4f4b-46c0-a5c3-42ac27153709` (launched `CHIKORY_SEED_CHAIN_FAIL_NODE=1 CHIKORY_CHAIN_RESUME_DRILL=1`)
- **1st launch (harness bug hit, no delivery):** `chain-3af8777f-18b4-45b9-875f-b299dbd264e9` — phase 2 exited 1, chain never actually resumed (see F-155 below)
- **Landed commits:** `a7fc10b` (delivery, cites the 2nd launch's run-id) · `9e01e09` (harness fix F-155, separate commit per the "keep the harvest commit pure" rule)
- **Outcome:** ✅ **SUCCESS** — `chikory chain resume` recovered a real sealed-FAILED 3-node chain to SUCCESS, and `chikory chain trace` now renders the resume history. First time WP-521(c)'s resume substrate has been proven on a live dogfood chain (dogfood-104/105 only proved chain-internal self-heal, never the operator `chain resume` CLI path).

## Plain lead

The `chikory chain resume` command (built in a prior WP but never dogfood-fired)
had a real bug: on the FIRST launch it silently no-op'd — it printed "resume
delivered" and then reprinted the OLD failed trace verbatim instead of actually
retrying the failed node. Fixed the race (F-155 below), re-ran the same drill, and
this time the retry genuinely fired: node N-B's retry incarnation (`N-B-r1`) ran for
real, succeeded, and the chain completed all 3 nodes. The delivered feature itself
(resume history in `chikory chain trace`) is correct and independently verified.

## What actually happened (1st launch — the harness bug)

Phase 1 force-failed node N-B (seam) and sealed the chain FAILED, as designed.
Phase 2 ran `chikory chain resume <chain-id> --watch`, printed
`resume delivered to chain ... (retrying the failed node)`, then printed an event
stream **byte-identical to phase 1** (same node ids, same timestamps) and exited 1.
No `N-B-r1` run directory was ever created — the retry never dispatched.

**Root cause (F-155):** `followChain` (`packages/sdk-ts/src/cli/chain.ts`) polls the
chain journal from index 0 and returns as soon as it observes a terminal
(SUCCESS/FAILED) status. `chikory chain resume` starts a *new* `chainLoop`
workflow execution over the same chain-id (`client.workflow.start`, which just
enqueues the start and returns immediately — it does not wait for the workflow to
actually begin). `followChain`'s first poll tick landed before the new workflow's
worker had picked up the task, so it read only the *pre-existing* FAILED tail from
phase 1 and treated that stale state as the resume's own outcome.

**Fix:** `followChain` now takes an optional `sinceIdx` baseline. The resume path
(`hostChainResumeAndFollow`) snapshots the journal's entry count *before* calling
`resumeChain`, and the terminal check now requires at least one journal entry past
that baseline (a genuine reopen/dispatch) before honoring a verdict — so a
pre-existing terminal state from before the resume can never be mistaken for the
resume's result. Re-ran the identical drill end to end on a fresh chain
(`chain-babfabb0-…`) and it worked: `chain resume (chain_failed_seal) — retry N-B`
→ `node N-B replanned → plan-…-r1` → `node N-B-r1 started` → `sealed SUCCESS` →
`node N-C started` → `sealed SUCCESS` → `chain SUCCESS`.

This is purely a CLI/harness bug in the resume-and-follow plumbing — it does not
touch the chain runner, `decideReplan`, `chain-loop.ts`, or any frozen contract
(consistent with the spec's own constraint not to touch those). Verified with the
full SDK test suite (955 tests) plus the two `chain-resume-live.test.ts` integration
tests, which cover `resumeChain` itself and passed both before and after.

## Trace (landed run `chain-babfabb0`)

| node | outcome | steps | cost | wall | note |
|---|---|---|---|---|---|
| N-A | SUCCESS | 1 | $2.01 | 7m37s | `renderChainResumeSummary` (new module) + test |
| N-B | **FAILED (seeded)** | 1 | $0.88 | 3m22s | seam force-failed the first incarnation as designed |
| N-B-r1 | SUCCESS | 1 | $1.62 | 4m41s | **the real retry** — wired `renderChainResumeSummary` into `renderChainReadTrace` |
| N-C | SUCCESS | 1 | $1.04 | 3m26s | E2E test: synthetic FAILED→replanned→SUCCESS journal renders a non-empty resume block |

Chain total: **$5.55**, 4 node dispatches, 1 chain resume, wall ≈19m28s
(15:14:35 → 15:34:03). Chain-completion review: PROCEED, 0 design findings.

## Delivery quality (human review, post-landing)

- **N-A** — `src/chain/resume-summary.ts`: pure named export
  `renderChainResumeSummary(entries)` folds `chain_failed_seal` control events with
  `node_replanned`/`node_sealed` history into a bounded multiline block. Reuses the
  existing journal entry reader (no sqlite re-parse). 6 focused unit tests. ✅
- **N-B-r1** — `src/chain/read-trace.ts`: `renderChainReadTrace` now calls
  `renderChainResumeSummary(entries)` and appends a `resume summary:` block only
  when non-empty. Relative ESM import of N-A's function (not recreated) — confirmed
  by reading the diff, no duplicate implementation. Landed on the retry incarnation
  as the spec required. ✅
- **N-C** — `test/cli/chain-trace-resume.test.ts`: seals a synthetic chain store
  (FAILED terminal → `chain_failed_seal` → `node_replanned` → SUCCESS terminal),
  imports both predecessors' symbols, asserts `chikory chain trace` renders a
  non-empty resume block naming the reopen boundary and retry node. Independently
  verified: `tsc --noEmit && eslint src/chain/read-trace.ts && vitest run
  test/chain/resume-summary.test.ts test/cli/chain-trace-resume.test.ts` all green
  against the landed tree (not just the run's clone). Both spec ACs (AC-1 grep for
  the export, AC-2 grep for the call site) re-verified green post-land. Scope is
  clean: only the 4 files the spec named. ✅

## New friction (global numbering continues from F-154)

- 🔴 **F-155** — `chikory chain resume` silently returned the chain's stale
  pre-resume terminal state instead of the retry's actual outcome, because
  `followChain` didn't distinguish "terminal state that predates this resume" from
  "terminal state produced by this resume" (race between `client.workflow.start`
  returning and the new workflow's worker actually picking up the task). This is
  the FIRST live-chain exercise of the WP-521(c) `chikory chain resume` CLI path
  (dogfood-104/105 only proved the chain's *internal* self-heal, never the operator
  resume command) — so the bug was invisible until now. **Fixed** in `9e01e09`
  (`followChain` gains a `sinceIdx` baseline; the resume caller snapshots the
  journal length before calling `resumeChain` and the terminal check waits for a
  genuinely new entry past that baseline). Re-verified live: the fix is what made
  this run's SUCCESS possible. No further WP needed — closed by the fix itself.

## Thesis-KPI verdict

| KPI | status | evidence |
|---|---|---|
| Operator `chikory chain resume` recovers a sealed-FAILED chain | 🟢 **first time proven** | `N-B-r1` dispatched and sealed SUCCESS on the actual `chain resume` CLI path (not the chain's own internal self-heal) |
| `chikory chain trace` renders resume history | 🟢 | `renderChainResumeSummary` + read-trace wiring, verified independently |
| Chain-scope kill→resume KPI (§1.4) | 🟢 | `resumes=1` this run (ledger) |
| Judge true-positive catches this run | 0 | none — the seeded FAILED is a harness seam, not a judge catch; no genuine judge catches or rollbacks fired |

## Verdict on the thesis

**PROGRESSING.** This closes the gap dogfood-104/105 left open: the chain
self-heal mechanism was proven internally, but the *operator-facing* recovery path
(`chikory chain resume`, meant for a human re-entering a chain hours later) had
never actually been fired — and turned out to be broken. Finding and fixing that on
a real dogfood chain (rather than only in the existing `chain-resume-live.test.ts`
integration test, which exercises `resumeChain` directly and never went through
`followChain`) is exactly the kind of gap dogfooding exists to catch.

## Next

Per the user's request this session, scope was "fix the friction so this run
succeeds" — no next spec authored. `docs/DOGFOODING.md`, `plan.md` §6/§7, and
`docs/REQUIREMENTS.md` status updates below; `examples/dogfood/README.md` index
row added. Next headline selection (progression gate + ladder pace check) is
deferred to the next `/dogfood-review`.
