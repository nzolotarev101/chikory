# ADR-008: Spec-In Autonomy End-State & the Chain-Autonomy Ladder

**Status**: Accepted
**Date**: 2026-07-07
**WP**: WP-516, WP-517, WP-518 (new) · WP-232 (chain-launch verification, promoted to rung C-1) · **Origin**: strategic-direction review 2026-07-07

## Context

Today a user hands Chikory a hand-authored `task.yaml`: a goal, acceptance
criteria with check commands, a budget, and routing. The chain layer
(ADR-005, goal decomposition & run chaining) already removes the *step*
breakdown — the planner decomposes, the plan meta-judge gates — but the
roadmap never names where this line of work is supposed to end.

This ADR names the end-state and ladders the path to it. The target, decided
2026-07-07:

> A user provides **no plan and no step breakdown** — at most a tech spec or
> architectural design. Chikory delivers the completed product **plus a
> ledger of the assumptions it made** (including ones the spec never
> mentioned), and **proactively asks the user to validate high-grade
> assumptions** before acting on them.

Three capability gaps stand between ADR-005 and that end-state, none of which
had a WP (work package) before this ADR:

- **Spec ingestion** — no path from "tech spec document" to a derived goal +
  acceptance criteria; the user still authors every AC and check command.
- **Assumption ledger** — assumptions live implicitly in goal text and
  executor reasoning; nothing extracts, journals, or reports them.
- **Clarification gate** — ESCALATE is reactive (stuck criterion, criterion
  flip-flop); there is no proactive "assumption graded high → formulate a
  question → park → resume with the answer" loop.

A fourth gap is evidential, not architectural: the durable multi-run chain
still has **zero end-to-end dogfood evidence** (F-32 → WP-232) — dogfood-041
was launched `chikory run` instead of `chikory chain`. Nothing in this ADR
may be built on an unproven chain.

Hard constraints this ADR honors:

- **Layering (ADR-005)**: chaining is orchestration *above* the run loop,
  never a change to it. All interactive autonomy lives in the chain layer;
  the `run` feature stays a focused, durable single-goal loop.
- **Invariant #2 (family diversity)**: any judge introduced here — including
  the AC-derivation gate — uses a structurally different model family from
  the LLM whose output it grades.
- **NF-1 / not-a-framework**: everything below is data + prompts + verdicts
  layered on existing machinery (planner, meta-judge, ESCALATE park,
  `chikory inject`), no new execution substrate.
- **The month-6 kill gate comes first**: the Stage-1 benchmark proof
  (published numbers due ~2026-09-08) is not delayed by this work.

## Decision

### D1 — Name the end-state (north star for the chain layer)

**Tech-spec-in → product-out, with an assumption ledger and clarification
escalation.** This is the chain layer's product north star, recorded in
`project.md` §5.8. The run layer is explicitly excluded from interactive
gates: runs journal assumptions passively (D3) but never park to ask the
user a question on their own initiative — parking remains the existing
judge-verdict machinery.

### D2 — The chain-autonomy ladder (`C-n`)

A second ladder, parallel to the WP-265 horizon ladder (`rung-N`, which
measures how *long* a run survives). `C-n` measures how *little* the user
must author. Rungs are cumulative; a rung is climbed only by a dogfood run
that proves it live.

| Rung | Name | Proof obligation |
|---|---|---|
| C-1 | Chain end-to-end | First true multi-node `chikory chain` dogfood on a real goal — this is **WP-232**, promoted onto the ladder. Prerequisite for every higher rung. |
| C-2 | Loose chain goal | A multi-node chain from an outcome-level goal with no per-node hints (the DOGFOODING §3 loose-spec discipline applied at chain scale). |
| C-3 | Assumption journal | Planner and executor declare assumptions as structured journal entries; the final report renders an assumption ledger (WP-516). |
| C-4 | Clarification round-trip | Assumptions graded low/high; a high-grade assumption ESCALATEs with a formulated question, the chain parks, the user's answer flows back, the chain resumes (WP-517). |
| C-5 | Tech-spec-only input | A tech spec / architectural design document in; derived goal + ACs + checks out, gated by a different-family derivation judge and user AC-approval (WP-518). |

### D3 — WP-516: Assumption journal (rung C-3)

- A new `assumption` journal-entry kind (journal-format.md): `{ id, holder:
  planner|executor, statement, basis, atStep }`. Additive; no frozen-contract
  shape change.
- Planner prompt and executor step prompt request explicit assumption
  declarations wherever the input underdetermines a decision.
- Run and chain reports gain an "Assumptions" section folding these entries;
  `chikory trace` renders them.
- The run layer participates **passively**: journal only, no gates. Cheap,
  and every entry enriches the trace dataset — the moat.

### D4 — WP-517: Assumption grading + clarification gate (rung C-4, post-P3)

- A grading rubric classifies each assumption low/high grade (blast radius ×
  reversibility × spec silence). High-grade → the chain layer emits ESCALATE
  with a formulated question as the escalate reason.
- Park/resume reuses existing machinery only: `AWAITING_APPROVAL` /
  WP-206 durable suspend, the approval signal, and `chikory inject` as the
  answer-delivery path. No new wait primitives.
- Chain-level only, per D1.

### D5 — WP-518: Tech-spec ingestion (rung C-5, post-P3)

- Accept a tech spec / architectural design document as the chain input.
  A derivation pass produces the goal + acceptance criteria + check commands.
- A **different-family** derivation judge gates the derived ACs against the
  source spec (invariant #2 extended, the plan-meta-judge pattern of
  `meta-judge-verdict.ts` applied one layer up).
- The user approves the derived ACs before execution — that approval is
  itself the first clarification round-trip, so C-5 depends on C-4's wiring.

### D6 — Sequencing rule (binding)

- **In P2 now**: C-1 (WP-232, already queued) and C-3 (WP-516) — both cheap,
  both dataset-enriching, neither competes with the WP-265 ladder headline.
- **Post-P3 only**: C-4 (WP-517) and C-5 (WP-518) — they do not start before
  the Stage-1 benchmark numbers ship (~2026-09-08). The horizon ladder and
  benchmark prep keep the headline slots.

## Design anchors (reference, do not re-design)

- Plan meta-judge verdicts: `packages/sdk-ts/src/planner/meta-judge-verdict.ts`
- ESCALATE park + approval wait: `packages/sdk-ts/src/workflow/agent-loop.ts:694`
- Judge verdict rules 3 (stuck criterion) and 5 (flip-flop) as natural
  assumption-inference hooks: `packages/sdk-ts/src/judge/verdict.ts`
- Cross-node carry for the ledger: structured compaction notes
  (`src/chain/compaction-note.ts`, ADR-006) + Memory Pointer refs (WP-202).

## Consequences

- The roadmap now has a named end-state and a measurable ladder toward it;
  "how autonomous is Chikory?" is answered by the highest climbed `C-n`.
- REQUIREMENTS.md gains FA-4 (assumption ledger), FA-5 (clarification gate),
  FA-6 (spec ingestion); GLOSSARY.md registers the `C-n` family.
- Risk accepted: C-4/C-5 wait ~2 months behind the benchmark gate. Mitigant:
  C-3's ledger data accumulates in every P2 run meanwhile, so grading (C-4)
  starts against real corpus, not cold.
