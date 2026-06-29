# dogfood-059 — WP-215 S4: pure new-dependency scan primitive

- **WP:** WP-215 S4 (the dependency-scan half of the Agent-as-a-Judge security/architecture rubric — the dependency analog of the landed secret-scan chain S1 `scanDiffForSecrets` dogfood-054 → S2 evidence wire dogfood-055 → S3 allowlist dogfood-056). A pure first slice; the live judge-evidence wire that consumes it is the SEPARATE WP-215 S5 follow-up.
- **Date:** 2026-06-28
- **Spec:** `examples/dogfood/dogfood-059.yaml` (`dogfood-059-wp215-dependency-scan`)
- **Run-id:** `run-bc841ce6-ad2c-4356-bb49-355a7a7b6637` (runtime HEAD `00b31e8`)
- **Landed commit:** _none yet_ — delivery uncommitted on the working tree, byte-IDENTICAL to the run workspace (`dogfood-verify §5` = `IDENTICAL` for all 3 files). Left for operator review per the skill's "leave edits uncommitted" rule.
- **Gate verdict (pre-launch, recorded in the dogfood-058 review):** ✅ **PROCEED** — §1.1 ✅ (GENUINE new classification logic, not a port: module-specifier extraction from added `import`/`from`/`require` lines, then `.`/`/`/`node:` exclusion and scoped-vs-unscoped subpath normalization — each a real way to get it subtly wrong; the `scanDiffForSecrets`/dogfood-054 precedent) · §1.2 ✅ (the landed diff is REAL open plan.md §6 WP-215 🟡 judge-pillar feature code — the explicitly-named "dependency-scan half", the analog of the landed secret scan and the primitive WP-215 S5 consumes — NOT invented disposable scaffolding like dogfood-046/047/048's clamp/roundTo/truncate throwaways) · §1.3 ✅ PROCEED (strongest UNBLOCKED real-product thesis slice — WP-210 act half is a §4 contract change; WP-250/WP-253 are §4 control-flow/override-walled; WP-251 is observability-only with no new code).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently. WP-215 S4 lands additively and correctly.** 🟡 **One new friction (F-56):** the WP-252-calibrated pacing metric STILL over-reads on `codex` steps — this TRIVIAL 3-file additive task read `peak window 370%` and PARKED, falsifying dogfood-058's "park-saturation series breaks here" and confirming WP-252's deferred residual (cumulative step throughput fed as live window occupancy; denominator keyed to the routed `code` model, not the codex executor).

---

## Trace (excerpt)

```
run run-bc841ce6-ad2c-4356-bb49-355a7a7b6637 · SUCCESS · 1 steps · $0.98 / $5.00 · 4m 34s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented WP-215’s pure new-depen… 734k/5.9k        $0.98    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.8%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 370% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps: 4`) |
| Executor / judge | `codex`/`openai` (`gpt-5.5`) · judge `openai-compat`/`gemini-3.1-pro-preview` (structurally different family ✓) |
| Step-1 tokens | **734,193 in / 5,931 out** · 27 tool calls · 3m 58s |
| Step-1 cost | **$0.9771** (estimated) · diff 4,865 bytes (`4fd72067846b`) |
| Judge pass #1 | $0.0079 · 22,396 evidence bytes · 36s · ✓ PROCEED (2/2 criteria, 0 rubric failures) |
| Total cost | **$0.9850** (exact sum, steps + judge) = **19.7%** of $5 budget · judge share **0.8%** |
| Checkpoint | `…@4` · commit `6c6f88bab847` · `lastGood true` (1 checkpoint, no resume) |
| Pacing | 1 event · `action park · projectedTokens 1,480,248 · remainingTokens −1,080,248 · utilization 3.70062` |

**Acronyms:** **WP** = work package (a plan.md unit of work). **AC** = acceptance criterion (a judge-executed `check`). **F-n** = globally-numbered friction finding. **OTel** = OpenTelemetry (span trace format). **Pacing/park/compact** = the context-window pressure decision: `compact` folds history NOW; `park` declines to start the next step because it's projected to overflow the window.

---

## Delivery quality (human review, post-landing)

Reviewed `scan-dependencies.ts` and its test line-by-line against the spec `goal`:

