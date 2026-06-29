# dogfood-061 — WP-249 fix-clause (c): `chikory land --verify` re-gates the LANDED commit

- **WP:** WP-249 fix-clause (c) — the breaking-build half of the harvest-hygiene WP. Threads the run's OWN journaled `acceptanceCriteria[].check`s into the existing `chikory land --verify` gate, re-run against the **landed commit's** working tree (not just the run's clean clone), FAIL-CLOSED (keep the commit, exit 1) on any red. Closes the dogfood-060 F-57 clone-green-≠-landed-green gap — the product's core thesis ("catch bad changes before they land") applied to the loop's own land step.
- **Date:** 2026-06-28
- **Spec:** `examples/dogfood/dogfood-061.yaml` (`dogfood-061-wp249-land-acceptance-regate`)
- **Run-id:** `run-f4dcc770-c9a6-4180-a0b6-28da39a60206` (runtime HEAD `ea29799`)
- **Landed commit:** none yet — delivery is **staged** (`M` in index) on the working tree, byte-IDENTICAL to the run workspace, pending the operator's harvest commit.
- **Gate verdict (pre-launch, recorded in the dogfood-060 review):** ✅ **PROCEED** — §1.1 ✅ (cross-file `land.ts`+`land.test.ts`, 2–4 steps, real failure surface: run-against-landed-tree, journal-default-vs-injectable, fail-closed keep-commit, ordering after `VERIFY_COMMANDS`, the count) · §1.2 ✅ (real open plan.md §6 WP-249 🔴 product code on the WP-220 landing primitive / gate-before-land seam, the documented fix-clause (c), NOT scaffolding) · §1.3 ✅ PROCEED (highest-priority 🔴 broken-build regression AND dogfoods the CORE thesis on the loop's own land step; judge-security pillar's dogfoodable surface exhausted, the override/WP-210-act/WP-250 are §4-walled).

## Trace (excerpt)

```
run run-f4dcc770-c9a6-4180-a0b6-28da39a60206 · SUCCESS · 1 steps · $1.28 / $5.00 · 4m 38s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented the `chikory land --ver… 965k/6.2k        $1.27    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.8%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 486% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps: 4`) |
| Executor / judge | `codex`/`openai` (`gpt-5.5`) · judge `openai-compat`/`gemini-3.1-pro-preview` (structurally different family ✓) |
| Step-1 tokens | **965,000 in / 6,200 out** · 27 tool calls · 3m 56s |
| Step-1 cost | **$1.2691** (estimated) · diff 6,123 bytes (`36f48440d668`) |
| Judge pass #1 | $0.0096 · 20,959 evidence bytes · 41s · ✓ PROCEED (2/2 criteria, 0 rubric failures) |
| Total cost | **$1.2787** (exact sum, steps + judge) = **25.6%** of $5 budget · judge share **0.8%** |
| Checkpoint | `…@4` · commit `ceaee6ad616d` · `lastGood true` (1 checkpoint, no resume) |
| Pacing | 1 event · `action park · projectedTokens 1,943,084 · utilization 4.85771` → `peak window 486% (compact 0 · park 1)` |

**Acronyms:** **WP** = work package (a plan.md unit of work). **AC** = acceptance criterion (a judge-executed `check`). **F-n** = globally-numbered friction finding. **harvest** = landing the run's workspace diff onto `main`. **Clone vs landed** = the run executes inside a fresh git clone of HEAD; the harvest is a separate commit on the host tree — the judge grades the clone, the harvest can add/omit files the clone never had. **Park** = the context-window pressure decision that declines to start the next step because its projected token cost exceeds the window.

---

## Delivery quality (human review, post-landing)

🟢 **Textbook one-shot, exactly to spec.** Both named files changed, nothing else (`git status --short` = the 2 files; harvest byte-diff §5 = `IDENTICAL` for both). Line-by-line against the `goal`:

- `src/cli/land.ts`:
  - New injectable `LandDeps.loadAcceptanceChecks?: (runId, dataDir) => string[]` with the mandated JSDoc (land.ts:18-20). ✓
  - `defaultLoadAcceptanceChecks` (land.ts:63-69) opens `new Journal(journalPath(dataDir ?? ".chikory", runId))`, reads `getRun()?.task.acceptanceCriteria ?? []`, filters non-empty `check` strings, returns them — the `requireSpec` shape. ✓ The `dataDir ?? ".chikory"` guard is a **correct, in-scope addition** (not spec drift): `journalPath(dataDir: string, …)` requires a `string` but the dep signature passes `string | undefined`; `".chikory"` is the canonical `DEFAULT_DATA_DIR` (`runner/paths.ts:7`). ✓
  - The acceptance gate (land.ts:140-150) runs **after** the `VERIFY_COMMANDS` loop, inside the `args.verify === true` block, reusing the same `runCheck(check, repo)` against the **landed** `repo` tree, fail-closed `return 1` **after** the commit (keep-commit contract preserved), exact error strings. ✓
  - Success surfacing: non-json `acceptance: N/N checks green` next to `verified:`; json adds `acceptanceChecks: acceptanceChecks.length`. The `args.verify !== true` paths are byte-identical. ✓
- `test/cli/land.test.ts`: two new cases — passing (`acceptance: 1/1 checks green`, commit present, `runCheck` called with `[...VERIFY_COMMANDS, "grep -q SOMETHING file"]`) and fail-closed (`__ac_fails__` throws only for itself, exit 1, `err` contains both lines, commit STILL on branch via re-`rev-parse`). No existing assertion weakened. ✓

**Independent re-gate (pack §3):** AC-1 PASS (exit 0 — 4 grep-pins + `vitest test/cli/land.test.ts` = 10 passed) · AC-2 PASS (exit 0 — `tsc --noEmit && eslint . && vitest run` = 505 passed | 19 skipped). No new dependency; `VERIFY_COMMANDS`, the journal/TaskSpec contracts, and `types.ts` untouched. Additive.

**Anomaly checklist:** no wasted/filler steps (1 step, `changes made 1`, `issues:changes 0:1`). Cost telemetry healthy — `$1.2691` step + `$0.0096` judge, both nonzero and priced (no `.00`/F-9). Judge checks genuinely executed (`exited 0` recorded, both ACs), family diversity real (Google `gemini-3.1-pro-preview` judge ≠ OpenAI `codex` executor via the keyless shim). No escalate/rollback/injection. Loop integrity clean: 1 checkpoint `lastGood true`, no resume, single journal. The empty-diff probe step (F-11) did not recur (`s0 j@0`).

## Token economics (baseline for WP-203/WP-207)

965,000 in / 6,200 out for the single step — a **new series-high input** (dogfood-057 898k → -059 734k → -060 775k → **-061 965k**). 27 tool calls. The huge input is cumulative cross-turn throughput of one codex subprocess, not live per-step window occupancy — the standing WP-254 numerator issue (below).

## New friction

### F-58 / WP-249 (stays open, de-escalated 🔴→🟡) — clause (c) shipped to the *product* `chikory land`, but the dogfood loop's harvest path BYPASSES it, so F-57's failure mode is still reachable.

**Evidence.** This run landed clause (c) into `chikory land --verify` — and inspection shows `chikory land` *already* satisfied clauses (a) and (b) too: it commits **only** the run's net workspace diff (clause a, inherent to `cmdLand`) and stamps `Run-ID: ${args.runId}` into the commit body (`land.ts:122`, clause b). **So all three WP-249 clauses now exist in the product `chikory land` path.** But the dogfood loop does **not** harvest via `chikory land` — `scripts/harvest.sh` stages the workspace diff and prints a manual `git commit -m "feat(<scope>): <message>"` hint (`harvest.sh:212`); it invokes no `land --verify`, no acceptance re-gate, and stamps no `Run-ID:` trailer. Consequently the exact F-57 regression (harvest sweeps unrelated host files / breaks `main`'s lint gate while the dashboard reads green; commit cites no run-id so `dogfood-verify §6` / `git log --grep <run-id>` can't resolve) **remains reachable on the next harvest** — the product fix is necessary but not yet adopted by the loop that needs it.

**WP it spawns.** Folds into **WP-249** (stays open; de-escalate 🔴→🟡 — the breaking-build *capability* exists in `chikory land`, so it is no longer un-built loop-integrity debt, but it is unwired in the harvest). WP-249's remaining work is now **operational adoption**: route the dogfood harvest through `chikory land --verify` (or have `harvest.sh` re-run the run's ACs against the staged tree + stamp the `Ref: run-id:` trailer it already knows). This is `harvest.sh` / operator tooling, **track-B** — not a failable product-dogfood headline.

### F-56 / WP-254 (recurs, 🟡 — no new WP) — the calibrated pacing metric still over-reads on `codex` steps; this run is the 9th data point AND the first calibrated *park*.

**Evidence.** The journaled `pacing` entry reads `action park · projectedTokens 1,943,084 · remainingTokens -1,543,084 · utilization 4.85771`. Back out the denominator: `1,943,084 / 4.85771 ≈ 400,000` — i.e. the WP-252 calibration **is live** (gpt-5.5 → 400k, not the legacy 200k; on 200k this would have read ~970%). 🟢 That confirms WP-252 end-to-end (see below). **But** the run still **parked**: `estimatedNextStepTokens (≈970k) > window (400k)` because the numerator sums one fresh codex subprocess's 27-internal-turn throughput as if it were live window occupancy — the WP-254 numerator bug, unchanged. 9th F-54/F-56 park data point (602/604/759/585/334/904/370/392/**486**%). Already tracked by WP-254 ("hard-to-spec measurement fix"); no new WP.

### 🟢 Positive — WP-252 calibration CLOSED by a live *park* read; WP-251 fold still unobserved.

dogfood-058 first observed the calibrated denominator on a `compact` (179% @ 400k); this run is the first calibrated **park** read (486% @ 400k), independently confirming `resolveContextWindowForSpec` resolves the executor's `routing.stages.code.model` (`gpt-5.5`→400k) on the park branch too. **WP-252's residual close-when-observed is fully discharged.** Note this does *not* close WP-251 (observe a real *compaction fold* live) — that still requires a multi-step run tuned so steps don't park but history folds.

## Verdict on the thesis

🟢 The product can now re-gate the landed commit (clone-green-≠-landed-green is closable), and the Agent-as-a-Judge graded honestly on a structurally-different family. The deeper lesson is **dogfood-meta**: shipping the fix to `chikory land` does not fix the loop until the harvest path adopts it (F-58). The thesis — real-time gates that catch bad changes before they land — is now *implemented* on the loop's own land step; closing the gap end-to-end is an adoption task, not a code-capability one.
