# dogfood-067 — WP-256 spec-staleness gate DELIVERED, via the FIRST durable CHAIN to land real product code (spec was written single-`run`, launched as a chain)

- **WP:** WP-256 (launch-time spec-staleness gate, born from dogfood-065 F-60). The dogfood-067 spec was authored as a **single `chikory run`** (to sidestep the dogfood-066 F-62 planner bug); the operator instead launched it with **`chikory chain`**. The chain planner decomposed the 4-file goal into node-1 (`parseWpStatus` parser) → node-2 (`assessSpecStaleness` consumer, importing node-1's symbol via the WP-239 handoff). **Both nodes SUCCEEDED** — the first durable multi-node chain to land **real open-WP product code** end-to-end (dogfood-066's gap, closed).
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-067.yaml` (`dogfood-067` — goal hardened the AC-1 description to name the `WP-25` discriminator literal; that hardening is what carried the grep-pinned literal into the chain node and prevented an F-62 repeat)
- **Run-id (chain):** `chain-d18a8c1b-f681-4fe3-ba35-c38fa0f54b65` (plan `plan-c4fd3fb0-c001-452f-a548-558c6846d3de`); child runs `…-node-node-1` (parser) and `…-node-node-2` (consumer). Runtime HEAD `a4b8e7a`.
- **Landed commit:** none yet — **4 files STAGED, uncommitted** on the working tree, byte-IDENTICAL to node-2's workspace (pack §5 all `IDENTICAL`). Left for operator review per dogfood-review §4.
- **Gate verdict (pre-launch, dogfood-067 header):** ✅ PROCEED — §1.1 ✅ cross-file (4 new files, consumer imports parser), real parsing/decision failure surface · §1.2 ✅ advances real open 🔴 WP-256 (the F-60 fix) · §1.3 ✅ thesis-stressing on a real WP. **Confirmed correct:** the run delivered WP-256's pure decision AND exercised the durable-chain pillar on real code for the first time.

## Outcome in plain English

The launch-time **spec-staleness gate** — the decision logic that should refuse a dogfood whose target work-package is *already done* (the dogfood-065 F-60 fix) — is **delivered and verified**: a pure `parseWpStatus(markdown, wpId)` parser plus a pure `assessSpecStaleness(input)` consumer that imports it, with full tests, type-clean and lint-clean.

The bigger result is the **vehicle**: the operator ran a spec written for a single `run` through `chikory chain` instead. The chain planner split the goal into two nodes, gated the decomposition with the meta-judge (PROCEED), ran node-1 to a sealed SUCCESS, **handed node-1's git tree to node-2** (WP-239 dependent handoff), and node-2 cloned that tree and `import`ed node-1's `parseWpStatus` rather than reimplementing it. Both nodes sealed SUCCESS. This is the first time the durable multi-run chain pillar (decompose → meta-judge gate → dependent handoff → per-node durable journal) has run end-to-end **on real open-WP product code** — exactly what dogfood-066 attempted and failed at.

Two caveats keep this from being a clean win:
1. **WP-256's gate landed ORPHANED** — `assessSpecStaleness` has zero live consumers (not in the barrel, not in `precheck.ts`/`commands.ts`). The pure *decision* exists; nothing actually *refuses a stale spec at launch*. This is the very F-60 orphan pattern WP-256 was meant to fix → **F-65 → WP-258** (wire the gate into the launch precheck).
2. **The chain planner STILL compresses node goals** — F-62's mechanism recurred (F-64). The parent goal carried the exact "id in the FIRST cell, status in the THIRD cell" positional semantics verbatim; node-1's `node.goal` compressed them away to "handling status icons from markdown tables and exact ID matching". It was **non-fatal only by luck**: the one grep-pinned literal (`WP-25`) survived because dogfood-067 had hardened it into the AC-1 *description*, and the dropped positional rule wasn't AC-enforced, so the executor's substitute interpretation passed. **WP-257 (planner must preserve mandated detail) is still required and still 🔴.**

## Trace

```
chain chain-d18a8c1b-… · SUCCESS 2/2 · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)
plan plan-c4fd3fb0-… · meta-judge PROCEED · node-1 [] → node-2 [node-1]

 node   deliverable                 step  tokens(in/out)   step$    judge$   verdict        dur
 node-1 parseWpStatus parser+test   1     1,280,082/6,912  $1.6692  $0.0051  ✓ PROCEED 1/1  3m34s
 node-2 assessSpecStaleness +test   1       624,547/4,591  $0.8266  $0.0064  ✓ PROCEED 2/2  3m10s

