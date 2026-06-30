# dogfood-068 — WP-258 spec-staleness gate WIRED LIVE (F-65 fixed); the SECOND consecutive durable CHAIN to land real product code — but the planner paraphrase (F-64) leaked CONTRACT DRIFT past the name-only grep net

- **WP:** WP-258 (wire WP-256's `assessSpecStaleness` gate into the live `chikory run` launch path — the dogfood-067 F-65 orphan fix). The dogfood-068 spec was authored as a **single `chikory run`** (its header twice says "NOT a chain", to sidestep the F-64 planner paraphrase); the operator instead launched it with **`chikory chain`** — the **second run in a row** where a single-`run` spec was chained. The planner decomposed the goal into node-1 (`precheck-module`: the pure module + test) → node-2 (`wire-precheck-cli`: the `commands.ts` wire). **Both nodes SUCCEEDED.**
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-068.yaml` (`dogfood-068-wp258-staleness-precheck-wire`)
- **Run-id (chain):** `chain-aa25aa5c-c3e7-4a5c-a8cf-d33723f0655b` (plan `plan-8844e604-716e-4a3c-827d-7815a5602eba`); child runs `…-node-precheck-module` and `…-node-wire-precheck-cli`. Runtime HEAD `e0da13f`.
- **Landed commit:** none yet — **3 files STAGED, uncommitted** on the working tree (`src/cli/spec-staleness-precheck.ts` NEW, `test/cli/spec-staleness-precheck.test.ts` NEW, `src/cli/commands.ts` +18), byte-IDENTICAL to node-2's workspace (pack §5 all `IDENTICAL`). Left for operator review per dogfood-review §4.
- **Gate verdict (pre-launch, dogfood-068 header):** ✅ PROCEED — §1.1 ✅ cross-file (new pure module + test + a LIVE `cmdRun` call-site + additive `CliDeps.readPlanText`), real failure surface · §1.2 ✅ advances real open 🔴 WP-258 AND flips WP-256 → 🟢 · §1.3 ✅ makes the §5 standing-failure-mode guard LIVE. **Confirmed correct:** the gate is now wired into a live launch call-site — F-65 fixed.

## Outcome in plain English

WP-256's **spec-staleness gate** (the logic that detects a dogfood whose target work-package is *already done*) was delivered ORPHANED by dogfood-067 — the pure `assessSpecStaleness` decision existed but **nothing called it**, so no run was ever actually warned. dogfood-068 **de-orphans it**: a new pure `evaluateSpecStalenessPrecheck` module consumes `assessSpecStaleness`, and `cmdRun` now calls it right after `parseTaskSpec` — so launching a spec whose goal targets an already-🟢 WP prints a loud `[chikory] WARNING: stale spec: …` to stderr. The guard the loop has needed against greening the dashboard on already-closed work is now **live and warn-only** (it never aborts the run). **F-65 is fixed; WP-258 → 🟢; WP-256 → 🟢.**

The vehicle, again, was a **durable chain**: the operator ran a single-`run`-authored spec through `chikory chain`. The planner split it into node-1 (the pure precheck module + test) and node-2 (the `commands.ts` wire); node-1 sealed SUCCESS, **handed its git tree to node-2** (WP-239 dependent handoff: node-2 `baseCommit 4631f4d` == node-1 head `4631f4d`), node-2 cloned that tree and consumed node-1's module. Both sealed SUCCESS. This is the **second consecutive durable chain to land real open-WP product code** end-to-end (F-69 🟢).

But the win is **not clean** — the planner paraphrase (F-64, still 🔴 as WP-257) bit a third time, and this time it leaked **contract drift** into the delivered API that the grep-gated ACs could not see (F-67), plus a latent mis-target bug in the wire (F-68).

## Trace

```
chain chain-aa25aa5c-… · SUCCESS 2/2 · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)
plan plan-8844e604-… · node-1 precheck-module [] → node-2 wire-precheck-cli [precheck-module]

 node               deliverable                       step  tokens(in/out)  step$    judge$   verdict        dur
 precheck-module    spec-staleness-precheck.ts +test  1     870k/5.7k       $1.1440  $0.0049  ✓ PROCEED 1/1  2m50s
 wire-precheck-cli  commands.ts wire (+CliDeps)        1     409k/3.4k       $0.5443  $0.0056  ✓ PROCEED 2/2  2m52s

totals: 2 nodes · 2 steps · $1.6988 total · judge $0.0105 (0.62%) · ~5m42s · 0 rollbacks · 0 escalations
        WP-239 handoff: node-2 baseCommit 4631f4d == node-1 headCommit 4631f4d  ✓
        no empty-diff probe step (F-11 did not recur) · harvest 3/3 files IDENTICAL to node-2 workspace
