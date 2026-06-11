# Component: Agent-as-a-Judge

**Phase**: P1 (lane M4), extended P2 · **WPs**: WP-131..134, WP-210, WP-211, WP-215 · **Requirements**: JD-1..7 · **ADR**: 002
**Code**: `packages/sdk-ts/src/judge/` (`evidence.ts`, `rubric.ts`, `prompt.ts`, `verdict.ts`, `harness.ts`, `family.ts`); runner wiring in `runner/activities.ts` (`judgeStep`, `restoreCheckpoint`) + `workflow/agent-loop.ts`

## Purpose

The core differentiator (spec §6 vector 1). An inner-loop, software-native evaluator that inspects what the executor actually *did* — diffs, test results, artifacts — and gates the next action **before** a bad change lands. Not offline eval, not text grading.

## Position in the loop (JD-2/3)

Runs as a journaled activity every `judgeCadence` steps (default 3); plan-milestone triggers land with the task tree (P2). Its verdict is binding on the runner:

| Verdict | Runner behavior | When the judge should issue it |
|---|---|---|
| `PROCEED` | Mark checkpoint as last-good, continue | All gated criteria pass; no regressions |
| `ROLLBACK` | Restore last-good checkpoint; judge rationale enters executor context | Work is wrong/destructive but recoverable (e.g., deleted needed code, broke tests it didn't touch) |
| `HALT` | Terminal FAILED-with-checkpoint | Continuing would waste budget (repeated identical failures, goal drift beyond recovery) |
| `ESCALATE` | Pause for human approval (signal) | Ambiguity the rubric can't resolve, security-sensitive change, acceptance criteria themselves look wrong |

P2 adds a `BRANCH` recommendation (try alternative at checkpoint X) once WP-205 lands.

## Evidence, not vibes (JD-4)

The judge never sees only prose. `JudgeEvidence` assembled by the harness (WP-131):

| Evidence | Source | Phase |
|---|---|---|
| Workspace diff(s) since last verdict | checkpointer | P1 |
| Test execution output (judge *runs* the test command from TaskSpec, doesn't trust the executor's claim) | judge-owned sandbox exec | P1 |
| Acceptance criteria + per-criterion current status | TaskSpec + verdict history | P1 |
| Compacted step summaries + executor self-reports | journal | P1 |
| UI screenshots (Playwright) vs criteria | WP-211 | P2 |
| Dependency/secret scan, architecture-rubric answers | WP-215 | P2 |

Evidence is size-bounded: large items go in as `ArtifactRef` + judge-targeted excerpts (window-fit reasoning for the *judge pass* — SE-2 applies to judging too; full version in WP-207).

## Scoring (JD-6/7, ADR-002)

- **Default: pointwise binary rubric with chain-of-thought** (G-Eval-style form filling): for each acceptance criterion and each standing rubric item (tests pass, no unrelated deletions, no secrets introduced, diff matches instruction scope), the judge answers `true/false` + one-sentence justification, then the verdict is **computed from the booleans by code**, not chosen freely by the model — this is the reward-hacking guard: the LLM fills a form; deterministic rules map form → verdict.
- Structured output enforced via Router `responseSchema`.
- P2: pairwise comparison mode (two candidate diffs, e.g. after BRANCH) and configurable rubric packs. Multi-judge debate: deferred until evidence justifies the cost (ADR-002).
- Drift awareness: verdict history + per-criterion flip-flops surface in `chikory trace`; persistent disagreement between judge and tests is itself an ESCALATE trigger.

## Structural diversity (JD-5, invariant #2 — WP-133)

- `judge.modelFamily !== executor.modelFamily` enforced at TaskSpec validation. Same family requires `judge.allowSameFamily: true` and prints a prominent warning into both console and journal.
- Diversity is three-fold per spec: different **family**, different **prompt regime** (judge prompt contains rubric + evidence only — never the executor's persona/instructions), different **memory** (judge gets compacted evidence, not the executor's context, also countering position/verbosity bias and shared-context poisoning).

## Cost transparency (JD-7 — WP-134)

Every judge pass is journaled with tokens/cost; `chikory trace` shows judge cost as absolute and as % of run cost. Cadence is the user's lever: `judgeCadence`, plus `judge.maxCostShare` (warn when judging exceeds N% of spend).

## Testing

Three layers (P1, `test/judge/`):

- **Deterministic rules** (`verdict.test.ts`): CONTRACTS §4 rules 1–5 + precedence, pure unit — the LLM never chooses the verdict, so the verdict logic needs no LLM to test.
- **Harness over a fake wire** (`harness.test.ts`, `runner/verdict-gating.test.ts`): transport faked (local HTTP server, real openai-compat wire format), never the LLM layer — JD-4 check overrides, failure-as-ESCALATE, and all four runner gating paths end-to-end.
- **Fixture-driven verdict suite** (`fixtures.integration.test.ts`, real calls, key-gated `@integration`): curated workspaces (good step, secret-introducing diff, deleted-test reward hack) with expected verdict classes, run against every judge family whose key is present. Broken-tests and scope-creep fixtures plus the cross-family disagreement metric extend in P3 (WP-306) alongside drift monitoring.
