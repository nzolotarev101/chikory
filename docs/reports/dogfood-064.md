# dogfood-064 — WP-254 pacing NUMERATOR (the pure live-resident-occupancy estimator half)

- **WP:** WP-254 (Pacing numerator: measure a `codex` step's LIVE window occupancy, not cumulative cross-turn throughput, 🟡) — the most-reinforced friction in the whole corpus (F-56, ~10 data points). The pacing DECISION (`decideContextWindowPacing`) is pure+correct and the DENOMINATOR was calibrated by WP-252 (`gpt-5.5`→400k); the OPEN defect is the NUMERATOR (`agent-loop.ts:350` feeds cumulative `spentTokens` as `currentInputTokens` → ~2× over-read). This run lands the PURE half: `estimateResidentContextTokens(parts: ResidentContextParts)` — the value the agent-loop SHOULD feed instead. The non-pure agent-loop feed swap is the SEPARATE §4 follow-up (operator-landed), exactly as the prior pure halves' wires were.
- **Date:** 2026-06-29
- **Spec:** `examples/dogfood/dogfood-064.yaml` (`dogfood-064-wp254-resident-occupancy`)
- **Run-id:** `run-6aa5081e-bda6-406a-b40f-ddf2355e17a5` (runtime HEAD `74875b9`)
- **Landed commit:** none yet — delivery is **STAGED** (`M` in index) on the working tree, byte-IDENTICAL to the run workspace (pack §5 = `IDENTICAL` ×3), pending the operator's harvest commit.
- **Gate verdict (pre-launch, recorded in the spec header):** ✅ **PROCEED** — §1.1 ✅ (cross-file `pacing.ts` extend + `index.ts` barrel + `pacing.test.ts`, 1–3 steps, real numeric failure surface: retained-TAIL slice direction, the `[0,length]` count clamp, folded-out exclusion, empty path, negative-`systemTokens` clamp, no input mutation — extends the existing pacing module, NOT a 1-file port) · §1.2 ✅ (real open plan.md §6 WP-254 🟡 product code on the context-rot/pacing named thesis pillar — it directly attacks F-56, the most-reinforced friction; NOT invented scaffolding) · §1.3 ✅ PROCEED (real product-WP thesis slice; UNBLOCKED and not §4-walled — the agent-loop feed swap is the §4 follow-up).

## Trace (excerpt)

```
run run-6aa5081e-bda6-406a-b40f-ddf2355e17a5 · SUCCESS · 1 steps · $0.01 / $5.00 · 37m 27s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Summary: Full `devbox run test` pas… 0/0              $0.00    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 100.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 0% (compact 0 · park 0) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps: 4`) |
| Executor / judge | `codex`/`openai` (`gpt-5.5`) · judge `openai-compat`/`gemini-3.1-pro-preview` (structurally different family ✓) |
| Step-1 status | ⚠️ **`FAILED` · killed: `step exceeded maxSeconds=600; killed (retriable: true)`** — yet the run sealed SUCCESS (see F-59) |
| Step-1 tokens | **0 in / 0 out** · 14 tool calls · **24m 32s** (the kill landed at **2.45× the 600 s cap**) — telemetry lost to the kill |
| Step-1 cost | **$0.0000** (telemetry lost) · diff `2f522a661c15` · **5,045 bytes** · transcript `6dd9450cb165` · 101,535 bytes |
| Judge pass #1 | **$0.0084** · 18,524 evidence bytes · **12m 54s** · ✓ PROCEED (2/2 criteria, 4/4 rubric, 0 failures) |
| Total cost | **$0.0084** (exact sum, steps + judge — ALL judge; the executor reported $0) = **0.2%** of $5 budget · judge share **100.0%** |
| Checkpoint | `…@4` · commit `ae70d991b0ee` · `lastGood true` (1 checkpoint, no resume, no rollback) |
| Pacing | 1 event · `peak window 0% (compact 0 · park 0)` — **F-56/WP-254 did NOT recur** this run (the kill zeroed the numerator it would have over-read; see below) |

**Acronyms / terms:** **WP** = work package (a plan.md unit of work). **AC** = acceptance criterion (a judge-executed `check`). **F-n** = globally-numbered friction finding. **harvest** = landing the run's workspace diff onto `main`. **`maxSeconds`** = the per-step wall-clock cap the runner kills a step at. **Resident occupancy** = the LIVE orchestration-context window going into the next step (system preamble + the retained TAIL of recent-step summaries after folding) — the value WP-254 wants the pacing numerator to read, NOT the codex subprocess's cumulative cross-turn throughput. **peak window %** = the calibrated pacing utilization (`projectedTokens / contextWindowTokens`). **park / compact** = the two context-window-pressure pacing branches.

---

## Delivery quality (human review, post-landing)

🟢 **Textbook one-shot, exactly to spec — despite the executor step being KILLED.** The deliverable was complete and on disk before the kill (the kill hit a redundant post-completion verification — F-59), and the judge graded the on-disk diff PROCEED. Three named files changed, nothing else (`git status --short` = the 3 files; harvest byte-diff §5 = `IDENTICAL` for all three). Line-by-line against the `goal`:

