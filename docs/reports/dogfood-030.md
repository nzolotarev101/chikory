# Dogfood-030 — WP-201 Python parity: the pure compaction digest-prompt half (`DIGEST_SYSTEM_PROMPT` + `build_digest_messages`, clean SUCCESS in ONE step — F-11 stays closed; input tokens 434k, low band)

**WP**: WP-201 (Python-SDK parity, pure compaction digest-prompt half) · **Date**: 2026-06-17 · **Task spec**: [`examples/dogfood/dogfood-030.yaml`](../../examples/dogfood/dogfood-030.yaml) · **Run**: `run-1a97e2ca-3b0b-4d01-8afd-74ea2df8caef` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested IDENTICAL, staged uncommitted on `main`

> Thirtieth campaign, twenty-ninth first-attempt SUCCESS. The F-11-closed shape
> held for a **ninth** straight run: one productive step emits
> `CHIKORY_TASK_COMPLETE`, the judge fires on that step (`components over time:
> s0 j@0`), SUCCESS seals, and there is no empty-diff probe. This run ports the
> dogfood-029 TS compaction digest prompt into `packages/sdk-py`: a frozen
> `DIGEST_SYSTEM_PROMPT` string and pure `build_digest_messages(to_digest:
> Sequence[str]) -> list[Message]`, re-exported from `chikory`. It is exactly the
> requested Python parity slice: no `types.py`/contract change, no runner/router
> wiring, no schema, no I/O, no network, no clock, no randomness. **No new
> friction.** Cost watch-item: input tokens came in at **434k**, the low band of
> the adjacent one-step pure-slice series.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the local OpenAI-compatible shim. Family diversity held (judge
`gemini-3.1-pro-preview` != executor `codex`/openai).

```text
run run-1a97e2ca-3b0b-4d01-8afd-74ea2df8caef · SUCCESS · 1 steps · $0.62 / $5.00 · 3m 11s · executor codex(openai) · judge openai-compat
 1   Implemented the Python compaction d…  434k/4.1k  $0.58  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.04, 6.4%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

**One step. No probe.** `components over time: s0 j@0` is the
F-11-closed shape, not the old `s0 s1 j@1` empty-diff probe. The phase-0
evidence pack independently confirms: `probe step: none detected (no empty-diff
step) — F-11 did not recur this run`.

## Delivery quality (human review, post-landing)

The delivery matches the spec line by line — exactly one new source file, one
new test file, and one existing package barrel update:

- **`packages/sdk-py/src/chikory/compaction_prompt.py`** (NEW) — pure sync
  Python 3.11 module, fully typed, no `Any`, no dependency, no I/O / clock /
  randomness / mutation. `DIGEST_SYSTEM_PROMPT: str` is built as
  `"\n".join([...])` and mirrors the TS source-of-truth prompt in
  `packages/sdk-ts/src/runner/compaction-prompt.ts` line-for-line: fold older
  step summaries into one faithful prose digest, preserve decisions/file and
  symbol names/open threads, preserve oldest-to-newest causality when relevant,
  drop redundancy/transient chatter, keep concrete implementation facts,
  mention unresolved questions / failed attempts / follow-up work, and output
  prose only with no JSON/schema. `build_digest_messages(to_digest:
  Sequence[str]) -> list[Message]` returns the two-message system/user pair
  under the same `## Older step summaries to fold (oldest to newest)` header,
  numbering summaries oldest-to-newest.
- **`packages/sdk-py/src/chikory/__init__.py`** — only the two requested public
  exports were added: `DIGEST_SYSTEM_PROMPT` and `build_digest_messages`.
  Existing exports and `__all__` stayed intact.
- **`packages/sdk-py/tests/test_compaction_prompt.py`** (NEW, 4 tests) — covers
  shape, oldest-to-newest ordering plus numbering, empty input, and input
  non-mutation. Fixtures stay type-correct (`Sequence[str]` in,
  `list[Message]` out).

Scope discipline held: no `types.py` contract/schema change, no
`runner.py`/`judge.py`/`router.py` runtime behavior, no LLM/router call, no
filesystem/network work, no dependency, no response schema. The digest wiring
remains the non-pure hand-design path (router call -> digest string ->
Memory Pointer store -> `CompactionResult` journal write).

Independent verification (working tree): AC-1 the new compaction-prompt parity
test **4 passed** · AC-2 the complete Python SDK suite **51 passed** · AC-3
pyright + ruff lint + ruff format check clean. Harvest byte-diff was
**IDENTICAL** for all three changed files.

The full executor transcript shows one recoverable in-step inefficiency: the
first `devbox run lint` failed in the fresh run workspace because dependencies
were not bootstrapped yet; the executor then ran `devbox run bootstrap`, hit a
Python format delta, applied `devbox run -- ruff format packages/sdk-py`, and
reran lint/typecheck/test green. That is not new friction: no human
intervention, no extra Chikory step, no scope drift, and the final canonical
checks were green. It remains a token-cost watch item for fresh-clone ceremony.

## New friction

**None.** The anomaly checklist came back clean:

- **Wasted steps**: zero Chikory steps wasted — one productive step, no empty
  diff, no re-executed step. The bootstrap/format recovery happened inside the
  productive step and ended green.
- **Cost telemetry**: $0.5842 step + $0.0402 judge = $0.6244 exact sum;
  non-zero priced telemetry, budget used 12.4 %, judge share 6.4 %. No
  blind-meter warning.
- **Token economics**: step 1 = **434k input / 4.1k output** for a 4370-byte
  diff across 22 tool calls. Adjacent one-step pure-slice series:
  021 862k -> 022 969k -> 023 451k -> 024 976k -> 025 467k -> 026 807k ->
  027 527k -> 028 410k -> 029 462k -> **030 434k**. The read is unchanged:
  high and noisy, not monotonic; WP-207 remains the next pure lever.
- **Judge behavior**: one pass, all three judge-executed checks exited 0, and
  the rubric was accurate: scope exactly three files, no deletions, no secrets,
  no runtime wiring. Verdict true positive.
- **Human ceremony**: launched once, watched to terminal. **F-30 did not recur.**
- **Loop integrity**: one checkpoint (`run-1a97e2ca…@3`, commit
  `a5afa67d80a7`, `lastGood true`), no duplicate journal entries, no resume or
  re-execution.

## Verdict on the thesis (thirtieth data point — TS/Python prompt parity without runtime wiring)

- **Dual-SDK parity can ride the same pure-slice pattern.** The TS prompt regime
  from dogfood-029 became a Python SDK export with a small, audited diff and a
  focused conformance test. That is the right shape for WP-201: parity follows
  the frozen TS artifact and stays independent of runtime wiring until the
  contract actually needs more surface.
- **The F-11-closed loop shape is now boring, which is the win.** Nine
  consecutive runs (022-030) sealed SUCCESS on the productive step with no
  probe. The old completion tax remains retired.
- **The next dogfoodable reliability lever is WP-207.** WP-202 and WP-203's
  pure surfaces are exhausted and their non-pure wiring has been hand-designed;
  WP-219 and WP-228 likewise have non-pure remainders. The cost series still
  shows hundreds of thousands of input tokens for tiny pure diffs. The next
  pure slice is the WP-207 context-window pacing decision: a local, unit-tested
  predicate/decision module that decides when projected context use should
  continue, compact, or park before any runner wiring exists.
