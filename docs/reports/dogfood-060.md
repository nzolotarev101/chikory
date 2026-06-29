# dogfood-060 — WP-215 S5: wire `scanDiffForNewDependencies` into the inner-loop judge evidence

- **WP:** WP-215 S5 (the live judge-evidence wire that CONSUMES dogfood-059's pure `scanDiffForNewDependencies` primitive — the DEPENDENCY analog of the landed secret-scan evidence wire S2 dogfood-055). Threads the scanner into `collectEvidence` so the Agent-as-a-Judge mechanically sees the external packages a diff NEWLY imports, in the same inner-loop evidence pass it already runs the secret scan.
- **Date:** 2026-06-28
- **Spec:** `examples/dogfood/dogfood-060.yaml` (`dogfood-060-wp215-dependency-evidence-wire`)
- **Run-id:** `run-291cf0b5-70d4-4919-8669-cef579679a56` (runtime HEAD `96df844`)
- **Landed commit:** `821cae5` — but **bundled** (see F-57): the 5 in-scope judge files are byte-correct, AND the harvest swept in 2 unrelated host working-tree files (`test/cli/cli.test.ts`, `test/cli/trace.test.ts`) the run never wrote.
- **Gate verdict (pre-launch, recorded in the dogfood-059 review):** ✅ **PROCEED** — §1.1 ✅ (cross-file judge-evidence wire, 4 source files + 1 test, 2–4 steps plausible; real failure surface — scan the FULL diff BEFORE the `bound(...)` prompt excerpt, thread the new field through `collectEvidence`→`harness`→`buildJudgeMessages`, render the prompt section; the dogfood-055 S2-wire precedent is itself a landed legitimate headline of this exact shape) · §1.2 ✅ (real open plan.md §6 WP-215 🟡 judge-pillar feature code — the documented S5 consumer of the S4 primitive, NOT invented disposable scaffolding) · §1.3 ✅ PROCEED (strongest UNBLOCKED real-product thesis slice — WP-210 act half / WP-250 / WP-253 §4-walled; WP-251/WP-254 observability-accuracy, not a thesis headline).
- **Verdict:** 🟢 **SUCCESS in 1 step — the WP-215 S5 wire lands additively and CORRECTLY; delivery is textbook against the spec + the secret-scan precedent.** 🔴 **One new friction (F-57), the most serious in this campaign: the harvest commit `821cae5` SWEPT IN 2 unrelated uncommitted host files that FAIL `pnpm exec eslint .` — main went RED on the very AC-2 lint gate the judge reported green.** The judge's AC-2 was honest on the run's CLONE (eslint passed there); it cannot see what harvest bundles afterward. F-57 is the 3rd recurrence of the WP-249 harvest-hygiene friction and the FIRST that BREAKS the build (fixed inline this review).

---

## Trace (excerpt)

```
run run-291cf0b5-70d4-4919-8669-cef579679a56 · SUCCESS · 1 steps · $1.07 / $5.00 · 4m 39s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Done: `scanDiffForNewDependencies` … 775k/8.8k        $1.06    ✓ PROCEED (2/2 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.9%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 392% (compact 0 · park 1) · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps: 4`) |
| Executor / judge | `codex`/`openai` (`gpt-5.5`) · judge `openai-compat`/`gemini-3.1-pro-preview` (structurally different family ✓) |
| Step-1 tokens | **775,283 in / 8,815 out** · 30 tool calls · 4m 2s |
| Step-1 cost | **$1.0565** (estimated) · diff 7,944 bytes (`edb2b79bf515`) |
| Judge pass #1 | $0.0100 · 25,452 evidence bytes · 36s · ✓ PROCEED (2/2 criteria, 0 rubric failures) |
| Total cost | **$1.0665** (exact sum, steps + judge) = **21.4%** of $5 budget · judge share **0.9%** |
| Checkpoint | `…@4` · commit `868b4a35fd72` · `lastGood true` (1 checkpoint, no resume) |
| Pacing | 1 event · `action park · peak window 392% (compact 0 · park 1)` — F-56/WP-254 recurs (8th data point) |

