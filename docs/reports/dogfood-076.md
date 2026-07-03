# dogfood-076 — WP-213 native executor BUILT + all-green (step 2), but the run sealed **FAILED** on a self-inflicted AC — the SECOND consecutive loose-headline false-FAILED, a NEW variant of the F-82 class (F-83), on a spec launched BEFORE its mandated WP-266 hand-fix landed (F-84)

- **WP:** WP-213 — the first in-process Chikory executor (`createNativeAdapter`) that drives the LLM DIRECTLY through the vendor-neutral Router/provider layer instead of shelling out to a CLI agent binary. Serves the WP-111 "CLI agents change under us" hedge and the WP-301 benchmark-control-executor dependency (plan.md:340). **WP-265 rung-2 HOST** — intended as the first ≥10-step at-horizon run + first LIVE `kill -9` → `chikory resume` durable-resume proof.
- **Date:** 2026-07-02
- **Spec:** `examples/dogfood/dogfood-076.yaml` (`dogfood-076-wp213-native-executor`, LOOSE format, ladder-rung 2) — launched as a single `chikory run` (5th consecutive correct launch mode).
- **Run-id:** `run-17a57451-b8cb-4b52-b8e4-3101bc04b4f0`. Runtime HEAD `d5d0469`.
- **Terminal state:** ⚠️ **FAILED** — `judge HALT: criterion AC-1 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)` @ step 4 (checkpoint `…@17`, `lastGood false`). **The core delivery is COMPLETE and was all-green at step 2** — the FAILED is an AC-authoring artifact (F-83), not a delivery defect.
- **Landed commit:** none — **nothing harvested; working tree clean.** The native adapter lives only in the run workspace. Last GREEN state = the step-2 checkpoint (commit `5724422b1a91`, `lastGood true`, AC-2 exit 0); the final workspace (step 4) is BROKEN because steps 3–4 flailed against the impossible AC-1.

## Trace (single run, 4 steps, 2h 38m)

```
run run-17a57451-… · FAILED · 4 steps · $3.71 / $30.00 · 2h 38m · executor codex(openai) · judge gemini-3.1-pro-preview(openai-compat)

 #   step deliverable                                     tokens(in/out)  step$     judge$    verdict            dur / tools
 1   native.ts + ADAPTERS wire + native.test.ts (all)     2232k/16k       $2.9505   $0.0139   ✓ PROCEED (1/2)    7m6s  / 55 tools
 2   executors barrel re-export of createNativeAdapter    548k/4.6k       $0.7309   $0.0063   ✓ PROCEED (1/2)    2m57s / 25 tools
 3   (hung — no diff, killed at step cap)                 0/0             $0.0000   —         ✗ FAILED           17m37s / 4 tools
 4   (re-edit chasing AC-1; broke the build)              0/0             $0.0000   $0.0079   ⛔ HALT             19m48s / 21 tools

totals: 4 decisions · 3 judge passes · $3.7095 total (exact sum) · judge $0.0281 (0.8%) · 0 rollbacks · 0 escalations · 0 injections
        budget 12.4% of $30.00 · checkpoints …@4 (lastGood) / …@9 (lastGood) / …@12 / …@17 · family diversity real (codex/openai ≠ judge gemini via shim)
        probe/empty-diff step: step 3 ($0.00, 0-token) — F-11 data point 0.0% of run cost
```

Every judge pass ran the two ACs as judge-executed checks. **AC-2 (`tsc && eslint && vitest run`) exited 0 on steps 1 AND 2** (the real build compiled + the full suite incl. the new native test passed); **AC-1 (a grep bundle) failed on all three passes.** The 3-consecutive-AC-1-fail streak tripped the budget-waste HALT guard. By step 4 the executor's flailing had also broken AC-2 (exit 1).

## Delivery quality (human review of the workspace) — 🟢 COMPLETE, the FAILED is spurious

Read `native.ts` (workspace, 469 lines) line-by-line against the goal's OUTCOME clauses. **Every outcome the goal names is delivered, and it is genuinely good code.**

