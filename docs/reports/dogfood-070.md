# dogfood-070 — WP-261 launch-mode-mismatch precheck (pure half) LANDED; and the run DOGFOODED ITS OWN BUG a SECOND time: the guard against "single-`run` spec launched as a chain" was itself launched as a chain (4th consecutive launch-mode divergence)

- **WP:** WP-261 (the launcher must honor a spec's prescribed execution mode — refuse/loud-warn when a single-`run`-authored spec is invoked via `chikory chain`) — **pure decision half**. The dogfood-070 spec was authored as a **single `chikory run`** (its header says "NOT a chain" / "HONOR THE LAUNCH MODE THIS TIME" repeatedly, *because a chain re-risks F-64*); the operator again launched it with **`chikory chain`** — the **fourth run in a row** where a single-`run` spec was chained — and the F-64 planner paraphrase recurred exactly as the spec warned.
- **Date:** 2026-06-30
- **Spec:** `examples/dogfood/dogfood-070.yaml` (`dogfood-070-wp261-launch-mode-mismatch-precheck`)
- **Run-id (chain, 2 nodes):** `chain-14f72c09-debe-4f60-a6ca-1c3b3b7d0e65` — `node-node-1` (plan `plan-be71d6b1-8b51-4de8-91d7-0fa6b511c278-node-1`) + `node-node-2`. The planner decomposed the single-run goal into **two nodes** (`node-1` = implement module + test shell; `node-2` = complete the test suite + verify). Runtime HEAD `07f9687`.
- **Landed commit:** none yet — **2 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/cli/launch-mode-precheck.ts` NEW, `packages/sdk-ts/test/cli/launch-mode-precheck.test.ts` NEW), byte-IDENTICAL to the **node-2** workspace (pack §5 both `IDENTICAL`; node-1's copies `DIFFER` because node-2 refined them). Left for operator review per dogfood-review §4.

## Trace (chain, 2 nodes)

```
chain chain-14f72c09-… · SUCCESS · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)
plan  plan-be71d6b1-… · TWO nodes: node-1 (implement) → node-2 (complete test + verify)

 node  deliverable                                  tokens(in/out)  step$    judge$   verdict         dur
 1     launch-mode-precheck.ts + basic test shell   988k/5.3k       $1.2888  $0.0045  ✓ PROCEED 1/1   7m13s (step 2m28s, 24 tool calls)
 2     complete test suite + tsc/eslint/full-suite  498k/5.4k       $0.6765  $0.0075  ✓ PROCEED 2/2   3m22s (step 2m45s, 19 tool calls)

totals: 2 nodes · 2 judge passes · $1.9773 total ($1.2933 + $0.6840) · judge $0.0120 (~0.6%)
        each node own $2.50 budget (51.6% / 27.2% used) · 0 rollbacks · 0 escalations
        checkpoints: node-1 …@4 (commit 930dae54) lastGood; node-2 …@4 (commit e3178b9b) lastGood
        no empty-diff probe step (F-11 did not recur) · harvest node-2 2/2 files IDENTICAL to working tree
```

## Delivery quality (human review, post-landing)

🟢 **Meets spec exactly.** Reviewed `launch-mode-precheck.ts` (`packages/sdk-ts/src/cli/launch-mode-precheck.ts:1-41`) + test (`test/cli/launch-mode-precheck.test.ts:1-56`) line-by-line against the goal:

| Mandated | Delivered | ✓ |
|---|---|---|
| `export interface LaunchModeMismatch { intendedSingleRun; launchedAsChain; warning }` | exact 3-field interface (`:1-5`) | 🟢 |
| `detectIntendedSingleRun(specText)` — true on `NOT a chain` / `single \`chikory run\`` / `Launch with \`chikory run\`` (case-insensitive), false otherwise | `SINGLE_RUN_PATTERNS.some(p => p.test())`, all 3 mandated markers + a benign 4th (`use \`chikory run\``) (`:7-20`) | 🟢 |
| `assessLaunchModeMismatch(input)` — non-null ONLY when both booleans true; echo both; `warning` contains `chikory chain` + `single \`chikory run\`` | `if (!intended \|\| !chain) return null` else echo + warning string containing both substrings (`:26-40`) | 🟢 |
| pure, named exports only, no default, no mutation of `input`, no I/O/clock/randomness | all satisfied; `input` read-only | 🟢 |
| JSDoc on each export citing WP-261 + the `evaluateSpecStalenessPrecheck` analog | present on both (`:14-17`, `:22-25`) | 🟢 |
| test: object-literal call `assessLaunchModeMismatch({`, `.warning` field, `intendedSingleRun: true`, `NOT a chain`, `LaunchModeMismatch` type import, discriminator (`false,true`→null), no-mutation snapshot | all present verbatim; 8 tests pass | 🟢 |

