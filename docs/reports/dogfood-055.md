# dogfood-055 — WP-215 S2: wire `scanDiffForSecrets` into the inner-loop judge evidence

- **WP:** WP-215 (security rubric checks — S2: thread the pure `scanDiffForSecrets` secret-scan primitive into the real-time judge's evidence collection so the judge mechanically extracts secret-kind labels from the diff it already collects; REQUIREMENTS JD-3/JD-4).
- **Date:** 2026-06-25
- **Spec:** `examples/dogfood/dogfood-055.yaml` (`dogfood-055-wp215-s2-judge-secret-evidence`)
- **Run-id:** `run-73437934-9672-43d4-b453-557044ec349b`
- **Landed commit:** _(none — delivery uncommitted on the working tree; `dogfood-verify §5` byte-IDENTICAL to the run workspace for all 4 files; `§6` no landed commit)_.
- **Runtime:** HEAD at launch `88d2102` (codex executor, `gemini-3.1-pro-preview` judge via the zero-secrets cli-judge-proxy shim).
- **Gate verdict (pre-launch):** ✅ **PROCEED** — §1.1 ✅ (cross-file judge-pillar slice: a NEW REQUIRED `secretScanLabels` field must thread through `CollectedEvidence` + `JudgePromptInput` + the harness call + the prompt renderer without breaking `tsc`/the existing judge suite — not a 1-file port) · §1.2 ✅ (the landed diff is REAL open WP-215 feature code in the judge harness, the scanner's documented consumer — NOT invented scaffolding) · §1.3 ✅ (stresses the Agent-as-a-Judge pillar: deterministic diff inspection in the inner loop on real product code; the judge-CATCH is settled — this run advances the security-evidence FEATURE, does NOT re-prove the catch).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently. NO new friction. Park-saturation recurs (4th data point, already tracked F-54/WP-250/WP-251) and the uncalibrated-denominator finding recurs (F-55/WP-252). One observability note folds into WP-253: the new secret-scan evidence section landed but rendered `(none)` live (this run's own diff is clean by design) — the non-empty path is unit-proven, not yet observed firing on a real label.**

## Vibe check (plain English)

dogfood-054 landed the pure secret scanner `scanDiffForSecrets(diff)` but **nothing consumed it** — `grep -r scanDiffForSecrets src` hit only its own file. This run makes the Agent-as-a-Judge actually USE it: every judge pass now runs the deterministic scanner over the full workspace diff it already collects, and the detected secret-kind labels are surfaced to the judge as a new prompt evidence section. This is the core thesis — *"Agent-as-a-Judge inspects diffs"* — given a **deterministic, non-LLM security signal** over the real change.

The wire is deliberately **additive**: it SURFACES the scan as judge evidence (a typed field + a prompt section); the LLM still adjudicates the `no_secrets_introduced` rubric item. A *live deterministic destructive override* (flip `no_secrets_introduced` to FAIL on a scanner hit) would self-trip ROLLBACK on any diff that adds AWS's canonical `AKIAIOSFODNN7EXAMPLE` test fixture — so the override + an example-key allowlist is the separate follow-up **WP-253**. This run keeps it evidence-only.

`codex`/`gpt-5.5` one-shot all four files in a single step; the structurally-different judge family (Google `gemini-3.1-pro-preview`) re-ran both acceptance checks (`exited 0`) and passed all rubric items. Self-trip safety held: the run's own added diff lines carry **no contiguous secret literal** (the test builds secret-like strings by `["aws","access","key"].join("-")` concatenation), so the now-live scanner over this very diff returned `[]` and the rendered section read `(none)`.

## Trace excerpt

```
run run-73437934-9672-43d4-b453-557044ec349b · SUCCESS · 1 steps · $0.78 / $5.00 · 3m 45s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Summary: Implemented the additive W… 580k/5.0k        $0.78    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 585% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (1 step, ≤ `max_steps` 4) |
| Cost (exact sum) | **$0.7834** / $5.00 budget (**15.6%**) — flagged `(estimated)` (CLI-OAuth executor, no per-call billing) |
| Step 1 | $0.7753 · **580k in / 5.0k out** · 3m1s · 24 tool calls · diff 5394 bytes · verdict ✓ PROCEED **2/2 criteria** |
| Judge pass #1 | $0.0081 · 44s · 22609 evidence bytes · **AC-1 `exited 0`, AC-2 `exited 0`** → all 4 rubric items ✓ |
| Judge share | **1.0%** ($0.0081 of $0.7834) — well under the `max_cost_share: 0.5` cap |
| Executor / Judge family | `codex` (openai) **vs** `gemini-3.1-pro-preview` (openai-compat, Google) — diverse ✅ |
| Checkpoints | step0 `…@4` commit `4567b8c2d37d` lastGood true |
| Empty-diff probe (F-11) | none — no empty-diff step, F-11 did not recur (`components over time: s0 j@0`) |
| Pacing | `peak window 585% (compact 0 · park 1)` — parked, 0 folds (see Recurrence) |
| Duration | 3m 45s |

## Delivery quality (human review, post-landing)

Reviewed the landed diff line-by-line against the spec `goal`. **In scope, on spec, exactly the 3 named existing files + 1 new test file** (`git status --short` = `M evidence.ts · M harness.ts · M prompt.ts · A secret-scan-evidence.test.ts`; `dogfood-verify §4` clean; all 4 files byte-IDENTICAL to the run workspace, `§5`).

**`packages/sdk-ts/src/judge/evidence.ts`** (+5 lines):
- 🟢 Imports `scanDiffForSecrets` from `./scan-secrets.js` (ESM `.js` relative import). ✓
- 🟢 `CollectedEvidence` gains the NEW REQUIRED field `secretScanLabels: string[]` with a doc comment citing WP-215. ✓
- 🟢 `collectEvidence` calls `scanDiffForSecrets(diff)` over the **FULL** collected diff (line 111, immediately after `git diff`, **BEFORE** the `bound(diff, MAX_DIFF_PROMPT_CHARS)` excerpt truncation at line 156) — so a secret beyond the prompt cap is still detected — and assigns the result into the returned object. ✓

**`packages/sdk-ts/src/judge/prompt.ts`** (+8 lines):
- 🟢 `JudgePromptInput` gains `secretScanLabels: string[]`. ✓
- 🟢 New pure `renderSecretScanLabels(labels)` helper: `(none)` when empty, else labels as `- <label>` one per line. ✓
- 🟢 The new section renders with the EXACT header `## EVIDENCE — deterministic secret scan (added diff lines)`, placed immediately AFTER the workspace-diff block and BEFORE the CHECK-RESULTS block, exactly as specified. ✓

**`packages/sdk-ts/src/judge/harness.ts`** (+1 line):
- 🟢 The existing `buildJudgeMessages({ … })` call passes `secretScanLabels: collected.secretScanLabels` through; no other harness change. ✓

**`packages/sdk-ts/test/judge/secret-scan-evidence.test.ts`** (NEW, 48 lines):
- 🟢 Both mandated cases present: `["aws-access-key","openai-key"]` → header + both `- <label>` lines; `[]` → `${HEADER}\n(none)` and neither label line. Imports `buildJudgeMessages` via `../../src/judge/prompt.js`. ✓
- 🟢 **Self-trip discipline honored** — secret-like labels are built by `["aws","access","key"].join("-")` / `["openai","key"].join("-")`, so the file's added diff lines carry **no** contiguous `AKIA[0-9A-Z]{16}` or `sk-…` literal. The now-live scanner over this run's own diff returned `[]` → the live judge section read `(none)`. ✓

**Scope discipline:** no edit to `rubric.ts`, the verdict/override logic, `types.ts`, `index.ts` barrels, or configs; no new dependency; no new I/O/network/clock/randomness call. Exactly the additive evidence wire specified. ✓

**Independent re-verification (`dogfood-verify §3`, re-run against the working tree):**
- 🟢 **AC-1 PASS** (exit 0) — all 5 grep-pins (`scanDiffForSecrets` + `secretScanLabels` in evidence.ts; `secretScanLabels` in prompt.ts & harness.ts; `deterministic secret scan` in prompt.ts) present + `vitest` 2/2 green.
- 🟢 **AC-2 PASS** (exit 0) — `tsc --noEmit` + `eslint .` + full `vitest` = **471 passed | 19 skipped (490)**, incl. the real-Temporal `verdict-gating` "seedBadDiff ARMED" path and `crash-recovery` kill -9 path. The new REQUIRED field threaded through every construction/consumer site without breaking the suite — the §1.1 failure surface cleared.

## New friction

Friction numbering is global/sequential; the highest prior is **F-55** (dogfood-054). **This run adds NO new friction.** Two earlier findings recur (both already tracked), and one narrow observability note folds into an existing WP.

### Recurrence (not new): F-54 / WP-250 / WP-251 — park-saturation, 4th data point.

- `peak window 585% (compact 0 · park 1)` — the single step PARKED, **0 compaction folds**, exactly as the F-54 entry predicts (a single step that alone exceeds the window can't be helped by folding history). Data points now **602% (dogfood-052) → 604% (dogfood-053) → 759% (dogfood-054) → 585% (dogfood-055)**. The compaction-summary telemetry (`compactions N (pacing M)`) again **never rendered live** (correctly). No new WP — the standing closure targets are **WP-251** (seam-forced multi-step fold, observe a `trigger:"pacing"` fold live) and **WP-250** (park→durable suspend act-slice).

### Recurrence (not new): F-55 / WP-252 — uncalibrated pacing-window denominator.

- The `585%` figure shares the dogfood-054 F-55 root cause: the pacing decision divides by a hardcoded `DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000` (`agent-loop.ts:63`) that does not reflect the real executor window. This step ran **580k** input tokens — ~2.9× the assumption — so `park` is structurally guaranteed and the headline % is loud but its denominator is arbitrary. Already tracked → **WP-252** (provider→window table). No new WP.

### Observability note (folds into WP-253, no new WP): the secret-scan evidence section is unit-proven but not yet observed firing on a real label.

- The new `## EVIDENCE — deterministic secret scan (added diff lines)` section rendered live in judge pass #1, but read **`(none)`** — by design, this run's own diff carries no contiguous secret, so the now-live `scanDiffForSecrets` returned `[]`. The non-empty rendering (one `- <label>` per detected key) is proven by the new vitest cases but **not yet observed firing on a real diff label live**. This is the same "close-when-observed" pattern as F-52/F-53/F-54. The live non-empty observation belongs to the **WP-253** dogfood (the deterministic `no_secrets_introduced` override + example-key allowlist), whose diff WILL carry a secret-bearing fixture — confirm `aws-access-key`/`openai-key` renders in that run's judge evidence. No fresh scaffold run; no new WP.

### Token economics (baseline data, no WP).

- Step 1 **580k in / 5.0k out** for a 5394-byte diff across 24 tool calls — in-band with the 387k–793k-input series every report records. The whole additive wire landed in **one** step for **$0.78 / 15.6%** of budget. Recorded for WP-203/WP-207.

### Judge behavior (clean — additive evidence wire confirmed).

- Both AC checks **actually executed** (`exited 0` each — `dogfood-verify §2`). The LLM rubric correctly passed `tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced` (the diff adds no real secret — the test's secret-like strings are built by concatenation), and `scope_matches_instruction` (exactly the 3 files + 1 new test). Family diversity real (`codex`/openai vs Google `gemini-3.1-pro-preview` via the shim). No ESCALATE/ROLLBACK; `issues found 0 · changes made 1`. ✅

### Human ceremony (F-10 territory, nothing new).

- Operator started the cli-judge-proxy shim, launched once (no seam env this run), watched to terminal. Delivery left uncommitted on the working tree for review (the standing harvest pattern). F-51/WP-249 (harvest commit cites no run-id) is N/A here — nothing committed yet.

## Verdict on the thesis

🟢 **Positive.** The deterministic security signal is now wired into the inner loop: the Agent-as-a-Judge mechanically scans the real diff it collects and surfaces secret-kind findings to a structurally-different judge family — the documented WP-215 consumer, delivered additively for **$0.78 / 15.6%** of budget with **1.0%** judge share, breaking nothing in a 471-pass suite. The honest residuals are observability (the `585%` denominator is uncalibrated — F-55/WP-252; the act-slice WP-250 + live-fold WP-251 remain queued) and a feature-completeness gap (the new evidence section is proven on synthetic input but its non-empty live firing is deferred to WP-253). The next slice on this exact line is **WP-253** — the example-key allowlist that unblocks the deterministic `no_secrets_introduced` override.
