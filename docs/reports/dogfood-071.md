# dogfood-071 — WP-261 §4 `cmdChain` launch-mode wire LANDED (WP-261 → 🟢); but the run DOGFOODED ITS OWN BUG a THIRD time (5th consecutive launch-mode divergence) AND the F-64 paraphrase this time caused REAL contract drift that shipped GREEN

- **WP:** WP-261 §4 — WIRE the landed launch-mode guard (`detectIntendedSingleRun` + `assessLaunchModeMismatch`, `src/cli/launch-mode-precheck.ts`, landed dogfood-070) into `cmdChain` so a single-`run`-authored spec invoked via `chikory chain` is refused (loud warning + non-zero exit) BEFORE any planner/meta-judge LLM cost. The dogfood-070 F-72 fix; the direct analog of dogfood-068's `cmdRun` spec-staleness wire. The spec was authored **single `chikory run`** ("LAUNCH WITH `chikory run` … NOT `chikory chain`", repeated 4× in the header, *because a chain re-risks F-64*) — and the operator launched it as a **`chikory chain`** anyway: the **fifth run in a row** (067/068/069/070/071) where a single-`run` spec was chained. The irony is total: the run whose entire job is to REFUSE this mistake was itself launched by making it.
- **Date:** 2026-07-01
- **Spec:** `examples/dogfood/dogfood-071.yaml` (`dogfood-071-wp261-cmdchain-launch-mode-wire`)
- **Run-id (chain, 1 node):** `chain-fd45e5a6-6805-4898-b171-e290823c84b2-node-node-1` (plan `plan-2976e9af-7863-4f01-8fd4-e0d6a82795dc-node-1`). The planner decomposed the single-run goal into **one node** this time (vs dogfood-070's two). Runtime HEAD `fc90348`.
- **Landed commit:** none yet — **2 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/cli/chain.ts` EDIT +12, `packages/sdk-ts/test/cli/chain-launch-mode.test.ts` NEW +54), byte-**IDENTICAL** to the node workspace (pack §5 both `IDENTICAL`). Left for operator review per dogfood-review §4.

## Trace (chain, 1 node)

```
chain chain-fd45e5a6-… · SUCCESS · 1 step · $1.13 / $5.00 · 4m17s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)
plan  plan-2976e9af-… · ONE node: node-1 (implement wire + behavioral test + verify)

 #   step deliverable                                 tokens(in/out)  step$     judge$    verdict         dur
 1   chain.ts wire + chain-launch-mode.test.ts        848k/6.1k       $1.1208   $0.0066   ✓ PROCEED 2/2   3m38s (32 tool calls)

totals: 1 step · 1 judge pass · $1.1274 total · judge $0.0066 (~0.6%) · 0 rollbacks · 0 escalations
        budget 22.6% of $5.00 · checkpoint …@4 (commit c6b8f918e59f) lastGood
        no empty-diff probe step (F-11 did not recur) · harvest 2/2 files IDENTICAL to working tree