- **Scope discipline:** exactly the 2 named new files (pack §4 / `git status --short`). No `types.ts`, barrel `src/index.ts`, `commands.ts`, the chain runner, or `spec-staleness-precheck.ts` touched. Anti-F-67 shape (the `warning` result field grep-pinned) honored. ✓
- **AC re-run against working tree:** AC-1 PASS (8 grep-pins + scoped vitest **8 passed**), AC-2 PASS (tsc + eslint + full suite **562 passed | 19 skipped**). ✓
- **Harvest:** node-2's 2 files byte-IDENTICAL to the working tree (pack §5). ✓
- **Minor (no friction):** the impl carries a 4th marker regex (`use \`chikory run\``) beyond the 3 the spec listed. The spec said "ANY of" those markers, so an extra benign marker is a superset — it cannot break a mandated assertion. Noted, not a defect.

**The delivered guard would have caught this very run's launch:** `assessLaunchModeMismatch({ intendedSingleRun: true, launchedAsChain: true })` returns a non-null `LaunchModeMismatch` — and `detectIntendedSingleRun(<dogfood-070 spec text>)` returns `true` (the header carries "NOT a chain"). The function this run delivered is exactly the guardrail that would have refused/warned on the launch that produced it.

## New friction

Friction numbering is global + sequential; the highest prior is F-71, so this report opens at **F-72**.

### 🔴 F-72 → reinforces WP-261 (pure half now LANDED) + WP-257 — 4th consecutive launch-mode divergence: the guard-against-itself run; F-64 paraphrase recurred but survived cheaply by luck

- **Evidence — the planner paraphrase (F-64) recurred.** The two journaled node `goal`s (`runs.task_json`) are two-sentence compressions of the ~2000-word single-run spec:
  - node-1: *"Implement the pure module `…/launch-mode-precheck.ts` containing `detectIntendedSingleRun`, `assessLaunchModeMismatch`, and the `LaunchModeMismatch` interface. Also create a basic test shell `…`."*
  - node-2: *"Complete the test suite `…` with all mandated test cases, verify that all tests pass, and ensure type and lint checks pass clean."*
  Both drop the **exact** mandated semantics the spec pinned in prose: the three marker regexes, the two required `warning` substrings (`chikory chain`, `single \`chikory run\``), the mismatch **truth table** (only `true && true`), the no-mutation rule, the JSDoc requirement, and the verbatim object-literal test cases.
- **Impact — but cheaper than dogfood-069.** Both nodes verdicted ✓ PROCEED on the **first** attempt (node-1 1/1, node-2 2/2) — **no failed-AC retry burn**. Total **$1.9773** (node-1 $1.2933 / 988k input tokens, node-2 $0.6840 / 498k input tokens; ~1.49M input tokens for a ~96-line 2-file delivery) vs dogfood-069's $2.73 with 2 failed-AC steps. The run survived because (a) the **F-49 grep-pinned ACs** (node-1's impl-symbol greps; node-2's full verbatim AC-1/AC-2) held the symbol + interface-shape + key-literal pins through the paraphrase, and (b) the **remaining un-pinned semantics** (the two `warning` substrings, the truth table, no-mutation) are self-evident enough that the executor converged on them **unaided**.
- **The silent-divergence tail (reinforces WP-257).** The two mandated `warning` substrings were **not** AC-grep-pinned — they survived only by executor good judgment. A less-reasonable wording would have shipped a warning diverging from the spec's mandate while **still passing every AC** — the exact "chain silently builds the wrong function" risk WP-257/F-64 already documents. This run got lucky; the mechanism is unfixed.
- **Why no new WP.** This is the **4th consecutive** single-`run`-authored spec launched as a chain (067/068/069/070). It reinforces the already-open **WP-261** (whose pure decision this run *delivered*) and **WP-257** (the planner paraphrase). No new WP — the fix is the WP-261 §4 wire below.