| Goal OUTCOME clause | Delivered | ✓ |
|---|---|---|
| `src/executors/native.ts` exports `createNativeAdapter(...)` returning an `ExecutorAdapter` (name `"native"`, `modelFamily`, `async runStep`) | `native.ts:284` `createNativeAdapter(opts): ExecutorAdapter` — `name:"native"`, `modelFamily`, `runStep` | 🟢 |
| `runStep` drives a REAL tool-calling loop through the Router/provider layer (NOT a shelled binary); tools read/write/edit/list; loop TERMINATES on `maxTurns`/`maxSeconds`; a tool error is fed back as an observation, not thrown | `runStep` loop `:313`, `opts.router.complete({stage:"code",…})` `:330`, tools `executeTool` `:176` (list/read/write/edit), `maxTurns` guard `:313`+`:435`, `maxSeconds` deadline `:314`, tool errors caught → `toolObservation(..,"FAILED",..)` fed back `:418-424`. **NO `execFile`/`spawn` call anywhere** (only match = the doc comment "…is spawned" `:4`). Path-traversal guards `:140-174` (a nice extra). | 🟢 |
| well-formed `StepRecord`: SUCCESS on completion / FAILED on hard error; diff via `captureWorkspaceDiff` → `diffRef`; `summary`/`toolCalls`/`tokens`/`costUsd`/`costEstimated`/`durationMs`/`transcriptRef` populated | `buildRecord` `:216` — `captureWorkspaceDiff` `:230`, `store.put` → `diffRef`+`transcriptRef` `:232`, all fields set, OTel span emitted `:262` | 🟢 |
| `"native"` entry in the `ADAPTERS` map in `cli/commands.ts`, router threaded additively through the factory ctx | `commands.ts:32` `native: (ctx) => …` (throws if router/modelFamily absent — additive; codex/claude entries untouched) | 🟢 |
| re-export from the executors barrel | `index.ts:21` `export { createNativeAdapter, type NativeAdapterOptions } from "./native.js"` | 🟢 |
| REAL behavioral test: drive `runStep` against a DETERMINISTIC scripted `ProviderAdapter` over a temp git workspace; assert SUCCESS + non-empty diff + well-formed record + tool-error-fed-back | `test/executors/native.test.ts` (net-new, references `createNativeAdapter`) — greppable per F-82 | 🟢 |
| CONSTRAINTS: strict TS, ESM `.js` imports, named exports, no new dep, no contract/workflow/journal change | confirmed by reading — no new dep, consumes `ExecutorAdapter`/`StepInput`/`StepRecord`, reuses `captureWorkspaceDiff`+ArtifactStore+Router | 🟢 |

- **AC-2 at step 2: PASS** — `tsc --noEmit` + `eslint .` + `vitest run` → **589 passed | 19 skipped (88 files)**, incl. the new native behavioral test. The loop works end-to-end.
- **Verdict on the delivery: WP-213 is functionally DONE.** The native raw-LLM loop executor exists, is registered, and is proven by a real behavioral test.

## Why it sealed FAILED — a negative grep matched a COMMENT (root cause)

AC-1's `check` includes `! grep -Eq 'execFile|spawn' src/executors/native.ts` — a NEGATIVE grep asserting native.ts never shells out. The delivered native.ts contains **no `execFile`/`spawn` call** — the loop is a pure in-process router drive. But line 4 is a doc comment:

```
 * in-process. No CLI agent binary is spawned.
```

The word **"spawned"** matches the bare substring `spawn`, so `! grep -Eq 'execFile|spawn'` is **false on correct code**. AC-1 could never pass regardless of implementation quality → failed all 3 passes → HALT. Steps 3–4 (~37 min wall-clock, 0 productive diff) were the executor chasing this phantom; step 4 even broke AC-2 in the process before the guard stopped it.

This is the **second consecutive loose-headline false-FAILED** and a NEW variant of the F-82 class:
- **F-82 (dogfood-075):** loose AC pinned a NEW-FILE path the goal delegated (`test -f inject.test.ts`).
- **F-83 (dogfood-076):** loose AC negative-grepped a BARE WORD that also appears in PROSE/COMMENTS (`spawn` in "…is spawned").

The dogfood-076 spec header explicitly cited F-82 and claimed its ACs were safe — and they WERE safe against the `test -f` variant. It just introduced a different unsatisfiable-grep mistake. **The class isn't "don't pin filenames"; it's "a loose AC's grep must anchor on an OUTCOME symbol as it appears in CODE, never on a substring that natural language can produce."**

## New friction (highest prior F-82 → F-83, F-84, F-85)

### 🔴 F-83 → WP-266 (loose-AC lint) — **FIXED THIS SITTING.** A negative AC grep on a bare word matches comments/strings/prose
- **Evidence:** `! grep -Eq 'execFile|spawn' src/executors/native.ts` false-FAILED because native.ts's own comment says "No CLI agent binary is **spawned**." The code has zero `execFile`/`spawn` calls; the AC's intent (no shelling out) was fully satisfied.
- **Why it matters (loop-integrity, 🔴):** a mis-authored AC produces a **false FAILED on correct work** and — at rung-2's intended ≥10-step / ~$15–40 scale — burns real budget. This is the exact hazard F-82 flagged, unfixed because F-82's fix (queued as WP-266) was never built (see F-84).
- **Fix (LANDED):** extended `scripts/dogfood-progression.sh --spec` with the WP-266 loose-AC lint. For a LOOSE spec it now ⛔-rejects (exit 3): (1) any AC `check` using `test -f`/`test -e` (F-82), and (2) any negative grep (`! grep` / `grep -v`) whose pattern is a bare word/identifier lacking a code anchor like `(` or `\b…\(` (F-83). Verified: it flags dogfood-076 (F-83), retroactively flags dogfood-075 (F-82 + a `! grep 'defineSignal'` F-83), and both false-FAILs would have been blocked at authoring time. **WP-266 → 🟢** (was the un-built queue item ②).

