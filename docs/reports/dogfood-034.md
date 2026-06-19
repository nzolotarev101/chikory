# Dogfood-034 — WP-205: pure default branch-name helper (SUCCESS in ONE step; no new friction)

**WP**: WP-205 (branching & rollback, pure default branch-name helper slice) · **Date**: 2026-06-18 · **Task spec**: [`examples/dogfood/dogfood-034.yaml`](../../examples/dogfood/dogfood-034.yaml) · **Run**: `run-1634171d-e4eb-4efb-9851-a826183a7fb6` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, staged uncommitted on `main`

> Thirty-fourth campaign, thirty-third first-attempt SUCCESS. WP-205's second
> pure helper: `branchNameForTarget(target)`, which derives the default git
> branch name (`branch-<sanitized-run-id>-step-<n>` / `branch-<…>-base`) the
> eventual `chikory branch <run-id>@<step>` command will use — still no CLI
> command, workflow fork, or git worktree side effect.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held (executor `openai`,
judge `gemini-3.1-pro-preview`).

```text
run run-1634171d-e4eb-4efb-9851-a826183a7fb6 · SUCCESS · 1 steps · $0.82 / $5.00 · 4m 25s · executor codex(openai) · judge openai-compat
 1   Implemented the pure `branchNameFor…  594k/4.5k  $0.79  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.03, 3.7%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

There was no empty-diff probe step. The productive step emitted the completion
marker, the judge fired on that step, and SUCCESS sealed at
`components over time: s0 j@0` — the F-11-closed shape, held for an **eleventh**
straight one-step run.

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's two-file scope (additive only — both files
already existed from dogfood-033):

- **`packages/sdk-ts/src/cli/branch-target.ts`** gains the named export
  `branchNameForTarget(target: BranchTarget): string`. It sanitizes the run id
  by collapsing each run of characters outside `[A-Za-z0-9._-]` to `-`
  (`/[^A-Za-z0-9._-]+/g`) then trimming leading/trailing `-`
  (`/^-+|-+$/g`); throws (reusing the module's `branchTargetError`, keyed on
  `target.checkpointId`) when sanitization leaves an empty run-id segment; and
  returns `branch-<sanitizedRunId>-step-<n>` for numeric steps,
  `branch-<sanitizedRunId>-base` for `base`. Pure and deterministic, no I/O.
- **`packages/sdk-ts/test/cli/branch-target.test.ts`** adds a
  `branchNameForTarget` describe block (5 assertions): numeric-step name,
  base name, canonical numeric name after a leading-zero parse
  (`run-205@007` → `branch-run-205-step-7`), sanitization of path/space/
  punctuation (`team/run 205!*@3` → `branch-team-run-205-step-3`), and rejection
  when the run id sanitizes to empty (`!/@1`).

Each test case was re-derived by hand against the implementation and matches.
The helper composes on top of `parseBranchTarget` (it takes the parsed
`BranchTarget`, not raw input), so step canonicalization is inherited rather
than duplicated — correct layering.

Independent checks from the phase-0 verifier:

```text
AC-1 pnpm --filter @chikory/sdk exec vitest run test/cli/branch-target.test.ts  PASS (15 tests)
AC-2 pnpm --filter @chikory/sdk typecheck                                       PASS
AC-3 pure name-helper scope only                                                PASS
```

Harvest integrity held: both changed files are byte-`IDENTICAL` to the run
workspace. There is no landed commit yet; the files are staged in the working
tree on `main` for review, on top of dogfood-033's HEAD (`29f357c`).

## New friction

No new friction numbers. Highest existing remains **F-31** (dogfood-031,
closed by WP-231/dogfood-032).

Other anomaly checks:

- **Wasted steps**: none. One productive step, no trailing probe.
- **Cost telemetry**: exact sum $0.8178; budget used 16.4 %; judge share
  3.7 %. Metering is nonzero and consistent with the pricing table; no `.00`
  with nonzero tokens.
- **Token economics**: step 1 used **594k input / 4.5k output** for a 2615-byte
  two-file diff — mid-band, roughly double dogfood-033's series-low 327k. The
  one-step pure-slice series now reads 021 862k → 022 969k → 023 451k →
  024 976k → 025 467k → 026 807k → 027 527k → 028 410k → 029 462k → 030 434k →
  031 375k → 033 327k → **034 594k** (032 excluded — it was a 2-step run). Still
  a sawtooth, tracking neither diff size nor run order; per-step input cost
  remains *noisy, not monotonic*. WP-203/WP-207 stay queued as the variance/
  ceiling lever, not a runaway-trend fix.
- **Judge behavior**: the judge executed both check commands (AC-1 vitest, AC-2
  typecheck, each exited 0), judged the description-only scope criterion (AC-3)
  from the diff, and correctly PROCEEDed. Rubric (`tests_pass`,
  `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`)
  all passed with sane justifications. Family diversity real (Gemini judge ≠
  OpenAI executor).
- **Human ceremony**: standard single launch + watch-to-terminal (F-30 did not
  recur). No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-1634171d@3`, `lastGood true`), no
  rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- **WP-205's pure surface is now complete.** A parsed branch target
  (dogfood-033 `parseBranchTarget`) plus its default branch name (this slice
  `branchNameForTarget`) give the eventual side-effectful `chikory branch`
  command everything pure it needs. What remains in WP-205 — the CLI command,
  the journal fork, the git worktree creation — is non-pure hand-design
  (TASK-PROTOCOL §4) and is the architect's next move, not a dogfood run.
- **The F-11 fix remains stable.** Dogfood-034 is the eleventh straight
  one-step, marker-triggered SUCCESS with no empty-diff probe.
- **No process finding emerged.** With WP-205's pure surface exhausted and the
  TS pure backlog thin, the dogfoodable thread shifts back to dual-SDK parity:
  port the branch-target pure helpers to the Python SDK (dogfood-035), the same
  pattern as dogfood-030's compaction-prompt parity.
