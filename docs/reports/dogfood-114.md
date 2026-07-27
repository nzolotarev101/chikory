# dogfood-114 — WP-538 (range-correct, single-plan, fail-loud node provisioning) — delivered, with one regression found by hand and fixed

- **WP:** WP-538 (WP-534 completion — range-correct per-target node provisioning)
- **Date:** 2026-07-27
- **Spec:** [`examples/dogfood/dogfood-114-wp538-range-correct-single-plan-provisioning.yaml`](../../examples/dogfood/dogfood-114-wp538-range-correct-single-plan-provisioning.yaml)
- **Run-id:** `run-fc10fe73-0095-48b9-b994-b17e1f27d51d`
- **Base HEAD at launch:** `03eda22`
- **Outcome:** SUCCESS · 1 step · $0.0552 / $30.00 · 3m 45s · executor `gemini-cli` (gemini) · judge `openai-compat` (`gpt-5.6-sol xhigh`)
- **Landed:** harvested + hand-fixed in this review sitting (commit cited in the status block below)

## Plain lead (vibe check)

The run did the job it was given: the benchmark harness now picks a Node version
that genuinely **satisfies** each target's declared version range instead of
demanding an exact match, decides it **once** per task, and hands the same
decision to both the run path and the grading path. Live-probed against the real
Nix store, the target that has been blocking the benchmark corpus (gitify, which
requires Node 24 or newer) correctly resolves to Node 24.15.0 while the other two
targets correctly stay on the ambient Node 22.

But the judge passed it 5/5 acceptance criteria and 6/6 rubric items, and hand
probing still found a **regression**: version ranges written as two bounds
(`">=24 <26"` — one of the commonest forms in real `package.json` files) were
silently treated as gibberish and resolved to the ambient Node. That is the exact
"silently run on the wrong toolchain" failure the run was chartered to abolish,
and the previous code handled that form *correctly*. It slipped through because
the acceptance criteria only probed single-bound ranges. Fixed by hand in this
sitting (13 new tests, 78 total green). Net: the delivery is good, the acceptance
oracle was one range-family too narrow, and the judge's design rubric — which is
the layer that should have asked "does this cover the range forms real repos
use?" — again had nothing to gate on.

## Glossary (IDs used here)

- **WP-538** — the work package this run delivered: WP-534's completion (range-correct node provisioning).
- **WP-534** — the first attempt at per-target node provisioning (dogfood-113); landed inverted.
- **WP-537** — the queued fix for F-180 (the design-fix retry loop that never fires).
- **F-n** — global sequential friction id. This report adds **F-187…F-190**.
- **AC-n** — acceptance criterion: a shell check the judge executes against the delivered tree.
- **P3-rung-4** — the P3 proof ladder's 4th rung: ≥5 brownfield tasks scored against a baseline.
- **ambient / provision / unavailable** — the three provisioning outcomes: use the Node already on PATH, prepend a different Node's `bin` dir, or refuse to score the task.
- **AND-range / OR-range** — `">=24 <26"` (both bounds must hold) vs `"22 || 24"` (either may hold).
- **oracle-owned AC** — an AC whose check states the expected inputs and outputs itself, rather than running tests the executor wrote.

## Trace excerpt (journal = ground truth)

```
run run-fc10fe73-0095-48b9-b994-b17e1f27d51d · SUCCESS · 1 steps · $0.06 / $30.00 · 3m 45s
  executor gemini-cli(gemini) · judge openai-compat · ⚠ cost meter blind (unpriced tokens)
 #   step                          tokens(in/out)   cost     verdict
 1   I will start by exploring …    4.8k/2.4k       $0.00    ✓ PROCEED (5/5 criteria)
totals: decisions 1 · judge passes 1 ($0.0552, 100.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 75% · issues found 0 · changes made 1
        endpoints plan openai-compat · code gemini-cli(gemini) · review/judge openai-compat
step 1 · diff e0ceeb231be0 · 19,482 bytes · 0 tool calls journaled · 2m 51s
judge pass #1 · gpt-5.6-sol xhigh · $0.0552 · 20,192 evidence bytes · 50s
  criteria: AC-1 ✓ AC-2 ✓ AC-3 ✓ AC-4 ✓ AC-5 ✓
  rubric:   tests_pass ✓ · no_unrelated_deletions ✓ · no_secrets_introduced ✓
            no_architecture_violations ✓ · scope_matches_instruction ✓ · design_serves_overall_goal ✓
verdict:    ✓ PROCEED (5/5 criteria) · rationale "all 5 acceptance criteria pass; no rubric failures"
checkpoint: run-…@5 · commit c13aef121d99 · lastGood true
```