```

- **node-1 judge:** AC-1 `pass:true` — judge-executed grep-chain (`assessSpecStaleness`/`extractTargetWpId`/`evaluateSpecStalenessPrecheck` in src; `evaluateSpecStalenessPrecheck`/`extractTargetWpId`/`stale`/`WP-258` in test) `&& pnpm exec vitest run …precheck.test.ts` exited 0. Rubric 4/4.
- **node-2 judge:** AC-2 `pass:true` (greps `evaluateSpecStalenessPrecheck` + `readPlanText` + `spec-staleness-precheck` in `commands.ts`) **and** AC-3 `pass:true` (full `tsc --noEmit && eslint . && vitest run` — **547 passed | 19 skipped**, incl. the real-Temporal `crash-recovery` path). Rubric 4/4.
- **Family diversity real:** executor `codex`/openai-family; judge `gemini-3.1-pro-preview` via the keyless openai-compat shim — structurally different family. ✓
- **Cost-share:** judge **0.62%** of total ($0.0105/$1.6988), well under the 0.5 `max_cost_share`. Per-node budget node-1 $2 (57.5%), node-2 $3 (18.3%).

## Delivery quality (human review, post-landing)

Independently re-ran the full AC against the working tree (devbox): node-1 AC-1 focused vitest **5 passed**; node-2 AC-2 greps green; AC-3 `tsc --noEmit` ✓ + `eslint .` ✓ + full vitest **547 passed | 19 skipped**. Scope = exactly the 3 expected paths, the two new files absent on HEAD `e0da13f` (no empty-diff/F-45 risk). No `types.ts`/contract/barrel/chain-runner change, as the goal mandated.

| File | Lines | Verdict |
|---|---|---|
| `src/cli/spec-staleness-precheck.ts` | 34 | 🟡 works + de-orphans the gate, but the **public API diverges from spec-as-written** (see F-67) |
| `test/cli/spec-staleness-precheck.test.ts` | 79 | 🟢 5 cases (🟢→stale/warning w/ `.toContain("stale")`, 🟡→null, no-id→null, `extractTargetWpId(…WP-258…)`→`"WP-258"`) |
| `src/cli/commands.ts` | +18 | 🟡 wire is live + warn-only (F-65 fixed), but reads the target WP from the **whole yaml**, not `spec.goal` (see F-68) |

**Functionally correct for WP-258's goal:** the gate is live in `cmdRun` (after `parseTaskSpec`, before the `CHIKORY_SEED_BAD_DIFF_PATH` seam), reads `plan.md` best-effort via the injectable `deps.readPlanText` (try/catch → null on a missing plan, so a missing `plan.md` cannot break launch), emits the warning over `ioPair.err`, and never aborts. The de-orphaning is real — `evaluateSpecStalenessPrecheck` has a live launch-path consumer.

**But the delivered public contract drifted from the spec** (all internally consistent — tsc/eslint/vitest green — so nothing caught it):

1. **`SpecStalenessPrecheckResult` dropped the mandated `stale: boolean` field.** Spec mandated `{ targetWpId, stale, warning }`; delivered `{ targetWpId, warning }`. The AC-1 grep `grep -q "stale"` passed anyway because it matched the test's `expect(result.warning).toContain("stale")` *string literal*, not a result field. The grep pins the *name* "stale" somewhere in the test, not the interface shape.
2. **`evaluateSpecStalenessPrecheck` takes positional `(specText, planText)` instead of the mandated single object param `{ goal, planText }`.** The grep only checks the symbol *name* appears, so a different signature passes. node-2's wire then had to call it positionally (which is why tsc stayed green — the two nodes are mutually consistent, just both off-spec).
3. **`readPlanText?: () => Promise<string>` dropped the mandated `| null`** from the dep return type (minor).
4. Regex `/\bWP-\d+\b/` vs mandated `/WP-\d+/` (benign — word-boundaries are arguably better).

All four trace to **F-64**: the chain planner compressed node-1's `node.goal` to *"The module should export `extractTargetWpId`, `evaluateSpecStalenessPrecheck`, and the `SpecStalenessPrecheckResult` interface. The tests must verify stale and fresh scenarios verbatim."* — **dropping the spec's exact field list (`stale`) and param shape (`{ goal, planText }`)**. The executor then invented a plausible-but-divergent API; the name-only grep net + tsc + vitest had no way to catch the shape mismatch. (Verified from the journal: node-1's `runs.task_json.goal` is the paraphrase; the parent plan goal in `chain.db` carries the full mandated signature.)

## New friction

Friction numbering is global/sequential; prior reports reached **F-66**. Continuing from **F-67**.

- **F-67 → WP-259 (new) + reinforces WP-257.** *The name-only AC grep net is blind to public TYPE-SHAPE, so the F-64 planner paraphrase leaked contract drift past a green AC.* The chain planner dropped node-1's mandated interface fields and param shape; the executor shipped `{ targetWpId, warning }` (no `stale`) with positional args instead of the mandated `{ targetWpId, stale, warning }` / `{ goal, planText }`. AC-1's `grep -q "stale"` matched the test's `.toContain("stale")` string, and tsc/eslint/vitest only enforce *internal* consistency — so a contract-divergent API passed clean. **This is the deeper lesson of F-64/WP-257:** F-49 grep discipline pins *symbol names*, not *interface shapes or signatures*, so a chain can build the wrong-shaped function and still go green (the dogfood-067 F-64 was wrong *semantics*; this is wrong *contract*). **WP-259:** when a goal mandates an exact `export interface`/function signature, the AC must assert the *shape* — e.g. a tiny tsc-compiled `satisfies` fixture or a `expectTypeOf`/type-level test that fails if a field or param shape is missing — not just `grep -q "<name>"`. Reinforces **WP-257** (the planner-paraphrase root); **WP-257 stays 🔴.**

- **F-68 → WP-260 (new).** *The live staleness-precheck wire reads the target WP from the WHOLE yaml text (including the comment preamble), not `spec.goal`.* Spec mandated `evaluateSpecStalenessPrecheck({ goal: spec.goal, planText })`; the delivered wire calls `evaluateSpecStalenessPrecheck(yamlText, planText)` and `extractTargetWpId` greps the first `WP-\d+` anywhere in the raw file. It happens to be correct for every current dogfood spec only because the spec **comment header conventionally leads with the target WP id** (`# Dogfood-068: WP-258 — …`). A spec whose preamble names an older/different WP first (e.g. a "WHY THIS IS NEXT: dogfood-067 delivered WP-256…" line) would warn about the **wrong** package. Latent correctness gap in the gate WP-256 exists to provide. **WP-260:** extract the target id from the parsed `spec.goal` (the field the spec mandated), not the raw yaml file — and add a fixture where the comment preamble names a decoy WP before the goal's real target.