**Acronyms:** **WP** = work package (a plan.md unit of work). **AC** = acceptance criterion (a judge-executed `check`). **F-n** = globally-numbered friction finding. **harvest** = landing the run's workspace diff onto `main`. **Clone vs landed** = the run executes inside a fresh git clone of HEAD; the harvest is a separate commit on the host tree — the judge grades the clone, the harvest can add files the clone never had. **Pacing/park** = the context-window pressure decision: `park` declines to start the next step because it's projected to overflow the window.

---

## Delivery quality (human review, post-landing)

Reviewed the 5 in-scope files line-by-line against the spec `goal` and the `scanDiffForSecrets`→`collectEvidence` (dogfood-055) precedent it is the analog of. **The wire is exactly right:**

- **`src/judge/evidence.ts`** ✅ — imports `scanDiffForNewDependencies` from `./scan-dependencies.js` (ESM `.js`, mirroring the `scanDiffForSecrets` import). Adds the REQUIRED `newDependencyLabels: string[]` field to `CollectedEvidence` with the WP-215 doc comment, next to `secretScanLabels`. **Critically, populates it from the FULL `diff` variable at line 112 — BEFORE the `bound(diff, MAX_DIFF_PROMPT_CHARS)` truncation at line 161** (the exact discipline `secretScanLabels` uses; the spec called this the real way to get it subtly wrong, and it was gotten right). Returns it in the `CollectedEvidence` literal next to `secretScanLabels`. Nothing else in the evidence flow changed (git/exec I/O untouched — pure in-memory scan of the diff string already in hand).
- **`src/judge/prompt.ts`** ✅ — adds the REQUIRED `newDependencyLabels: string[]` to `JudgePromptInput`; a module-private `renderNewDependencyLabels` (non-empty → `- <label>` newline-joined, empty → `(none)`) byte-mirroring `renderSecretScanLabels`; and the new section `## EVIDENCE — deterministic new-dependency scan (added diff lines)` rendered **IMMEDIATELY AFTER** the secret-scan section and **BEFORE** `## EVIDENCE — CHECK RESULTS`, exactly as specified.
- **`src/judge/harness.ts`** ✅ — at the `buildJudgeMessages({...})` call site, passes `newDependencyLabels: collected.newDependencyLabels` next to the existing `secretScanLabels: collected.secretScanLabels`. One line, nothing else.
- **`test/judge/new-dependency-scan-evidence.test.ts` (NEW)** ✅ — proves the wire end-to-end: a synthetic diff adding `+import express from "express";` → `collectEvidence` populates `newDependencyLabels` deep-equal `["express"]` (and a relative/`node:` import does NOT appear); `buildJudgeMessages` with `["axios","zod"]` renders the section header + `- axios` + `- zod`; the `[]` case renders `(none)`. Follows the `secret-scan-evidence.test.ts` structure; no assertion weakened.
- **`test/judge/secret-scan-evidence.test.ts`** ✅ — `+1` line: `newDependencyLabels: []` added to the `input()` helper. **TRIVIALLY ENTAILED, not scope creep** — `JudgePromptInput` now has a required field, so the pre-existing secret-scan test could not compile without it. The judge correctly counted this as in-scope (5 files, `scope_matches_instruction ✓`).

**Scope discipline against the spec.** The RUN itself was perfectly scoped: the run workspace's `git diff` is exactly the 5 judge files; `eslint .` on the run CLONE passed (exit 0 — what the judge saw when AC-2 graded green). `types.ts`, `scanDiffForNewDependencies`/`scanDiffForSecrets`, `buildVerdict`, the rubric, and the journal payloads are all untouched. **The scope problem is entirely in the HARVEST, not the run — see F-57.**