- **`packages/sdk-ts/src/runner/pacing.ts`** — adds the local `ResidentContextParts` interface (`systemTokens: number; recentSummaryTokens: number[]; retainedSummaryCount: number`) with the mandated JSDoc, and the pure `estimateResidentContextTokens(parts): number`. Semantics verified exact:
  - `retainedSummaryCount` clamped into `[0, recentSummaryTokens.length]` via `Math.max(0, Math.min(parts.retainedSummaryCount, parts.recentSummaryTokens.length))` ✓
  - TAIL slice: `parts.recentSummaryTokens.slice(-retainedSummaryCount)` when `> 0`, else `[]` — folding drops the OLDEST, so only the most-recent N count ✓
  - `Math.max(0, parts.systemTokens + summaryTokens)` — clamps a negative `systemTokens` result to 0 ✓
  - empty / `≤0` path → `Math.max(0, systemTokens)` (the `[]` branch) ✓
  - pure: `slice` + `reduce`, no mutation of `parts` or the array ✓
  - The existing `decideContextWindowPacing` / `ContextWindowUsage` / `ContextWindowPacingDecision` / `ContextWindowPacingPolicy` exports are untouched.
- **`packages/sdk-ts/src/index.ts`** — adds `estimateResidentContextTokens` and `type ResidentContextParts` to the SAME existing `./runner/pacing.js` re-export statement. Nothing else in the barrel changed.
- **`packages/sdk-ts/test/runner/pacing.test.ts`** — adds 6 focused cases under the existing describe block, covering every mandated path: (a) tail+preamble `100 + 30 + 40 = 170` (the LAST two of `[10,20,30,40]`, not the first two) ✓; (b) over-length count retains ALL (`100 + 10+20+30 = 160`) ✓; (c) `retainedSummaryCount: 0` and `-1` → `100` ✓; (d) empty `recentSummaryTokens` → `100` ✓; (e) negative `systemTokens: -100` → `0` ✓; (f) no-mutation snapshot (`toEqual` on the parts object + the array). No existing `decideContextWindowPacing` assertion removed or weakened.

**Scope discipline.** Exactly the three named files; `types.ts` and every contract untouched; no new dependency; the existing pacing exports unchanged. Additive-only.

**Independent re-verification (working tree, post-landing).** Both ACs re-run green against the working tree:
- **AC-1 — `exited 0`:** 4 grep-pins (`estimateResidentContextTokens` in `pacing.ts`/`index.ts`/`pacing.test.ts` + `ResidentContextParts` in `pacing.ts`) + scoped `vitest run test/runner/pacing.test.ts` → **11 passed** (1.08 s).
- **AC-2 — `exited 0`:** `tsc --noEmit` clean, `eslint .` clean, full `vitest run` → **521 passed | 19 skipped (80 files)**, incl. the real-Temporal `verdict-gating` (WP-132) ARMED seam path and `crash-recovery` (WP-123) kill-mid-run path.

The judge's own AC-1/AC-2 (`judge-executed check … exited 0`) were honest; all 4 rubric items (`tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`) pass with sane justifications. The judge is family-diverse (`codex`/openai executor vs Google `gemini-3.1-pro-preview`).

---

## New friction

Friction numbering is global/sequential; the highest prior is **F-58** (dogfood-061). This run adds **one** new finding, **F-59**, recurs **F-58**, and is the FIRST run since dogfood-057 where **F-56 did NOT recur** (and for a telling reason).

### F-59 / WP-255 (NEW, 🟡) — the executor step ran **2.45× past its `maxSeconds=600` wall-clock cap** doing redundant post-completion self-verification, was killed, and lost ALL its token/cost telemetry — the run only sealed SUCCESS because the judge grades on-disk artifacts, not executor liveness.

