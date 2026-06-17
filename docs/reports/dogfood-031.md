# Dogfood-031 — WP-207: pure context-window pacing decision (`decideContextWindowPacing`, clean SUCCESS in ONE step; F-11 stays closed; surfaced F-31 landing-scope contamination)

**WP**: WP-207 (pure context-window pacing decision) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-031.yaml`](../../examples/dogfood/dogfood-031.yaml) · **Run**: `run-c4aa79d3-a1dc-4444-a629-69761c7373a9` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: `67eb167` contains the verified run diff plus out-of-scope warning-suppression changes

> Thirty-first campaign, thirtieth first-attempt SUCCESS. The F-11-closed shape
> held for a **tenth** straight run: one productive step emitted
> `CHIKORY_TASK_COMPLETE`, the judge fired on that step (`components over time:
> s0 j@0`), SUCCESS sealed, and there was no empty-diff probe. The delivered
> run diff is exactly the WP-207 pure helper slice: `decideContextWindowPacing`
> plus local types and focused tests, no runtime wiring. Human review did find
> one new process finding, **F-31**: the committed `HEAD` mixed that clean,
> judge-verified three-file run diff with five unrelated runtime-warning edits
> that the judge never reviewed.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` != executor `codex`/openai).

```text
run run-c4aa79d3-a1dc-4444-a629-69761c7373a9 · SUCCESS · 1 steps · $0.55 / $5.00 · 3m 19s · executor codex(openai) · judge openai-compat
 1   Implemented WP-207 pure context-win…  375k/4.5k  $0.51  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.03, 6.1%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

**One step. No probe.** The phase-0 evidence pack independently confirms:
`probe step: none detected (no empty-diff step) — F-11 did not recur this run`.

## Delivery quality (human review, post-landing)

The run's own diff matches the spec line by line:

- **`packages/sdk-ts/src/runner/pacing.ts`** (NEW) — named exports only; local
  `ContextWindowUsage`, `ContextWindowPacingPolicy`, and
  `ContextWindowPacingDecision` interfaces; pure
  `decideContextWindowPacing(usage, policy)` returning `continue`, `compact`, or
  `park`. Math matches the goal: `projectedTokens`, `remainingTokens`, and
  `utilization` are computed directly from the inputs; an estimated next step
  larger than the whole context parks; projected use strictly above
  `contextWindowTokens * compactAtFraction` compacts; exactly-at-threshold
  continues.
- **`packages/sdk-ts/src/index.ts`** — one barrel re-export block for the helper
  and three local types beside the other runner pure helpers.
- **`packages/sdk-ts/test/runner/pacing.test.ts`** (NEW, 5 tests) — covers under
  threshold, exactly-at-threshold, above-threshold compaction, oversized next
  step parking, and input non-mutation.

Scope discipline held inside the run workspace: no `types.ts`, schema,
TaskSpec, workflow/agent-loop, activities, journal-format, router, judge,
executor-prompt, compaction-wiring, dependency, filesystem, network, clock, or
randomness change. The run transcript shows two harmless verification-command
misfires inside the same productive step (repo-relative Vitest paths while
running from `packages/sdk-ts`), then the executor corrected to package-relative
paths and finished with only the three requested paths changed.

Independent verification against the working tree: AC-1 pacing test **5 passed**
· AC-2 neighboring runner helper tests **16 passed** · AC-3 `tsc --noEmit &&
tsc --noEmit -p tsconfig.test.json` plus `eslint .` clean. The judge-executed
checks all exited 0, and the rubric correctly read the run diff as additions
only, no secrets, and exactly the requested scope.

The post-run landing scope did **not** hold. `git show --stat HEAD` for
`67eb167` contains eight files:

```text
packages/sdk-ts/src/cli/bin.ts
packages/sdk-ts/src/index.ts
packages/sdk-ts/src/runner/pacing.ts
packages/sdk-ts/src/runner/worker.ts
packages/sdk-ts/test/runner/pacing.test.ts
packages/smoke/src/run-smoke.ts
scripts/dogfood.sh
scripts/smoke.sh
```

Only the three `pacing`/`index` paths came from the run artifact
(`782c152…`, 5714 bytes). The other five paths suppress SQLite/Temporal runtime
warning noise and redirect Temporal dev-server output. Those may be useful
changes, but they were outside dogfood-031's goal, outside the judge's evidence,
and outside the run's acceptance checks.

## New friction

**F-31 — the verified run diff can still be committed with unrelated manual
changes.** Evidence: the phase-0 verifier reported the run diff as clean and the
working tree as clean, because it only re-runs checks and byte-diffs currently
changed files against the run workspace. It did not compare the actual landed
commit to the run workspace diff. `git log --grep
run-c4aa79d3-a1dc-4444-a629-69761c7373a9` found no run-linked harvest commit,
while `HEAD` (`67eb167`) contains the three verified run files plus five
unrelated warning-suppression files. This is the same audit-trail class as
F-13, but at the post-review/manual-commit boundary rather than the old harvest
tool.

→ **WP-231**: add a dogfood landing-scope audit. The mechanical verifier should
compare the run workspace diff (`chikory-base..HEAD` inside
`.chikory/runs/<run-id>/workspace`) with the landed commit being reviewed
(`git log --grep <run-id>` when available, or an explicit commit/HEAD fallback)
and flag extra paths, missing paths, and file-content divergence. Until that
lands, reviewers must manually compare `git -C .chikory/runs/<run-id>/workspace
diff --name-status chikory-base..HEAD` with `git show --name-status <landed>`.

Other anomaly checks:

- **Wasted steps**: zero Chikory steps wasted — one productive step, no probe.
  The verification-command correction stayed inside the productive step.
- **Cost telemetry**: $0.5134 step + $0.0331 judge = $0.5465 exact sum; budget
  used 11.0 %, judge share 6.1 %. No blind-meter warning.
- **Token economics**: step 1 = **375k input / 4.5k output** for a 5714-byte
  run diff across 20 tool calls. Adjacent one-step pure-slice series:
  021 862k -> 022 969k -> 023 451k -> 024 976k -> 025 467k -> 026 807k ->
  027 527k -> 028 410k -> 029 462k -> 030 434k -> **031 375k**. This is the new
  low, but still hundreds of thousands of input tokens for a tiny pure diff;
  WP-207's runtime integration remains a real lever.
- **Judge behavior**: one true-positive PROCEED. The judge accurately graded
  the run artifact but had no visibility into the later contaminated commit,
  which is exactly why F-31 needs a landing-scope audit.
- **Human ceremony**: launched once; **F-30 did not recur**. The manual commit
  boundary, not duplicate launch, is the new process gap.
- **Loop integrity**: one checkpoint (`run-c4aa79d3…@3`, commit `98547368ddbd`,
  `lastGood true`), no duplicate journal entries, no resume or re-execution.

## Verdict on the thesis

- **The engine delivered the pure WP-207 slice cleanly.** The deterministic
  window-fit decision now exists as a small, unit-tested runner helper ahead of
  any runtime wiring. It is the right "math first, side effects later" shape for
  FA-3/SE-2.
- **The F-11 completion-probe fix is stable.** Ten consecutive runs
  (022-031) sealed SUCCESS in one productive step with no trailing empty-diff
  probe.
- **The product gap moved to landing forensics.** The judge did its job on the
  evidence it was given. The human/manual commit path then changed the audited
  artifact. That is a control-plane issue: if Chikory is going to be trusted as
  the audit trail, the verifier must make "what ran" versus "what landed"
  mechanically visible.

Next: dogfood-032 should take **WP-231**, a small landing-scope audit for the
dogfood verifier, before returning to WP-207's non-pure runner integration.
