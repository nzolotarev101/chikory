# Dogfood-035 — WP-201: Python branch-target parity (SUCCESS in ONE step; no new friction; series-low input tokens)

**WP**: WP-201 (Python-SDK parity, branch-target pure helpers) · **Date**: 2026-06-19 · **Task spec**: [`examples/dogfood/dogfood-035.yaml`](../../examples/dogfood/dogfood-035.yaml) · **Run**: `run-b0bc3865-e70e-4d26-be7e-13a757808d3b` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested byte-`IDENTICAL`, committed `88e496c` on `main` (landing-scope **MATCH**)

> Thirty-fifth campaign, thirty-fourth first-attempt SUCCESS. The Python parity
> of the WP-205 pure branch-target surface that landed in the TS SDK across
> dogfood-033 (`parseBranchTarget`) and dogfood-034 (`branchNameForTarget`):
> `parse_branch_target` + `branch_name_for_target` in a new
> `packages/sdk-py/src/chikory/branch_target.py`, mirroring the source-of-truth
> module `packages/sdk-ts/src/cli/branch-target.ts` behavior-for-behavior. The
> dogfood-030 dual-SDK parity pattern — no contract change, no CLI command, no
> git/worktree side effect.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held (executor `openai`,
judge `gemini-3.1-pro-preview`).