**Live-read note (foreseen, NOT friction).** The new section rendered `(none)` on this run's own diff — the delivery's only added imports are an ALREADY-present internal module (`./scan-dependencies.js`, a relative `.js` specifier → excluded) and no NEW external package, so `scanDiffForNewDependencies` over the run's own diff returns `[]`. The spec header predicted this verbatim and forbade seeding a fake external import to force a non-empty render (that would be scaffold-hosted busy work); non-empty firing is unit-proven by the new test, exactly as the S2 secret-scan section rendered `(none)` live in dogfood-055.

**Independent re-verification (working tree, post-fix).** AC-1 `exited 0` (4 grep-pins for the wire symbols + `vitest run new-dependency-scan-evidence.test.ts` → **3 passed**). AC-2 — `tsc --noEmit` clean, full `vitest run` → **503 passed | 19 skipped (78 files)**, and `eslint .` now **exit 0 after the F-57 fix** (it FAILED `exit 1` before the fix — 2 `no-control-regex` errors). The judge's own AC-1/AC-2 (`judge-executed check … exited 0`) were honest on the CLONE; all 4 rubric items (`tests_pass`, `no_unrelated_deletions`, `no_secrets_introduced`, `scope_matches_instruction`) pass with sane justifications.

**Anomaly checklist:** no wasted/filler steps (1 step, `changes made 1`, `issues:changes 0:1`). Cost telemetry healthy — `$1.0565` step + `$0.0100` judge, nonzero, both models priced (no `.00`/F-9). Judge checks genuinely executed (`exited 0` recorded), family diversity real (Google `gemini-3.1-pro-preview` judge ≠ OpenAI `codex` executor via the keyless shim). No escalate/rollback/injection. Loop integrity clean: 1 checkpoint `lastGood true`, no resume, no duplicate journal entries. The empty-diff probe step (F-11) did not recur (`s0 j@0`).

---

## Token economics (baseline for WP-203/WP-207)

🟡 **A 5-file additive wire burned 775,283 input tokens** (8,815 out) across 30 tool calls in a single step — the campaign's highest yet for an additive-wire task (dogfood-059's similar primitive: 734k; dogfood-055's 4-file secret wire: 580k). Codex input consumption tracks the executor's repo-exploration appetite, NOT task difficulty — the executor read ~88× more than it wrote (775k in / 8.8k out). This is the raw input the pacing numerator then sums and projects (see F-56/WP-254).

---

## New friction

Friction numbering is global/sequential; the highest prior is **F-56** (dogfood-059 → WP-254, open). This run adds **one** new finding, **F-57**, and recurs **F-56**.

### F-57 / WP-249 (escalated 🔴) — the harvest commit bundled unrelated uncommitted host files and BROKE the lint gate on `main`; the judge's green is on the CLONE, never re-checked on the LANDED commit.