totals: 2 nodes · 2 steps · $2.5073 total · judge $0.0115 (0.46%) · 6m44s · 0 rollbacks · 0 escalations
        WP-239 handoff: node-2 baseCommit f7f494a == node-1 headCommit f7f494a  ✓
        no empty-diff probe step (F-11 did not recur) · harvest 4/4 files IDENTICAL to node-2 workspace
```

- **node-1 judge:** AC-1 `pass:true` — "judge-executed check `… grep -q \"WP-25\" … && pnpm exec vitest run …` exited 0". Rubric 4/4 (`tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`).
- **node-2 judge:** AC-2 `pass:true` (greps `parseWpStatus`/`assessSpecStaleness` import + focused vitest) **and** AC-3 `pass:true` (full `tsc --noEmit && eslint . && vitest run`). The planner added a full-suite AC-3 on the terminal node — a good safety net. Rubric 4/4.
- **Family diversity real:** executor `codex`/openai-family; judge `gemini-3.1-pro-preview` via the keyless openai-compat shim — structurally different family. ✓
- **Cost-share:** judge **0.46%** of total ($0.0115/$2.5073), well under the 0.5 `max_cost_share`. Budget per node $2; node-1 83.7%, node-2 41.7%.

## Delivery quality (human review, post-landing)

Independently re-ran the full AC against the working tree (devbox): `tsc --noEmit` ✓, `eslint .` ✓, focused vitest **9 passed (9)** (`wp-status` 5 + `spec-staleness` 4). Scope = exactly the 4 named new files, all absent on HEAD `a4b8e7a` (no empty-diff/F-45 risk). No barrel/`types.ts`/contract/CLI-wiring change, as the goal mandated.

| File | Lines | Verdict |
|---|---|---|
| `src/cli/wp-status.ts` | 78 | 🟡 works + robust, but semantics **diverge** from spec-as-written (see F-64) |
| `src/cli/spec-staleness.ts` | 35 | 🟢 matches spec verbatim — imports `parseWpStatus`, `stale = status === "green"`, exact reason strings |
| `test/cli/wp-status.test.ts` | 66 | 🟢 5 cases incl. the `WP-25`/`WP-255` discriminator + markdown-id (`` `WP-259` ``, `[WP-260](…)`) |
| `test/cli/spec-staleness.test.ts` | 64 | 🟢 4 cases incl. stale/fresh/absent + no-mutation |

