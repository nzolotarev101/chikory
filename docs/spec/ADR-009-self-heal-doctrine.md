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

0. **Repair** — a gate rejected an artifact *before* any durable execution
   exists (the plan meta-judge on a decomposition, ADR-005 D2). The gate's own
   evidence is fed back and the artifact is re-produced, bounded by attempts and
   cost (WP-542, new). Applies to launches, so it precedes every tier below.
1. **Prevent** — judge gates the bad diff before it lands (WP-132, existing).
2. **Correct** — ROLLBACK: checkpoint restore + rationale feedback (existing).
3. **Remediate** — bounded retry against an explicit remediation brief
   (WP-519, new).
4. **Re-enter** — chain-level, before any rewrite: a child that sealed
   `resumable` FAILED is re-executed under the SAME run id, so its checkpoint,
   its journal and its remediation brief carry forward (WP-544, new).
5. **Replan** — chain-level: re-decompose from the failure as evidence
   (ADR-005 D3, existing but off by default — WP-521 turns it on).
6. **Escalate** — park for the human (existing ESCALATE machinery), or seal
   **resumable** FAILED (WP-520) so recovery remains possible later.

**Tier order is cheapest-first, and "cheap" means work preserved.** Tier 4
precedes tier 5 because a replan discards a workspace the run had already
earned; answering "this run can continue" by deleting the run is a regression
dressed as a heal (F-214).

