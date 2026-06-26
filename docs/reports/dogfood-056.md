# dogfood-056 — WP-253 (WP-215 S3): the example-key allowlist + real-secrets-only scan

- **WP:** WP-253 (WP-215 S3 — the pure example-key allowlist + `scanDiffForRealSecrets` that excludes canonical dummy credentials, the deterministic security primitive a future `no_secrets_introduced` override consumes without self-tripping ROLLBACK on AWS's `AKIAIOSFODNN7EXAMPLE` test fixture; REQUIREMENTS JD-3/JD-4).
- **Date:** 2026-06-25
- **Spec:** `examples/dogfood/dogfood-056.yaml` (`dogfood-056-wp253-secret-allowlist`)
- **Run-id:** `run-37862cf7-0c24-4aec-b09a-547028bd6720`
- **Landed commit:** _(none — delivery uncommitted on the working tree; `dogfood-verify §5` byte-IDENTICAL to the run workspace for all 3 files; `§6` no landed commit)_.
- **Runtime:** HEAD at launch `8e4661c` (codex executor, `gemini-3.1-pro-preview` judge via the zero-secrets cli-judge-proxy shim).
- **Gate verdict (pre-launch, recorded in the dogfood-055 review):** ✅ **PROCEED** — §1.1 ✅ (cross-file judge-pillar slice: a NEW `secret-allowlist.ts` module + a NEW `scanDiffForRealSecrets` in the existing `scan-secrets.ts` + a test; genuinely failable on the real-vs-example PARTITION AND the no-regression constraint that the evidence-facing `scanDiffForSecrets` stays byte-behavior-identical — not a 1-file port) · §1.2 ✅ (the landed diff is REAL open WP-253 feature code: the documented allowlist that unblocks the deterministic override — NOT invented scaffolding) · §1.3 ✅ (advances the deterministic-security-gate thesis mechanism on real product code; WP-250 park→suspend is §4 operator-landed, WP-251 is observability-only — this is the strongest UNBLOCKED real-WP thesis slice).
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently. NO new friction.** Park-saturation recurs (5th data point, already tracked F-54/WP-250/WP-251) and the uncalibrated-denominator finding recurs (F-55/WP-252). One observability note folds into the future override slice: the real-vs-example partition is unit-proven, but the live non-empty firing of the secret-scan evidence section is STILL deferred — this run's own diff is secret-free by self-trip discipline, so the now-live `scanDiffForSecrets` again rendered `(none)`.

## Vibe check (plain English)

dogfood-055 wired the deterministic secret scanner into the inner-loop judge's evidence, but flagged a blocker for the *next* step (the destructive override): a live override that flips `no_secrets_introduced`→FAIL on any scanner hit would **self-trip ROLLBACK** on AWS's canonical example key `AKIAIOSFODNN7EXAMPLE`, which legitimately appears in the WP-215 S1 test fixtures. This run lands the documented unblocker (**WP-253**): a tiny **allowlist** of canonical example credentials plus a **real-secrets-only** scan that filters them out.

Two functions, one new module, one new test:
- `secret-allowlist.ts` — a frozen `EXAMPLE_SECRET_VALUES` set (containing AWS's `AKIAIOSFODNN7EXAMPLE`, built by `"AKIA" + "IOSFODNN7EXAMPLE"` concatenation) + a pure `isExampleSecret(value): boolean`.
- `scanDiffForRealSecrets(diff): string[]` in `scan-secrets.ts` — same added-diff-line scan as the evidence scanner, REUSING the existing `AWS_ACCESS_KEY_PATTERN`/`OPENAI_KEY_PATTERN`, but switched from `.test` to `.match` so it can read the matched value and **exclude** anything `isExampleSecret` recognizes.

The slice is **deliberately additive**: the evidence-facing `scanDiffForSecrets` is unchanged in behavior (the judge still SEES every secret-like match, example keys included), and no rubric/verdict/override logic was touched. The destructive override that consumes `scanDiffForRealSecrets` to flip the verdict pre-land is the SEPARATE §4 hand-design follow-up.

`codex`/`gpt-5.5` one-shot all three files in a single step; the structurally-different judge family (Google `gemini-3.1-pro-preview`) re-ran both acceptance checks (`exited 0`) and passed all four rubric items. **Self-trip safety held:** every secret-like value in the diff is built by string concatenation, so the now-live `scanDiffForSecrets` over this very run's diff returned `[]` and the rendered judge evidence section read `(none)`.

## Trace excerpt

```
run run-37862cf7-0c24-4aec-b09a-547028bd6720 · SUCCESS · 1 steps · $0.47 / $5.00 · 3m 15s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Done: WP-253 is landed as an additi… 328k/5.4k        $0.46    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 2.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 334% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (1 step, ≤ `max_steps` 4) |
| Cost (exact sum) | **$0.4744** / $5.00 budget (**9.4%**) — flagged `(estimated)` (CLI-OAuth executor, no per-call billing) |
| Step 1 | $0.4648 · **328k in / 5.4k out** · 2m41s · 18 tool calls · diff 4212 bytes · verdict ✓ PROCEED **2/2 criteria** |
| Judge pass #1 | $0.0096 · 33s · 21535 evidence bytes · **AC-1 `exited 0`, AC-2 `exited 0`** → all 4 rubric items ✓ |
| Judge share | **2.0%** ($0.0096 of $0.4744) — well under the `max_cost_share: 0.5` cap |
| Executor / Judge family | `codex` (openai) **vs** `gemini-3.1-pro-preview` (openai-compat, Google) — diverse ✅ |
| Checkpoints | step0 `…@4` commit `c906988d42b9` lastGood true |
| Empty-diff probe (F-11) | none — no empty-diff step, F-11 did not recur (`components over time: s0 j@0`) |
| Pacing | `peak window 334% (compact 0 · park 1)` — parked, 0 folds (see Recurrence) |
| Duration | 3m 15s |

## Delivery quality (human review, post-landing)

Reviewed the landed diff line-by-line against the spec `goal`. **In scope, on spec, exactly the 2 named files + 1 new test file** (`git status --short` = `M scan-secrets.ts · A secret-allowlist.ts · A secret-allowlist.test.ts`; `dogfood-verify §4` clean; all 3 files byte-IDENTICAL to the run workspace, `§5`).

**`packages/sdk-ts/src/judge/secret-allowlist.ts`** (NEW, 11 lines):
- 🟢 `EXAMPLE_SECRET_VALUES: ReadonlySet<string>` is a frozen module-level `Set` containing AWS's canonical example key, built `"AKIA" + "IOSFODNN7EXAMPLE"` (no contiguous `AKIA[0-9A-Z]{16}` in the added diff line). ✓
- 🟢 `isExampleSecret(value): boolean` returns `EXAMPLE_SECRET_VALUES.has(value)` — pure (reads only its arg + the module constant), doc comment cites WP-253, named exports only, no default. ✓

**`packages/sdk-ts/src/judge/scan-secrets.ts`** (+25/−4 lines):
- 🟢 Imports `isExampleSecret` from `./secret-allowlist.js` (ESM `.js` relative import). ✓
- 🟢 New private `getAddedDiffLines(diff)` helper extracts the shared added-lines-only / `+++`-excluded filter; `scanDiffForSecrets` is refactored to use it **with no behavior change** — it stays `.test`-based and still surfaces example keys (the S1 5-case `scan-secrets.test.ts` is the regression guard, re-run green below). ✓
- 🟢 New `scanDiffForRealSecrets(diff): string[]` scans the same added lines via `line.match(PATTERN)`, adds `"aws-access-key"`/`"openai-key"` only when the match is non-null AND `!isExampleSecret(match[0])`; result `Set`-deduped + `.sort()`ed, empty-safe (`[]`). Doc comment cites WP-253. ✓

**`packages/sdk-ts/test/judge/secret-allowlist.test.ts`** (NEW, 33 lines):
- 🟢 All three mandated cases present and not weakened: (1) `isExampleSecret(("AKIA"+"IOSFODNN7EXAMPLE"))` true / a different AWS-shaped value false + `EXAMPLE_SECRET_VALUES.has` true; (2) example-key diff → `scanDiffForSecrets` STILL `["aws-access-key"]` but `scanDiffForRealSecrets` `[]`; (3) non-example AWS + OpenAI key diff → `scanDiffForRealSecrets` `["aws-access-key","openai-key"]` (sorted). ✓
- 🟢 **Self-trip discipline honored** — every secret-like input is built by concatenation (`"AKIA" + "1234567890ABCDEF"`, `"sk-" + "abcdef…"`, `'+const k = "' + "AKIA" + 'IOSFODNN7EXAMPLE";'`), so the file's added diff lines carry no contiguous secret literal. The now-live scanner over this run's own diff returned `[]`. ✓

**Scope discipline:** no edit to `evidence.ts`, `prompt.ts`, `harness.ts`, `rubric.ts`, the verdict/override logic, `types.ts`, barrels, or configs; no new dependency; no new I/O/network/clock/randomness call. Exactly the additive primitive specified. ✓

**Independent re-verification (`dogfood-verify §3`, re-run against the working tree):**
- 🟢 **AC-1 PASS** (exit 0) — all 4 grep-pins (`EXAMPLE_SECRET_VALUES` + `isExampleSecret` in `secret-allowlist.ts`; `isExampleSecret` + `scanDiffForRealSecrets` in `scan-secrets.ts`) present + `vitest` **8 passed** (3 allowlist + 5 unchanged S1 `scan-secrets`).
- 🟢 **AC-2 PASS** (exit 0) — `tsc --noEmit` + `eslint .` + full `vitest` = **474 passed | 19 skipped (493)**, incl. the real-Temporal `verdict-gating` "seedBadDiff ARMED" path and `crash-recovery` kill -9 path. The new function is additive and the S1 `scanDiffForSecrets` evidence scan + the dogfood-055 wire are not regressed — the §1.1 failure surface cleared.

## New friction

Friction numbering is global/sequential; the highest prior is **F-55** (dogfood-054). **This run adds NO new friction.** Two earlier findings recur (both already tracked), and one observability note folds into the existing override follow-up.

### Recurrence (not new): F-54 / WP-250 / WP-251 — park-saturation, 5th data point.

- `peak window 334% (compact 0 · park 1)` — the single step PARKED, **0 compaction folds**, exactly as the F-54 entry predicts (a single step that alone exceeds the window can't be helped by folding history). Data points now **602% (dogfood-052) → 604% (dogfood-053) → 759% (dogfood-054) → 585% (dogfood-055) → 334% (dogfood-056)**. The compaction-summary telemetry (`compactions N (pacing M)`) again **never rendered live** (correctly). No new WP — the standing closure targets are **WP-251** (seam-forced multi-step fold, observe a `trigger:"pacing"` fold live) and **WP-250** (park→durable suspend act-slice).

### Recurrence (not new): F-55 / WP-252 — uncalibrated pacing-window denominator.

- The `334%` figure shares the dogfood-054 F-55 root cause: the pacing decision divides by a hardcoded `DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000` (`agent-loop.ts:63`) that does not reflect the real executor window. This step ran **328k** input tokens — ~1.6× the assumption — so `park` is structurally guaranteed and the headline % is loud but its denominator is arbitrary. (This run's 328k input is the LOW end of the recorded 328k–793k series, hence the lower 334% peak — the metric tracks token volume, not genuine pressure against the real `gpt-5.5` window.) Already tracked → **WP-252** (provider→window table). No new WP.

### Observability note (folds into the WP-253 override follow-up, no new WP): the secret-scan evidence section is STILL only unit-proven, not yet observed firing on a real label.

- The dogfood-055 report deferred the live non-empty firing of the `## EVIDENCE — deterministic secret scan (added diff lines)` section to "the WP-253 dogfood, whose diff WILL carry a secret-bearing fixture." **It did not fire here either:** this run's own diff is secret-free by self-trip discipline (the now-live `scanDiffForSecrets` is run over the build run's diff, so a contiguous secret would pollute the live judge evidence), so the section again rendered `(none)`. This exposes a standing tension: **any dogfood that touches the live judge cannot carry a contiguous secret in its own diff**, so the non-empty path may never be observed *naturally* in a build run — its closure belongs to a dedicated assertion (a `scanDiffForRealSecrets`/evidence unit case firing on a fixture-file path the live scan excludes) inside the future destructive-override slice, not a fresh scaffold run. Same close-when-observed shape as F-52/F-53/F-54. No new WP.

### Token economics (baseline data, no WP).

- Step 1 **328k in / 5.4k out** for a 4212-byte diff across 18 tool calls — the LOW end of the 328k–793k-input series every report records (a small, well-scoped 3-file slice). The whole additive primitive landed in **one** step for **$0.47 / 9.4%** of budget — the cheapest headline of the WP-215 sub-series (vs $1.33 S1, $0.78 S2). Recorded for WP-203/WP-207.

### Judge behavior (clean — additive primitive confirmed).

- Both AC checks **actually executed** (`exited 0` each — `dogfood-verify §2`). The LLM rubric correctly passed `tests_pass`, `no_unrelated_deletions` (recognized the `getAddedDiffLines` extraction as related refactor), `no_secrets_introduced` (the diff's secret-like values are built by concatenation — no contiguous literal), and `scope_matches_instruction` (exactly the 2 files + 1 new test). Family diversity real (`codex`/openai vs Google `gemini-3.1-pro-preview` via the shim). No ESCALATE/ROLLBACK; `issues found 0 · changes made 1`. ✅

### Human ceremony (F-10 territory, nothing new).

- Operator started the cli-judge-proxy shim, launched once (no seam env this run), watched to terminal. Delivery left uncommitted on the working tree for review (the standing harvest pattern). F-51/WP-249 (harvest commit cites no run-id) is N/A here — nothing committed yet.

## Verdict on the thesis

🟢 **Positive.** The deterministic security gate now has its missing partition primitive: the Agent-as-a-Judge can distinguish a real leaked credential from AWS's canonical example key, so a future destructive `no_secrets_introduced` override can flip the verdict on a genuine secret **without** self-tripping ROLLBACK on dummy test fixtures. Delivered additively — the evidence-facing scanner is unchanged, no rubric/verdict/override logic touched — for **$0.47 / 9.4%** of budget with **2.0%** judge share, breaking nothing in a 474-pass suite, by an executor whose work a structurally-different judge family re-ran and approved. The honest residuals are unchanged from dogfood-055: observability (the `334%` denominator is uncalibrated — F-55/WP-252; the act-slice WP-250 + live-fold WP-251 remain queued) and the feature-completeness gap that the secret-scan evidence's non-empty live firing is still deferred. The deterministic override that consumes `scanDiffForRealSecrets` to flip `no_secrets_introduced` pre-land is the **§4 hand-design follow-up** (operator-landed — it touches verdict/override logic). The next *dogfoodable* headline is **WP-252** — calibrate the pacing-window denominator to the executor model, retiring the recurring F-55 finding every report in this series flags.
