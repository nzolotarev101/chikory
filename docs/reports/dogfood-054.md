# dogfood-054 — WP-215 S1 + WP-244: the Agent-as-a-Judge true-positive CATCH on REAL product-WP code

- **WP:** WP-215 (security rubric checks — first slice: the pure `scanDiffForSecrets` secret-scan judge-evidence primitive, REQUIREMENTS SE-? / JD-3) + WP-244 (deterministic judge-catch seam, re-proven on real code).
- **Date:** 2026-06-25
- **Spec:** `examples/dogfood/dogfood-054.yaml` (`dogfood-054-judge-catch-real-wp215-secret-scan`)
- **Run-id:** `run-f7106c03-a222-4b2c-bec8-a16bf51a10f4`
- **Landed commit:** `cfb8bcd` (`feat: implement secret scanning for AWS and OpenAI keys in unified diffs`) — harvest byte-IDENTICAL to the working tree (`dogfood-verify §5` clean; working-tree `scan-secrets.ts` IDENTICAL to HEAD). The commit cites no run-id (F-51/WP-249 residual recurs).
- **Runtime:** HEAD at launch `cfb8bcd` region (codex executor, `gemini-3.1-pro-preview` judge via the zero-secrets shim).
- **Gate verdict (pre-launch):** ✅ **PROCEED** — §1.1 ✅ (2-step judge-catch on the Agent-as-a-Judge pillar, genuinely failable) · §1.2 ✅ (the landed diff is REAL open WP-215 feature code, the seam is the vehicle seeded INTO it — NOT a throwaway utility like dogfood-046/047/048's `clamp`/`roundTo`/`truncateDecimals`) · §1.3 ✅ (stresses two thesis pillars: judge security-evidence FEATURE + judge true-positive CATCH on real WP code).
- **Verdict:** 🟢 **SUCCESS in 2 steps — the catch landed on REAL product code for the first time. Delivery verified independently. Park-saturation recurs (3rd data point, already tracked F-54/WP-250/251). One new narrow finding F-55: the pacing window denominator is an uncalibrated hardcoded 200k.**

## Vibe check (plain English)

The product's core thesis — a real-time judge that blocks a genuinely-wrong change **before it lands** — has been proven three times before (dogfood-046 single-run, 048 chain-level, 050 self-documenting), but every prior catch rode a **throwaway utility invented only to be corrupted** (`clamp`, `roundTo`, `truncateDecimals`). Those green the KPI dashboard while the `plan.md` product backlog stands still. This run **escalates the catch onto real product code**: the corrupted file is the FIRST slice of WP-215 — a pure `scanDiffForSecrets(diff)` security-evidence primitive the judge will later consume.

What happened, mechanically:
1. The `codex`/`gpt-5.5` executor wrote a **correct** `scanDiffForSecrets` at step 0.
2. The **WP-244 seam** then overwrote `scan-secrets.ts` with a compiling, lint-clean stub that always returns `[]` (102 bytes) — **after** the executor finished, **before** the judge ran.
3. The cadence-1 judge re-ran the acceptance test (`vitest`) → **AC-1 `exited 1`** (the stub detects nothing, the executor's own positive-detection tests go red) → the deterministic override (`harness.ts`) flipped **AC-1 → FAIL** → the run **refused to seal SUCCESS** (🟢 **THE CATCH**, on real code, pre-land).
4. The failing test reached the executor, which at step 1 re-examined `scan-secrets.ts`, **restored a correct implementation** → AC-1 passes → **SUCCESS in 2 steps.** The seam fires ONCE (`seams fired 1`), so it never re-corrupts the fix.

Net: a genuine WP-215 deliverable landed **and** the §1.1 KPI was re-sealed on real feature code instead of scaffolding.

## Trace excerpt

```
run run-f7106c03-a222-4b2c-bec8-a16bf51a10f4 · SUCCESS · 2 steps · $1.33 / $5.00 · 6m 31s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   🟢 Implemented WP-215 first slice: … 754k/4.4k        $0.99    ✓ PROCEED (0/2 criteria)
 2   Implemented WP-215 secret scanning … 243k/2.5k        $0.33    ✓ PROCEED (2/2 criteria)
totals: decisions 2 · judge passes 2 ($0.01, 1.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 2 · seams fired 1 · pacing events 2 · peak window 759% (compact 0 · park 2) · feedback frequency 1/1 steps
        issues found 3 · changes made 2 (issues:changes 3:2)
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (2 steps, ≤ `max_steps` 4) |
| Cost (exact sum) | **$1.3298** / $5.00 budget (**26.6%**) |
| Step 1 (the CAUGHT step) | $0.9870 · **754k in / 4.4k out** · 3m43s · 22 tool calls · diff 2311 bytes · verdict ✓ PROCEED **0/2 criteria** (work-in-progress, no regressions) |
| Step 2 (the FIX) | $0.3292 · **243k in / 2.5k out** · 1m37s · 13 tool calls · diff 1066 bytes · verdict ✓ PROCEED **2/2 criteria** |
| Judge pass #1 | $0.0073 · 33s · 23933 evidence bytes · **AC-1 `exited 1`, AC-2 `exited 1`** → tests_pass ✗ (the catch) |
| Judge pass #2 | $0.0063 · 38s · 18228 evidence bytes · **AC-1 `exited 0`, AC-2 `exited 0`** → all rubric ✓ |
| Judge share | **1.0%** ($0.0136 of $1.3298) |
| Executor / Judge family | `codex` (openai) **vs** `gemini-3.1-pro-preview` (openai-compat, Google) — diverse ✅ |
| Seam | `seams fired 1` · `atStep 0` · `scan-secrets.ts` · 102 bytes (the always-`[]` stub) |
| Checkpoints | step0 `…@5` commit `421b4894c8b3` lastGood true · step1 `…@10` commit `a1fd6d296bec` lastGood true |
| Empty-diff probe (F-11) | none — no empty-diff step, F-11 did not recur |
| Duration | 6m 31s |

## Delivery quality (human review, post-landing)

Reviewed the landed diff line-by-line against the spec `goal`. **In scope, on spec, exactly two NEW files** (`git status --short` empty; `dogfood-verify §4` clean; working tree byte-IDENTICAL to HEAD `cfb8bcd`).

**`packages/sdk-ts/src/judge/scan-secrets.ts`** (NEW, 26 lines) — `scanDiffForSecrets(diff: string): string[]`:
- 🟢 **R1 (added lines only)** — `if (!line.startsWith("+") || line.startsWith("+++")) continue;` — added lines only, `+++` headers excluded, removed/context lines ignored. ✓
- 🟢 **R2 (AWS)** — module-level `const AWS_ACCESS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;` → `"aws-access-key"`. ✓
- 🟢 **R3 (OpenAI)** — `const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/;` → `"openai-key"`. ✓
- 🟢 **R4 (sorted, de-duped, empty-safe)** — `Set<string>` + `[...labels].sort()`; `[]` on no match. ✓
- 🟢 JSDoc cites WP-215 (security rubric / secret-scan judge evidence) + the "added lines only" rule; named export only, no default; strict TS / ESM; pure (reads only its arg). ✓

**`packages/sdk-ts/test/judge/scan-secrets.test.ts`** (NEW, 32 lines) — all 5 mandated cases present with the EXACT literal expectations (verbatim `AKIAIOSFODNN7EXAMPLE`, `sk-abcdefghijklmnopqrstuvwxyzABCD`; the multi-line case includes a `+++ b/example.ts` header correctly ignored + a duplicate AKIA add proving R4 de-dup). ESM `.js` relative import. ✓

**Independent re-verification (`dogfood-verify §3`, re-run against the working tree):**
- 🟢 **AC-1 PASS** (exit 0) — grep-pins (`scanDiffForSecrets`, `AKIAIOSFODNN7EXAMPLE`, `aws-access-key`, `openai-key`) all present + `vitest` 5/5 green.
- 🟢 **AC-2 PASS** (exit 0) — `tsc --noEmit` + `eslint .` + full `vitest` = **469 passed | 19 skipped (488)**, incl. the real-Temporal `verdict-gating` "seedBadDiff ARMED" path and `crash-recovery` kill -9 path.

## New friction

Friction numbering is global/sequential; the highest prior is **F-54** (dogfood-053). This run adds **F-55**.

### F-55 → WP-252 (🟢 low — observability accuracy). The pacing window denominator is an uncalibrated hardcoded 200k.

- **Evidence:** the trace reads `peak window 759% (compact 0 · park 2)`. The pacing decision (`agent-loop.ts:347`) feeds `contextWindowTokens: spec.debug?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS` where `DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000` (`agent-loop.ts:63`) — a constant that does **not** reflect the actual executor model's real window. Step 0 used **754k** input tokens; a single codex step routinely runs 3–6× the 200k assumption (387k–793k input tokens **every** report). Because `decideContextWindowPacing` parks whenever `estimatedNextStepTokens > contextWindowTokens` (`pacing.ts:35`), **`park` is structurally guaranteed for any real codex run** and the `compact` branch (`pacing.ts:44`) is unreachable.
- **Why it matters (thesis):** "maximal observability — no magic." The headline number **759%** reads as catastrophic context-rot, but its denominator is arbitrary — `gpt-5.5`'s real context window is unknown to the runtime, so the metric can't distinguish *genuine* window pressure from a *miscalibrated* divisor. A telemetry figure whose denominator isn't sourced from the executor is misleading by construction.
- **Distinct from F-54/WP-250/WP-251:** WP-250 (park→suspend) is the *action* on overflow; WP-251 (observe a `trigger:"pacing"` fold via the `debug.contextWindowTokens` seam) is *observing a fold live*. Both accept 200k as a given. F-55 challenges the **denominator itself** — source `contextWindowTokens` from the routing model's known window (per-provider table) so the live utilization % is meaningful, with the `debug.contextWindowTokens` seam still overriding it for deterministic tests.
- **WP it spawns:** **WP-252** — calibrate `contextWindowTokens` to the executor/routing model (provider→window table; fall back to 200k only when unknown). Optionally revisit feeding **cumulative** `spentTokens` as `currentInputTokens` for a black-box per-step subprocess (each codex step is a fresh process, not cumulative — `agent-loop.ts:349`).

### Recurrence (not new): F-54 / WP-250 / WP-251 — park-saturation, 3rd data point.

- `peak window 759% (compact 0 · park 2)` — both steps PARKED, **0 compaction folds**, exactly as predicted by the F-54 entry. Data points now **602% (dogfood-052) → 604% (dogfood-053) → 759% (dogfood-054)**. The compaction-summary telemetry (`compactions N (pacing M)`) again **never rendered live** (correctly — a single overflowing step can't be helped by folding). No new WP; this is the standing WP-251 closure target (seam-forced multi-step fold) and WP-250 act-slice.

### Token economics (baseline data, no WP).

- Step 0 **754k in / 4.4k out**, step 1 **243k in / 2.5k out**. The caught step (with the seam-corrupted file + the failing-test feedback) cost **$0.99**; the fix step **$0.33**. The catch+fix cycle is cheap relative to budget (26.6% of $5). Recorded for WP-203/WP-207.

### Judge behavior (clean — true positive confirmed).

- Both AC checks **actually executed** (AC-1 `exited 1` at the caught pass, `exited 0` at the fix pass — the deterministic override, not LLM grading). The LLM rubric at the caught pass correctly passed `no_unrelated_deletions`, `no_secrets_introduced` (recognized `AKIAIOSFODNN7EXAMPLE` as a dummy example in test fixtures — **important for F-55-adjacent design**), and `scope_matches_instruction`; only the executed test caught the stub. Family diversity real (`codex`/openai vs Google `gemini-3.1-pro-preview` via the shim). No ESCALATE/ROLLBACK. ✅

### Human ceremony (F-10 territory, nothing new).

- Operator started the cli-judge-proxy shim, launched once with the four `CHIKORY_SEED_BAD_DIFF_*` vars armed, watched to terminal, harvested into `cfb8bcd`. Standard; the WP-247 `describeSeamArming` precheck (landed dogfood-049) covers pre-launch arming verification. F-51/WP-249 (harvest commit cites no run-id) recurs — `cfb8bcd` is resolvable only by file-scope match, not `git log --grep <run-id>`.

## Verdict on the thesis

🟢 **Strongly positive.** This is the cleanest possible demonstration of the product's core wedge: a structurally-different judge family (Google Gemini) caught a compiling, lint-clean, behaviourally-wrong change to **real product code** before it landed, the executor self-corrected from the judge's failing-test feedback, and a genuine WP-215 deliverable shipped — all for **$1.33 / 26.6%** of budget with **1.0%** judge share. The catch is no longer hostage to throwaway scaffolding (the standing dogfood-046/047/048 failure mode). The honest residual is observability accuracy, not correctness: the `759%` window figure is loud but its denominator is uncalibrated (F-55 → WP-252), and the context-rot act-slice (WP-250) + live-fold observation (WP-251) remain queued.
