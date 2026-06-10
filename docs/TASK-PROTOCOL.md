# Task Protocol — how to work this plan

For **anyone and anything** (human, strong model, simple model) picking up a work package (WP) from [`plan.md`](../plan.md), whether working alone, in parallel with others, or continuing someone else's lane.

## 1. Before you start

1. Read your WP row in `plan.md`, the component doc it links, and the requirement IDs it closes in [`REQUIREMENTS.md`](REQUIREMENTS.md). The component doc is the spec — if it doesn't answer a design question and your WP is tagged 🟢/🟡, **stop and escalate** (file an issue / ask the architect) rather than inventing architecture.
2. Check dependencies: all `Depends` WPs merged? If not, you're in the wrong lane — pick another.
3. Check the lane is free: one WP in flight per lane (lanes = milestones M1–M5 in P1; one WP per component doc in P2+). Lanes never share files; if your change touches another lane's files, that's a contracts change — see §4.

## 2. While you work

- **Devbox only**: run every command (build/lint/test/Temporal/scripts) via `devbox shell` or `devbox run …`. Host toolchains are unsupported; if a verification command in your PR isn't a devbox invocation, it doesn't count as verified. New tools: `devbox add <pkg>`, commit `devbox.json` + `devbox.lock`.
- Branch: `wp-<number>-<slug>` (e.g., `wp-103-retry-policy`). One WP = one branch = one PR.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Tests per repo rules: real integrations over mocks; **never mock the LLM layer** (transport-level fakes for retry logic are fine — see router.md Testing).
- The five invariants (CLAUDE.md / memory) are merge-blocking:
  1. All LLM calls through Router — no direct provider SDK imports in business logic
  2. Judge family ≠ executor family (same-family = explicit opt-in + loud warning)
  3. OTel span on every LLM/tool call
  4. Explicit SUCCESS/FAILED on every tool/step/router result
  5. No secrets in code; keys via env only

## 3. Definition of done

A WP is done when **all** of:
- [ ] Acceptance criteria from its `plan.md` row pass, with the verification command(s) in the PR description
- [ ] CI green (lint, typecheck, tests)
- [ ] Requirement IDs updated in `REQUIREMENTS.md` (status → `done`)
- [ ] Component doc updated if reality diverged from spec (doc-follows-code drift is a bug)
- [ ] Invariants checklist confirmed in PR description
- [ ] PR includes benchmark deltas if agent/judge logic was touched (CLAUDE.md rule)

## 4. Changing a contract

Core interfaces are designed in [`docs/spec/CONTRACTS.md`](spec/CONTRACTS.md) and frozen in `types.ts` after WP-002 (the two must never diverge — change both in one PR). To change one:
1. Separate PR, title `contracts: <change>`, touching only types + affected call sites.
2. PR description must map the change to requirement IDs and list every lane affected.
3. Architect-level review (🔴-capable worker) required. Other lanes rebase after merge — coordinate timing.

## 5. Handing off mid-WP

If you stop before done (context limit, session end, blocked):
- Push the branch with a `HANDOFF.md` at repo root on that branch: what's done, what's verified, what's next (concrete next command/file), known traps. Delete it in the final PR.
- Never hand off red: if tests are broken, say exactly which and why in HANDOFF.md.

## 6. Worker-capability guidance

- 🔴 WPs: require design judgment — strong model or human. Read the spec section + ADRs first; expect to update docs as part of the work.
- 🟡 WPs: the component doc fully specifies the behavior; your job is faithful implementation + tests. Surprising spec gaps → escalate, don't improvise.
- 🟢 WPs: pattern-following (a previous implementation or conformance suite defines correctness). Ideal first tasks and parallel filler; if you find yourself making a design decision, the WP was mistagged — escalate.

## 7. Dogfood etiquette (P2+)

When a WP is run *through Chikory itself*: task.yaml lives in `examples/dogfood/wp-<n>.yaml`; the run journal is kept as an artifact; friction observed goes into `docs/reports/` — dogfood reports are first-class plan inputs (they drive reprioritization at phase boundaries).
