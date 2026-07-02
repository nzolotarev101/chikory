# dogfood-075 — WP-212 `chikory inject` DELIVERED (functionally complete + live-proven), but the run sealed **FAILED** on a self-inflicted AC — the FIRST loose-spec headline exposed a loose-AC authoring hazard (F-82)

- **WP:** WP-212 / requirement OB-2 — give the operator `chikory inject <run-id> "<guidance>"` so a durable run can be STEERED mid-flight (guidance reaches the next step + is journaled) without killing it. The durable SUBSTRATE already existed (`injectSignal` handler `agent-loop.ts:140` → `pendingInjections` → next-step context `agent-loop.ts:365`; journaled kind `injection` `activities.ts:738`; `RunHandle.inject(guidance)` `runner.ts:89`); the open gap was purely the CLI surface. **This was the FIRST `spec_format=loose` headline** — the deliberate graduation off the prescribed-diff track (74 straight prescribed runs, progression gate ⛔ STALLED).
- **Date:** 2026-07-02
- **Spec:** `examples/dogfood/dogfood-075.yaml` (`dogfood-075-wp212-chikory-inject`, LOOSE format, ladder-rung 1) — launched as a single `chikory run` (4th consecutive correct launch; the 067–071 divergence streak stays broken).
- **Run-id:** `run-bb715500-c0d7-44af-a4e6-9d96dd4512f5`. Runtime HEAD `bf0bcb1`.
- **Terminal state:** ⚠️ **FAILED** — `judge HALT: criterion AC-1 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)` @ step 3. **But the delivery is functionally COMPLETE and all-green** (see below) — the FAILED is an AC-authoring artifact, not a delivery defect.
- **Landed commit:** none yet — **3 files STAGED, uncommitted** on the working tree (`packages/sdk-ts/src/cli/commands.ts` +28, `src/cli/main.ts` +14, `test/cli/cli.test.ts` +~55), all three byte-**IDENTICAL** to the run workspace (pack §5 all `IDENTICAL`). Left for operator review per dogfood-review §4.

## Trace (single run, 3 steps)

```
run run-bb715500-… · FAILED · 3 steps · $3.85 / $6.00 · 17m 28s · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)

 #   step deliverable                                     tokens(in/out)  step$     judge$    verdict            dur / tools
 1   NEW cmdInject + main.ts dispatch + live inject test  1299k/9.4k      $1.7183   $0.0077   ✓ PROCEED (1/2)    4m40s / 45 tools
 2   strengthen live test (journal + context snapshot)    1032k/7.9k      $1.3691   $0.0063   ✓ PROCEED (1/2)    3m37s / 48 tools
 3   add empty-guidance guard at command boundary         549k/5.6k       $0.7424   $0.0064   ⛔ HALT             2m51s / 26 tools

totals: 3 decisions · 3 judge passes · $3.8502 total (exact sum) · judge $0.0204 (0.5%) · 0 rollbacks · 0 escalations · 0 injections
        budget 64.2% of $6.00 · checkpoints …@4 (lastGood) / …@9 (lastGood) / …@14 · family diversity real (codex/openai ≠ judge gemini via shim)
        HALT saved ~$2.15: guard fired at 3 consecutive AC-1 fails instead of burning to the $6 cap
```

Every judge pass ran the two ACs as judge-executed checks: **AC-2 (`tsc && eslint && vitest run`) exited 0 on ALL THREE steps**; **AC-1 (a grep bundle) failed on all three** — and its 3-consecutive-fail streak is what tripped the HALT guard.

## Delivery quality (human review, post-landing) — 🟢 COMPLETE, the FAILED is spurious

Reviewed the landed diff line-by-line against the goal's OUTCOME clauses. **Every outcome the goal names is delivered, and the live durable test proves the end-to-end steer works.**

