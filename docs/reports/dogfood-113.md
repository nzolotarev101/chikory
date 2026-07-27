# dogfood-113 — WP-534 (per-target node provisioning) — mechanism landed, semantics inverted

- **WP:** WP-534 (per-target node provisioning — grade each benchmark target under the node engine it demands), `plan.md` §7 · P3-rung-4 **prerequisite** (not a rung climb)
- **Date:** 2026-07-26
- **Spec:** [`examples/dogfood/dogfood-113-wp534-per-target-node-provisioning.yaml`](../../examples/dogfood/dogfood-113-wp534-per-target-node-provisioning.yaml)
- **Run-id:** `run-5da56db2-69df-4ffa-9961-1ed65db863a3`
- **Landed commit:** see the harvest commit for this run-id (`git log --grep run-5da56db2`)
- **Outcome:** 🟡 **SUCCESS-with-defects** — 1 step, $0.0527 / $30.00, 3m 42s · executor `gemini-cli` (gemini) · judge `openai-compat` (gpt-5.6-sol xhigh) · verdict PROCEED (4/4 criteria, 5/6 rubric)

## Plain lead (vibe check)

The harness can now pick a different Node version per benchmark target, and for
the one target we care about today it picks the right one — gitify asks for
Node ≥24, and the new code correctly hands it Node 24.15.0 out of the Nix store.
That part works, verified by running it.

**But the version-matching rule is wrong in a way that makes the feature
backfire on most real repos.** It treats "needs Node ≥24" as "needs Node
exactly 24". So a target that says `>=18` — one of the commonest pins in the
wild — gets *skipped as unsatisfiable* even though the Node we already have
satisfies it, and a target that says `>=20` gets *downgraded* onto Node 20 when
Node 22 was already fine. The whole point of this work package was to make the
benchmark corpus **bigger**; as landed, it would make it smaller.

Two further problems: the run path and the grading path each work out the Node
version **independently, from different sources** — which is exactly the trap
the spec named and told the agent not to fall into — and if the network hiccup
prevents reading the target's `package.json`, everything silently falls back to
the default Node with no warning, producing precisely the "is this a red test or
a red toolchain?" confusion this work package exists to abolish.

**The judge saw two of these three problems and said PROCEED anyway.** That is
the most important finding of this review: a design-rubric failure currently
changes only the wording of the verdict, not the outcome, so the run sealed
SUCCESS at step 1 with the defects intact. WP-534 is **not done**.

## Glossary (IDs used here)