- **Evidence.** The run touched exactly 5 judge files (run workspace `git diff` + `eslint .` on the clone = exit 0; judge AC-2 PROCEED honest). But the harvest commit **`821cae5`** changed **7** files: the 5 in-scope judge files **PLUS `test/cli/cli.test.ts` (+6/−2) and `test/cli/trace.test.ts` (+12/−5)** — two duplicate `stripAnsi` helpers using `/\x1b\[[0-9;]*m/g`. Proof the run never wrote them: the run workspace's `cli.test.ts` contains **0** occurrences of `stripAnsi`; so does the run-base commit `96df844`; the strings exist only as uncommitted ANSI-cleanup edits on the host working tree at harvest time. The commit message even names the bundle: *"…and clean CLI logs of ANSI escape codes."*
- **The cost (NEW, severe).** Those 2 bundled files **fail `pnpm exec eslint .`** — `no-control-regex` on the `\x1b` control character, ×2. So **`821cae5` (HEAD/main) FAILS AC-2's own lint gate** (`cd packages/sdk-ts && pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm exec vitest run` → `exit 1`), even though the dogfood dashboard reads ✅ PROCEED 2/2. **Green dashboard, red main.** The judge cannot catch this: it graded the clone (where the files didn't exist); nothing re-runs the run's AC checks against the actual landed commit. **Worse, it poisons the next dogfood** — every run clones HEAD, so dogfood-061's `eslint .` AC would have failed before its executor wrote a line.
- **Why WP-249, escalated.** This is the **3rd recurrence** of the harvest-hygiene friction: F-51 (dogfood-049, `dde765b` bundled an unrelated `land.test.ts` edit) → recurred dogfood-058 (`774e130`, auto-commit bundled delivery+docs) → **F-57 now**. The first two were *audit-trail pollution* (benign extra files, broken `git log --grep <run-id>`); F-57 is the first that **breaks the build**, promoting WP-249 from 🟡 to **🔴**. The auto-commit-mid-session pattern (a hook bundling whatever sits on the host tree into one run-id-less commit) is the mechanism every time.
- **Fix (WP-249, escalated):** (a) land the run's harvested diff in its **own** commit, separate from operator/host hand-edits — the ANSI-cleanup is legitimate but belongs in its own `fix:` commit; (b) stamp a `Ref: run-id: <id>` trailer; **(c, NEW — the breaking-build half) after harvest, RE-RUN the run's OWN acceptance `check`s against the LANDED commit** (not just trust the clone's green) and refuse/flag the land if any fails. The judge grades the clone; only a post-harvest re-gate on the landed tree closes the green-dashboard-red-main gap. **Fixed inline this review** (the immediate breakage): added `// eslint-disable-next-line no-control-regex` above both `stripAnsi` helpers — `eslint .` now exit 0, `main` is lint-clean again (left uncommitted with the report).

### F-56 / WP-254 (recurs, 🟡 — no new WP) — the calibrated pacing metric still over-reads on `codex` steps.

- This 5-file additive wire read `peak window 392% (compact 0 · park 1)` and PARKED — the **8th** data point in the park-saturation series (602/604/759/585/334/904[pre-wire]/179[058-light]/370/**392**). Same root cause WP-254 already tracks (dogfood-059 F-56): the numerator sums a fresh codex subprocess's 30 internal-turn throughput (775k+8.8k) ×2 and divides by a window keyed to `routing.stages.code.model`, not the actual executor — even raw 775k/400k = 1.94× "overflows" though the provider accepted 775k input (real executor window > 400k, zero genuine context pressure on a 5-file task). No new WP; reinforces WP-254's priority.

---

## Verdict on the thesis

🟢 **Strongly positive on the product pillar — and a sharp, honest negative on the dogfood loop's own landing discipline.** WP-215's S5 judge-evidence wire lands exactly as designed: the Agent-as-a-Judge now mechanically sees the external packages a diff newly imports, alongside the secret scan, in the same inner-loop evidence pass — the dependency analog of the landed secret-scan wire, completing the S1→S2→S3 (secret) / S4→S5 (dependency) security-evidence chain on real judge code. Delivered in **1 step for $1.0665 / 21.4%** of budget with **0.9%** judge share, breaking nothing in the 503-pass suite, by a `codex`/`gpt-5.5` executor whose work a structurally-different `gemini-3.1-pro-preview` judge re-ran and approved (2/2 AC, 4/4 rubric). The full-diff-before-truncation ordering — the spec's named failure surface — was gotten right. Zero contract change, zero new dependency, tight 5-file run scope.

But **F-57 is the most important finding of the campaign so far**, and it's a thesis-relevant one: the product sells *real-time quality gates that catch bad changes before they land*, yet **the dogfood loop's own landing step shipped a lint-broken `main` while every gate read green**. The judge was honest — it graded a clean clone — but **nothing re-checks the run's acceptance criteria against the commit that actually lands**. That gap (clone-green ≠ landed-green) is exactly the kind of seam the product exists to close, and it bit the product's own pipeline. WP-249's escalation to 🔴 — separate the run-diff commit AND **re-gate the landed commit** — is now the highest-priority loop-integrity fix. **The next dogfoodable headline stays on the WP-215 judge-security pillar: the deterministic dependency/secret OVERRIDE (the WP-253-style §4 follow-up that lets a non-empty `newDependencyLabels`/real-secret flip a verdict pre-land), which the now-landed S5 evidence wire makes possible.**
