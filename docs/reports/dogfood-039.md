# Dogfood-039 — WP-201 dual-SDK parity: the Python chain-state reducer (SUCCESS in ONE step; no new friction; sixteenth straight probe-free run)

**WP**: WP-201 (Thin Python SDK / IF-2) · **Date**: 2026-06-20 · **Task spec**: [`examples/dogfood/dogfood-039.yaml`](../../examples/dogfood/dogfood-039.yaml) · **Run**: `run-6bb8ac7e-3f4c-4421-aa1c-d777a33070ba` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) · **Landed**: harvested byte-`IDENTICAL`, uncommitted/staged on the working tree (pending the user's review)

> Thirty-ninth campaign, thirty-eighth first-attempt SUCCESS (dogfood-017 the
> lone FAILED). The dual-SDK parity thread resumes now that the TS WP-219
> chain-executor pure surface is exhausted (dogfood-037/038): a 1:1 Python port
> of the dogfood-038 chain-state reducer. `advance_chain` + `derive_chain_status`
> in a new `packages/sdk-py/src/chikory/chain_advance.py`, mirroring the TS
> `src/chain/advance.ts` source-of-truth symbol-for-symbol — the four-rule
> ADR-005 §S3 precedence + the pure immutable node-fold. The
> `ChainRecord`/`NodeOutcome`/`ChainStatus` contracts already landed in
> `chikory/types.py`, so **no contract change** — the dogfood-035/036 parity
> pattern.

## The run

Zero-secrets setup unchanged: Codex executor (OpenAI family) + Gemini judge
behind the OpenAI-compatible shim. Family diversity held (executor `openai`
via `gpt-5.5`, judge `gemini-3.1-pro-preview` through `openai-compat`) — the
bias-mitigation invariant is real at the *model-family* level even though both
route through the keyless shim.

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS |
| Steps | **1** (no empty-diff probe — F-11 stays closed, `s0 j@0`) |
| Judge passes | 1 · ✓ PROCEED (3/3 criteria) · 0 rollbacks · 0 escalations |
| Total cost | **$1.0358** (steps + judge) / $5.00 budget — **20.8%** used |
| Judge cost-share | $0.0088 (**0.8%**) |
| Step-1 tokens | **755k in / 8.3k out** · 35 tool calls · 3m 22s |
| Judge tokens/time | 6.7 KB evidence · 9s |
| Duration | 3m 32s |
| Checkpoint | `run-6bb8ac7e@3` · commit `8bab2b016687` · `lastGood true` |

### Trace

```
run run-6bb8ac7e · SUCCESS · 1 steps · $1.04 / $5.00 · 3m 32s · executor codex(openai) · judge openai-compat
 1   Implemented the WP-219 S3 Python re…  755k/8.3k  $1.03  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.8%) · rollbacks 0 · checkpoints 1 · changes 1
```

## Delivery quality (human review, post-landing)

Reviewed line-by-line against the TS source-of-truth (`packages/sdk-ts/src/chain/advance.ts`) and the spec goal. 🟢 **Byte-faithful behavioral parity.**

- **`derive_chain_status`** — mirrors the four-rule, first-match-wins precedence exactly: ESCALATE→`AWAITING_PLAN_APPROVAL` (rule 1) outranks FAILED→`FAILED` (rule 2), then all-nodes-SUCCESS→`SUCCESS` (rule 3, via `record.node_outcomes.get(node.id)` with a `None` guard — the empty-`plan.nodes` case folds to `SUCCESS` exactly as TS `[].every(...)`), else `RUNNING` (rule 4). The walrus `(outcome := record.node_outcomes.get(node.id)) is not None and outcome.status == "SUCCESS"` is the faithful Python of the TS optional-chain `record.nodeOutcomes[node.id]?.status === "SUCCESS"`.
- **`advance_chain`** — the pure immutable fold: `record.model_copy(update={"node_outcomes": {**record.node_outcomes, node_id: outcome}})` then a second `model_copy` setting `status = derive_chain_status(next_record)`. Input record + nested dict left untouched; returns a fresh object. Matches the TS spread-then-recompute exactly.
- **`__init__.py`** — re-export added alphabetically (`from .chain_advance import advance_chain, derive_chain_status`), both names inserted into `__all__` keeping sort order. Nothing else changed.
- **Test** — `test_chain_advance.py` mirrors the TS `test/chain/advance.test.ts` builder shape 1:1 (same `plan-219` id, same `N-1→N-2→N-3` chain, same dates). Six cases cover all four rules + the ESCALATE-outranks-FAILED precedence + the fold (folded outcome present, recomputed status, input unchanged, distinct object). All spec-required assertions present.
- **Scope discipline** 🟢 — exactly 3 files (`chain_advance.py` new, `test_chain_advance.py` new, `__init__.py` edited). No `types.py`/contract touch, no new dependency. `git status --short` matches the goal precisely; harvest byte-diff **IDENTICAL** on all three.

### Independent verification (pack §3, re-run against the working tree)

| AC | Check | Result |
|---|---|---|
| AC-1 | `uv sync && uv run pytest tests/test_chain_advance.py -q` | 🟢 **PASS** — 6 passed in 0.06s |
| AC-2 | `uv run pytest -q` (full py suite) | 🟢 **PASS** — 80 passed in 0.09s |
| AC-3 | `uv run pyright && ruff check . && ruff format --check .` | 🟢 **PASS** — 0 errors, all checks pass, 15 files formatted |

Judge-executed (inside the run workspace): all 3 AC exited 0; rubric `tests_pass` / `no_unrelated_deletions` / `no_secrets_introduced` / `scope_matches_instruction` all ✓ with sane justifications.

## Anomaly hunt

- **Probe step**: none. Sixteenth straight one-step no-probe SUCCESS (`s0 j@0`). F-11 stays closed.
- **Cost telemetry**: $1.0358 total on nonzero tokens — `gpt-5.5` and `gemini-3.1-pro-preview` both priced (no `UNPRICED`/`$0.00` blind-meter, F-9 not recurring).
- **Judge behavior**: 3 judge-executed checks each `exited 0`; PROCEED with no escalation; family diversity real (shim backend `gemini` ≠ executor `openai`).
- **Loop integrity**: 1 checkpoint, `lastGood true`, no resume, no duplicate journal entries, no re-executed steps.
- **Token economics** ℹ️: **755k input tokens** for a ~45-line, 3-file port — the **highest in the Python-parity series** (035 318k → 036 398k → 039 755k) and high-mid for the whole one-step pure-slice series. Diff is one of the smallest delivered (6354 bytes incl. tests). Reconfirms the standing finding: per-step input cost is **noisy, not monotonic** — it tracks neither diff size nor run order. Baseline data for WP-203 (compaction) / WP-207 (pacing), the input-side ceiling levers. **Not new friction.**
- 🟡 **Cosmetic code-quality nit (NOT friction, no WP):** `chain_advance.py` reassigns `outcomes = record.node_outcomes.values()` twice (once at the top of `derive_chain_status`, again redundantly before the FAILED check) — the second line is dead (the view is reusable). Behavior-identical; `ruff`/`pyright` clean (sub-lint-level). The judge cannot catch it and no process change would; flagged for the user's optional one-line cleanup, left in place to preserve the run's audit-trail artifact.

## New friction

**None.** Highest friction id stays **F-31**. Clean one-step SUCCESS, full scope discipline, byte-faithful parity, F-11/F-30 did not recur.

## Verdict on the thesis

🟢 The dual-SDK parity wedge holds one module deeper into the WP-219 chain
executor: the chain-state reducer — the logic the durable chain executor folds
each sealed node through — now has byte-faithful Python parity, so the
vendor-neutral dual-SDK launch requirement (IF-2) advances without any contract
drift. The keyless Codex-executor + Gemini-judge loop sealed it in one step at
20.8% of budget with the judge spending 0.8% — the Agent-as-a-Judge inner loop
executed the real `pytest`/`pyright`/`ruff` checks (not text grading) and
PROCEED'd on green. The lone watch-item remains input-token volume (755k), the
input-side cost lever WP-203/WP-207 will address.
