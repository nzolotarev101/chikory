# ADR-009: Self-Heal Doctrine — Bounded Automated Recovery Before Any Terminal Seal

**Status**: Accepted
**Date**: 2026-07-07
**WP**: WP-519, WP-520, WP-521 (new) · **Origin**: strategic-direction review 2026-07-07 (the ADR-008 sibling)

## Context

Chikory's headline is "long-running, **self-correcting** software agents"
(project.md line 3), but no invariant, non-functional constraint, or
requirement row operationalizes what happens after the judge finds a real
issue in the implementation. Some paths heal; others dead-end silently.

What already heals (do not re-invent):

- **Judge ROLLBACK** (destructive rubric hit): checkpoint restore + the
  judge's rationale rides into the next step's context
  (`packages/sdk-ts/src/workflow/agent-loop.ts:615–618`) — live-proven
  (WP-132, the dogfood-046/048/054 true-positive catches).
- **Chain halt-and-replan** (ADR-005 D3): a FAILED node triggers
  `decideReplan` → `replanRemaining` → spliced plan → chain continues —
  built and live-proven (dogfood-082, `src/chain/replan.ts`,
  `replan-live.test.ts`).
- **Infra**: Temporal retry/replay covers worker crashes and transient
  activity failures (WP-123).

What dead-ends today, with no automated heal attempt:

- **Judge HALT** (verdict rule 3, criterion stuck 3 consecutive passes,
  `src/judge/verdict.ts`) seals FAILED immediately — the judge diagnoses the
  problem and then throws the diagnosis away.
- **Between milestones**, failing-criterion feedback is suppressed
  (`agent-loop.ts:689` gates `judgeFeedback` on `completionMilestone`) — the
  executor retries blind against the exact evidence the judge already holds.
- **Chain replan is off by default** (`maxReplans ?? 0`,
  `src/chain/chain-loop.ts:55`) — the delivered healer never fires unless
  opted in.
- **A FAILED chain is final** — no `chikory chain resume`; replan exhaustion
  is a dead end.
- **Resumable vs dead FAILED are indistinguishable** — F-110 already flags
  that a policy park and a genuine failure seal the same way and asks for an
  ADR; this is it.

Why this matters now: the P2 exit gate is a 24h+ **unattended** run. Over
that horizon a single stuck criterion is near-certain; without an automated
healer the gate run dies on its first one. And the end-state named in
ADR-008 (spec-in autonomy) presumes completion without a human on call —
self-governance requires self-healing in every transaction, run and chain.

## Decision

### D1 — The doctrine (binding)

**Every non-infra failure class gets at least one bounded, journaled,
automated heal attempt before any terminal seal.** Human escalation is the
*last* resort in the recovery order, never the first response. This applies
to the run loop and the chain layer alike.

Bounds are mandatory: heal attempts are counted and capped (CG-1 /
invariant #4 — deterministic exits, no infinite loops). Every heal attempt
is journaled with its trigger, evidence, and outcome (NF-2 — no magic);
heal-attempt records enrich the trace dataset, the moat.

### D2 — The heal escalation order

Recovery proceeds through named tiers; each tier is tried (within its bound)
before falling to the next:

1. **Prevent** — judge gates the bad diff before it lands (WP-132, existing).
2. **Correct** — ROLLBACK: checkpoint restore + rationale feedback (existing).
3. **Remediate** — bounded retry against an explicit remediation brief
   (WP-519, new).
4. **Replan** — chain-level: re-decompose from the failure as evidence
   (ADR-005 D3, existing but off by default — WP-521 turns it on).
5. **Escalate** — park for the human (existing ESCALATE machinery), or seal
   **resumable** FAILED (WP-520) so recovery remains possible later.

### D3 — WP-519: Remediation-before-HALT (run level, P2)

When verdict rule 3 (stuck criterion) would HALT:

- The judge authors a **remediation brief** — the failing criteria, the
  evidence, and what a fix must change — instead of discarding its diagnosis.
- The runner rolls back to the last-good checkpoint and grants **one**
  bounded remediation attempt with the brief as feedback, then re-judges.
- Still stuck → seal **resumable** FAILED (D4), not a dead seal.
- Slice (a), independent and cheap: un-suppress intermediate feedback —
  failing-criterion rationale rides into the next step on **every** judge
  pass, not only at completion milestones (`agent-loop.ts:689`).
- Chunk-aware: respects the WP-273 rule-3/5 suppression during non-final
  work chunks; remediation triggers only where HALT would have.

### D4 — WP-520: Resumable-FAILED terminal state (run level, P2)

The F-110 follow-through:

- Distinguish **resumable** FAILED (healable: remediation exhausted,
  unattended-policy seal, budget-recoverable) from **dead** FAILED
  (unrecoverable) in the journal seal, `chikory trace`, and CLI output.
- Define `chikory resume` semantics on a resumable-FAILED run — currently
  undefined behavior. Resume re-enters from the sealed state with the
  remediation brief / failure evidence in context.
- WP-519 and WP-521 seal into this state; it is their substrate.

### D5 — WP-521: Chain heal-by-default + chain resume (post-C-1)

- **(a)** `maxReplans` defaults ≥1 for chains — halt-and-replan fires by
  default; opting *out* is the explicit act.
- **(b)** Replanner evidence enrichment: the failed node's judge rationale
  and AC-failure history feed `replanRemaining`, so the replan corrects the
  actual failure rather than re-rolling the dice.
- **(c)** extend `chikory chain resume <chain-id>` (exists today only for a
  PARKED awaiting-approval chain, WP-241/dogfood-044) to a FAILED or
  replan-exhausted chain: retry the failed node with its failure evidence,
  remaining budget permitting.
- Depends on WP-232 (chain-autonomy rung C-1, ADR-008) — no chain healing is
  built on a chain layer without end-to-end evidence.

### D6 — Sequencing rule (binding)

- **P2 now**: WP-519 + WP-520 — prerequisites for the 24h unattended
  exit-gate run; an unattended run without a healer cannot survive the gate.
- **Post-C-1**: WP-521 — starts only after WP-232 lands chain e2e evidence.
- Nothing here displaces the WP-265 horizon-ladder headline; these land as
  ladder-run hosts or track-B per DOGFOODING §1.5 friction budget.

## Design anchors (reference, do not re-design)

- Verdict rules 3 (stuck) / 5 (flip-flop): `packages/sdk-ts/src/judge/verdict.ts`
- Rollback + feedback carry: `packages/sdk-ts/src/workflow/agent-loop.ts:615–618`, `:689`
- Escalate park + approval wait: `agent-loop.ts:694–714`; unattended seal: WP-271 `seal_resumable_failed`
- Chain replan: `packages/sdk-ts/src/chain/replan.ts`, `chain-loop.ts:55` (`maxReplans`), `activities.ts` `replanRemaining`
- Chunk-aware judge rules: WP-273

## Consequences

- "Self-correcting" becomes checkable: NF-7 (REQUIREMENTS.md) states the
  doctrine; DX-9 and JD-8 trace it to WP-519/520/521.
- Terminal seals gain a semantic split (resumable vs dead) — additive journal
  change, designed under WP-520, no frozen-contract break expected.
- Cost: healing spends budget on failed work. Accepted — bounds cap it, and
  a healed run is cheaper than a re-launched one; the budget gate (CG-2)
  still halts overruns.
- Risk: remediation loops masking systematic spec defects. Mitigant: one
  bounded attempt, then a resumable seal that preserves the diagnosis for
  the human.