```text
run run-b0bc3865-e70e-4d26-be7e-13a757808d3b · SUCCESS · 1 steps · $0.44 / $5.00 · 2m 24s · executor codex(openai) · judge openai-compat
 1   Implemented the WP-205/WP-201 Pytho…  318k/4.0k  $0.44  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.7%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

There was no empty-diff probe step. The productive step emitted the completion
marker, the judge fired on that step, and SUCCESS sealed at
`components over time: s0 j@0` — the F-11-closed shape, held for a **twelfth**
straight one-step run (the spec predicted exactly this).

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's exact three-file scope (139 insertions,
no deletions, no other file touched):

- **`packages/sdk-py/src/chikory/branch_target.py`** (new) — a frozen
  `@dataclass BranchTarget` (`run_id: str`, `step: int | Literal["base"]`,
  `checkpoint_id: str`, the Python parity of the TS interface, kept local — not
  added to `types.py`), `parse_branch_target(value)`, and
  `branch_name_for_target(target)`. Re-derived against the TS source-of-truth
  line by line:
  - `parse_branch_target` splits on `@`, requires exactly one separator
    (`len(parts) != 2`), rejects an empty run id, rejects an empty step, accepts
    the literal `base`, and for numeric steps validates with `re.fullmatch(r"[0-9]+")`
    then `int()` + range check `step <= 0 or step > MAX_SAFE_INTEGER`. The
    `MAX_SAFE_INTEGER = 9_007_199_254_740_991` constant is the deliberate parity
    of the TS `Number.isSafeInteger` guard (correct: Python ints don't overflow,
    so the port keeps the cross-SDK contract identical rather than silently
    accepting larger steps). Leading-zero canonicalization is inherited from
    `int()` (`"run-205@007"` → `step=7`, `checkpoint_id="run-205@7"`).
  - The error message shape is byte-identical to TS:
    `f"Invalid branch target '{value}': {detail}. Expected <run-id>@<step|base>."`,
    raised as `ValueError` (the SDK validation-error convention, the parity of
    the TS thrown `Error`). All four detail strings match the TS verbatim.
  - `branch_name_for_target` sanitizes with `re.sub(r"[^A-Za-z0-9._-]+", "-", …).strip("-")`
    (the parity of the TS `replace(/[^…]+/g,"-").replace(/^-+|-+$/g,"")`), raises
    on an empty sanitized run id keyed on `target.checkpoint_id`, and returns
    `branch-<sanitized>-step-<n>` / `branch-<sanitized>-base`. Pure and
    deterministic, no I/O, no mutation.
- **`packages/sdk-py/src/chikory/__init__.py`** — re-exports the three symbols
  from `.branch_target` and adds them to `__all__`, following the existing
  convention; nothing else changed.
- **`packages/sdk-py/tests/test_branch_target.py`** (new) — 16 cases (8
  parametrized rejections + 8 functions): numeric/base parse, leading-zero
  canonicalization, the full rejection matrix (missing/multiple `@`, empty run
  id, empty step, zero, negative, decimal, non-numeric), the three name forms,
  path/space/punctuation sanitization (`team/run 205!*@3` →
  `branch-team-run-205-step-3`), and the empty-sanitized-run-id rejection
  (`!/@1`). Each was re-derived by hand against the implementation and matches.

`types.py` / contract models were not touched (confirmed by `git show --stat`),
honoring the spec's hard "no contract change" constraint.

Independent checks from the phase-0 verifier, re-run against the working tree:

```text
AC-1 cd packages/sdk-py && uv sync --quiet && uv run pytest tests/test_branch_target.py -q  PASS (16 passed)
AC-2 cd packages/sdk-py && uv run pytest -q                                                 PASS (67 passed)
AC-3 cd packages/sdk-py && uv run pyright && ruff check . && ruff format --check .          PASS (0 errors, clean)
```

Harvest integrity held: all three changed files are byte-`IDENTICAL` to the run
workspace, and `scripts/dogfood-landed-scope.sh` reports **MATCH** between the
run's diff (`base e8f693d → run-head 9ff1b712`) and the landed commit
`88e496c` — so unlike dogfood-031's F-31 incident, the committed `HEAD` carries
*only* the verified run diff, no unrelated manual edits. This is the first
branch-target-series run committed to `HEAD` (033/034 were staged uncommitted);
the landing-scope audit (WP-231/dogfood-032) confirmed it clean.

## New friction

No new friction numbers. Highest existing remains **F-31** (dogfood-031, closed
by WP-231/dogfood-032).

Other anomaly checks:

- **Wasted steps**: none. One productive step, no trailing probe. F-11 stays
  closed for a twelfth straight one-step run.
- **Cost telemetry**: exact sum $0.4447; budget used 8.8 %; judge share 1.7 %
  ($0.0074). Metering nonzero and consistent with the pricing table; no `.00`
  with nonzero tokens.
- **Token economics**: step 1 used **318k input / 4.0k output** for a 5504-byte
  three-file diff — a **new series low**, just under dogfood-033's 327k. The
  one-step pure-slice series now reads 021 862k → 022 969k → 023 451k →
  024 976k → 025 467k → 026 807k → 027 527k → 028 410k → 029 462k → 030 434k →
  031 375k → 033 327k → 034 594k → **035 318k** (032 excluded — a 2-step run).
  Still a sawtooth, tracking neither diff size nor run order; per-step input
  cost remains *noisy, not monotonic*. WP-203/WP-207 stay queued as the
  variance/ceiling lever, not a runaway-trend fix.
- **Judge behavior**: the judge executed all three check commands (AC-1 pytest
  on the new file, AC-2 the full suite, AC-3 pyright + ruff lint + format),
  each exited 0, and correctly PROCEEDed. Rubric (`tests_pass`,
  `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`)
  all passed with sane justifications ("Exactly three files were
  modified/added… focusing entirely on the pure branch-target helpers"). Family
  diversity real (Gemini judge ≠ OpenAI executor).
- **Human ceremony**: standard single launch + watch-to-terminal (F-30 did not
  recur). No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-b0bc3865@3`, commit `9ff1b712`,
  `lastGood true`), no rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- **The WP-205 pure branch-target surface now exists in BOTH SDKs.** The Python
  parity (`parse_branch_target` + `branch_name_for_target`) mirrors the TS
  source-of-truth symbol-for-symbol and behavior-for-behavior — the
  vendor-neutral dual-SDK invariant WP-201 requires, the dogfood-030 pattern
  repeated cleanly. What remains in WP-205 — the `chikory branch` CLI command,
  the journal fork, the git worktree creation — is non-pure hand-design
  (TASK-PROTOCOL §4), the architect's move, not a dogfood run.
- **The F-11 fix remains stable.** Dogfood-035 is the twelfth straight
  one-step, marker-triggered SUCCESS with no empty-diff probe.
- **The F-31 landing-scope audit earns its keep.** With the run diff committed
  straight to `HEAD`, the `dogfood-landed-scope.sh` MATCH is the proof that the
  green is the verified green — no manual contamination rode along.
- **No process finding emerged.** The standing dogfoodable thread stays dual-SDK
  parity: next is the Memory Pointer pure surface (dogfood-036) — port
  `shouldPointerize` + `formatPointerReference` (the TS `runner/memory-pointer.ts`
  from dogfood-028) to the Python SDK, the same parity pattern, no contract
  change. The keystone after that is the hand-design S3 durable chain executor,
  whose dogfoodable pure slice (the chain-state reducer) needs the ADR-005 D3/D4
  transition rules written by hand first.