| Goal OUTCOME clause | Delivered | ✓ |
|---|---|---|
| `chikory inject <run-id> "<guidance>"` resolves the durable handle + delivers via the EXISTING `RunHandle.inject`/`SIGNAL_INJECT` path (no second mechanism, no workflow/journal/contract change) | `cmdInject` (`commands.ts:448`): `createTemporalRunner(...)` → `runner.get(runId)` → `handle.inject(guidance)`, `runner.close()` in `finally` — exact mirror of `cmdCancel` | 🟢 |
| Registered in `main.ts` dispatch next to `approve`/`cancel` | `case "inject"` at `main.ts:262` + parse case + help text (`main.ts:42`) | 🟢 |
| Guidance reaches the run: journaled as kind-`injection` with payload text VERBATIM + spliced into next step context | live test asserts `journal.entries("injection")` len 1, `injection.text === guidance`, AND the matching checkpoint's `context.injections` contains the sentinel | 🟢 |
| Missing run-id OR missing/empty guidance → actionable stderr + nonzero exit; success → ack + exit 0 | test drives `["inject"]`→1 (`missing run-id`), `["inject","run-nope"]`→1, `["inject","run-nope",""]`→1 (`missing guidance text`); success prints `guidance delivered to <run-id>` exit 0 | 🟢 |
| REAL behavioral test (no mocking the durable layer), ≥2-step run, inject mid-run mirroring the live `cmdCancel` timing pattern, distinctive greppable sentinel | live Temporal-backed test with sentinel `WP-212-INJECT-SENTINEL preserve this exact guidance`, fired between step-1 journal and run completion | 🟢 |
| CONSTRAINTS: strict TS, ESM `.js` imports, named exports, no new dep, change confined to CLI surface + one test | confirmed — only `commands.ts`/`main.ts`/`cli.test.ts` touched (pack §4); no `types.ts`/`workflow/`/`activities.ts`/contract change; no dep | 🟢 |

- **AC-2 re-run against the working tree: PASS** — `tsc --noEmit` + `eslint .` + `vitest run` → **589 passed | 19 skipped (88 test files)**, incl. the new live inject test. The `chikory inject` command works end-to-end over the real durable layer.
- **Harvest:** all 3 files byte-IDENTICAL to the run workspace (pack §5). ✓
- **Scope discipline:** exactly the CLI surface + one test; no substrate/contract touched. ✓

**Verdict on the delivery: WP-212 is functionally DONE.** The operator can now steer a live run; the guidance lands in the journal and the next step's context verbatim.

## Why it sealed FAILED — the root cause is the spec's own AC-1, not the code

AC-1's `check` is a grep bundle that includes two file-layout pins:

```
test -f test/cli/inject.test.ts && grep -q '"inject"' test/cli/inject.test.ts && grep -q 'injection' test/cli/inject.test.ts
```

It hard-requires a **NEW file named exactly `test/cli/inject.test.ts`**. But the same spec's GOAL says the test must *"mirror the live `cmdCancel` timing pattern in `test/cli/cli.test.ts`"* and explicitly states *"the implementation/file-layout is LEFT TO THE EXECUTOR."* The executor did the sensible, goal-faithful thing — it **extended the existing `test/cli/cli.test.ts`** (where the sibling `cmdCancel` live test already lives) rather than spawning a parallel `inject.test.ts`. Result: `test -f test/cli/inject.test.ts` can **never** pass, so AC-1 fails on every step regardless of how correct the code is.

The other AC-1 clauses all *pass* against the delivery (`grep 'case "inject"' main.ts` ✓, `grep '\.inject(' commands.ts` ✓, `! grep 'defineSignal' commands.ts` ✓). Only the filename pin is unsatisfiable.

This is the **loose-track's first authoring hazard, made concrete**: a LOOSE spec (goal delegates file layout) whose AC nonetheless **pins a file-layout implementation detail** the goal disclaimed — and, worse, one that *contradicts* the goal's own "mirror `cmdCancel` in `cli.test.ts`" steer. Steps 2–3 (~$2.11, 55% of the run) were the executor chasing this phantom: step 2 strengthened the (correctly-located) test; step 3 added a redundant command-boundary empty-guidance guard — neither could satisfy `test -f inject.test.ts`, so the guard HALTed at the 3rd consecutive AC-1 fail.

## Thesis wins (record them — this run stressed real mechanisms)

- 🟢 **The goal-drift / budget-waste HALT guard fired correctly.** 3 consecutive same-criterion failures → HALT at $3.85, saving ~$2.15 of the $6 budget from being burned on an unsatisfiable criterion. This is exactly the "break the loop / don't waste budget" mechanism the thesis promises — a *true positive on "AC-1 keeps failing,"* even though (this time) the underlying cause was a bad AC, not drifting code. **Note the asymmetry:** the guard is only as good as the criterion it guards; a mis-authored AC turns a correct guard into a spurious FAILED. (No WP — the guard behaved as designed.)
- 🟢 **The durable inject substrate is proven end-to-end by the run's own live test** — an operator-issued `inject` reaches `pendingInjections`, is journaled as kind-`injection` with the payload verbatim, and appears in the next step's `context.injections`. The HITL steer pillar (OB-2) now has a working operator surface AND a live regression test.
- 🟢 **Family diversity real** — codex/`gpt-5.5` executor vs `gemini-3.1-pro-preview` judge via the openai-compat shim.
- 🟢 **Correct launch mode** — single `chikory run`, full goal verbatim to the executor (4th consecutive correct launch; no F-64 paraphrase surface since it was not a chain).