- **`scan-dependencies.ts` (NEW, 46 lines).** ✅ Faithful to the brief and to the `scanDiffForSecrets` precedent:
  - `getAddedDiffLines` (line 5–7): added lines only, `+++` excluded — the exact `scan-secrets.ts` discipline.
  - Three module-grade regexes (lines 1–3): `FROM_SOURCE_PATTERN` `/\bfrom\s*["']([^"']+)["']/g`, `SIDE_EFFECT_IMPORT_PATTERN` `/\bimport\s*["']([^"']+)["']/g`, `REQUIRE_PATTERN` `/\brequire\(\s*["']([^"']+)["']\s*\)/g` — verbatim the spec's patterns, global-flagged for `matchAll`. The side-effect pattern correctly does NOT mis-fire on `import x from "pkg"` (the `["']` must immediately follow `import`); any overlap is de-duped by the `Set`.
  - `normalizeExternalPackageName` (line 9–20): ignores `.`/`/`/`node:` → `null`; scoped (`@`) keeps the first two `/`-segments, unscoped keeps the first; degenerate scoped-without-slash returns the specifier (safe).
  - `scanDiffForNewDependencies` (line 32–45): `Set` for de-dup, `[...set].sort()` for sorted output, empty-safe; pure (reads only `diff`); WP-215 doc comment present; named export, no default, strict ESM. ✅
- **`scan-dependencies.test.ts` (NEW, 11 cases).** ✅ Encodes all 10 mandated cases AND adds an 11th (absolute `/opt/app/config` exclusion). No assertion weakened; the sorted/de-dup case (`zebra`,`alpha`,`alpha/x` → `["alpha","zebra"]`), the added-lines-only case (`+++` header + `-removed-pkg` both excluded → `["good-pkg"]`), scoped (`@scope/pkg`) and unscoped (`lodash`) normalization, require (`axios`), side-effect (`zod`), and empty (`[]`) all present and exact.
- **`index.ts` barrel.** ✅ Single additive re-export `export { scanDiffForNewDependencies } from "./scan-dependencies.js";`, ESM `.js` specifier, nothing else changed.
- **Scope discipline.** ✅ `git status --short` = exactly the 3 named files (1 `M` barrel, 2 `A`). No `types.ts`, no `scanDiffForSecrets`/`scanDiffForRealSecrets`/`collectEvidence`, no verdict/evidence/journal logic, no new dependency. `dogfood-verify §5` byte-diff = `IDENTICAL` for all three vs the run workspace.
- **Independent re-verification (working tree).** ✅ AC-1 `exited 0` (3 grep-pins + `vitest run scan-dependencies.test.ts` → **11 passed**). AC-2 `exited 0` (`tsc --noEmit` + `eslint .` + full `vitest run` → **500 passed | 19 skipped (79 files)**). The judge's own AC-1/AC-2 (`judge-executed check … exited 0`) match; all 4 rubric items (`tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`) pass with sane justifications.

**Anomaly checklist:** no wasted/filler steps (1 step). Cost telemetry healthy — `$0.9771` step + `$0.0079` judge, nonzero, both models priced (no `.00`/F-9). Judge checks genuinely executed (`exited 0` recorded), family diversity real (Gemini judge ≠ OpenAI executor via the keyless shim). No escalate/rollback/injection; `issues:changes 0:1`. Loop integrity clean: 1 checkpoint `lastGood true`, no resume, no duplicate journal entries. Harvest hygiene: delivery uncommitted (pre-review state); the dogfood-058 delivery (`scoring.ts`) was committed before launch, so F-30 "launch once on a clean HEAD" held. The empty-diff probe step (F-11) did not recur (`s0 j@0`).

---

## Token economics (baseline for WP-203/WP-207)

🟡 **A TRIVIAL 3-file additive task burned 734,193 input tokens** (5,931 out) across 27 tool calls in a single step. This is on par with WP-252's series-high (898k) and ~2× dogfood-058's similar-complexity scoring primitive (355k). Codex input-token consumption does **not** track task difficulty — it tracks the executor's repo-exploration appetite, which is high and high-variance. Record as a data point: the executor reads ~150× more than it writes (734k in / 5.9k out). This is the raw input that the pacing numerator then sums and projects (see F-56).

---

## New friction

Friction numbering is global/sequential; the highest prior is **F-55** (dogfood-054, now closed in code by WP-252). This run adds **one** new finding, **F-56**.

### F-56 / WP-254 — the calibrated pacing metric still over-reads on `codex` steps: cumulative step throughput is fed as live window occupancy. 🟡

- **Evidence.** This run's journaled pacing entry: `action park · projectedTokens 1,480,248 · remainingTokens −1,080,248 · utilization 3.70062`. The denominator is the calibrated `gpt-5.5`→400k window (`1,480,248 / 3.70062 = 400,000` exactly — WP-252's calibration HELD, this is NOT a 200k regression). The numerator is the defect: `projectedTokens = spentTokens + estimatedNextStepTokens = (734,193 + 5,931) × 2 = 1,480,248` (`agent-loop.ts:348–359`, `pacing.ts:31–32`). Even the raw single-step input alone, `734,193 / 400,000 = 1.835×`, already exceeds the window.
- **Why it's wrong.** A `codex` step is a **fresh black-box subprocess**; its journaled `tokens_in` (734k) is the SUM of every internal tool-call turn (27 of them), not the peak live prompt occupancy. The provider ACCEPTED 734k input, so the executor's real window is comfortably above 400k — there was zero genuine context pressure on a 3-file additive task. Feeding cumulative summed throughput as `currentInputTokens` and dividing by a single-prompt window keyed to the routed `code` model (not the codex executor) makes `decideContextWindowPacing` PARK (`pacing.ts:35`, `estimatedNextStepTokens > contextWindowTokens`) on work that never approached the window. `peak window 370%` reads as catastrophic context-rot but the number cannot distinguish real pressure from per-subprocess accounting — anti-thesis for CLAUDE.md "maximal observability — no magic".
- **This was foreseen.** WP-252's own residual note (plan.md §6) flagged it: *"Optionally stop feeding cumulative `spentTokens` as `currentInputTokens` for a black-box per-step subprocess (`agent-loop.ts:349` — each codex step is a fresh process, not cumulative)."* dogfood-059 is the first run to PROVE it materially misleads at the calibrated denominator (a park on a task that cannot overflow), promoting the "optionally" to a tracked WP.
- **Corrects the dogfood-058 narrative.** dogfood-058 declared the F-54 park-saturation series "breaks here" (`compact 1 · park 0`, `peak window 179%`). That was happenstance — that step was light (`projectedTokens 716,994` ⇒ ~358k step total, landing in compact range). A heavier codex step (this 740k-total trivial task) parks again: **370%**. Park-saturation is the 7th data point in the F-54 series (602/604/759/585/334/904[pre-wire]/179[058-light]/**370**). The structural park is not fixed by calibration; it is fixed by correcting the numerator and keying the window to the actual executor.
- **WP-254 (new, 🟡):** Make the pacing numerator measure a `codex` step's live window occupancy, not cumulative cross-turn/cross-step throughput, and resolve the context-window denominator from the actual EXECUTOR model/window (not `routing.stages.code.model`). Keep the `debug.contextWindowTokens` seam as the deterministic test override. Distinct from WP-250 (the ACTION on park → durable suspend) and WP-251 (observe a fold live) — both accept the current accounting; WP-254 fixes the MEASUREMENT so park fires only under genuine pressure. Observability-accuracy; sequence behind the WP-215 S5 judge feature and the WP-250 act-slice, ahead of re-attempting a "park-saturation broke" claim.

---

## Verdict on the thesis

🟢 **Positive on the product pillar, 🟡 sharper on observability.** WP-215's dependency-scan half lands as a pure, fully-tested primitive — `scanDiffForNewDependencies` now mechanizes the "no new dependencies unless the goal allowed them" review this dogfood loop performs by hand every run, the dependency analog of the landed secret scan, the primitive the WP-215 S5 evidence wire will consume. Delivered for **$0.9850 / 19.7%** of budget with **0.8%** judge share, breaking nothing in a 500-pass suite, by a `codex`/`gpt-5.5` executor whose work a structurally-different `gemini-3.1-pro-preview` judge re-ran and approved (2/2 AC, 4/4 rubric). Zero contract change, zero new dependency, tight 3-file scope.

The friction is the honest counter-weight: the WP-252 calibration was real but **incomplete** — its denominator fix can't rescue a numerator that sums a fresh subprocess's 27 internal turns and calls the total "window occupancy". A trivial 3-file task reading `peak window 370%` and parking is the proof, and it corrects dogfood-058's premature "park-saturation series breaks" optimism. F-56 → WP-254 fixes the measurement so the context-rot signal means what it says. **The WP-215 S5 judge-evidence wire (the `scanDiffForSecrets`→`collectEvidence` analog that consumes `scanDiffForNewDependencies`) is the next dogfoodable headline on this pillar.**