```

## Delivery quality (human review, post-landing)

🟡 **Functionally correct wire, but drifted from the spec on THREE mandated behaviors — and the behavioral test was under-built so the drift shipped GREEN.** Reviewed `chain.ts` (`packages/sdk-ts/src/cli/chain.ts:403-411`) + the new test (`test/cli/chain-launch-mode.test.ts:1-54`) line-by-line against the goal:

| Mandated | Delivered | ✓ |
|---|---|---|
| import `{ assessLaunchModeMismatch, detectIntendedSingleRun } from "./launch-mode-precheck.js"` | exact, top of file (`chain.ts:40`) | 🟢 |
| Guard fires **AFTER** `spec = parseTaskSpec(yamlText)` succeeds, before `createRouter`/`planAndGateChain` | Guard placed **BEFORE** `parseTaskSpec` (`:403-411`) — still zero-LLM-cost (earlier), but **not** where the spec pinned it | 🟡 drift |
| `assessLaunchModeMismatch({ intendedSingleRun: detectIntendedSingleRun(yamlText), launchedAsChain: true })` over RAW `yamlText` | exact (`:404-407`) | 🟢 |
| Emit `warning` via `ioPair.err`, **THEN a SECOND `ioPair.err` line** with relaunch guidance + the `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=1` override hint, then `return 1` | emits **only** `ioPair.err(launchModeMismatch.warning)` — the mandated **second line is DROPPED**; the test then locks the drop with `expect(err).toHaveLength(1)` | 🔴 drift |
| Override falls through when the env var is **set to a non-empty value** | narrowed to `!== "1"` — only the literal `"1"` overrides; `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=yes` would still REFUSE | 🟡 drift |
| Behavioral test: a **parse-valid `TaskSpec`** temp file carrying the marker; invoke `cmdChain`; assert exit 1 + both mandated `warning` substrings | uses an **unparseable** blob (`"# Launch with \`chikory run\`, NOT a chain.\nnot: parsed\n"`) — passes ONLY because the guard was moved ahead of `parseTaskSpec`; had the guard been AFTER parse (as specced), `parseTaskSpec` would throw first and the warning assertions would fail | 🔴 drift |
| `return 1`, genuine-chain happy path falls through unchanged | present; no-marker → no early return | 🟢 |

- **The two drifts are mutually reinforcing.** The executor moved the guard ahead of `parseTaskSpec` AND wrote a test that feeds an unparseable spec — each makes the other pass. A spec-faithful test (a parse-valid marker spec, guard after parse) would have exposed both. This is not a cosmetic reorder: it means the delivered behavioral test does **not** prove the intended scenario (a *valid* single-run spec refused *after* a successful parse, before the router).
- **Operator-facing consequence of the dropped second line:** an operator who hits the wall sees only `[chikory] WARNING: launch mode mismatch: … use \`chikory run\`, not \`chikory chain\`` — with **no on-screen hint that `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=1` exists**. The spec added that second line precisely so the escape hatch is discoverable; it shipped absent.
- **Scope discipline:** exactly the 2 named files (pack §4 / `git status --short`). No `types.ts`, barrel, `commands.ts`, `spec-staleness-precheck.ts`, or `launch-mode-precheck.ts` touched (this run CONSUMES the last). ✓
- **AC re-run against working tree:** AC-1 PASS (8 grep-pins + scoped vitest **1 passed**), AC-2 PASS (tsc + eslint + full suite **563 passed | 19 skipped**). ✓ — but see the finding: the AC greps are **substring-only**, so they pinned the symbols and could not catch the placement / dropped-line / override-semantics drift.
- **Harvest:** both files byte-IDENTICAL to the node workspace (pack §5). ✓

**The delivered wire would have refused this very run's launch:** committing this delivery makes `chikory chain examples/dogfood/dogfood-071.yaml` return 1 at zero LLM cost — `detectIntendedSingleRun(<this spec text>)` is `true` (header carries "NOT a chain" / "single `chikory run`"), `launchedAsChain: true` → non-null mismatch → refusal. The guard closes over its own launcher exactly as the spec predicted.

## New friction

Friction numbering is global + sequential; the highest prior is F-73, so this report opens at **F-74**.

### 🔴→🟢 F-74 → closes on commit (no new WP) — 5th consecutive launch-mode divergence, but THIS landed wire is the fix that ends the streak

- **Evidence.** Run-id prefix `chain-…` + a live `.chikory/chains/chain-fd45e5a6-…` journal → the spec was launched with `chikory chain`, despite the header's 4× "NOT `chikory chain`". This is the **5th consecutive** single-`run`-authored spec chained (067/068/069/070/071).
- **Why it self-closes.** The delivery is the `cmdChain` guard itself. Once committed, the dogfood-071 workspace clone (which clones HEAD) will REFUSE any future single-`run` spec launched as a chain at zero LLM cost. `assessLaunchModeMismatch({ intendedSingleRun: true, launchedAsChain: true })` returns non-null for this exact launch. **Committing this delivery makes divergence #5 the last one that can slip.** No new WP — WP-261 §4 (this wire) IS the fix; the action is: commit it.
- **Root-cause harness fix LANDED (this review).** The true cause of all five divergences was not operator error — it was `scripts/dogfood.sh:132-135`, which picked `chikory chain` whenever the spec text contained `chikory chain`; since every single-run spec's header WARNS "NOT `chikory chain`", the grep matched the warning and chained the run. Fixed by splitting the launcher into explicit modes: `devbox run run-dogfood` (single `chikory run`) and `devbox run chain-dogfood` (durable `chikory chain`), the broken auto-detect removed, mode now operator-chosen. The `cmdChain` guard (this delivery) is the second line of defence. (`devbox.json`, `scripts/dogfood.sh`, DOGFOODING §4 updated.)

### 🔴 F-75 → WP-262 (new) + reinforces WP-257 / WP-259 / WP-260 — the F-64 paraphrase caused REAL contract drift that shipped GREEN (not "by luck" this time)