- **Evidence.** Step 1's journaled `failure` is `step exceeded maxSeconds=600; killed (retriable: true)`, yet the step's recorded duration is **24m 32s** — the kill landed **2.45× past** the 600 s (10 min) cap it claims to enforce. The step's own `summary` shows the work was already DONE before the kill: *"Full `devbox run test` passed: TypeScript suite `521 passed | 19 skipped`, Python suite `82 passed`, and harvest integration reported `PASS`. I'm doing a final status check to confirm only the three requested source/test files are modified."* — i.e. the executor had delivered the correct 5,045-byte diff AND run the full suite, then burned until the cap on a REDUNDANT re-verification of scope it had already satisfied.
- **Two distinct defects in one finding:**
  1. **The cap signals the direct child but does not reap the process TREE.** Root cause pinned in code: `runBounded` (`src/executors/process.ts:48-55`) arms a correct `setTimeout(maxSeconds*1000)` that fires `child.kill("SIGTERM")` then `SIGKILL` after a 5 s grace — but `child.kill` signals only the DIRECT child (`codex exec`), not its process GROUP. Codex spawns grandchild processes (sandbox/tool subprocesses) that keep the stdout/stderr pipes open, so the `close` handler (`process.ts:66`) — and therefore `proc.durationMs` and the whole step — does not resolve until those grandchildren exit naturally: **24m32s, 2.45× the 600 s cap**. The deadline fires on time; the tree just isn't reaped. A runaway step on a PAID executor could thus burn ~2.45× its intended wall-clock (and proportional cost) before it actually dies. Fix: `spawn(..., { detached: true })` + `process.kill(-child.pid, signal)` to signal the whole group (or a tree-kill).
  2. **Killing the step destroys its telemetry.** Step tokens read **0 in / 0 out** and cost **$0.00** (the codex adapter emits its usage record only at clean turn completion; the kill pre-empted it). Consequences: the **budget gate was blind** to executor spend this run (total cost reads $0.0084, all judge), and — ironically — the lost numerator is exactly why **F-56/WP-254 did not recur** (`peak window 0%`): the pacing event had no token input to over-read. The over-read this very run was launched to fix was masked by the kill, not absent.
- **Why this is thesis-relevant (and partly a WIN).** 🟢 The durable-execution + Agent-as-a-Judge layers RECOVERED a killed executor into a correct landing: the judge (different family) executed both ACs against the on-disk clone and sealed PROCEED, the checkpoint chain stayed consistent (`…@4`, `lastGood true`, no rollback, no duplicate journal entry, NOT retried despite `retriable: true`). This is the strongest organic crash-resilience demonstration in the campaign — an ACTUAL executor kill, not a seam — and it validates the WP-206 crash→resume pillar shape. 🟡 But the SAME event exposes the loose cap + telemetry-on-kill gap.
- **Spawns WP-255** (🟡): (a) reap the process TREE on cap overrun — `runBounded` should `spawn(..., { detached: true })` and `process.kill(-pid, SIGTERM/SIGKILL)` (or a tree-kill) so the step actually dies near `maxSeconds`, not 2.45× over; (b) preserve best-effort token/cost telemetry on a killed step (the codex adapter flushes partial usage before the kill, or the runner estimates from the transcript) so the budget gate and pacing numerator aren't blinded; (c) the deeper TRIGGER — the executor doing redundant post-completion verification after the ACs are objectively met — is the WP-217 completion-signal gap (no "ACs met → stop" signal to the executor); cross-reference, don't duplicate. The pure-first dogfoodable half (dogfood-065) is a `describeStepDeadline` telemetry descriptor — see §"Ready the next run".

### F-58 / WP-249 (recurs, 🟡 — no new WP) — delivery is again STAGED/uncommitted with no `Run-ID:` trailer; the harvest path bypasses `chikory land --verify`.

- The 3 delivery files sit `M` in the index (pack §5 = `IDENTICAL` ×3), to be harvested via `scripts/harvest.sh` + a manual `git commit` — which invokes no `land --verify`, no acceptance re-gate, and stamps no `Run-ID:`/`Ref: run-id:` trailer (`harvest.sh:212`). So F-57's failure mode (a harvest sweeping unrelated host files past the AC re-gate / breaking `main`'s lint gate while the dashboard reads green; run-id-less commit `dogfood-verify §6` can't resolve) stays reachable until the harvest adopts the re-gate. Track-B operational adoption; no new WP.

---

## Verdict on the thesis

🟢 **WP-254's pure numerator half landed clean — the corpus's most-reinforced friction (F-56, ~10 data points) now has its fix primitive in code.** `estimateResidentContextTokens` is the exact live-occupancy value the agent-loop should feed instead of cumulative `spentTokens`; the §4 feed swap (`agent-loop.ts:350`) is all that remains to retire F-56 at the source. Delivery is textbook: 3 files, additive, every contract untouched, all 6 mandated test paths, both ACs green on independent re-verification (521 passed | 19 skipped).

🟢 **The strongest organic crash-resilience signal yet: a KILLED executor recovered into a correct SUCCESS.** The product sells durable, self-correcting agents; this run's executor died (wall-clock kill, `retriable: true`) with the deliverable already on disk, and the judge-grades-artifacts + checkpoint machinery sealed a correct, lint-green landing without re-executing the step or corrupting the chain. Not a seam — a real kill.

🟡 **But the same kill exposed F-59 → WP-255:** the `maxSeconds=600` cap let the step run 2.45× over before engaging, and killing the step zeroed its telemetry — blinding the budget gate and (ironically) masking the very F-56 over-read this run targets. The pacing numerator can't be trusted as observability until BOTH the live-occupancy feed (WP-254 §4) AND telemetry-on-kill (WP-255) land. The deeper cause — the executor wasting ~14 min re-verifying scope it had already proven — is the WP-217 completion-signal gap recurring; an "ACs met → stop" signal would have ended the step minutes before the cap.

**Next:** the chosen headline is the strongest UNBLOCKED real-product thesis slice — see §"Ready the next run" below.