- **WP-n** — work package (`plan.md` §6/§7 backlog row).
- **F-n** — global sequential friction id (this report adds F-180…F-186).
- **AC-n** — acceptance criterion (the spec's judge-executed pass/fail checks).
- **P3-rung-N** — rung on the P3 moat ladder (`plan.md` §7, WP-530). rung-3 = one benchmark task scored end-to-end; rung-4 = ≥5-task slice vs a baseline.
- **rubric item** — a judge check on *quality* (design, scope, secrets) as opposed to an AC, which checks *doneness*.
- **ambient toolchain** — whatever `node` is already on `PATH` (here: devbox-pinned v22.22.3).
- **provision** — put a different Node's `bin/` directory at the front of `PATH` for the duration of a task.
- **engines.node** — the npm `package.json` field where a repo declares which Node versions it supports.

## Trace excerpt (journal = ground truth)

```
run run-5da56db2-69df-4ffa-9961-1ed65db863a3 · SUCCESS · 1 steps · $0.05 / $30.00 · 3m 42s
   executor gemini-cli(gemini) · judge openai-compat · ⚠ cost meter blind (unpriced tokens)
 #  step                                tokens(in/out)  cost    verdict
 1  per-target node provisioning        3.2k / 2.3k     $0.00*  ✓ PROCEED (4/4 criteria)
totals: decisions 1 · judge passes 1 ($0.0527, 100.0%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · pacing events 1 · peak window 75% · issues:changes 1:1
```
`* step cost $0.00` — the `gemini-cli` executor's 5,471 metered tokens are
**unpriced** (F-9/F-167 recurrence). `routing.stages.code.model: default` makes
this structural: we never learn which model ran, so we can never price it.

| Metric | Value |
|---|---|
| Terminal state | 🟢 SUCCESS (journal) / 🟡 defective delivery (this review) |
| Steps | 1 · 0 tool calls journaled at step level (work done inside the gemini turn) |
| Duration | 3m 42s (step 2m 46s · judge 52s) |
| Executor / judge families | `gemini-cli` (gemini) ≠ `openai-compat` — bias-mitigation invariant held ✅ |
| Judge passes | 1 (completion milestone) · 25,800 evidence bytes |
| Judge verdict | PROCEED · 4/4 AC · **5/6 rubric (`design_serves_overall_goal` ✗)** · 0 rollbacks |
| Cost (exact) | $0.0527 — 100% judge, executor unpriced / $30.00 budget = **0.2%** |
| Checkpoint chain | `run-…@5` · commit `dcbf4045a2f7` · `lastGood true` |
| Diff size | 24,992 bytes |
| Probe step (F-11) | none — no empty-diff step, F-11 did not recur ✅ |

## Verification (independent, post-harvest)

The delivery arrived **unharvested** — `git status` was clean and all three grep
ACs were RED on the working tree until `scripts/harvest.sh` ran. Post-harvest:

| Check | Result |
|---|---|
| AC-1 `resolveTargetNodeEngine` exported | 🟢 PASS |
| AC-2 `planNodeProvisioning` referenced in ≥3 src files | 🟢 PASS (suite.ts, adapter.ts, grade.ts) |
| AC-3 `planNodeProvisioning(` call expression present | 🟢 PASS |
| AC-4 `tsc --noEmit && eslint src && vitest run` | 🟢 PASS — **59/59** (47 pre-existing + 12 new) |
| Harvest byte-diff (6 files vs run workspace) | 🟢 all `IDENTICAL` |
| Scope | 🟢 6 files, all under `benchmarks/harness/` — spec's write-fence honored exactly |

Scope discipline was clean: no `benchmarks/tasks/*.yaml`, no `packages/sdk-ts/`,
no chain runner, no harvest scripts, no new dependency, no key material. ✅

### Live probe — does it actually provision?

Built the harness and called the landed functions against the **real** Nix store
and the real devbox ambient (`v22.22.3`):

```
discovered toolchains: 20.19.1, 20.19.6, 22.21.1, 22.22.3 ×2, 24.14.1 ×2, 24.15.0 ×2
gitify ">=24" → required major 24 → provision /nix/store/3mvbmkd…-nodejs-24.15.0/bin  🟢
```

🟢 **The core mechanism is real and works for the target it was built for.**
Node 24 exists in the store, discovery finds it, the plan selects it. `PATH`
mutation survives `scrubExecutorEnv` (it only strips provider keys) and is
inherited by both `spawn("bash", …)` in `adapter.ts` and `runBounded` in
`grade.ts`, so a provisioned toolchain genuinely reaches both child processes.

### Live probe — the semantics

Same functions, same real toolchain set, ambient `v22.22.3`:

| `engines.node` | resolved | plan | correct? |
|---|---|---|---|
| `">=24"` (gitify, real) | 24 | provision **24.15.0** | 🟢 |
| `">=22"` | 22 | ambient | 🟢 |
| `">=20"` | 20 | provision **20.19.6** | 🔴 **downgrade** — ambient 22 already satisfies `>=20` |
| `">=18"` | 18 | **unavailable** → task skipped | 🔴 **false skip** — ambient 22 satisfies `>=18`; corpus SHRINKS |
| `">=24"`, only node 26 available | 24 | **unavailable** | 🔴 26 satisfies `>=24` |

## Delivery quality (human review, post-landing)

| Spec requirement | Delivered | Verdict |
|---|---|---|
| Pure `resolveTargetNodeEngine`, no I/O | `engine.ts:21-81` — pure, handles `>=N`, `>=N.N.N`, `^N.N.N`, `N.x`, `A \|\| B`, bare `N`; unparseable → `"no constraint"`, never throws | 🟢 |
| Pure `planNodeProvisioning`, bounded decision | `engine.ts:86-118` — pure, returns `ambient` / `provision{binDir}` / `unavailable{neededVersion, available}` | 🟡 shape right, **rule wrong** (F-181) |
| "ambient no-op when the requirement is already satisfied by the current node" | satisfied **only at exact major equality** (`engine.ts:99`) | 🔴 F-181 |
| **THE TRAP: run path and grade path consume the SAME plan** | three *independent* recomputations from *two different sources* | 🔴 F-182 |
| UNAVAILABLE degrades to structured skip, never a red score | `suite.ts:100-103` mirrors the existing `blocked` shape (`suite.ts:80-83`) exactly | 🟢 (judge's objection here was a false positive) |
| Unit tests over both pure functions, all listed cases | `test/engine.test.ts` — 12 tests, every enumerated case present incl. gitify's real `>=24` | 🟡 present but **blind to the defect** (F-181) |
| Additive, strict TS, ESM `.js` specifiers, named exports, no new dep | ✅ all honored; `index.ts` re-exports the new surface | 🟢 |

### The trap, precisely (F-182)

The spec said: *"Both the path that launches the target's run and the path that
executes its graded checks must consume the same plan."* They do not. Three
sites each call the planner independently:

| Site | Source of `package.json` | When |
|---|---|---|
| `suite.ts:95-98` | remote `git clone` of `task.repo` (workspace is empty — `mkdirSync` two lines above) | pre-run |
| `adapter.ts:74-77` (`withProvisionedPath`) | remote `git clone` again (workspace still empty; the *adapter* is what clones) | pre-run |
| `grade.ts:119-126` | **local `ctx.workspaceDir/package.json`** — post-run, post-agent-edit | post-run |

`suite.ts` computes a full plan and then **discards everything except the
`unavailable` branch** — the `provision` decision it just computed is thrown
away and recomputed by the adapter. And `grade.ts` reads a *different artifact*
than the adapter did: if the agent edits `engines.node` (a legitimate move in a
dependency-upgrade task), the graded checks run under a different Node than the
work did. That is F-163 re-opened in the opposite direction, which is the exact
thing the spec named as the trap.

Additionally, neither `adapter.ts` nor `grade.ts` acts on an `unavailable`
decision — they only branch on `provision`. The invariant is enforced solely by
`suite.ts` running first.

## New friction

### 🔴 F-180 — the design-fix retry loop is SKIPPED on a first-verdict seal, so a rubric failure has no consumer

**Corrected root cause (post-review code read — the fix is far narrower and
cheaper than "make the rubric block the seal").** The machinery to act on a
design finding **already exists and works**:
`workflow/agent-loop.ts:874-900` runs a completion review over the cumulative
diff at the moment a run would seal, and when
`reviewVerdict.form.rubricResults` carries failures it builds a design brief
(`buildCompletionReviewBrief`) and grants **one bounded fix step**, re-reviewed
after, cost-bounded by `MAX_COMPLETION_REVIEWS = 2`.

It never ran here. `workflow/completion-review.ts:38-43`:

```ts
if (state.sealingDiffBase === state.baseCommit) {
  return { action: "skip", reason: "sealing verdict already judged the cumulative diff (first-verdict seal)" };
}
```

dogfood-113 was a **1-step run**, so the sealing judge pass's diff base *was*
the run's base commit — a first-verdict seal — and the completion review was
skipped as redundant. The skip's reasoning is correct about **coverage** (the
judge genuinely did see the whole diff, and genuinely did flag it) but wrong
about **consequence**: the sealing verdict is produced by `decideVerdict`, where
a rubric-only failure falls through to a branch that also returns `PROCEED`
(`judge/verdict.ts:131-149`), changing only the rationale string. So on a
first-verdict seal the rubric result has **no consumer at all** — the one path
that would have acted on it was skipped precisely because the other path had
already looked.

- **Blast radius:** every 1-step dogfood, which is most of them — 108, 112 and
  113 all sealed in one step. A multi-step run whose sealing pass has a non-base
  diff base *would* have caught this and granted the fix step.
- **Why it matters:** the judge's `design_serves_overall_goal ✗` named three
  concrete defects; this review independently **confirmed two of them as real**
  (F-181, F-182). The thesis mechanism *detected* the problem pre-land, and the
  control plane had a remediation loop ready, and still shipped it — because the
  two halves were wired past each other.
- **Spawns:** **WP-537** — `decideCompletionReview` must not skip a
  first-verdict seal when the **sealing verdict itself carried rubric
  failures**: skip only when the cumulative diff was covered AND the rubric was
  clean. `verdict.form.rubricResults` is already in scope at the seal site
  (`agent-loop.ts:843`), so this is a ~5-line change to a pure, unit-tested
  function plus one field at the call site. Everything downstream — the brief,
  the bounded retry, the re-review, the F-107 "never park a run whose criteria
  all pass" discipline — is already built and needs no change. Mid-run rubric
  fails stay non-destructive (dogfood-048/112 lineage must not regress).

### 🔴 F-181 — `planNodeProvisioning` collapses `>=N` to exact-major equality; corpus SHRINKS

- **Evidence:** `engine.ts:99` (`ambientMajor === requiredMajor`) and
  `engine.ts:104-107` (`parseInt(m[1],10) === requiredMajor`). Live probe table
  above: `>=18` → `unavailable` (task skipped though ambient 22 satisfies it);
  `>=20` → provisions node **20.19.6**, downgrading below a satisfying ambient.
- **Why it matters:** the spec's stated Thesis-KPI is *BENCHMARK CORPUS REACH*.
  `>=18`/`>=20` are among the commonest engine pins in the wild. As landed, this
  code would **remove** such targets from the corpus rather than admit them —
  the KPI is inverted for every case except the single one the tests pin.
- **Root cause of the test blindness:** `test/engine.test.ts:61-64` pins
  "requirement already satisfied" at `planNodeProvisioning(22, …, "v22.11.0")` —
  exact equality — so the range semantics are never exercised. Every enumerated
  spec case is present and the suite is green while the requirement is violated.
- **Spawns:** **WP-538** (WP-534 completion, part 1) — the resolver must return
  a *constraint*, not a bare major, or the planner must accept
  `ambient >= required`; plus tests for `ambient > required` → ambient and
  `only-newer-toolchain-available` → provision.

### 🔴 F-182 — no shared provisioning plan across the run and grade paths (the spec's named trap)

- **Evidence:** `suite.ts:95-98`, `adapter.ts:74-77`, `grade.ts:119-126` — three
  independent recomputations; adapter reads the *pinned remote* `package.json`,
  grader reads the *post-run local* one. `suite.ts` discards its own `provision`
  decision. `adapter.ts`/`grade.ts` ignore `unavailable` entirely.
- **Spawns:** **WP-538** (part 2) — resolve the plan **once** per task in
  `suite.ts`, thread it through `AdapterContext` and `GradeContext`, and make
  both consume it. No re-derivation downstream.

### 🔴 F-183 — silent fallback to ambient when the target `package.json` can't be read

- **Evidence:** `engine.ts:155-193`. Every failure path in
  `getTargetPackageJson` — clone timeout (3× 15 s), offline, repo moved, rate
  limit — returns `null`. Callers then map `null → "no constraint" → ambient`
  with **no log line**. gitify would run and be graded on Node 22, producing the
  systemic 354/1128 red that WP-534 exists to eliminate, indistinguishable from
  agent failure and non-reproducible between runs.
- **Spawns:** **WP-538** (part 3) — a target with a pinned `repo` whose
  `package.json` cannot be read must fail **loud** (structured skip with the
  read error as `blocked_reason`), never degrade to ambient.

### 🟡 F-184 — two network clones per task, plus a `temp-git-*` leak into the results dir

- **Evidence:** `suite.ts:95` and `adapter.ts:75` both call
  `getTargetPackageJson` against a workspace that is still empty (the adapter is
  what clones), so each runnable brownfield target triggers **two** full
  `git clone --filter=blob:none` + `fetch` + `checkout` cycles, up to 45 s each.
  The temp dir is created at `join(workspaceDir, "..", "temp-git-…")` — inside
  the suite's own artifact dir — and `rm -rf` runs only on the success path
  (`engine.ts:183`), so a partial clone leaves the temp clone in the published
  results. Fixed for free by F-182's single-resolution design.
- **Spawns:** folded into **WP-538**.

### 🟡 F-185 — non-deterministic toolchain pick

- **Evidence:** `engine.ts:104` `.find()` over `readdirSync("/nix/store")`
  output, which is ordered by the store's content hash, not by version. Both
  `nodejs-24.15.0` and `nodejs-24.14.1` are present here; which one wins depends
  on hash lexical order. Two machines with the same store can grade the same
  target on different patch versions.
- **Spawns:** folded into **WP-538** — sort candidates and select the newest
  satisfying toolchain deterministically.

### 🟡 F-186 — `fan-in-handoff.test.ts` flaky under full-suite parallel load

- **Evidence:** `scripts/harvest.sh`'s full `pnpm test` failed with
  `fan-in chain failed: … N-3 sealed FAILED/HALT` (1 failed / 981 passed).
  Re-run in isolation: **2/2 passed in 6.6 s**. The full run reported wall 42.86 s
  against 313.80 s aggregate test time — heavy concurrency. The two parents
  sealed SUCCESS; only the fan-in child N-3 halted, consistent with resource
  starvation, not a logic defect.
- **Impact:** harvest exits non-zero on a green tree, which is what made this
  run look unharvested. Not loop-integrity, but it blocks the harvest gate.
- **Spawns:** track-B note — pin concurrency (or `test.concurrent` opt-out) for
  the chain fan-in suite.

### ℹ️ Recurrences (no new id)

- **F-143** (misleading judge rationale, dogfood-103) **recurred at run level and
  is HAND-FIXED this sitting.** The verdict rationale read
  `"work in progress, no regressions — no criteria evaluated"` on a journal
  whose own criteria table two lines above read **4/4 ✓**. `verdict.ts:140-143`
  conflated "zero criteria FAILED" with "zero criteria EVALUATED". Fixed at
  `packages/sdk-ts/src/judge/verdict.ts:140-149` — now emits
  `all N acceptance criteria pass` when criteria were evaluated and none failed.
  `tsc --noEmit` + 359 judge/runner tests green.
- **F-167 / F-9** (unpriced executor tokens) recurred: 5,471 metered tokens at
  $0.00, `⚠ cost meter blind`. `routing.stages.code.model: default` (mandated by
  F-170 safety) means the model id is never surfaced, so this is structural for
  every gemini-cli dogfood, not a missing `pricing.ts` row.

## Verdict on the thesis

🟡 **Mixed — and the mixed half is the more valuable signal.**

**What worked.** The judge is doing the job the thesis claims for it. On a run
where every mechanical gate was green — 4/4 ACs, 59/59 tests, lint clean, type
clean, perfect scope discipline — the judge's design rubric was the *only*
signal that the delivery was defective, and it named the two real defects with
precision ("the run and grade paths do not consume one shared plan"; "treats
only an exactly equal ambient major as satisfying a requirement resolved from
ranges such as `>=24`"). No grep-based AC could have caught either. This is
Agent-as-a-Judge earning its place in the inner loop.

**What didn't.** The control plane then ignored it. F-180 means a design-rubric
failure is cosmetic at the seal, so the run reported 🟢 SUCCESS on a delivery
whose headline KPI is inverted. **A judge that detects and does not gate is a
judge that does not exist**, from the operator's point of view — and this review
is the only reason the defect didn't sit in `main` unnoticed. That makes F-180
the highest-value finding of the campaign so far: it is the seam between "the
judge is smart" and "the judge is load-bearing", and today only the first is true.

**Corpus reach: unmoved.** `brownfield-002` remains `status: blocked` (correctly
— the spec forbade the flip), so `isRunnable` skips it at `suite.ts:80` before
the new provisioning code is ever reached. Runnable corpus is still **2**
(zodios, zod — neither declares `engines`, so both correctly plan `ambient`).
The rung-4 unblock is **landed but not activated**, and cannot be activated
until F-181/F-182/F-183 are fixed.

**P3-rung-4 status:** not climbed, and the prerequisite is not yet satisfied.
Ledger `rung = 0` (mode `run`, no suite scored).