### 🟢 F-73 (positive, no new WP — promotes the WP-261 §4 wire to top priority) — the landed guard is proven against its own launch

- **Evidence.** `assessLaunchModeMismatch({ intendedSingleRun: detectIntendedSingleRun(<this spec>), launchedAsChain: true })` = a non-null `LaunchModeMismatch` for dogfood-070 itself (the header carries the `NOT a chain` marker → `intendedSingleRun` true; it was launched as a chain → `launchedAsChain` true).
- **Consequence.** The documented §4 follow-up — call `assessLaunchModeMismatch` inside `cmdChain` (`src/cli/commands.ts`) with `detectIntendedSingleRun(specText)` and warn (or refuse pending `--force`) on a non-null result — would have flagged this launch **before the planner ran a single token**. With the pure half landed and proven against the live defect, **the §4 `cmdChain` wire is now the single highest-value WP-261 slice.** It is CLI-harness wiring (operator-landed / track-B), the exact shape of the WP-258 `evaluateSpecStalenessPrecheck` wire into `cmdRun` — not a dogfood headline.

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern: the 2 files are STAGED uncommitted (not harvested), so the landed-commit re-gate that `chikory land --verify` provides is again bypassed. No new WP — WP-249's track-B harvest-adoption remainder already owns this.

## Verdict on the thesis

🟢🔴 **The second consecutive "the run dogfoods its own bug" data point — and the sharpest yet.** dogfood-069 delivered the *detector* of the F-64 paraphrase and was hit by it; dogfood-070 delivered the *launcher guard* that would have prevented the wrong-mode launch — and was itself launched in exactly that wrong mode. Two thesis claims land at once:

- 🟢 **Durable + grep-pinned-AC-on-disk is resilient.** Even fed two lossy paraphrased node goals, the chain delivered a correct, lint-green, spec-meeting SUCCESS across 2 checkpointed nodes (`node-1 …@4`, `node-2 …@4`, both `lastGood`, no rollback, no re-execution), first-try each node — because the F-49 grep pins survived into the *acceptance criteria*. The quality gate, not the goal text, carried the run again.
- 🔴 **But the launch-mode divergence is now a 4-run standing operator defect, and the planner paraphrase (F-64) is unfixed.** The cost this time was low only by luck (the un-pinned `warning` substrings happened to survive). The pure guards for BOTH defects are now landed (WP-257 `planLiteralGaps`, WP-261 `assessLaunchModeMismatch`) and BOTH proven against live defects — yet NEITHER is wired. Until the wires land, every grep-pinned chain stays one un-pinned literal away from a silent divergence.

**WP-261 → 🟡** (pure `detectIntendedSingleRun` + `assessLaunchModeMismatch` LANDED + proven against this run's own launch; the `cmdChain` REVISE/warn wire remains — now top priority). **WP-257 reinforced** (silent-divergence tail recurred, survived by luck). **New: F-72** (4th launch-mode divergence, reinforces WP-261/WP-257), **F-73** (🟢 the guard is proven against its own launch → §4 wire top priority). **Next dogfood headline: a thesis-stressing slice on a real unblocked product WP** — both the WP-261 `cmdChain` wire and the WP-257 `runPlannerPass` wire are operator-landed/track-B CLI-harness work, not headlines.
