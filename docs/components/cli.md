# Component: CLI

**Phase**: P1 (lane M5) · **WPs**: WP-141, WP-142, WP-144, WP-212 (P2) · **Requirements**: IF-4, OB-1, OB-5, OB-6, DX-4
**Code**: `packages/sdk-ts/src/cli/` (bin: `chikory`)

## Purpose

The primary user surface for Stage 1. Everything the SDK can do must be reachable from the CLI; the Stage 2 web trace browser is a re-skin of the same journal data, not a new capability.

## Commands (WP-141)

| Command | Does |
|---|---|
| `chikory run <task.yaml> [--watch]` | Validate TaskSpec, start run, print run-id; `--watch` streams journal entries live |
| `chikory resume <run-id> [--add-budget <usd>]` | Continue from last checkpoint; optional budget top-up |
| `chikory status [<run-id>]` | Live state via Temporal query: current step, spend vs budget, last verdict, checkpoints; no arg = list runs |
| `chikory approve <run-id> [--reject "<reason>"]` | Answer an ESCALATE |
| `chikory cancel <run-id>` | Graceful stop at next step boundary, final checkpoint written |
| `chikory trace <run-id> [--json] [--step <n>]` | Trajectory forensics (below) |
| `chikory inject <run-id> "<guidance>"` | (P2, WP-212) journaled mid-run correction |
| `chikory branch <run-id>@<step>` | (P2, WP-205) fork a run from a checkpoint |

Conventions: exit code 0/1 mirrors SUCCESS/FAILED; `--json` on every command for scripting; errors actionable ("missing GEMINI_API_KEY — judge stage routes to gemini").

## Trajectory renderer (WP-142) — exit-gate #5

`chikory trace` renders the journal so a person who didn't run the task can reconstruct it:

```
run 7f3a · SUCCESS · 42 steps · $11.30 / $20.00 · 2h 14m · executor claude-code(anthropic) · judge gemini
─────────────────────────────────────────────────────────────────────────────
 #  step                              tokens(in/out)   cost    verdict
 1  scaffold blob store interface       12k/3.1k       $0.21
 2  implement LocalFsStore              18k/5.2k       $0.34
 3  add ref-resolution + tests          22k/4.8k       $0.39   ✓ PROCEED (4/4 criteria)
 …
 9  wire into StepRecord                31k/6.0k       $0.55   ⟲ ROLLBACK → ckpt#6
        judge: "transcriptRef writes bypass the store API; test for ref
        round-trip deleted rather than fixed"
 …
totals: decisions 42 · judge passes 14 ($1.71, 15.1%) · rollbacks 1 · escalations 0
        injections 0 · feedback frequency 1/3 steps · components produced 3
```

Per-step drill-down (`--step 9`): full diff ref, test output, judge form (per-criterion booleans + rationales), transcript pointer. `--json` emits the raw journal for tooling (and is the P3 benchmark/dataset interchange format). Process metrics line (OB-6, SE-3) grows in WP-209.

## Quickstart (WP-144)

`README` path: install devbox → `devbox shell` (pulls pinned toolchain incl. temporal-cli) → `devbox run temporal-dev` → export 2 provider keys → `chikory run examples/fix-failing-test.yaml` → first gated run in <10 minutes on a clean machine where devbox is the only prerequisite (measured, not aspirational). Two examples ship: a greenfield toy and a brownfield fix-on-real-repo.