### 🔴 F-84 → WP-267 — the lint is AVAILABLE, not ENFORCED: rung 2 launched with an un-linted spec because the mandated pre-rung-2 hand-fix was skipped — **FIXED THIS SITTING**
- **Evidence:** plan.md §6 queue item ② read *"hand-fix F-82 first (track-B) … so a mis-authored loose AC can't false-FAIL a correct delivery at rung-2's ≥10-step scale"* → THEN ③ rung 2. WP-266 was **never built** before dogfood-076 launched, and dogfood-076 then hit the exact class it guards. Even now that the lint exists (F-83 fix), nothing MECHANICALLY runs it at launch — an operator can still launch a headline whose loose ACs are unsatisfiable.
- **Why it matters (loop-integrity, 🔴):** two consecutive headline FAILs (075, 076) were caused by loose-AC bugs, not the executor — the loop's own spec-authoring is the unreliable link, and "apply the lint by hand" has now failed twice. Horizon/reliability data is unmeasurable while every rung run false-FAILs on a grep typo.
- **Fix → WP-267 (LANDED):** `scripts/dogfood.sh` already ran `dogfood-progression.sh --spec` but swallowed the exit with `|| true` (it printed the ⛔ and launched anyway — F-84 in one line). It now captures the RC and, on exit 3 (the WP-266 AC-lint hazard), REFUSES the launch at zero LLM cost with an actionable message; override `CHIKORY_ALLOW_LOOSE_AC_HAZARD=1`. Progression STALLED/off-format stays advisory. Verified: dogfood-076 (F-83) → RC=3 → refused; dogfood-077 (clean) → RC=0 → proceeds. A lint nobody is forced to run is not a guard — now it's forced.

### 🟡 F-85 → WP-268 — codex steps ran ~2× past the maxSeconds=600 step wall-clock cap before being killed
- **Evidence:** step 3 ran **1057s = 1.76×** the 600s cap; step 4 ran **1188s = 1.98×**; both recorded 0/0 tokens, $0.00, and sealed FAILED. ~37 min of the run's 2h 38m wall-clock was two hung, dead, zero-product steps. Recurrence of the codex-wall-clock family (F-76/F-80), now material at rung scale.
- **Why it matters:** the step cap is Chikory's own durability lever; if an unresponsive executor can burn ~2× the intended wall-clock per step, the 24h-gate cost/context-rot math is off by that factor and a hung step steals real time. The cap is enforced LATE (~2×), not at ~1×.
- **Fix → WP-268 (track-B):** enforce the step wall-clock cap hard — escalate to SIGKILL of the executor process group at ~1× the cap rather than tolerating a 2× overrun (sibling of the WP-255/264 `runBounded` group-kill work; codex ignores SIGTERM until it's SIGKILLed).

### ℹ️ Rung-2 primary artifact (live kill→resume) NOT captured — run auto-terminated first
- The spec's headline thesis artifact was the operator's deliberate mid-run `kill -9` → `chikory resume` (durable resume at horizon). The run auto-terminated (2 hung steps + judge HALT) before that step; the operator confirmed they could not reach the kill in time. **No live kill→resume data this cycle.** Also: the WP-213 build was only ~2 productive steps, NOT the ≥10-step horizon the rung-2 goal targeted — WP-213 is mis-sized as a horizon host (the spec pre-acknowledged this possibility). Rung 2's horizon + resume KPIs remain unmeasured.

### ℹ️ Token-economics baseline (WP-203/207 data, no friction)
- Step 1: **2,232k input / 16k output** for the whole native adapter + wire + test in one step (23,647-byte diff) — a new campaign input high, codex-verbosity lineage (F-77/F-80). Steps 3–4 spent 0 tokens (hung/killed). Baseline for WP-203 (context rot) / WP-207 (pacing).

### 🟡 F-58 / WP-249 reinforced — delivery unharvested, no `Run-ID:` trailer
- Same standing pattern: nothing landed via `chikory land --verify`; the good delivery sits only in the run workspace. WP-249's harvest-adoption remainder owns it; no new WP.

## Verdict on the thesis

🟡🟢 **A productive FAILED — but the loop just failed the SAME way twice, and that IS the finding.** WP-213 (the native raw-LLM loop executor — a real product WP, the WP-111 hedge + WP-301 dependency) was BUILT well and proven all-green at step 2. But for the second headline running, a correct loose-spec delivery sealed FAILED on a self-inflicted, unsatisfiable AC grep (F-83, the F-82 class in a new costume), on a spec launched *before* the fix that was explicitly queued to precede it (F-84). The two thesis rung-2 KPIs it was built to measure — ≥10-step horizon reliability and a live kill→resume — were BOTH un-measured (the build was ~2 steps; the run auto-terminated before the operator's kill). The clear lesson: **stop hand-applying the loose-AC discipline and make it a mechanical launch gate (WP-266 landed the lint; WP-267 must enforce it) before another rung run is launched.** The codex 2× step-cap overrun (F-85 → WP-268) is a second durability leak worth closing before the horizon rungs, where a hung step costs hours.