- `spec-staleness.ts` is **exactly** to spec: imports node-1's symbol (WP-239 handoff respected — the AC-2 grep forbade reimplementation), `stale === "green"` is the F-60 condition, all three reason strings verbatim, pure/no-mutation (tested).
- `wp-status.ts` is **higher-fidelity to real `plan.md` than the spec asked** — it locates the status column by markdown **header** ("Status") and normalizes link/backtick id cells (`[WP-x](…)`, `` `WP-x` ``), which is what `plan.md`'s real tables use. **But** it does NOT implement the spec's literal rule (id in the FIRST cell, status in the THIRD cell): it matches the id in *any* cell (`row.some`) and reads a header-located column. The tests pass because the executor authored fixtures that match its own parser. Net: the AC is satisfied and the code likely works better on real `plan.md`, but it is **not the function the spec describes** — a direct consequence of F-64 (the planner dropped the positional semantics from node-1's goal, so the executor reinvented them).

## New friction

Friction numbering is global/sequential; prior reports reached **F-63**. Continuing from **F-64**.

- **F-64 → WP-257 (reinforces; no new WP).** *The chain planner still compresses node goals and drops mandated detail — F-62's mechanism recurred, non-fatally.* The parent goal (`plan-c4fd3fb0` payload) carried the exact positional semantics verbatim ("…whose FIRST cell is the work-package id…", "read the THIRD pipe-delimited cell…"). node-1's `node.goal` (journal `task_json.goal`) compressed them to *"handling status icons from markdown tables and exact ID matching."* Unlike dogfood-066 (where the dropped literal was grep-enforced → fatal HALT), here the dropped detail was *prose semantics* not AC-enforced, and the one grep-pinned literal (`WP-25`) survived because dogfood-067 had hardened it into the **AC-1 description** text — so the executor's divergent header-driven parser passed. **Evidence WP-257 is still required even when a chain "succeeds":** the planner paraphrase silently changed what got built. Fix unchanged (preserve per-node sections / quoted literals verbatim into node goals + a planner-output check). **WP-257 stays 🔴.**

- **F-65 → WP-258 (new).** *WP-256's staleness gate landed ORPHANED — the F-60 pattern it was meant to fix.* `assessSpecStaleness` / `parseWpStatus` have **zero** live consumers: `grep -rn assessSpecStaleness packages/sdk-ts/src --include=*.ts` returns only the module + its test; not in the barrel `src/index.ts`; `precheck.ts`/`commands.ts` contain no `stale`/`Staleness`. The pure *decision* exists; nothing **refuses a stale spec at launch**. The dogfood-067 spec deliberately scoped to 4 files (no wiring) to keep the nodes clean — a reasonable chain-decomposition choice, but it leaves WP-256's actual requirement (refuse-at-launch) **half-done**. → **WP-258**: wire `assessSpecStaleness` into the launch precheck (`chikory run`/`chain` calls it against `plan.md`, loud-warns/refuses when the target WP is already 🟢). Sibling of WP-228/WP-231/WP-232.

- **F-66 (🟢 positive, no WP).** *First durable chain to land real open-WP product code, end-to-end.* decompose ✅ → meta-judge PROCEED ✅ → node-1 sealed SUCCESS ✅ → **WP-239 dependent handoff live** (node-2 `baseCommit f7f494a` == node-1 `headCommit f7f494a`; node-2 imported, did not reimplement) ✅ → node-2 sealed SUCCESS ✅ → chain SUCCESS 2/2. dogfood-066 exercised decompose+gate+node-A journal but the handoff was blocked; this run completes the pillar. The chain pillar is no longer "never truly exercised on real code." Mirror of dogfood-066's F-63 positive.

## Token economics (baseline for WP-203/WP-207)

- node-1: **1,280,082** input / 6,912 output tokens for a single step writing 2 small files (144 lines). node-2: **624,547** / 4,591. The codex adapter carries a very large input context per step; output is tiny. No compaction/parking fired (1 step each). Data point for the context-rot / compaction work.

## Verdict on the thesis

🟢 **Strong.** Two thesis pillars advanced in one run: (1) the **durable multi-run chain** finally ran end-to-end on real product code — decompose, meta-judge gate, dependent handoff, per-node durable journal, both nodes sealed — closing the dogfood-066 gap; (2) the **real-time judge** executed the grep+vitest+tsc+eslint ACs on each node's on-disk clone (not text-grading) and correctly PROCEEDed, with a different model family from the executor. The loop's standing failure mode still bit at the edges: F-64 shows the planner paraphrase silently altered the built artifact (a chain can "pass" while building the wrong function), and F-65 shows the delivered gate is orphaned until WP-258 wires it. Both are now queued as WPs — the dogfood loop is generating its own next product work, which is the point.
