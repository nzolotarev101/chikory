# dogfood-118 — WP-540 (base-ref materialization) — the verification is real now, and nothing reads it

- **WP:** WP-540 (prove a benchmark task's untouched base is green before anyone scores it)
- **Date:** 2026-07-28
- **Spec:** [`examples/dogfood/dogfood-118-wp540-base-ref-materialization.yaml`](../../examples/dogfood/dogfood-118-wp540-base-ref-materialization.yaml)
- **Run-id:** `run-ee8491db-a082-4eb3-97ee-a9915256b401`
- **Base HEAD at launch:** `2f1a9a7`
- **Outcome:** SUCCESS · 1 step · $0.0487 / $30.00 · 3m 18s · executor `gemini-cli` (gemini) · judge `openai-compat` (`gpt-5.6-sol xhigh`)
- **Landed:** harvested by hand this sitting (byte-IDENTICAL, 7 files, +301/−54); commit cited in the status block below

## Plain lead (vibe check)

The run did exactly what it was asked and it is right. The benchmark harness now
checks out the target repository at its pinned commit, in a scratch directory of
its own, and runs the target's own declared test command there — before the agent
under test touches anything. The workspace handed to the agent still starts
empty, the scratch checkout is deleted afterwards, and the "guess the test
command from the grading checks" resolver is gone, replaced by one declared YAML
field. All four acceptance criteria pass independently against the harvested
tree, and the full project suite is green.

Two things this review found by looking past the green:

1. **The verdict is written down and nobody reads it.** The base-green result
   lands in the per-task JSON and stops there — no consumer, no field in the
   suite summary, no effect on the published I-SR/D-SR scores. A benchmark can
   still publish a number whose base was never proven green. That is the same
   defect shape as WP-540 itself, one level up, and it is the next run.
2. **`brownfield-002` did not need any of this.** Its `blocked_reason` says the
   target's suite is systemically red on the pinned base under Node 22. Measured
   this sitting on a clean clone of that exact commit: **1128 / 1128 tests pass
   in 13.1 s under ambient Node v22.22.3.** The task has been blocked for five
   days and four dogfood runs on a premise nobody re-measured.

## Glossary (IDs used here)

- **WP-540** — the work package: give the harness a mechanical answer to "is this task's untouched base ref green?".
- **WP-541** — new, queued below: a base that is not proven green must invalidate the score computed on it.
- **P3-rung-4** — current phase ladder rung: ≥5 brownfield tasks scored against a baseline, producing a score range.
- **AC-n** — acceptance criterion: a shell check the judge executes against the delivered tree.
- **base ref** — the commit a brownfield task pins as "before the fix"; the agent's diff is measured against it.
- **I-SR / D-SR** — DevAI independent / dependency-adjusted satisfaction rate: the published benchmark numbers.
- **provisioning decision** — `ambient` / `provision` / `unavailable`, the per-target Node choice WP-538 landed.
- **F-n** — global sequential friction id. This report adds **F-202 … F-206**.

## Trace

```
run run-ee8491db-a082-4eb3-97ee-a9915256b401 · SUCCESS · 1 steps · $0.05 / $30.00 · 3m 18s
  executor gemini-cli(gemini) · judge openai-compat · ⚠ cost meter blind (unpriced tokens)
 #   step                          tokens(in/out)   cost     verdict
 1   High-Level Summary…           4.3k/865         $0.00    ✓ PROCEED (4/4 criteria)
totals: decisions 1 · judge passes 1 ($0.0487, 100.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 75% (compact 0 · park 0)
        issues found 0 · changes made 1
```

| Item | Value |
|---|---|
| Step 1 wall-clock | 2m 28s · 0 tool calls · diff 19069 bytes |
| Judge pass #1 | 47s · 19232 evidence bytes · $0.0487 · `gpt-5.6-sol xhigh` |
| Checkpoint | `run-ee8491db…@5` · commit `2f4096fa747d` · `lastGood: true` |
| Cost split | steps $0.0000 (unpriced gemini tokens) + judge $0.0487 = **$0.0487** (0.2% of budget) |
| Judge cost share | **100.0%** — above `judge.maxCostShare: 0.5`, warned at runtime (structural for a 1-step gemini run, F-190) |
| Probe step | none (no empty-diff step) — F-11 did not recur |

## Delivery quality (human review, post-landing)

Landed diff: 7 files, +301 / −54, all inside `benchmarks/harness/` — scope clean,
no new dependency, no `devbox.json` edit.

| Spec requirement | Delivered | Evidence |
|---|---|---|
| Base ref materialized **outside** `workspaceDir` | 🟢 | `suite.ts:136-152` — `git clone` + `checkout <ref>` into `os.tmpdir()/base-verify-<taskId>-…` |
| Adapter workspace still empty at adapter start | 🟢 | AC-1 asserts `readdirSync(workspaceDir).length === 0`; `suite.test.ts:170` re-asserts |
| Cleanup on success **and** failure | 🟢 | `finally { rmSync(tempDir, {recursive, force}) }` `suite.ts:160-168`; `suite.test.ts:193` pins no `base-verify-*` left in `tmpdir()`; hand-checked — 0 leftovers after two AC-1 runs |
| Verification runs **before** the adapter (trap B) | 🟢 | `suite.ts:126-170` precedes `adapter.run` at `:173` |
| No repo pin ⇒ record **nothing** | 🟢 | `if (task.repo !== undefined)` guard; AC-1 + `suite.test.ts:200` |
| Repo-pinned, no declared command ⇒ non-green, no invented command | 🟢 | `suite.ts:128-135`; `suite.test.ts:217` |
| `findBaseVerificationCommand` deleted from module, call site, exports | 🟢 | `base-verify.ts` −23 lines, `index.ts` −1, AC-2 |
| One declared field, wired for real (F-194) | 🟢 | `base_verification_command` (YAML) → `baseVerificationCommand?: string`, `task.ts:55,85,214` — exactly one spelling, no speculative siblings |
| Suite-path tests, not module-only | 🟢 | 5 net-new `runSuite` cases (`suite.test.ts:140-330`); 94 → **102** tests |

**Independent verification (not the run's own green):**

| Check | Result |
|---|---|
| AC-1 (behavioral, drives real `runSuite` vs a local git fixture) | 🟢 PASS |
| AC-2 (resolver gone + declaration present) | 🟢 PASS |
| AC-3 (harness suite, ≥100 floor) | 🟢 PASS — **102 passed / 10 files**, 3.17s |
| AC-4 (`tsc --noEmit` + `eslint src`, harness-scoped) | 🟢 PASS |
| Harvest byte-diff vs run workspace | 🟢 **IDENTICAL** on all 7 files |
| Full project suite (`devbox run test`) | 🟢 sdk-ts **1007 passed / 23 skipped** (144 files) · harness **102** · sdk-py **84** |
| `git status` after the run (F-192 escape check) | 🟢 clean — no writes outside the run workspace |

Judge behavior was honest at the criteria altitude: all four checks genuinely
executed (19232 bytes of evidence), and all six rubric items carry specific,
verifiable justifications — `no_unrelated_deletions` correctly identifies that
the only removed production code is the prohibited resolver.

## New friction

**F-202 — 🔴 the base verdict is recorded and no code reads it.**
`suite.ts:197` writes `baseVerification` into `TaskResult`; `grep -n
baseVerification benchmarks/harness/src/*.ts` returns write sites only. There is
no field for it on `SuiteSummary` (`results.ts:26-45`), and `summarize()`
computes I-SR / D-SR over every task regardless. A suite run whose every base is
red — or, today, whose every base records `"No base verification command
declared"` — publishes the same headline numbers as one whose bases are all
proven green. WP-540's own thesis (*a benchmark number is worthless if the base
it is measured against was never verified*) is satisfied at the measurement
altitude and unsatisfied at the publication altitude. The spec asked only that
the result be *"carried into the per-task result record as it is today"*, so the
executor delivered exactly what was specified — **this is a spec gap, not an
executor defect**, and it is the third consecutive run where the defect lives one
level above where the ACs looked (F-198 → call site; F-202 → consumer).
→ **WP-541 (queued, next headline).**

**F-203 — 🔴 `brownfield-002` has been blocked for five days on a premise that is
false today.** Its `blocked_reason` (F-163, 2026-07-23) states the target pins
`engines.node >=24` and that under Node 22 the base ref is systemically red —
*"354/1128 tests fail, incl. 107 snapshot-serialization drifts"* — so grading is
meaningless. Measured this sitting, clean clone, no harness involvement:

| Probe | Measured |
|---|---|
| `git clone https://github.com/gitify-app/gitify` | 2.08s · 27 MB |
| `git checkout a061eaa112fa18885dd4de0cea6c0e51094cad0c` (the pinned base ref) | clean tree, confirmed by `git rev-parse HEAD` |
| `pnpm install --frozen-lockfile` (warm store) | 5.2s |
| `pnpm test` under ambient **node v22.22.3** | **153/153 files · 1128/1128 tests passed · 13.13s** |
| `decideTargetNode(">=24", discoverNodeToolchains(), v22)` | `provision` → `/nix/store/3mvbmkd7…-nodejs-24.15.0/bin` (9 toolchains found) |

So the base is green under the *unsupported* engine, and the harness can
provision the supported one anyway. The most likely explanation for the original
354-failure measurement is that it was taken inside a harness workspace carrying
the copy-back and install defects of that week (F-157 wrong workspace, F-166
symlink rewrite, F-173 `npm install` in a non-npm repo) rather than on a clean
clone. Cost of not re-measuring: `brownfield-002` stayed blocked across
dogfood-113/114/117/118 — **four runs, three of them `rung=0`** — while the
corpus sat at 2 of the 5 that P3-rung-4 needs.
→ **flip folded into WP-541**, gated on the harness's own verification rather
than on this hand measurement. Standing rule added to DOGFOODING §7:
**re-measure a `blocked_reason` before spending a run on its unblock.**

**F-204 — 🟡 AC-1's cleanup assertion was vacuous (my spec, not the delivery).**
`A(readdirSync(root).filter(e => e.startsWith("chikory-base-")).length === 0)`
scans the *fixture's* temp root for a prefix no implementation uses; the delivery
writes to `os.tmpdir()/base-verify-*`. The assertion would have passed over a
delivery that leaked every checkout. Cleanup is in fact correct — proven by the
executor's own `suite.test.ts:193` (right directory, right prefix) and by a hand
check finding 0 leftovers. An oracle-owning AC that names a path must name the
path the implementation is free to choose, or assert emptiness of the directory
the implementation was *told* to use.
→ **track-B AC-hygiene note** (with F-83 / F-187 / F-198).

**F-205 — ℹ️ the base checkout re-implements `loadTargetEngineSource`'s temp
clone, more heavily.** `suite.ts:141-148` uses a full `git clone` (no `--depth`,
no `--filter`) plus `git checkout <ref>`, with hardcoded 30s / 15s timeouts;
`engine.ts:210-217` — three modules away, same job — uses `clone --depth 1
--no-checkout --filter=blob:none` then `fetch --depth 1 origin <ref>`. Measured,
the heavy form costs nothing today (gitify 2.08s/27 MB, zod 1.97s/40 MB, both
pinned refs reachable after a plain clone). It fails where the light form
succeeds only for a ref not reachable from any branch or tag (a PR head).
→ **track-B**, fold into WP-541 if that run touches the checkout path anyway.

**F-206 — ℹ️ nothing installs the target's dependencies between checkout and
verification.** `verifyBaseGreen` runs the declared command in a bare clone under
`DEFAULT_CHECK_TIMEOUT_MS = 120_000`. Any real declaration must therefore fold
the install in (`pnpm install --frozen-lockfile && pnpm test`), and install +
suite must fit 120s. Measured for gitify: 5.2s + 13.1s = **18.3s**, comfortably
inside the cap — so no knob is needed yet (F-194: do not add the field until a
target needs it). This is a constraint the next spec must state, not a defect.
→ **folded into WP-541.**

## KPI table (DOGFOODING §1.4)

| KPI | This run | Trailing window |
|---|---|---|
| Max horizon survived | 1 step · 3m 18s | 4 steps (dogfood-115); trailing-3 max **2 vs 4** prior-3 |
| kill→resume count | 0 | 0 across 112–118 |
| Judge true-positives pre-land | **0** — the judge could not catch F-202 (out of spec scope) | 0 (117), 1 (116), 1 (115) |
| Trailing-3 meta:product headline ratio | 0:3 (`class=product`) | cap ≤1/3 intact |
| Per-step reliability (runs ≥5 steps) | n/a (1 step) | 93.8% (8 rollbacks / 128 steps) — target 99%+ |
| Current-phase ladder rung | **0** (off-ladder; WP-540 is rung-4's unblock, not the rung) | rung 3 climbed (dogfood-108); rung 4 ⏳; exit gate = rung 5 |
| Progression gate | ⛔ **STALLED** — no thesis axis moved over the last 3 runs | 3rd consecutive `rung=0` |

## Friction disposition table

| F-n | Sev | Defect | Disposition |
|---|---|---|---|
| F-202 | 🔴 | Base verdict written to the per-task record; zero readers, absent from `SuiteSummary`, no effect on I-SR/D-SR | **→ WP-541 (queued, next headline)** |
| F-203 | 🔴 | `brownfield-002` blocked 5 days / 4 runs on a stale premise — base measured **1128/1128 green** under Node 22 | **→ WP-541 (queued)** — flip gated on the harness's own verdict; rule added to DOGFOODING §7 |
| F-204 | 🟡 | AC-1's cleanup assertion scanned the wrong directory for an unused prefix — vacuous | **track-B note** (AC hygiene, with F-83/F-187/F-198) |
| F-205 | ℹ️ | Base checkout duplicates `engine.ts`'s temp-clone in a heavier form (full clone, hardcoded timeouts) | **track-B note**; fold into WP-541 if it touches the checkout path |
| F-206 | ℹ️ | No dependency install between checkout and verification — declarations must fold it in; measured 18.3s of a 120s cap | **→ WP-541 (spec constraint)** |

## Verdict on the thesis

The judge loop is now reliably right about the thing it is pointed at, and
reliably silent about the thing one level up. dogfood-117 shipped a correct
module wired to an empty directory; dogfood-118 shipped a correct call site whose
output no consumer reads. In both cases every acceptance criterion was genuine,
behavioral, and satisfied — and in both cases the defect sat at the next altitude
out.

That is a sharper statement of the standing lesson than "own your oracle". The
acceptance criteria are only ever as wide as the spec's imagination, so the
recurring question for spec authoring is not *"does this work?"* but *"who
consumes this, and what breaks if the answer is wrong?"* — asked one hop further
out each time. WP-541 is written that way: it does not add a verification, it
makes an existing verification able to stop a number from being published.

The louder lesson is F-203. Four runs of capability were built to unblock a task
that was not actually blocked. The block was a sentence in a YAML comment, and
nobody re-ran the measurement behind it. The thesis is *self-correcting agents
over long horizons*; a loop that inherits its own stale assertions is not
self-correcting, it is compounding. Re-measuring a `blocked_reason` costs 20
seconds. Not re-measuring it cost four runs.

## Next run — AC arming evidence (dogfood-119 / WP-541)

Spec: [`examples/dogfood/dogfood-119-wp541-unverified-base-invalidates-the-score.yaml`](../../examples/dogfood/dogfood-119-wp541-unverified-base-invalidates-the-score.yaml)

| AC | Preflight class | RED on HEAD | GREEN on a throwaway reference | Wall-clock vs 120s cap |
|---|---|---|---|---|
| AC-1 (summary altitude, owns its oracle) | VERIFY-SUITE — not dry-run | 🟢 `FAIL: a green base is verified` (`perTask[].baseVerified` undefined), clean exit 1 | 🟢 `AC-1 OK: unverified bases are named, counted, kept visible, and excluded from the published rate` against a throwaway `results.ts` patch (since reverted) | **3.01s** RED / **2.69s** GREEN |
| AC-2 (summary fields + corpus declarations + the flip) | dry-run by preflight | 🟢 clean exit 1 | 🟢 exit 0 against a simulated compliant corpus (since reverted) | **0.03s** |
| AC-3 pt1 (test floor 110) | VERIFY-SUITE | 🟢 `FAIL: only 102 harness tests pass` | 🟢 same script with the floor at 100 → `AC-3 pt1 OK: 102 harness tests pass` | **4.25s** RED / **5.15s** GREEN (both parts) |
| AC-3 pt2 (real corpus loads, 3 declarations, `brownfield-002` runnable) | VERIFY-SUITE | 🟢 `FAIL: brownfield-001 must declare a base_verification_command that survives the loader` | 🟢 `AC-3 pt2 OK: corpus loads, 3 tasks declare a base command, brownfield-002 is runnable` | **0.39s** |
| AC-4 (`tsc --noEmit` + `eslint src`, harness-scoped) | VERIFY-SUITE | n/a (green pre-delivery by design) | 🟢 exit 0 | **2.78s** |

Everything is far inside the 120s per-check judge cap; the slowest is AC-3 at ~5s.

**One AC-hygiene defect found and fixed while arming (F-204's lesson, applied
immediately):** AC-3's two `node -e` stages were originally newline-separated,
so the check's exit status was pt2's alone — a delivery that regressed the test
floor but fixed the corpus would have scored a false GREEN. Chained with `&&`
before launch and re-verified in both directions.

**Residual risk, stated plainly:** AC-2/AC-3 prove each pinned corpus task
*declares* a base verification command and that the declaration survives the
loader. Neither can prove the command is *correct* — that needs network and the
real targets, so it is the follow-on benchmark run's job. The measured reference
for `brownfield-002` is `pnpm install --frozen-lockfile && pnpm test` → 1128/1128
in 18.3s total; `brownfield-001` is Yarn Berry (F-173) and must not use npm.

`CHIKORY_PREFLIGHT_ONLY=1 devbox run run-dogfood` → ✅ Preflight OK; spec lint
🟢 LOOSE, rung 4, KPI header present, no F-82/F-83 hazard; the spec-pick glob
(`sort | tail -n 1`) resolves to dogfood-119.
