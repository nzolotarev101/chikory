# Dogfood-036 — WP-201: Python Memory Pointer parity (SUCCESS in ONE step; no new friction; thirteenth straight probe-free run)

**WP**: WP-201 (Python-SDK parity, Memory Pointer pure helpers) · **Date**: 2026-06-19 · **Task spec**: [`examples/dogfood/dogfood-036.yaml`](../../examples/dogfood/dogfood-036.yaml) · **Run**: `run-51645fbb-eee1-41a2-92c6-a4edfff7fafa` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested byte-`IDENTICAL`, uncommitted on the working tree (pending the user's review)

> Thirty-sixth campaign, thirty-fifth first-attempt SUCCESS (dogfood-017 the lone
> FAILED). The Python parity of the WP-202 / CM-3 pure Memory Pointer surface
> that landed in the TS SDK in dogfood-028
> (`packages/sdk-ts/src/runner/memory-pointer.ts`): a local frozen
> `MemoryPointerPolicy` dataclass + `should_pointerize` + `format_pointer_reference`
> in a new `packages/sdk-py/src/chikory/memory_pointer.py`, mirroring the
> source-of-truth TS module behavior-for-behavior. The dogfood-030/035 dual-SDK
> parity pattern — no contract change, no runtime wiring, `ArtifactRef` reused
> from the already-ported `chikory/types.py:197`.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held (executor `openai`,
judge `gemini-3.1-pro-preview`).

```text
run run-51645fbb-eee1-41a2-92c6-a4edfff7fafa · SUCCESS · 1 steps · $0.53 / $5.00 · 2m 6s · executor codex(openai) · judge openai-compat
 1   Implemented the Python WP-202 / CM-…  398k/3.2k  $0.53  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.1%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

There was no empty-diff probe step. The productive step emitted the completion
marker, the judge fired on that step, and SUCCESS sealed at
`components over time: s0 j@0` — the F-11-closed shape, held for a **thirteenth**
straight one-step run (the spec predicted exactly this).

## Delivery quality (human review, post-landing)

The delivered diff matches the spec's exact three-file scope (3737-byte diff,
additions only, no other file touched):

- **`packages/sdk-py/src/chikory/memory_pointer.py`** (new) — re-derived against
  the TS source-of-truth (`packages/sdk-ts/src/runner/memory-pointer.ts`)
  line by line:
  - `@dataclass(frozen=True) MemoryPointerPolicy` with the single field
    `max_inline_bytes: int` — the Python parity of the TS `MemoryPointerPolicy`
    interface, kept **local** to the module (not added to `types.py`), honoring
    the spec's hard "no contract change" constraint.
  - `should_pointerize(num_bytes, policy) -> bool` returns
    `num_bytes > policy.max_inline_bytes` — byte-for-byte the TS
    `shouldPointerize` (`bytes > policy.maxInlineBytes`), strict `>` so
    exactly-at-threshold outputs inline.
  - `format_pointer_reference(ref) -> str` returns
    `f"[memory {ref.kind} {ref.id[:12]}] {ref.bytes}B — {ref.summary}"` —
    **byte-identical** to the TS template literal
    (`` `[memory ${ref.kind} ${ref.id.slice(0, 12)}] ${ref.bytes}B — ${ref.summary}` ``),
    including the 12-char id truncation and the em dash (`—`, U+2014) between the
    byte count and the summary. `ArtifactRef` is imported from `.types` (reusing
    the already-ported contract model — not redefined). Pure, deterministic, no
    I/O, no mutation; each export docstrings WP-202 / CM-3 / WP-201.
- **`packages/sdk-py/src/chikory/__init__.py`** — re-exports the three symbols
  from `.memory_pointer` and adds them to `__all__`, following the existing
  convention; nothing else changed (`git status --short` shows the file `M`,
  the two new files `A`).
- **`packages/sdk-py/tests/test_memory_pointer.py`** (new) — 5 cases covering
  every assertion the spec named, each re-derived by hand: predicate above
  threshold (1025/2048 → True), boundary (1024 → False exactly-at-threshold
  inlines, 0 → False), reference render with 12-char truncation
  (`abcdef0123456789` → `abcdef012345`, em dash before the summary), short-id
  no-op (`abc123` rendered unchanged), and kind interpolated verbatim
  (`kind="diff"` → `[memory diff …]`).

`types.py` / contract models were not touched — confirmed by the phase-0
scope check (only `__init__.py` `M`, the two new files `A`).

Independent checks from the phase-0 verifier, re-run against the working tree:

```text
AC-1 cd packages/sdk-py && uv sync --quiet && uv run pytest tests/test_memory_pointer.py -q  PASS (5 passed)
AC-2 cd packages/sdk-py && uv run pytest -q                                                  PASS (72 passed)
AC-3 cd packages/sdk-py && uv run pyright && ruff check . && ruff format --check .           PASS (0 errors, clean)
```

Harvest integrity held: all three changed files are byte-`IDENTICAL` to the run
workspace (phase-0 §5). The diff is uncommitted on the working tree, left for
the user's review per the skill default; when committed, run
`scripts/dogfood-landed-scope.sh` to confirm the landing-scope MATCH (the F-31
guard, WP-231/dogfood-032).

## New friction

No new friction numbers. Highest existing remains **F-31** (dogfood-031, closed
by WP-231/dogfood-032).

Other anomaly checks:

- **Wasted steps**: none. One productive step, no trailing probe. F-11 stays
  closed for a thirteenth straight one-step run.
- **Cost telemetry**: exact sum $0.5349; budget used 10.6 %; judge share 1.1 %
  ($0.0061). Metering nonzero and consistent with the pricing table; no `.00`
  with nonzero tokens.
- **Token economics**: step 1 used **398k input / 3.2k output** for a 3737-byte
  three-file diff. The one-step pure-slice series now reads 021 862k →
  022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k → 028 410k →
  029 462k → 030 434k → 031 375k → 033 327k → 034 594k → 035 318k → **036 398k**
  (032 excluded — a 2-step run). Still a sawtooth, tracking neither diff size
  nor run order; per-step input cost remains *noisy, not monotonic*. WP-203/
  WP-207 stay queued as the variance/ceiling lever, not a runaway-trend fix.
- **Judge behavior**: the judge executed all three check commands (AC-1 pytest
  on the new file, AC-2 the full suite, AC-3 pyright + ruff lint + format),
  each exited 0, and correctly PROCEEDed. Rubric (`tests_pass`,
  `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`)
  all passed with sane justifications ("changes are limited to exactly the three
  specified files and implement exactly the pure parity memory pointer interface
  and unit tests requested"). Family diversity real (Gemini judge ≠ OpenAI
  executor).
- **Human ceremony**: standard single launch + watch-to-terminal (F-30 did not
  recur). No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-51645fbb@3`, commit `3b336f57e22f`,
  `lastGood true`), no rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- **The WP-202 / CM-3 Memory Pointer pure surface now exists in BOTH SDKs.** The
  Python parity (`should_pointerize` + `format_pointer_reference` +
  `MemoryPointerPolicy`) mirrors the TS source-of-truth symbol-for-symbol and
  byte-for-byte — the vendor-neutral dual-SDK invariant WP-201 requires, the
  dogfood-030/035 pattern repeated cleanly. What remains in WP-202 — the non-pure
  interception (`store.put` on a large tool output → inject
  `format_pointer_reference(ref)`) — is hand-design (TASK-PROTOCOL §4), already
  landed in the TS runtime on `main`; the Python runtime client parity is
  deferred until something needs it.
- **The F-11 fix remains stable.** Dogfood-036 is the thirteenth straight
  one-step, marker-triggered SUCCESS with no empty-diff probe.
- **No process finding emerged.** The standing dogfoodable thread stays dual-SDK
  parity: next is the WP-207 context-window pacing pure surface (dogfood-037) —
  port `decideContextWindowPacing` (the TS `runner/pacing.ts` landed in
  dogfood-031) to the Python SDK as `decide_context_window_pacing`, the same
  parity pattern, no contract change. The keystone after the parity thread
  remains the hand-design S3 durable chain executor, whose dogfoodable pure slice
  (the chain-state reducer) needs the ADR-005 D3/D4 transition rules written by
  hand first.