- **Root cause — the planner paraphrase (F-64) recurred and this time it BIT.** The single journaled node `goal` (`runs.task_json`) is a one-sentence compression of the ~2500-word single-run spec: *"Implement launch-mode mismatch refusal in packages/sdk-ts/src/cli/chain.ts, write unit tests in packages/sdk-ts/test/cli/chain-launch-mode.test.ts, and verify typecheck/lint passes."* It DROPPED every precise mandate: guard placement **after** `parseTaskSpec`, the **second** `ioPair.err` override-hint line, the **non-empty**-value override semantics, and the **parse-valid `TaskSpec`** test-fixture requirement. The executor never saw them → built a plausible-but-drifted wire (see the delivery table's three 🔴/🟡 rows).
- **Why it shipped GREEN.** AC-1's greps are **substring-only** (`grep -q "return 1"`, `grep -q "toBe(1)"`, `grep -q "single \`chikory run\`"`) — they pin symbols, not placement, line-count, or override semantics. The behavioral test the spec's "F-67 HARDENING" section mandated to prevent exactly this was **itself** under-built (unparseable fixture) and locks the drift (`err.toHaveLength(1)`). So AC + judge (`gemini-3.1-pro-preview`, PROCEED 2/2, 4/4 rubric) all passed on a delivery that diverges from its own spec on three behaviors.
- **This is the concrete realization of the WP-257 silent-divergence tail.** dogfood-069/070 survived the paraphrase "by luck" (the un-pinned literals happened to converge). dogfood-071 did **not** — the un-pinned mandates actually diverged and shipped. It triply reinforces **F-64 → WP-257** (the `runPlannerPass`/`buildPlan` REVISE wire that would flag dropped literals at plan time — still un-wired) and the **F-67/F-68 → WP-259/WP-260** AC-pinning gaps.
- **Spawns WP-262:** (a) hand-fix the delivered `chain.ts` wire to match spec — add the second override-hint `ioPair.err` line, broaden the override to any non-empty value, and move the guard AFTER `parseTaskSpec` (or consciously ratify the earlier placement) — and rewrite the test to use a parse-valid marker `TaskSpec`; (b) treat this as the forcing case to land the WP-257 REVISE wire so a chained single-run spec can no longer silently drop mandates.

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern: the 2 files are STAGED uncommitted (not harvested), so the landed-commit re-gate `chikory land --verify` provides is again bypassed. No new WP — WP-249's track-B harvest-adoption remainder already owns this.

## Verdict on the thesis

🟢🔴 **The third consecutive "the run dogfoods its own bug" data point — and the first where the F-64 paraphrase actually corrupted the delivery instead of merely threatening to.**

- 🟢 **WP-261 § the loop-closing win.** The launch-mode guard is now wired at its real call-site (`cmdChain`), the F-65 orphan is killed, and — committed — the guard refuses the exact mis-launch that has degraded the last five runs. The durable + grep-pinned-AC substrate again delivered a lint-green, full-suite-green SUCCESS in a single checkpointed node (`…@4 lastGood`, no rollback), first-try. The functional wire works.
- 🔴 **But the silent-divergence tail finally cost real correctness, not just money.** For three runs the WP-257 risk was "a chain COULD go green building the wrong function." dogfood-071 is the run where it DID: three mandated behaviors (placement, the override-hint line, non-empty override) diverged and passed every gate, and the anti-drift behavioral test the spec explicitly required was hollowed out to fit the drift. Until the WP-257 REVISE wire lands (flag dropped literals at plan time) AND single-run specs stop being chained, every grep-pinned chain remains one un-pinned mandate away from shipping a subtly wrong implementation green.

**WP-261 → 🟢** (the `cmdChain` launch-mode wire LANDED + proven against its own launch; a small spec-conformance remainder rides F-75 → WP-262, not a reopen). **WP-257 triply-reinforced** (silent-divergence tail realized in delivery, not luck). **New: F-74** (🔴→🟢, 5th launch-mode divergence, closes on commit — this wire is the fix), **F-75 → WP-262** (🔴 paraphrase-driven contract drift shipped green; hand-fix the wire + land the WP-257 REVISE wire). **F-58/WP-249 reinforced** (STAGED, no `Run-ID:` trailer). **Next dogfood headline: a thesis-stressing slice on a real unblocked product WP — WP-233 (durable, resumable chain planning layer)** — the WP-261/WP-257 remainders are operator-landed/track-B CLI-harness work, not headlines.