## Verification (independent, post-harvest)

`scripts/dogfood-verify.sh` §3 initially reported AC-1…AC-4 **FAIL** — the
delivery was not yet harvested (F-186's lesson, now codified in DOGFOODING §7:
never read a clean `git status` as "the run delivered nothing"). After
`scripts/harvest.sh`:

| Check | Result |
|---|---|
| Harvest byte-diff (§5) | clean — 6 files, no `DIFFERS` |
| Scope (§4) | `benchmarks/harness/src/{engine,suite,adapter,grade,index}.ts` + `test/engine.test.ts` — exactly the goal's surface, nothing else |
| AC-1 (behavioral probe over built module) | 🟢 PASS, 2.0 s |
| AC-2 (`decideTargetNode` referenced by exactly 2 src files) | 🟢 PASS |
| AC-3 (both consumers take `nodeProvisioning`, neither re-derives) | 🟢 PASS |
| AC-4 (`loadTargetEngineSource` exported) | 🟢 PASS |
| AC-5 (tsc + eslint + vitest) | 🟢 PASS — 65 tests (was 59; executor's claim of 65 is exact) |
| New dependency / key material / `devbox.json` edit | none |

### Live probe — the real corpus, real Nix store, ambient v22.22.3

Store toolchains discovered: `20.19.1, 20.19.6, 22.21.1, 22.22.3, 24.14.1, 24.15.0`.

| task | target | declared `engines.node` | decision |
|---|---|---|---|
| `brownfield-001` | `ecyrbe/zodios` | *(none)* | `ambient` |
| `brownfield-002` | `gitify-app/gitify` | `">=24"` | `provision …-nodejs-24.15.0/bin` |
| `brownfield-003` | `colinhacks/zod` | *(none)* | `ambient` |

The Thesis-KPI (**benchmark corpus reach**) is met on the corpus as it stands, and
`loadTargetEngineSource` was proven end-to-end against the three real remotes —
one clone per task, temp dir under `os.tmpdir()`, removed in `finally` (F-184
closed).

### Live probe — the range families the ACs did NOT cover

This is where the delivery broke, and where the legacy code was better:

| range | HEAD (legacy resolver) | as delivered | after hand-fix |
|---|---|---|---|
| `">=24 <26"` | provision node 24 | 🔴 **`ambient` (v22)** | provision 24.15.0 |
| `">=18 <21"` | `unavailable` (loud) | 🔴 **`ambient` (v22, violates `<21`)** | provision 20.19.6 |
| `">=20.0.0 <23"` | provision node 20 | 🔴 **`ambient`** *(v22 does satisfy it, so benign here)* | `ambient` ✓ |
| `"~24.1"` | no constraint → ambient | `ambient` | `unavailable` (loud) |
| `">18"` / `"<=24"` | no constraint → ambient | `ambient` | `ambient` ✓ (v22 satisfies both) |
| `"24.15.0"` (exact pin) | major-only | major-only (24.14.1 accepted) | exact match |
| `">=18.19.1 <19 \|\| >=20.11.1"` | — | 🔴 `ambient` | evaluated per-group |

## Delivery quality (human review, post-landing)

**What the executor got right, and it is most of the goal:**

- `decideTargetNode` is pure, exported, and composes resolution + planning into
  one decision. Satisfaction, not equality: `">=18"`/`">=20"`/`">=22"` all resolve
  to `ambient` under v22 — the F-181 inversion is closed.
- Deterministic newest-satisfying pick via an explicit `compareVersions` sort,
  not `readdirSync` order (F-185 closed). Live-verified: `">=24"` picks 24.15.0
  over 24.14.1.
- **Single resolution, correctly threaded.** `suite.ts:95-112` resolves once;
  `AdapterContext` and `GradeContext` each carry `nodeProvisioning`;
  `adapter.ts`'s `withProvisionedPath` and `grade.ts`'s `gradeTask` now *consume*
  it and both **throw** on `unavailable` rather than silently running ambient.
  The imports of `planNodeProvisioning`/`getTargetPackageJson` are gone from both
  consumers — F-182, the spec's named trap, is genuinely closed, and this is the
  part dogfood-113 failed.
- `loadTargetEngineSource` returns a discriminated result, never `null`; the
  read-failure reason is carried into the skip message (F-183 closed).
- One clone per task, `os.tmpdir()`, `finally` cleanup (F-184 closed).
- Scope perfect: 6 files, all inside `benchmarks/harness/`, no dependency added,
  `brownfield-002` left `status: blocked` as mandated.
- 6 new tests, all the goal's named cases; 65/65 green, tsc + eslint clean.

**Where it fell short:**

- The range grammar models only single-comparator forms. Whitespace-joined
  comparators — an AND-range — were dropped as unparseable and fell through the
  goal's "unparseable resolves to ambient" clause, which is the one path the goal
  *also* forbade ("FAIL LOUD, NEVER SILENTLY AMBIENT"). Two clauses of the same
  goal disagreed, and the executor satisfied the wrong one (F-187).
- `loadTargetEngineSource` conflates "this repo has no `package.json`" with
  "this repo could not be read", so a non-Node target would be skipped rather
  than run on ambient (F-188).
- Bare full versions were treated as major-ranges, so a `"24.15.0"` pin accepted
  24.14.1 (F-189).
- The legacy `resolveTargetNodeEngine` / `planNodeProvisioning` /
  `getTargetPackageJson` trio is now dead in `src/` (still exported and tested,
  marked "kept for compatibility"). Harmless, but it is two range engines in one
  file; a future edit will fix one of them.

## New friction

### 🔴 F-187 — an AND-range silently resolves to the ambient toolchain (a regression)

**Evidence.** `benchmarks/harness/src/engine.ts` `satisfiesRange` matched each
`||`-part against four anchored single-comparator regexes. A part containing two
comparators separated by whitespace matched none, so the part was unsatisfied;
the `hasValidPattern` guard then classed the whole range as unparseable and
`decideTargetNode` returned `ambient`. Live-probed at ambient v22.22.3 with
24.15.0 present in the store:

```
">=24 <26"  → ambient      (legacy resolver: provision node 24)
">=18 <21"  → ambient      (v22 violates <21; legacy: loud unavailable)
```

`">=X <Y"` is among the commonest `engines.node` forms in the wild (`">=18.19.1
<19 || >=20.11.1"` ships in the Angular and Nx toolchains). `>`, `<=`, `~` were
also unmodelled. **Consequence:** exactly the failure mode WP-534/WP-538 exist to
abolish — the target runs and is graded under a Node its own manifest excludes,
emitting a red indistinguishable from agent failure, with no log line. And for
`">=24 <26"` it is strictly **worse than the code it replaced**.

**Why the gate missed it.** AC-1 owns its oracle and did its job — for the range
family it enumerated. Every probe used a single comparator, so an AC that was
verified in both directions still under-specified the input domain. The judge's
`design_serves_overall_goal ✓` blessed the design without asking whether the
grammar covered real manifests; per F-180 a rubric ✗ would have had no consumer
anyway.

**Disposition: HAND-FIXED THIS SITTING.** `engine.ts:46-135` — replaced the four
ad-hoc regexes with one `parseAtom`/`parseRange` model: OR-groups of AND-ed
comparators over `>=`, `>`, `<=`, `<`, `=`, `^`, `~`, `N.x`, `*`, bare; operator/
operand whitespace normalized before AND-splitting so `">= 24"` still parses; an
AND-group containing any unmodelled comparator is dropped whole rather than
satisfied on its parseable half; `parseRange() === null` is now the single
definition of "unparseable" for both the satisfaction test and the
ambient-vs-unavailable branch. **13 new tests** (`test/engine.test.ts`), harness
**78/78 green**, tsc + eslint clean, AC-1 re-passes, real-corpus decisions
unchanged.

### 🟡 F-188 — a target with no `package.json` is read as an unreadable repo, and skipped

**Evidence.** `loadTargetEngineSource` ran `git checkout FETCH_HEAD --
package.json` and mapped any throw to `{type:"error"}`, which `suite.ts` turns
into an `unavailable` skip. Probed against a real repo that has no
`package.json`:

```
loadTargetEngineSource(<no-package.json repo>)
  → {"type":"error","error":"Command failed: git -C … checkout FETCH_HEAD -- package.json"}
  legacy getTargetPackageJson(…) → null   → "no constraint" → the task RAN
```

**Consequence.** A Python/Go/Rust target — or any Node repo that declares engines
somewhere else — would be **skipped** with "failed to read engine source" instead
of running on ambient. That shrinks the corpus, inverting the WP's own KPI. No
current corpus impact (all three targets are Node repos with a `package.json`),
so it is latent, not live — but corpus expansion to ≥5 tasks is the very next
work, which is when it would have bitten.

**Disposition: HAND-FIXED THIS SITTING.** `engine.ts:213-224` — ask the tree
before treating a failed checkout as a read error: `git ls-tree --name-only
FETCH_HEAD package.json`; empty output means the file genuinely is absent →
`{type:"success", content:"{}"}` (no constraint). Only an unreachable/unfetchable
repo degrades to the loud skip. **3 tests** covering absent-with-no-repo,
present-in-workspace, and unreachable-repo.

### 🟡 F-189 — a fully-specified bare version was treated as a major-range

**Evidence.** `"24.15.0"` was satisfied by 24.14.1 (the bare-version branch
compared majors only). Pre-existing in the legacy resolver too, so not a
regression — but `decideTargetNode` was chartered to "get the satisfaction
relation right", and an exact pin is the one case where being loose silently
grades a target on a Node it did not ask for.

**Disposition: HAND-FIXED THIS SITTING** (folded into the F-187 parser). A
partial bare version stays a range over what it omits (`"24"` → any 24.x, `"24.1"`
→ any 24.1.x); a full `major.minor.patch` is an exact match. Probed: `"22.11.0"`
against a store holding 22.21.1/22.22.3 now yields a loud `unavailable` instead of
a false ambient.

### 🟡 F-190 — the CLI executor collapses a whole agent session into one Chikory step, so the horizon KPI is unmeasurable

**Evidence.** Step 1 journaled **0 tool calls** and 4.8k in / 2.4k out tokens
while producing a **19,482-byte diff across 6 files** — the ~90 discrete actions
the summary narrates all happened *inside* one `gemini-cli` turn. Same shape in
dogfood-108, 112, 113. Consequences, all structural rather than incidental:

- max-horizon-survived (§1.4's headline KPI) reads `1` on every gemini-cli run and
  measures nothing about long-horizon reliability;
- judge `cadence: 2` can never fire twice; pacing has one data point (`75% window`);
- checkpoint granularity is one commit, so a mid-session rollback is impossible;
- context-rot mitigation (WP-203/204) is never exercised;
- **and the F-180 mitigation the spec built in — "the goal is big enough to
  plausibly need >1 step, which re-arms the completion review" — cannot work.**
  A single-turn executor makes *every* run a first-verdict seal.

Related to but distinct from F-176 (`parseAgyOutput` recovers no tool count):
F-176 is a parser gap, F-190 is that the executor's own loop is the agent loop.
**Disposition: track-B note**, and a **design constraint on WP-537**: the F-180
fix must not assume a multi-step run, because on this executor there are none.

### 🟡 F-191 — the spec-format lint ⛔s a spec for having an oracle-owned AC

**Evidence.** Found while arming dogfood-115. `scripts/dogfood-progression.sh:145-148`
decided "prescribed diff" by grepping the **whole spec file** for
`^\s{4,}(import |const |export |return |await )`. An AC that owns its oracle is a
`node -e '…'` probe whose body contains exactly those lines, so the lint reported:

```
⚠️  PRESCRIBED-diff spec (goal dictates files/symbols/code) with NO '# Format: track-B'
    declaration. Headline specs must be LOOSE — outcome + ACs (DOGFOODING §3).
```

on a spec whose `goal` is purely outcome-shaped. **Consequence:** a ⛔ (a prescribed
headline without a track-B declaration is a launch blocker) fired *because* the spec
did the one thing DOGFOODING §3.4 now requires after F-180/F-187. Left standing, the
lint pressures every future headline away from behavioral ACs and back toward
symbol-greps — the precise failure that produced dogfood-113 and F-187.

**Disposition: HAND-FIXED THIS SITTING.** `scripts/dogfood-progression.sh:145-152` —
the heuristic now reads a `GOAL_BLOCK` extracted by `awk` (from `goal:` to the next
top-level key) instead of the whole file. Regression-checked both directions:
dogfood-114 still lints 🟢 LOOSE, dogfood-115 now lints 🟢 LOOSE, and the genuinely
prescribed track-B specs (dogfood-012…017) are still detected as PRESCRIBED.

### ℹ️ Recurrences (no new id)

- **F-167 / F-9 (cost meter blind).** $0.0000 across 7,212 metered executor
  tokens; `⚠ cost meter blind (unpriced tokens)` rendered correctly. Structural —
  `routing.stages.code.model: default` (mandated by F-170 safety) never surfaces a
  model id, so `pricing.ts` cannot help. Downstream: the JD-7 warning "judge spend
  is 100.0% of run cost … above `judge.maxCostShare=0.5`" is a **denominator
  artifact**, not a real overspend ($0.0552 total, 0.2% of budget). `max_cost_share`
  is inert on this arm.
- **F-180 (design-fix loop skipped on a first-verdict seal).** Did not bite as a
  missed rubric ✗ — the rubric was 6/6 ✓. It bit differently: a 1-step run means
  the completion review was skipped, so there was no second look at a design whose
  range grammar was one family too narrow. Still open → WP-537, and now the next
  headline.
- **F-186 (flaky `fan-in-handoff.test.ts`).** Did not recur — `scripts/harvest.sh`
  passed first try; sdk-ts 982 passed / 23 skipped.
- **F-141-safe.** Every AC inside the 120 s judge cap: AC-1 2.0 s, AC-5 ~2 s.

## Verdict on the thesis

**The product axis moved.** Per-target node provisioning is now range-correct,
resolved once, shared by the run and grade paths, and loud when it cannot be
honoured — live-proven against the real store and the three real targets. The
mechanical blocker on `brownfield-002` is gone; only its `status: blocked` flag and
a green-base verification run stand between the corpus and 3 runnable tasks.

**The gate axis did not.** Two consecutive headline runs have now sealed 🟢
SUCCESS carrying defects a human found in minutes: dogfood-113's inverted
semantics (judge caught 2 of 3, rubric-only, no consumer) and dogfood-114's
AND-range regression (judge caught none — the ACs did not probe the domain). The
common cause is F-180: **on a one-step run nothing consumes a design objection**,
and F-190 says every gemini-cli run is a one-step run. We are about to author
benchmark tasks we intend to publish. Publishing a corpus produced under a gate
that cannot gate is the failure mode the whole project is a rebuttal to — so
WP-537 goes ahead of corpus expansion.

**Lesson for AC design, beyond "own your oracle".** dogfood-113 taught that an AC
must not delegate correctness to executor-authored tests. dogfood-114 teaches the
next thing: an oracle-owned AC still only proves what it enumerates. When the
deliverable is a **parser or a matcher**, the AC must enumerate the *input
families* the real world contains — not just the happy family named in the goal.
Codified in DOGFOODING §5.

## Friction disposition

| F-n | sev | defect | disposition |
|---|---|---|---|
| F-187 | 🔴 | AND-range (`">=24 <26"`) silently resolves to ambient; regression vs the legacy resolver | **HAND-FIXED THIS SITTING** — `engine.ts:46-135` single `parseAtom`/`parseRange` model; 13 tests; 78/78 green |
| F-188 | 🟡 | absent `package.json` read as an unreadable repo → task skipped | **HAND-FIXED THIS SITTING** — `engine.ts:213-224` `ls-tree` probe before erroring; 3 tests |
| F-189 | 🟡 | exact pin `"24.15.0"` satisfied by 24.14.1 | **HAND-FIXED THIS SITTING** — folded into the F-187 parser; probed loud `unavailable` |
| F-190 | 🟡 | gemini-cli collapses the session into 1 Chikory step → horizon KPI, judge cadence, checkpoints and the F-180 re-arm all unmeasurable | **track-B note** + binding design constraint on WP-537 |
| F-191 | 🟡 | the spec-format lint scanned the whole file, so an oracle-owned `node -e` AC made a LOOSE spec ⛔ as "prescribed" | **HAND-FIXED THIS SITTING** — `scripts/dogfood-progression.sh:145-152` scans a `goal:`-only block; 114 + 115 lint 🟢 LOOSE, 012…017 still PRESCRIBED |
| F-167/F-9 | ℹ️ | recurrence — unpriced executor tokens, JD-7 warning is a denominator artifact | track-B (structural, already recorded) |
| F-180 | 🔴 | recurrence — 1-step run ⇒ completion review skipped ⇒ no consumer for a design objection | **→ WP-537 (queued as the NEXT HEADLINE, dogfood-115)** |