- **F-69 (🟢 positive, no WP).** *Second consecutive durable chain to land real open-WP product code, end-to-end.* decompose ✅ → node-1 `precheck-module` sealed SUCCESS ✅ → **WP-239 dependent handoff live** (node-2 `baseCommit 4631f4d` == node-1 `headCommit 4631f4d`; node-2 consumed node-1's module) ✅ → node-2 `wire-precheck-cli` sealed SUCCESS ✅ → chain SUCCESS 2/2. dogfood-067 was the first; dogfood-068 confirms the durable-chain pillar (decompose → per-node durable journal → handoff → seal) is repeatable on real product code, not a one-off. Mirror of F-66.

## Token economics (baseline for WP-203/WP-207)

- node-1: **870,000** input / 5,700 output tokens for a single step writing 2 small files (113 lines), 30 tool calls. node-2: **409,000** / 3,400, 17 tool calls, for a +18-line wire. Codex carries a large per-step input context; output is tiny. No compaction/parking fired (1 step each; `peak window 0%`). Lower than dogfood-067's node-1 (1.28M) — the smaller goal shows in the input. Data point for the context-rot / compaction work.

## Verdict on the thesis

🟢 **Strong, with a sharpened caveat.** WP-256's launch-time staleness guard is now **live** — the loop's standing failure mode (greening the dashboard on already-closed work) finally has a real launch-path consumer, delivered by a repeatable durable chain that exercised the WP-239 handoff a second time. The real-time judge again executed the grep+vitest+tsc+eslint ACs on each node's on-disk clone (not text-grading) and PROCEEDed correctly, family-diverse. **The sharpened caveat:** F-67 shows the F-64 planner paraphrase can now leak past a *green* chain not just as wrong *semantics* (dogfood-067) but as wrong *contract shape* (a missing interface field, a positional-vs-object signature), because the grep net pins names, not shapes — and F-68 shows the resulting wire reads the target from the wrong source. WP-257 (preserve mandated detail into node goals) is the root and is now triply-evidenced; WP-259 (assert type-shape in the AC, not just the name) and WP-260 (extract from `spec.goal`) are its concrete consequences. The loop keeps generating its own next product work — which is the point.