**Binding on every future gate.** D1 says *every* non-infra failure class gets a
heal attempt; a gate that consumes an LLM-produced artifact and can reject it is
a failure class. Any such gate routes through the tier-0 primitives
(`heal/gate-repair.ts`) rather than ending the launch. Two exclusions, and only
two: a **config error** (a same-family judge — invariant #2 fails fast, at no
cost) and a **substantive ESCALATE** (the verdict whose meaning is "a human must
decide"). Deterministic `$0` prechecks that refuse a malformed *input* — a
broken spec, a stale WP, an unarmed seam — are not gates in this sense and stay
fail-closed: repairing them would defeat the F-119/120/121 launch guards.

Repair never softens the gate. An exhausted budget stops the launch with the
full attempt trail; it never proceeds on the rejected artifact.

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

### D5b — WP-542: Plan-time gate repair (tier 0, P3)

The plan gate sits above both loops and had no tier at all: any rejection — a
planner transport fault, an unserializable write-set topology, the WP-509
`min_nodes` floor, the coverage/literal floors, or the meta-judge's own REVISE —
discarded the decomposition and ended the launch. Measured cost: five launches
of `dogfood-120` with zero nodes run, each one repaired by a human editing the
goal spec (F-207). ADR-005 D2 already named the fix in the verdict's own name —
"REVISE → re-plan" — and nothing consumed it that way.

- **(a)** `planAndGateChain` loops: classify → decide → brief → re-decompose.
  Default 3 repair attempts, stopping early above 10% of the chain budget;
  `CHIKORY_PLAN_REPAIR_ATTEMPTS=0` restores the single-shot stop.
- **(b)** The brief is composed deterministically from evidence the gate already
  produced (`verdict.uncoveredCriteria`, `planLiteralGaps`, the node-count
  shortfall) plus the rejected plan's outline — no extra LLM call, machine-checked
  defects listed before the prose so a paraphrasing retry cannot lose them.
- **(c)** Journaled per D1: one `plan_verdict` chain entry per attempt, written
  at `initChain` (the gate runs before the chain exists).
- **(d)** Prevention first: the planner prompt now states the backtick-literal
  rule the verdict floor was already enforcing silently.

### D5c — WP-543: No incarnation ends without a terminal seal (F-208)

D1's "before any terminal seal" assumes a seal is always written. `chainLoop`
could exit without one: `deriveChainStatus` rule 1 parks the chain in
`AWAITING_PLAN_APPROVAL` on any node outcome carrying `verdict === "ESCALATE"`,
the loop seals only `SUCCESS`/`FAILED`, and a *sealed* escalation has already
been answered — so nothing could unpark it. The result was strictly worse than a
dead end: no `terminal` entry, `chains.status` stuck `RUNNING`, `chain resume`
reporting "no journal or is still live", `chain approve` finding nothing to
signal, `--watch` waiting forever, with the plan and every node attempt intact
on disk (dogfood-120, `chain-0723ac0b`). The unattended escalation policy
reaches the same state with no human involved.

- **(a)** Binding: **every workflow incarnation ends in a terminal status.** A
  status the orchestrator cannot leave is a bug in the orchestrator, never a
  state for an operator to discover.
- **(b)** Pure `resolveAnsweredEscalationPark` (`src/chain/escalation-park.ts`)
  converts the answered park into a `FAILED` + `resumable` seal — the WP-521(c)
  resume entry point, so the failed node gets its fresh heal attempt. ADR-005
  §S3 reserves non-node transitions for the orchestrator, so the pure four-rule
  reducer and its Python parity port are unchanged.
- **(c)** Recovery for chains ALREADY orphaned by a pre-fix build:
  `chikory chain resume` writes the missing seal and re-enters. Fail-closed —
  an in-flight node, a live workflow, or an unreachable Temporal all decline the
  write; a chain we merely cannot see is not an orphan.
- **(d)** Every terminal that a heal path can re-enter says so at the seal
  (`recover with: chikory chain resume <id> --watch`), and every refusal names
  the command that does work.

### D5d — WP-544: A heal budget must measure the right thing (F-209…F-214)

Every tier above assumes the run it is healing was configured as the operator
declared, and that the strikes triggering a heal were actually earned. On
dogfood-120's `N-2`, neither held: the chain node template forwarded six spec
fields and silently dropped `step_limits` / `unattended` / `pacing`, so a
cap-kill at the *default* 600s became strike 1 of the three that HALTed the node
on $0.20 of a $15 budget — and the chain-wide replan budget, still charging for
a lineage that had since succeeded, then refused it a heal entirely.

- **(a)** Binding: **a bound is only legitimate over what the agent controls.**
  An infrastructure kill (`StepRecord.infraFailed`) and a verdict whose diff was
  reverted are inconclusive; the rule-3 sequence skips both. The finding is
  never suppressed — only the strike.
- **(b)** Binding: **a heal budget is per unit-of-work, not per chain.** Node
  lineages (`N-1` → `N-1-r1` → …) carry their own count; the chain-wide ceiling
  is measured over nodes the CURRENT plan contains, so a lineage that healed
  stops debiting the nodes after it.
- **(c)** A rewind's anchor must contain work: a PROCEED covering a FAILED step
  never becomes `lastGoodCheckpointId`.
- **(d)** A restore does not clear the counter that triggered it. Remediation
  (tier 3) fires *because* a criterion is three verdicts stuck; resetting its own
  trigger would turn one bounded attempt into three more judge passes.
- **(e)** The chain template's coverage of `TaskSpec` is **enumerated**
  (`CHAIN_TEMPLATE_FIELDS`) and asserted at compile time. A policy an operator
  declared and the system ignored is indistinguishable, from the outside, from a
  policy that does not work.

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
- Gate repair (tier 0): `packages/sdk-ts/src/heal/gate-repair.ts`; plan-phase binding `packages/sdk-ts/src/planner/plan-repair.ts`; loop `packages/sdk-ts/src/cli/chain.ts` `planAndGateChain`
- Answered-escalation seal: `packages/sdk-ts/src/chain/escalation-park.ts`; orchestrator use `chain-loop.ts`; orphan repair `cli/chain.ts` `repairOrphanedChainSeal`
- Strike accounting (what a bound may count): `packages/sdk-ts/src/runner/strike-accounting.ts`
- Chain→run re-entry (tier 4): `packages/sdk-ts/src/chain/node-heal.ts`; template contract `chain/node-spec.ts` `CHAIN_TEMPLATE_FIELDS`
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