## New friction

Friction numbering is global + sequential; the highest prior is **F-81** (dogfood-071 review / plan.md §6 — the `parseWpStatus` schema fix). This run surfaces **one** new numbered friction.

### 🔴 F-82 → WP-266 — a LOOSE-spec AC must anchor on OUTCOME symbols, never pin the file layout the goal delegates

- **Evidence:** dogfood-075 AC-1 pins `test -f test/cli/inject.test.ts`. The goal declares file layout is the executor's to choose AND points the test at `test/cli/cli.test.ts`. The executor followed the goal, extended `cli.test.ts`, and delivered a complete, all-green, live-proven `chikory inject` — yet the run sealed **FAILED** because the AC demanded a filename the goal never mandated. ~$2.11 (steps 2–3) was spent chasing the phantom before the HALT guard stopped it.
- **Why it matters (loop-integrity, 🔴):** this is the *first* loose headline, and it exposes the exact failure mode the loose track will hit repeatedly at higher rungs (rung 2 is ≥10 steps / ~$15–40): a mis-scoped AC produces a **false FAILED on correct work** and burns real budget. Prescribed-diff specs never hit this because the diff *was* the file layout; loose specs decouple the two, so the AC must test the OUTCOME (does `chikory inject` exist, dispatch to `handle.inject`, journal the guidance?), grepping only symbols the goal itself names — never `test -f <a-specific-new-file>` for a file the goal left to the executor.
- **Fix → WP-266 (track-B):** a mechanical **loose-spec AC lint** in `scripts/dogfood-progression.sh --spec` (the format linter already in the phase-0 pack): when a spec's header declares LOOSE, reject any AC `check` that pins file layout the goal delegates — specifically `test -f <path>` / `test -e <path>` / `grep … <specific-new-test-file>` referencing a NEW file the goal does not name. Pair it with the DOGFOODING §3 authoring rule below. Until the lint lands, the rule is applied by hand at spec-authoring time.
- **NOT a judge WP:** the judge did its job — it ran AC-1, saw it fail 3×, and HALTed per the guard. The defect is upstream (spec authoring). No judge change.

### ℹ️ Token-economics baseline (WP-203 / WP-207 data, no friction)

- **1,299k + 1,032k + 549k = 2,880k input / 22.9k output across 3 steps, 119 tool calls, 17m28s, $3.85.** Step 1 alone (1,299k input) is comparable to dogfood-074's 1,477k high-water for a smaller net delivery — codex verbosity lineage (F-77/F-80), not task size. Steps 2–3 (1,581k input combined) were pure phantom-AC churn (F-82) — the clearest signal yet that input-token spend does not track productive work when the AC is unsatisfiable. Baseline for WP-203 (context rot) / WP-207 (pacing).

### 🟡 F-58 / WP-249 reinforced — delivery STAGED, no `Run-ID:` trailer, not harvested via `chikory land --verify`

- Same standing pattern as 070–074: pack §6 `no landed commit found`. WP-249's track-B harvest-adoption remainder already owns this; no new WP.

## Verdict on the thesis

🟡🟢 **A productive FAILED — the most informative run since the prescribed era began.** The loose track graduated (first `spec_format=loose` headline; progression gate flipped ⛔ STALLED → ✅ PROGRESSING: rung 0→1, loose 0→1, max steps 2→3), it delivered a real product WP (WP-212 `chikory inject`, functionally complete + live-proven, the operator steer tool every longer rung depends on), AND it stress-tested two thesis mechanisms for real: the budget-waste HALT guard fired correctly, and the durable inject substrate was proven end-to-end. It also caught the loose-track's first authoring hazard (F-82) *cheaply* — at rung 1's small blast radius rather than at rung 2's ≥10-step / ~$15–40 scale. The one caveat the run makes vivid: **a correct guard on a mis-authored criterion still yields a spurious FAILED** — the loose track's ACs must be outcome-anchored (WP-266) before we scale horizon.
