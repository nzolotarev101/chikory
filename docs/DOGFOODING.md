# Dogfooding guide — running plan.md work packages through Chikory

This is the complete operating manual for executing Phase 2+ work packages
(`plan.md` §6+) **through Chikory itself**: how to set up, how to write the
task spec for a WP (every field explained), how to launch, supervise, and
recover a run, and how to land the result as a normal PR.

**Status (2026-07-02, bounded — update discipline: REPLACE this block, ≤15 lines;
displaced prose moves verbatim to [`PLAN-HISTORY.md`](PLAN-HISTORY.md); per-run detail:
`docs/reports/dogfood-NNN.md`; queue + course correction: `plan.md` §6).**
Latest: dogfood-083 — **WP-270 PER-STEP WORK-UNIT CHUNKING** (`run-d3879dab-c1e4-4dde-930e-27f679a75d10`,
`docs/reports/dogfood-083.md`). 🟢 **SUCCESS · 3 steps · $4.09/$40 · 10m22s.** Built the rung-3 QUALITY lever F-100
demanded: opt-in ordered `work_chunks` on `bounded_work_unit` + a pure `decideWorkChunk` (`src/workflow/work-chunk.ts`)
wired into `agent-loop.ts` step-forcing, so each forced durable step carries EXACTLY the next chunk's directive instead
of the whole goal. Additive (no list = byte-for-byte WP-269, no policy = one-shot); frozen contracts held; no new dep;
LIVE-proven in a real Temporal test (each step's instruction = its ordered chunk, all distinct, none = full goal, distinct
per-step diffs; the no-chunk-list variant stays on WP-269), 658 tests green; harvest byte-IDENTICAL. ✅ **F-101 CLOSED
(re-run `run-03d161e9`, un-harvested):** the chunk counter now uses a dedicated PROCEED-gated `consumedWorkChunks` (not raw
`checkpoints.length`) so a rolled-back chunk is re-handed; LIVE scripted-ROLLBACK regression test, 660 tests green. ℹ️ the build run
ITSELF front-loaded (F-100 recurred: step 1 = $3.56/20.5KB) because the new field can't be referenced in its own launch
YAML (HEAD `.strict()` rejects it) — proven in-code. **NEXT: dogfood-084 — the NON-HOLLOW rung-3 horizon on `work_chunks`**
(a ≥5-step run whose every sealed checkpoint carries a distinct non-trivial diff). See §7 (troubleshooting), §8 (known limitations), §1.5, §1.4, §3.

Related docs: [`docs/spec/task-spec.md`](spec/task-spec.md) (schema
reference) · [`docs/TASK-PROTOCOL.md`](TASK-PROTOCOL.md) (WP etiquette, §7 is
dogfood-specific) · [`docs/components/cli.md`](components/cli.md) (command
reference).

---

## 1. When to dogfood a WP

A dogfood run exists to **stress the thesis** — durable multi-run execution, a
real-time judge that catches a bad change *before* it lands, and reliability
over long horizons. A task a competent agent cannot plausibly fail tests none of
that; greening it is theater. (The tell: dogfood-002…039 were 38/39 one-step
SUCCESSes — that streak meant the picks were too trivial to fail, **not** that
the product was reliable.) Selection has four gates, in order.

### 1.1 Failure-surface test — is this WORTH dogfooding?

A slice is a **headline dogfood** only if a competent agent could *plausibly
fail* it — it has a real failure surface:

- multi-step / cross-file work where context accumulates (context rot), **or**
- a **thesis pillar**: durable execution, multi-run chains (WP-219, launched
  with `chikory chain`), the judge catching a regression, crash→resume (WP-206),
  context-rot mitigation (WP-203/204), **or**
- a genuine bug surface (a refactor, a tricky edge case, a non-obvious contract).

A **pure single-file function with a deterministic test** — a 1:1 parity port, a
formatter, a pure helper — is **track-B**: necessary, but not thesis evidence.
Land it as a normal PR or batch it. It must **not** be the dogfood headline.

### 1.2 Product-progress gate — does the DELIVERABLE move the backlog? (mandatory)

A headline run's *landed diff* must advance a **real open `plan.md` §6 product
WP** — feature code on a thesis pillar (durable execution, memory store, chains,
compaction wiring, control-plane) — not invented disposable code. A thesis
**mechanism** (the `debug.seedBadDiff` judge-catch seam, a `chikory chain`
decomposition) is a **vehicle layered onto real product work, not a substitute
for it**. Seeding a bad diff into a brand-new throwaway utility passes §1.1
(there's a failure surface) yet moves **zero** product WP — that is the standing
failure mode (dogfood-046 `clamp`, 047 `roundTo`/`roundToCents`,
048 `truncateDecimals`/`truncateToCents`): the thesis machine fired, the backlog
did not move. Selection MUST **prefer a real open WP to host the mechanism**.

**Fallback carve-out (the only exclusions).** A throwaway-scaffold deliverable is
permitted **only** when *no* open product WP can plausibly host the mechanism
because every candidate is blocked by:

- a **frozen-contract / ADR wall** (un-landed contract; TASK-PROTOCOL §4), **or**
- **harness the dogfood mechanism itself depends on** (changing it would break the
  run).

When the carve-out fires, the spec must **name the blocking WP/contract** and the
report must register *unblocking it* as the next priority.

### 1.3 Mission-critical gate — is this the RIGHT thing now? (mandatory veto)

`dogfood-review` phase 5 applies this gate **automatically/inline on every
candidate** (no pick is queued without a recorded verdict); `/dogfood-assessor`
remains available for an explicit second opinion. The gate issues a **binding
verdict**: a `⛔ VETO` (the candidate is busy work / track-B / scaffold-hosted
**and** a thesis-stressing slice on a real product WP is unblocked) means queue
the named thesis slice instead. A scaffold-hosted or busy-work headline is allowed
**only** when nothing real is unblocked (`🟡 ALLOW (fallback)`, the §1.2
carve-out), in which case the gap to unblock a real run is itself the priority.

### 1.4 WP-tag readiness — CAN it run as one campaign?

| WP tag | Dogfood? |
|---|---|
| 🟢 Mechanical | Runnable, but apply §1.1 — a pure leaf with no failure surface is **track-B**, not a headline. |
| 🟡 Builder | **The sweet spot.** Slice to a real, checkable surface. A contracts change (`types.ts`) is hand-done first (TASK-PROTOCOL §4). |
| 🔴 Architect | **Not as one run** — design by hand, then dogfood the slices that fall out, **including the non-pure wiring** (that's where agents fail and the judge earns its keep — e.g. the `chikory chain` launch path that unblocked the first chain dogfood). |

**Rule of thumb:** a headline run should be **2–6 executor steps with a real
chance of a wrong turn** — enough rope for compounding error and for the judge
to have something to catch. A goal that always finishes clean in one step is
track-B (one step ≈ one focused agent session, ≤10 min, ≤25 turns).

**KPI table (single source — plan.md references this; the dogfood-review skill
reports these values on every review).** The "N straight one-step SUCCESS"
streak is **RETIRED** as of the 2026-07-02 course correction (it rewarded
triviality and camouflaged F-32). The values are **computed, not recalled**:
`devbox run dogfood-progression` reads the per-run ledger
`docs/reports/dogfood-ledger.csv` (one row per terminal run, appended by
`/dogfood-review` phase 4) and emits the trend plus a binding
✅ PROGRESSING / ⛔ STALLED verdict (see §1.5). Track:

| KPI | Definition | Direction |
|---|---|---|
| Max horizon survived | Longest run to a clean terminal state, in executor steps AND wall-clock | ↑ toward the P2 exit gate (24h) |
| Kill→resume count | Deliberate or genuine crash→`chikory resume` completions | ↑ (≥1 per ladder rung 2+) |
| Judge true-positives pre-land | Real regressions the judge caught before landing (not seam-armed drills) | ↑ |
| Judge recall (seam drills) | Drill catches ÷ drills armed, from WP-244 `debug.seedBadDiff` drills (§1.6) | stay at 100% |
| Meta:product headline ratio | Trailing-3-run ratio of harness-meta headlines to product-WP headlines (§1.5 definition) | ≤ 1:3 |
| Per-step reliability | Steps sealed without a judge ROLLBACK ÷ total steps, over runs ≥5 steps — computed by `dogfood-progression` from the ledger `rollbacks` column (rows from dogfood-084 on; older rows lack the column and are excluded) | ↑ toward 99% |
| Exit-gate distance | Current ladder rung vs the P2 exit gate | rung number ↑ |

### 1.5 Friction budget — when new friction may headline a run

New friction from a run review spawns a **headline** dogfood ONLY if it is 🔴
**loop-integrity**: it corrupts judge trust (a hang or infra fault reads as a
substantive verdict), breaks durability (state loss, unresumable), or enables
silent divergence (work ships green that doesn't match the mandate). Everything
else — ergonomics, hygiene, telemetry polish, spec plumbing — is **track-B or an
operator hand-fix** (TASK-PROTOCOL §4), recorded in plan.md but never the next
headline by default.

**Hard cap: ≤1 harness-meta headline per 3 runs.** *Harness-meta* = the
deliverable's primary surface is `scripts/`, `examples/dogfood/`, launch
prechecks, spec hygiene, or verifier plumbing — as opposed to product runtime
(router / executors / runner / judge / chain / memory). The dogfood-review skill
computes the trailing-3-run ratio mechanically each review; a pick that busts
the cap is a ⛔ VETO regardless of how fresh the friction feels.

**Mechanical enforcement (the part prose can't skip).**
`scripts/dogfood-progression.sh` (also `devbox run dogfood-progression`)
computes the verdict from `docs/reports/dogfood-ledger.csv` and is run at three
points in the chain: `dogfood.sh` launch preflight (advisory), the
`/dogfood-assessor` step 0 (binding), and `/dogfood-review` phase 0 + phase-5
gate 0 (binding). Semantics:

- **⛔ STALLED** — no thesis axis (max steps survived, ladder rung, resume,
  spec looseness) moved across the trailing 3 runs vs the prior 3. The next
  headline **is the current WP-265 ladder rung, no exceptions**. New 🔴
  loop-integrity friction is **hand-fixed in the same review sitting**
  (TASK-PROTOCOL §4) or queued track-B — under STALLED it never headlines.
  (Rationale: 🔴s kept appearing for 14 straight runs; if a 🔴 can always
  preempt, the ladder never starts.)
- **🔴 CAP BUSTED** — >1 harness-meta headline in the trailing 3: next headline
  must be `class=product` regardless of the verdict.
- **✅ PROGRESSING** — the ladder is climbing; the next rung stays the default
  headline, and any non-ladder candidate must beat it through §1.1–§1.3 AND
  this budget.

Hand-fix-first is the standing preference for ALL new friction: a friction
item becomes a headline dogfood only when it (a) is 🔴 loop-integrity, (b)
cannot be hand-fixed in a §4 sitting, (c) the cap allows it, and (d) the loop
is not STALLED.

Rationale (course correction 2026-07-02, plan.md §6): runs 060–073 headlined
friction fixes exclusively while the P2 exit gate went unapproached — prose
priority rules alone failed twice (dogfood-039/041); enforcement must live in
executable scripts and the skills that run the process, not in prose alone.

**Ladder pace rule (2026-07-04 assessment): ≤3 headline runs per rung.**
PROGRESSING can stay green on steps/resumes/looseness while the rung sits
still — the second incrementalism era in embryo (the first one burned 73 runs
without touching the exit gate). If the trailing-3 window's max rung does not
beat the prior-3's, the next headline must climb the next rung, or the review
must record an explicit one-line justification in the report (a named blocker,
not "not ready yet"). `dogfood-progression.sh` prints a ⚠️ LADDER PACE
advisory when this trips; the justification requirement is binding on
`/dogfood-review` phase 5.

### 1.6 Judge recall drills — measuring the wedge, not assuming it

The judge is the product's differentiator, yet a healthy loop starves it of
evidence: strong executors one-shot clean, so "judge true-positives pre-land"
sits at an honest 0 for long stretches and the wedge rests on trust. The
WP-244 `debug.seedBadDiff` seam (§7) exists precisely to make a catch
deterministic — use it on a cadence, not just for one-off seam proofs:

- **Trigger:** whenever the trailing **5** headline runs show 0 genuine judge
  catches, the next suitable headline run is a **drill host**.
- **How:** arm the seam ON a real product headline (the four
  `CHIKORY_SEED_BAD_DIFF_*` vars on the launch; per-node via
  `CHIKORY_SEED_BAD_DIFF_NODE_INDEX` for chains) — never a throwaway utility
  invented to be broken (the dogfood-046/047/048 anti-pattern, phase-5 rule).
  Seed at a mid step of the real work, single-line, compiling,
  behaviourally wrong.
- **Verify armed** before trusting any result — a disarmed launch greens
  silently (F-48 checklist in §7: `task_json` must contain `seedBadDiff`;
  a caught drill takes ≥2 steps on the seeded node).
- **Record:** the report notes `drill: armed/caught` (or `armed/MISSED` — a
  missed drill is a 🔴 loop-integrity finding on the judge itself); the KPI
  is drill catches ÷ drills armed (§1.4). Drill rollbacks DO count in the
  ledger `rollbacks` column (real judge interventions); drill catches do NOT
  count in `judge_catches` (genuine true-positives only).

## 2. One-time setup

Everything runs via devbox (CLAUDE.md hard rule). From the repo root:

```sh
devbox shell                         # pinned toolchain (node, pnpm, temporal-cli)
devbox run bootstrap                 # pnpm install + python sync
devbox run build                     # compiles the chikory CLI to dist/
devbox run temporal-dev              # durable-execution substrate — leave running (own terminal)
```

Run Devbox commands **sequentially**. Concurrent `devbox run` startup races
on `.devbox/gen/scripts/.cmd.sh` under Devbox 0.17.0 (dogfood-016 F-22).

> **Rebuild after every SDK change**: `pnpm chikory` runs from `dist/`, not
> `src/`. Stale dist = running yesterday's CLI (this bit us in dogfood-001
> run 3). When in doubt: `devbox run build`.

### 2.1 Executor auth (the agent that writes code)

Executors are wrapped CLIs running on whatever auth they already have — no
Chikory-side keys needed:

| `executor.adapter` | Binary | Auth | Notes |
|---|---|---|---|
| `claude-code` | `claude` | Anthropic subscription OAuth or `ANTHROPIC_API_KEY` | File-ops tool allowlist; exact cost on the wire. Subscription **session limits are a real failure mode** (killed dogfood run 1) — the run degrades safely, but prefer API-key auth for long runs. |
| `codex` | `codex` | ChatGPT OAuth or `OPENAI_API_KEY` | `workspace-write` sandbox; cost estimated from pricing table (`costEstimated: true`). |

### 2.2 Judge auth (the gate — a *different* model family)

The judge calls an LLM directly through the router. Two paths:

**Path A — API key** (simplest if you have one). Export the key for the
judge's family and route the judge stage at it:

```sh
export GEMINI_API_KEY=…        # or OPENAI_API_KEY / ANTHROPIC_API_KEY
```

**Path B — zero secrets** (locally-authenticated CLIs only; what dogfood-001
used). A local shim exposes the `codex` or `gemini` CLI as an OpenAI-compat
endpoint through the router's existing `openai-compat` seam:

```sh
node scripts/cli-judge-proxy.mjs 8787 gemini &     # backends: gemini | codex
export OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787
```

Pick the judge backend from a **different family than the executor**
(invariant #2): codex executor → `gemini` judge backend; claude-code
executor → `codex` or `gemini`. Path B has one routing quirk — see §3.8.

## 3. Writing the task spec — every field

Convention (TASK-PROTOCOL §7): the spec lives at
`examples/dogfood/dogfood-<NNN>.yaml`, numbered sequentially and paired 1:1
with its report `docs/reports/dogfood-<NNN>.md` (index + full naming rules:
[`examples/dogfood/README.md`](../examples/dogfood/README.md)). Ready-to-run
examples: [`dogfood-002.yaml`](../examples/dogfood/dogfood-002.yaml) (ran
SUCCESS), [`dogfood-003.yaml`](../examples/dogfood/dogfood-003.yaml) (next
up). Schema
reference with all validation rules: [`docs/spec/task-spec.md`](spec/task-spec.md).

**Spec-style graduation (course correction 2026-07-02, plan.md §6 — binding).**
Two spec formats, mapped to the two tracks:

- **Headline format — LOOSE spec:** the `goal` states the OUTCOME and the
  constraints; `acceptance_criteria` pin what done means; the **implementation
  is the executor's problem**. The gap between outcome and diff is the failure
  surface — it is what makes compounding error, judge catches, and per-step
  reliability measurable at all. Ladder runs (WP-265) use this format only.
- **Track-B format — PRESCRIBED diff:** the goal dictates files/symbols/code
  (the dogfood-001…073 style). Still correct for parity ports and for
  verifying hand-designed wiring — but a prescribed spec makes the executor a
  typist and the judge a transcription checker, so it can never be thesis
  evidence and never headlines.

The prescribed style was the right bring-up format while the harness itself was
untrustworthy (byte-IDENTICAL harvest, grep-pinned ACs caught real bugs — F-49,
F-64). It graduates, not apologizes.

**Machine-greppable spec headers (mandatory from dogfood-075 on;
`scripts/dogfood-progression.sh --spec <file>` lints them at launch):**

```yaml
# Ladder-rung: 1            # WP-265 rung this run climbs (0 = off-ladder)
# Thesis-KPI: max horizon survived   # which §1.4 KPI this run pushes
# Format: track-B (prescribed — <why>)   # ONLY on a sanctioned prescribed spec
```

A prescribed-diff spec without the `# Format: track-B` declaration fails the
lint; a headline spec must name a rung and a KPI. The point: "what does this
run test MORE of than the last one?" is answered in the spec header, before
any spend — not reconstructed in the review.

### 3.1 `name` (required)

Short slug for the run, e.g. `wp-201-python-parity-contracts`. Appears in
nothing load-bearing yet; keep it greppable.

### 3.2 `goal` (required) — the most important field

This exact text is the executor's instruction **on every step** (P1 has no
planner; the loop re-sends the goal with accumulated context). Write it like
a complete, self-contained brief to a competent engineer who has the repo
open and `AGENTS.md` read:

- **Name every file path** to create/modify (`packages/sdk-py/src/...`).
- **Spell out the public API** — exported names, signatures, defaults. The
  judge holds the diff against this text; vagueness produces escalations.
- **Name the conventions** that apply (strict TS / ruff, named exports, .js
  import extensions, JSDoc on exports, no new dependencies).
- **State what NOT to touch** if the WP is near shared files.
- Scope it to 1–3 steps' worth of work (§1). If you can't describe the
  change in one paragraph of concrete instructions, split the WP into
  multiple runs.
- **Specify the *what*, not the *how* (dogfood-018 F-28).** Name files,
  symbol signatures, the behavior, and the tests with their assertions — then
  stop. Do **not** transcribe the literal code body (exact cast text, exact
  variable names, exact one-line expressions). A goal that dictates the change
  keystroke-by-keystroke collapses the executor's job to transcription: the
  run no longer tests agent judgment and the judge can only confirm code the
  human already wrote (dogfood-018 produced a diff byte-for-byte identical to
  its goal; dogfood-017's redundant-spec failure was the same drift taken to
  its limit). Leave a real decision in every spec so the run is genuine thesis
  evidence — autonomy exercised, judge grading something independent.

### 3.3 `repos` (required, exactly 1 in P1)

```yaml
repos:
  - url: /absolute/path/to/repo   # local path or git URL
    ref: main                     # optional branch/commit; default = default branch
    writable: true                # at least one repo must be writable
```

`prepareRun` **clones** this into a private workspace
(`.chikory/runs/<run-id>/workspace`) on a run-private branch
(`chikory/run-<run-id>`) — your checkout is never touched, and only
**committed** state is cloned (commit before launching). Use an absolute
path for local repos. Multi-repo is P2 (WP-214).

### 3.4 `acceptance_criteria` (required) — what the judge enforces

```yaml
acceptance_criteria:
  - id: AC-1                        # stable, unique; verdicts reference it
    description: the new test suite passes
    check: pnpm install --prefer-offline --silent && pnpm --filter @chikory/sdk exec vitest run test/foo.test.ts
  - id: AC-2
    description: strict typecheck still passes
    check: pnpm --filter @chikory/sdk typecheck
  - id: AC-3
    description: public API matches the goal's signatures
    # no check → judged from diff evidence only
```

How checks behave — this is the heart of the gate (JD-4):

- The **judge executes each `check`** with `sh -c` in the run **workspace**
  (the clone), at every judge pass. Exit 0 = pass. The executor's claims are
  never trusted.
- **120-second wall-clock cap per check** (`DEFAULT_CHECK_TIMEOUT_MS`).
  Budget accordingly: the workspace is a fresh clone, so the first check
  must include dependency install (`pnpm install --prefer-offline` ≈ 15 s
  warm). Subsequent passes are fast (`node_modules` persists).
- **Call toolchain binaries directly (`pnpm`, `pytest`, `uv`), not
  `devbox run`.** Checks inherit the worker's environment, which already *is*
  the devbox environment when you launch via `devbox run -- pnpm chikory …`
  — whereas `devbox run` inside a fresh clone pays ~80 s of env init against
  the 120 s cap (dogfood friction F-3).
- A criterion can fail honestly for a while (work in progress). But a
  criterion failing **3 consecutive judge verdicts → deterministic HALT**
  (goal-drift guard, seals FAILED). Set `cadence` so the work has time to
  land between passes (§3.7).
- **Run-level SUCCESS = PROCEED verdict + every criterion passing.** A run
  cannot succeed with a failing check.
- Prefer machine-checkable criteria (OB-3). Description-only criteria are
  judged from the diff by the rubric — fine for API-shape assertions, weak
  for behavior.

**LOOSE-spec ACs must anchor on OUTCOME, never on file layout the goal delegates
(F-82 → WP-266).** A LOOSE headline goal states "the implementation/file-layout
is left to the executor" — so its `check`s must test *what the deliverable does*
(grep the symbols the goal itself names — a command case, an exported function,
a registry key — and run the suite), and must **never** pin where the executor
put a file: no `test -f test/cli/<new>.test.ts`, no `grep … <a-new-file-the-goal-
did-not-name>`. dogfood-075 sealed a spurious **FAILED** because AC-1 grep-pinned
`test -f test/cli/inject.test.ts` while the goal delegated layout and steered the
test into the existing `cli.test.ts` — the complete, live-proven `chikory inject`
could never satisfy the filename pin, and the 3-consecutive-fail HALT guard
(above) fired on the phantom, burning ~55% of the run. The guard is only as good
as the criterion it guards: a layout-pinned AC on a layout-delegating goal turns
a correct guard into a false FAILED. (Prescribed track-B specs are exempt — there
the diff *is* the layout, so pinning files is legitimate.) The
`scripts/dogfood-progression.sh --spec` lint (WP-266) will reject a LOOSE spec
whose AC pins a delegated file; until it lands, apply the rule by hand.

### 3.5 `budget_usd` (required) and `max_steps` (default 100)

- `budget_usd` — hard cap (CG-2). Pre-step gate estimates the next step at
  1.5× the rolling mean of the last 5 step costs; a breach **suspends** the
  run on its last checkpoint (zero compute) until
  `chikory resume <run-id> --add-budget <usd>`. Subscription-auth runs
  report $0.00 on the wire, so the gate is inert there; estimated-cost runs
  meter against the pricing table since WP-218. $5–20 fits a 1–3-step WP
  slice — dogfood-005, the first fully priced campaign, metered $2.14 for
  a 2-step, 3-file CLI feature.
- `max_steps` — absolute step ceiling; reaching it seals FAILED. For a
  scoped slice, 6–10 is plenty; the default 100 just delays the inevitable
  on a drifting run.

### 3.6 `executor` (required)

```yaml
executor:
  adapter: codex        # registered adapter: claude-code | codex
  family: openai        # the adapter's model family — used for judge-diversity enforcement
```

`family` must be the executor's **true** family (claude-code → `anthropic`,
codex → `openai`); it's what invariant #2 is checked against.

### 3.7 `judge` (required)

```yaml
judge:
  family: gemini          # must differ from executor.family (or allow_same_family: true + loud warning)
  cadence: 2              # judge every N steps (default 3)
  max_cost_share: 0.5     # warn when judge spend exceeds this fraction of run cost
  # model: gemini-2.5-pro # optional; defaults from routing.stages.judge
  # scoring_method: pointwise   # default; pairwise is P2 (WP-210)
```

Choosing `cadence`: each pass costs a judge LLM call + all check commands.
- Since WP-217 (landed `ef4b16f`), a SUCCESS step with an empty diff
  triggers the judge immediately regardless of cadence — a finished run
  seals without waiting for the boundary. Cadence is now the *backstop*
  for runs that keep producing diffs, not the only path to a verdict.
- Small slice (1–3 steps): `cadence` slightly above the expected step count
  (e.g. 3–4) is enough — completion triggers the seal.
- Longer run: `cadence: 3` (default) balances cost vs drift window. Remember
  the HALT guard counts *verdicts*, so cadence × 3 steps is how long a
  criterion may stay red before the run is killed.
- **Dogfooding new trigger/loop behavior? Make the spec falsifying**
  (dogfood-003 F-12): configure it so the *old* code observably could not
  produce the outcome — e.g. dogfood-003 ran `cadence: 2`, completion landed
  on step 2, and the cadence boundary fired at the same instant, so the live
  run never isolated the feature it shipped. `cadence` > `max_steps` would
  have made the milestone trigger the only possible sealing path.

### 3.8 `routing` (optional — read this if using the zero-secrets path)

Omitted → `defaultPolicy(executor.family)`: light model for plan, heavy for
code/review, different-family heavy model for judge. **With API keys, omit
it** and just make sure the keys for both families are exported (validation
fails fast naming any missing variable).

With the **zero-secrets shim** you currently need an explicit block, because
parse-time validation demands an env key for every provider that appears in
`routing.stages` — even stages a wrapped-CLI executor never routes through
the router (known wart, friction F-1; fix planned in P2):

```yaml
routing:
  stages:
    # plan/review are unused by CLI executors in P1; code.model feeds the executor CLI (-m flag).
    plan:   { provider: openai-compat, model: gpt-5.5 }
    code:   { provider: openai-compat, model: gpt-5.5 }            # ← a model id the EXECUTOR CLI accepts
    review: { provider: openai-compat, model: gpt-5.5 }
    judge:  { provider: openai-compat, model: gemini-3.1-pro-preview }  # ← passed to the shim's backend CLI (-m)
```

Only `OPENAI_COMPAT_BASE_URL` needs to be set; the `openai-compat` labels on
executor stages are the documented workaround. `judge.family` is then
`openai-compat` — real diversity is whatever model family backs the shim, so
keep it different from the executor's (and pick `judge.model` to match the
backend: a Gemini model id for the `gemini` backend, etc.).

### 3.9 P2-reserved blocks

`pacing` (WP-207) and `notifications` (WP-208) parse but do nothing yet.

## 4. Launch checklist

```sh
# 0. preconditions
git status                  # commit everything the run should see — the workspace clones HEAD
devbox run build            # dist/ is what runs
devbox run temporal-dev     # running in its own terminal
node scripts/cli-judge-proxy.mjs 8787 gemini &   # zero-secrets path only

# 1. launch — CANONICAL path (auto-builds SDK, starts Temporal + judge proxy, picks the LATEST spec):
devbox run run-dogfood      # single `chikory run`   — for a single-run-authored spec
devbox run chain-dogfood    # durable `chikory chain` — for a spec that genuinely decomposes

# 1b. launch — manual path (from the repo root; --watch streams journal entries live)
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787 pnpm chikory run examples/dogfood/dogfood-003.yaml --watch
```

**The launch mode is EXPLICIT — you pick `run-dogfood` vs `chain-dogfood`.** The old single
`devbox run dogfood` auto-detected the mode by grepping the spec for `chikory chain` — but every
single-run spec's header WARNS "NOT `chikory chain`", so the grep matched the warning and chained the
run: the F-72/F-74 5-run mis-launch bleed (dogfood-067–071). The split removes the heuristic; the
landed `cmdChain` guard (WP-261) is the second line of defence. `devbox run` does not forward a spec
path, so both scripts run the **latest** `examples/dogfood/dogfood-NNN.yaml` — commit the spec you
mean to run and make sure it is the newest. For an explicit spec use `bash scripts/dogfood.sh --run|--chain <spec-path>`.

`run` validates the spec (actionable errors: missing env vars are named),
hosts the Temporal worker in-process, prints the `run-id`, and follows the
run to its terminal state. **Exit code mirrors the run**: 0 = SUCCESS,
1 = FAILED/CANCELLED. Ctrl-C only detaches your terminal — the run state is
durable; reattach with `chikory resume <run-id>`.

## 5. Supervising a live run

```sh
pnpm chikory status                       # list all local runs
pnpm chikory status <run-id>              # step, spend vs budget, last verdict, checkpoints
pnpm chikory trace <run-id>               # full trajectory (works mid-run and offline)
pnpm chikory trace <run-id> --step 2      # one step: diff/transcript refs, judge form, rationale
```

States you will encounter and what to do:

| You see | Meaning | Action |
|---|---|---|
| `AWAITING_APPROVAL` | Judge ESCALATEd, or 3 consecutive executor failures (loop-breaker) | Read the rationale in `trace`, then `pnpm chikory approve <run-id>` to continue or `… approve <run-id> --reject "<reason>"` to seal FAILED |
| `SUSPENDED` | Budget gate tripped | `pnpm chikory resume <run-id> --add-budget 10` |
| `ROLLBACK` verdict in trace | Judge reverted the workspace to the last PROCEED-ed checkpoint; its rationale rides into the next step as feedback | Nothing — the loop self-corrects; watch the next verdict |
| Worker/laptop died | Run state is in Temporal + journal | `pnpm chikory resume <run-id>` — journaled steps are never re-executed, zero duplicate spend |
| Hopeless run | — | `pnpm chikory cancel <run-id>` (graceful, final checkpoint written) |

Mid-run guidance injection (`chikory inject`) is P2 (WP-212) — today your
levers are approve/reject, budget, and cancel.

## 6. Harvesting the result

The work lives in the run workspace, on a run-private branch:

```sh
ws=.chikory/runs/<run-id>/workspace        # a full clone of your repo
git -C $ws log --oneline main..HEAD        # 'chikory: step <n>' checkpoint commits
```

Land it per TASK-PROTOCOL (one WP = one branch = one PR). Since WP-220
(dogfood-005) this is one command:

```sh
pnpm chikory land <run-id> --verify [--branch wp-201-python-parity] [--repo <dir>]
# → branch + ONE squashed `feat: land <run-id>` commit (body cites run-id,
#   workspace, verification commands), prints branch/sha/forensics line.
# --verify (since WP-224, dogfood-008): reruns devbox build/lint/typecheck/test
#   against the fresh commit, stops on first red, KEEPS the commit, exits 1.
# Requires a clean target tree; fails actionably on missing workspace or empty diff.
```

Since WP-224 (dogfood-008) `land --verify` reruns the four `devbox run
build/lint/typecheck/test` commands against the fresh commit (F-17 closed)
and the `git()` helper now captures + surfaces git stderr instead of
leaking `Switched to a new branch …` lines (F-18 closed). Use `--verify`
as the default landing path; the commit is kept even on a red check so you
can inspect it (`git -C <repo> show <sha>`). Without `--verify`, `land`
still only applies + commits — verify by hand:

```sh
devbox run build && devbox run lint && devbox run typecheck && devbox run test
```

Also per TASK-PROTOCOL §7: keep the journal as an artifact (don't delete
`.chikory/runs/<run-id>` — `journal.db` + `artifacts/` are the audit trail),
and write observed friction into `docs/reports/` — dogfood reports drive
reprioritization at phase boundaries.

**Keep the harvest commit pure** (dogfood-003 F-13): the commit citing the
run-id must contain the run's diff and nothing else — `git show <landed>`
should equal the run's diff artifact. Hand-written tooling, docs, or specs
go in separate commits. `ef4b16f` broke this (harvest script + devbox task
rode along with WP-217's delivery) and `2a4dd21` repeated it (WP-218's
diff + the dogfood-004 review docs in one commit); `chikory land`
(dogfood-005) makes the pure commit mechanical — use it.

**The harvest must be RE-GATED on the LANDED commit, not the run's clone** (dogfood-060 F-57 → WP-249; dogfood-061 F-58). The judge grades the run's workspace *clone*; the harvest is a separate commit on the *host tree*, so the harvest can add files the clone never had — and if those files break a gate, `main` goes RED while the dashboard reads green. dogfood-060's harvest `821cae5` swept 2 unrelated uncommitted host files (`test/cli/{cli,trace}.test.ts`, `stripAnsi` helpers with a `\x1b` control-char regex) into the WP-215-S5 delivery; they fail `pnpm exec eslint .` (`no-control-regex` ×2), so HEAD failed AC-2's own lint gate even though the judge passed it 2/2 on the clean clone. Two protections, both mandatory: (1) **commit only the run's harvested diff** — `git show <landed> --stat` must equal the run-workspace `git diff` file set; if you are NOT using `chikory land` (e.g. an auto-commit hook bundling the whole host tree), `git status` first and stash/separate anything the run didn't write; (2) **re-run the run's own acceptance `check`s against the LANDED commit** before trusting the green. ⚠️ **dogfood-061 closed the *capability* gap but NOT the loop's adoption gap (F-58):** `chikory land --verify` now ALSO re-runs the run's OWN journaled `acceptanceCriteria[].check`s against the landed tree (not just the four generic `VERIFY_COMMANDS`), fail-closed — so the product can refuse a land that breaks the landed AC. BUT the dogfood loop still harvests via `scripts/harvest.sh` + a manual `git commit`, which invokes neither `land` nor any re-gate — so **F-57's failure mode is still reachable on the next harvest**. Until the harvest path adopts `chikory land --verify` (or `harvest.sh` replicates the AC re-gate + the `Ref: run-id:` trailer), the dogfood-verify `§3` acceptance re-run (against the working tree) remains your only catch — and it fires *after* `main` is already broken.

### 6.1 Post-run review — mandatory, and scripted

Every terminal run gets the full review: independent re-verification of the
delivery, anomaly hunt, numbered report (`docs/reports/dogfood-<NNN>.md`,
friction ids global across reports), plan/REQUIREMENTS/DOGFOODING updates,
and the next spec readied. The whole procedure is encoded as a Claude Code
skill — run `/dogfood-review <run-id>` from the repo root
([`.claude/skills/dogfood-review/SKILL.md`](../.claude/skills/dogfood-review/SKILL.md)).
The mechanical half (trace, per-step evidence, acceptance-check re-runs,
harvest byte-diff, cost-share + the F-11 probe %) is scripted —
`RUN_ID=<run-id> devbox run dogfood-verify` emits a single evidence block;
the checks are read from the run's own journal so they always match the run.
The script writes nothing — judgment (diff-vs-goal, anomaly hunt, report,
doc updates) stays human. A SUCCESS run still gets reviewed: dogfood-002 was
a first-attempt SUCCESS and produced three plan-changing findings
(F-8…F-10 → WP-217…WP-220).

**Track-B fixes found in review go out as normal scoped PRs — never by
re-running an already-terminal spec (F-102, dogfood-083b).** A closed spec's
run slot belongs to the ladder; re-running it to carry a fix consumes a
headline slot, widens scope beyond the spec's ACs (F-103), and produces a
duplicate report. Route: hand-fix in the review sitting (TASK-PROTOCOL §4)
or a scoped conventional-commit PR citing the F-n; the ONLY sanctioned
re-run of a terminal spec is when the original run's own delivery is what's
broken (a false-green, not a follow-on fix).

## 7. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Invalid task spec: provider 'x' … missing env var Y` | Parse-time key validation. Export the key, or use the §3.8 routing workaround for keyless CLI runs. |
| `Is the Temporal dev server up?` | It isn't. `devbox run temporal-dev`. |
| A track-B robustness gap (e.g. an F-n queued "track-B, fix pending") tempts you to re-launch the already-green headline spec to fix it | Don't — a re-run of a closed spec consumes a dogfood slot the ladder queue owns and double-counts in the ledger (F-102, dogfood-083 re-run `run-03d161e9` fixed F-101 this way). Land a documented track-B fix as a NORMAL PR against the WP's real code; keep dogfood headlines for the WP-265 ladder rung. (The re-run's fix is legitimate and kept — the process, not the code, is the friction.) |
| Steps fail instantly, `executor exited with code 1` | Read the failure: `pnpm chikory trace <run-id> --step 1`. Check the executor binary works headless in your env (`codex exec`/`claude -p` smoke test). |
| Steps fail with a session/usage-limit message | Subscription executor ran dry (dogfood run 1). Reject the escalation, switch `executor` to the other CLI (or API-key auth), relaunch. |
| Judge checks time out | 120 s/check cap. Bare `pnpm` not `devbox run` (§3.4); split slow suites into a focused test file per criterion. |
| A judge check "times out" at 120 s but the judge pass takes MINUTES longer — and/or an AC reads red right after a wall-clock-killed step even though the workspace is complete | **The check-timeout kill does not reap the check's process tree** (dogfood-073 **F-78 → WP-264**). `runCheck` (`src/judge/evidence.ts:76`) runs each `check` via `execFileAsync("/bin/sh", ["-c", …], { timeout })`; Node's `timeout` kills only the direct `/bin/sh`, so grandchildren (vitest tinypool workers, etc.) hold the stdout/stderr pipes and the check doesn't settle until they die naturally — dogfood-072's post-kill AC-2 logged `[check timed out after 120000ms]` yet ran **695,853 ms = 5.8× the cap**, tail `Error: Failed to terminate worker`. Treat such a red as an INFRA artifact, not a code red: re-run the check by hand before trusting a FAILED verdict, and beware the 3-consecutive-fails HALT compounding it. Durable fix = WP-264 (port the WP-255(a) `runBounded` group-kill to `runCheck`). |
| Judge verdict is ESCALATE with `judge raised concerns` | The rubric/concerns fired (e.g. scope creep, deleted tests). `trace --step <n>` shows the full form; approve or reject deliberately. |
| CLI behaves like yesterday’s code (e.g. a just-harvested trace feature missing from `chikory trace`) | Stale `dist/`. `devbox run build`. `harvest.sh` now rebuilds before verification (dogfood-004 F-16); the dogfood script builds *pre-run*, so post-harvest forensics always need the rebuild. |
| `chikory land` succeeded but the landed feature is invisible / verification not run | Pass `--verify` (since WP-224, dogfood-008): it reruns `devbox run build/lint/typecheck/test` against the fresh commit and exits 1 on the first red check (commit kept for inspection). Bare `land` (no flag) still only applies + commits — run the four commands by hand. The stray `Switched to a new branch …` lines are gone (F-18 fixed): git stderr is now captured and only surfaced inside `land failed: …` on real errors. |
| `pnpm chikory: command not found` | Bin link lost: `rm node_modules/.pnpm-workspace-state-v1.json && devbox run -- pnpm install`. |
| Parallel `devbox run` commands fail with `.devbox/gen/scripts/.cmd.sh: No such file or directory` | Devbox 0.17.0 concurrent-startup race (dogfood-016 **F-22**). Run every Devbox command sequentially; do not parallelize test/typecheck/lint invocations. |
| `dogfood-verify` shows Vitest `undefined` failures although the same tests pass directly | Do not prefix `devbox run` with an env assignment under Devbox 0.17.0 (dogfood-016 **F-24**). For an explicit run use `devbox run -- bash scripts/dogfood-verify.sh <run-id>`; for the newest run use `devbox run dogfood-verify`. |
| Proxy run dies with router FAILED on judge pass | Shim not running / wrong port — restart `cli-judge-proxy.mjs` and check `OPENAI_COMPAT_BASE_URL`. |
| `chikory chain` prints `plan meta-judge gate stopped the chain: plan meta-judge LLM call failed after 5 attempts: transport error: fetch failed` and exits — no `.chikory/chains/` dir is created | The judge-stage LLM call (the plan meta-judge) couldn't reach the shim; the router retried 5× then gave up, the harness folded it to an ESCALATE-as-value, and the chain fail-closed (dogfood-041 attempt 2, **F-33**). **This is an infra error, NOT a plan rejection** — the message reads like the plan was rejected, but the judge was simply unreachable. Root cause is almost always the proxy (**F-34**, see next row). Note the decompose+gate run **host-side before any durable state exists**, so this leaves no `ChainJournal` and nothing to resume — you must fix the shim and re-launch from scratch. Until WP-233 lands, a flaky shim makes the chain un-launchable with no trail. |
| The judge proxy "is already running" but chain/judge LLM calls get `transport error: fetch failed` | **Fixed by WP-234** (dogfood-041 **F-34**): `dogfood.sh:80-95` now health-probes an in-use :8787 (`curl --max-time 3`) and, on a non-response, `lsof`/`kill -9`s the stale listener and starts a fresh proxy before launching. (Original gap: it skipped startup when :8787 was in use — "Assuming proxy is already running" — without probing, so a stale/dead/half-crashed listener presented as an in-use port and then failed at the first LLM call.) If you still hit this, the backend CLI itself (`agy`/`codex`) may be failing — check the `[cli-judge:…]` lines; manual reset: `lsof -ti:8787 \| xargs kill; node scripts/cli-judge-proxy.mjs 8787 agy &`. |
| `chikory chain` prints `plan meta-judge gate stopped the chain: plan meta-judge reply failed schema validation: … unrecognized_keys … 'uncoveredCriteria'` and exits — no `.chikory/chains/` dir | **Fixed by WP-235** (dogfood-041 attempt 3, **F-35**): the plan meta-judge gate rejected its OWN schema-compliant reply — the response schema + system prompt require `uncoveredCriteria` but the `.strict()` parse schema `PlanJudgeReplySchema` didn't list it, so every compliant verdict failed validation → ESCALATE → fail-closed. Fix: `PlanJudgeReplySchema` (`schemas.ts`) now accepts `uncoveredCriteria: z.array(z.string()).default([])`; the deterministic `planCoverageGaps` coverage floor stays authoritative (the model's value is advisory). **If you see this on old code, rebuild the SDK** (`devbox run run-dogfood`/`chain-dogfood` rebuilds it first). |
| `chikory chain` prints `plan meta-judge gate stopped the chain: … [coverage override: plan leaves goal criteria uncovered: AC-1, AC-2, AC-3 - cannot PROCEED]` even though the rationale says the plan covers everything | **Fixed by WP-236** (dogfood-041 attempt 4, **F-36**): the deterministic coverage floor `planCoverageGaps` (`coverage.ts:19-21`) marks a goal criterion covered only if some node carries an acceptance criterion with the **same id**, but the planner was told (by both the prompt and the spec) to invent its own per-node criterion ids — so they never matched the goal ids and every plan was rejected, overriding the LLM's PROCEED. Fix: `PLANNER_SYSTEM_PROMPT` + `buildPlannerMessages` (`prompt.ts`) now instruct the planner to reuse each goal criterion id VERBATIM on the node(s) that cover it (coverage is matched by id, not wording; extra node-specific criteria with new ids are fine). The floor is unchanged — it remains a genuine safety net against a plan that truly drops a criterion. **Rebuild the SDK** to pick it up. **Spec authors:** if you tell the planner to "derive per-node criteria", also remind it the *covering* criterion must keep the goal id; the union of node criterion ids must include every goal id. |
| A chain runs end-to-end but a later node seals FAILED/HALT with `changes made 0` even though its predecessor SUCCEEDED | **Fixed by WP-237 and generalized by WP-239/ADR-007** (F-37/F-39): successful nodes publish full Git bundles through the configured shared `ArtifactStore`; a dependent fetches every ordered `parentHandoff`, merges them, and tags that cumulative tree as `chikory-base`. No new chain reads predecessor workspaces. The default store is local; multi-worker deployments must inject one shared remote-backed store. |
| The planner emits a final "verify tests/typecheck/lint pass" node (or any node with no code change) and it HALTs | **Fixed by WP-238** (dogfood-041 attempt 5, **F-38**): every node is already independently judge-gated and its acceptance `check`s run automatically, so a verification-only node has no work product and cannot PROCEED. `PLANNER_SYSTEM_PROMPT` (`prompt.ts`) now requires every node to produce a non-empty diff and forbids verification-only/testing-only nodes (fold tests into the node that makes the change). **Rebuild the SDK** to pick it up. If you still see it, the planner ignored the rule — re-run, or simplify the spec goal so it doesn't invite a verify split. |
| A chain node makes the correct diff but its judge check uses a different package manager/path than the goal spec and fails repeatedly | **Fixed by WP-240** (dogfood-042 attempt 1, **F-40**): the planner copied the goal criterion id but invented a replacement check (`npm run test packages/sdk-ts/…`) instead of preserving `cd packages/sdk-ts && pnpm exec vitest…`. After three failures the deterministic guard correctly HALTed node A. `buildPlan` now restores every matching goal criterion description/check verbatim; the prompt also exposes and forbids translating checks. |
| `dogfood-verify.sh <child-run>` reports sibling files as `EXTRA_IN_COMMIT` or cannot find the child's `chikory-base` in the host repo | Chain landed-scope verification is not chain-aware (**F-41**, dogfood-042). A cumulative harvest commit legitimately contains every child delta, while a dependent child's base is its predecessor's private checkpoint SHA. Review each child check plus chain-harvest reconciliation manually until WP-232 understands ordered chain deltas. |
| `chikory chain --watch` goes silent while a child is `AWAITING_APPROVAL`/`SUSPENDED` | **Fixed by WP-241** (dogfood-042 **F-42**, substrate landed): `followChain` now always surfaces a parked in-flight child once per distinct park — `node <id> child <run> ⏸ <AWAITING_APPROVAL\|SUSPENDED> — <reason>` plus the exact unblock command — by reading the child's own per-run journal (`childParkedState`), since the chain workflow is blocked inside `executeChild` with nothing new to journal at chain scope. Unblock at chain level (no detach/restart dance): `chikory chain approve <chain-id> [--reject "<reason>"]` for an ESCALATE, or `chikory chain resume <chain-id> --add-budget <usd>` for a budget cap — both host a worker, signal the parked child by its deterministic run id, and follow the chain to terminal. **PROVEN LIVE** by the dogfood-044 re-run (`chain-1bfb9d13-…`, F-42 closed): node B parked at step 0 via the WP-243 seam, the chain surfaced it, and `chikory chain resume <chain-id> --add-budget 5` drove it to SUCCESS 2/2 with the parent worker attached. (First attempt `chain-bc247058-…`/**F-44** couldn't park — node B one-shotted before the pre-step/top-of-loop USD gate ran, also overshooting its cap by a full step, $0.3425 vs $0.05 — which is exactly why WP-243's deterministic seam was built.) |
| **To force a chain node to park on demand (dogfood/test only)** — the natural park triggers (USD budget SUSPEND, quota ESCALATE, token FAILED) are all non-deterministic and a small node will one-shot before the pre-step gate runs | Use the **WP-243 park-injection seam** (`debug.parkBeforeStep`, landed `4dfcac1`). Launch the chain with `CHIKORY_PARK_BEFORE_STEP=<step-index>` and `CHIKORY_PARK_NODE_INDEX=<0-based dispatch order>`; the chain host bakes a per-node target into the workflow template and the run loop is forced through the **real** SUSPEND→top-up path before that step (journaled as a `budget_event` halt with `cause:"debug"`). Recover exactly as a real park: `chikory chain resume <chain-id> --add-budget <usd> --watch`. The downstream surfacing + resume path is the genuine WP-241 code — only the trigger is synthetic. The value rides the frozen workflow input (replay-safe; never read from env inside the workflow). |
| **To force a real-time judge-catch on demand (dogfood/test only)** — "hope the executor writes a bug" is non-deterministic; a strong executor one-shots clean (dogfood-045 F-46) | Use the **WP-244 bad-diff injection seam** (`debug.seedBadDiff`, dogfood-046 `run-b024565e-…`). Launch a single run with `CHIKORY_SEED_BAD_DIFF_PATH=<workspace-rel file>`, `CHIKORY_SEED_BAD_DIFF_AT_STEP=<step-index>`, and `CHIKORY_SEED_BAD_DIFF_CONTENT='<single-line, compiling-but-behaviourally-wrong content>'`; right after that step's executor runs, the seam overwrites the file, so the cadence-1 judge's executed acceptance `check` (e.g. `vitest`) exits nonzero → the deterministic override (`harness.ts:105`) flips the criterion to FAIL → the run refuses to seal SUCCESS (the catch) → the executor fixes from the feedback → SUCCESS in ≥2 steps. Keep the content **single-line, valid-TypeScript, compiling** so the catch lands on a *behavioural* test (vitest red), not a tsc compile error. Fires once (`badDiffInjected`); replay-safe (rides the frozen workflow input). **Caveat (F-47, until WP-245):** the seam firing journals nothing — `chikory trace` totals show `injections 0` (that counter is for operator-guidance prompt injections, not the seam), so to confirm the catch was *seeded* you must byte-diff the executor step diff (correct) vs the judge evidence diff (corrupted) by hand. **Chain wiring landed (WP-246, `3fc27bb`):** arm a per-node chain catch with `CHIKORY_SEED_BAD_DIFF_NODE_INDEX=<0-based dispatch order>` alongside the three `_PATH`/`_AT_STEP`/`_CONTENT` vars on the `chikory chain` launch — `chain.ts:158-171` bakes the seam into that node's `debug` template. **But the chain-level catch is NOT yet dogfood-proven:** dogfood-047 (`chain-989b31b9-…`) was launched **without** these env vars → the seam never armed → clean SUCCESS 2/2, no catch (F-48). **Until WP-247 lands a pre-flight guard, double-check the four `CHIKORY_SEED_BAD_DIFF_*` vars are in the launch command BEFORE running a seam-spec — a disarmed launch greens silently.** |
| **A seam-requiring chain/run spec was launched DISARMED — it greens with no catch and nothing warns** (dogfood-047 **F-48**) | The bad-diff seam arms **only** when `CHIKORY_SEED_BAD_DIFF_PATH` is set host-side (`chain.ts:162-163`); omit the four `CHIKORY_SEED_BAD_DIFF_*` vars and the chain runs the clean no-seam path → the seeded node seals SUCCESS in 1 step → **no catch**, the F-32 "path not exercised" wasted-run mode (dogfood-047 hit this verbatim despite the spec header warning of it). **The disarmed run is indistinguishable from a legitimately clean one** (`injections 0` is truthful either way — reinforces F-47/WP-245). **Confirm before trusting a seam-spec's green:** the seeded node's `task_json` must contain a `debug.seedBadDiff` block (`devbox run -- sqlite3 .chikory/runs/<child-run>/journal.db "select task_json from runs" \| grep seedBadDiff`), and a catch run shows that node taking **≥2 steps** (caught → fixed), not 1. **WP-247** will make the launcher refuse/warn when a seam-declaring spec is launched without the env. |
| A chain re-run of a deterministic-port spec FAILS with a node sealing `produced no repository changes` even though the executor "did the work" (and the judge may even PROCEED) | The workspace clones HEAD, and **HEAD already contains the spec's deliverables from the prior run's harvest commit** (dogfood-044 **F-45**: the false-start `chain-8c303011-…` cloned a HEAD that still held `resume-fixture-a.ts` committed in `b0ca2b7`; the executor's "create the module" was a no-op → empty diff → the non-empty-diff guard (`ec13d71`) sealed node-a FAILED after burning ≈$0.2714, even though the judge passed AC-1 because the files were present from the clone). **Before re-running a deterministic-port dogfood, remove the prior harvest's deliverable files from HEAD first** (e.g. `git rm` + commit, as `af81580` did), so the new run clones a clean baseline. This is the chain-side recurrence of dogfood-017 F-25 / WP-228 (baseline-satisfied precheck) — once WP-228's launch wiring lands and covers `chikory chain`, the precheck will refuse the launch instead of wasting a node. |
| `dogfood-verify.sh §6` reports **"no landed commit found for run id"** even though the work IS committed on HEAD | The harvest commit doesn't cite the run-id, so `git log --grep <run-id>` (the §6 + skill phase-1 lookup) can't resolve it (dogfood-049 **F-51**; dogfood-046/047/048 harvests `5b6ca24`/`37cddb1`/`2c516d5` are equally run-id-less). **Find it by date/subject** (`git log --stat --since=<run-day>`) and pass it explicitly: `bash scripts/dogfood-landed-scope.sh .chikory/runs/<run-id>/workspace <commit>`. **Also beware the inverse:** a harvest commit may bundle **operator hand-edits the run never produced** — dogfood-049's `dde765b` carried an unrelated `test/cli/land.test.ts` flaky-`rm` retry wrapper alongside the run's 3 files, so the commit's `--stat` overstates the run's scope. Trust the run's **step diff** (`pnpm chikory trace <run-id> --step <n>`) + the judge's `scope_matches_instruction`, not the harvest commit, for "what the run produced." **`chikory land` already does the right thing** (commits only the run diff, stamps `Run-ID:` at `land.ts:122`, and as of dogfood-061 re-gates the run's ACs against the landed commit under `--verify`) — but the dogfood harvest via `scripts/harvest.sh` + manual `git commit` bypasses it (F-58). **Until the harvest adopts `land`**, land the run's harvested diff in its own commit (operator fixes in a separate `fix:`), and add a `Ref: run-id: <id>` trailer to the harvest commit. |
| A dogfood SUCCEEDS flawlessly but the delivery is ORPHANED — the new symbol has **zero runtime consumers**, or its logic already exists elsewhere | **The queued spec went STALE before launch** (dogfood-065 **F-60 → WP-256**). The workspace clones HEAD at launch, but the operator-follow-up loop ([[auto-commit-mid-session]]) can land the spec's target WP — or the same logic inline in a `src/` consumer — between when the spec was written and when it runs. dogfood-065 landed a perfect pure `describeStepDeadline` (6 cases, all ACs green) that nothing calls: operator commit `0533a4c` (15:03) had already put the identical `elapsedSeconds`/`overrunRatio` arithmetic inline in `step.ts:150-163` and marked WP-255 → 🟢, 15 min before the run launched (15:18); `plan.md` even pre-labeled the slice "now low-value". A flawless green that moves no backlog WP is the §5 standing failure mode. **Before launching, re-run the §5 gates against CURRENT HEAD, not the day you wrote the spec:** (1) `grep -rn "<plan WP-id>.*🟢" plan.md` — if the target WP is already green, retire/re-gate the spec; (2) grep `src/` (excluding the new file/barrel/test) for the mandated symbol AND its core arithmetic/identifier — if a consumer already implements it inline, the descriptor will land orphaned. WP-256 will mechanize this as a launch-time refusal. **Recurrence (dogfood-067 F-65 → WP-258):** WP-256's own gate (`assessSpecStaleness`/`parseWpStatus`) landed with the SAME defect — a 4-files-only spec scoped out the wiring, so the pure decision has zero live consumers (not in the barrel, not in `precheck.ts`/`commands.ts`) and nothing actually refuses a stale spec yet. A pure-decision delivery only fixes the requirement once a `src/` consumer CALLS it — confirm the consumer wire is in the spec's file list, or queue a follow-up WP (here WP-258) to wire it. |
| `[cli-judge:…] FAILED … 404/500` *during executor steps* | Not the judge: the executor inherited `OPENAI_COMPAT_BASE_URL` and its in-workspace test run un-skipped `providers.integration.test.ts`, which pings the live shim (dogfood-004 F-14; recurred dogfood-005/006). **Fixed by WP-222 slice 1** (dogfood-006, landed `18fae43`): executor children now see only their own family key. **Closure confirmed by dogfood-007** — zero shim noise in `run-22b337a9`'s executor transcript. Seeing this symptom now is a regression — file it. |
| A `feat:` commit's diff is only docs — the harvested CODE (new files) is missing | The untracked-new-file commit gap (dogfood-015 **F-21**). **Fixed by WP-226**: harvest now stages every applied file after reconciliation. Dogfood-016 proved the path with both new files staged. |
| `devbox run harvest` says `Successfully applied changes` but the feature is missing / files unchanged | The pre-fix modified-file blind spot (dogfood-014 **F-20**) remains fixed by final-version copying plus reconciliation. WP-239 makes harvest DAG-aware: it validates the successful graph, rejects cycles/missing nodes, and applies every node-local delta once in stable topological order before staging and reconciling. For an explicit artifact use `devbox run -- bash scripts/harvest.sh <run-id\|chain-id>`. |
| A full-suite run fails because `cli.test.ts` misses `AWAITING_APPROVAL` immediately before terminal FAILED | F-15's terminal-boundary remainder (dogfood-016 **F-23**, → WP-227): `followRun` can append a transition after its journal scan and then return terminal status without a final drain. Focused reruns may pass. Dogfood-017 adds the final drain and deterministic regression test. |
| A full-suite or AC run fails on `agent-loop.test.ts > incomplete empty-diff verdict keeps RUNNING…` with `expected undefined to deeply equal { kind: 'PROCEED', … }` | Pre-existing test-harness race (dogfood-007 F-19, fix WP-225): the test's `waitFor` gates on the judge-wire hit count, not on the verdict being journaled, so `lastVerdict` can still be `undefined` at assert time (flapped 2/13 host invocations). Re-run the file in isolation; unrelated to any CLI diff. One-line fix: gate the predicate on `report.lastVerdict !== undefined`. |
| A run produces a ~empty diff, the executor still claims SUCCESS, and the judge ESCALATEs "diff missing the required changes" | The spec was **redundant — its WP already landed by another path** before launch (dogfood-017 **F-25**: WP-227 hand-landed `26b9964` four hours before the spec ran). The executor had no work and narrated the spec as done over an empty diff (F-26); the judge correctly caught the mismatch. **Operating rule: retire/supersede a dogfood spec the moment its WP lands by any other path** — check `git log`/HEAD before launching. WP-228 adds a launch-time precheck that runs the acceptance checks against the clean baseline and warns if they already pass; its pure decision half is landed (`evaluateBaselinePrecheck`, `src/cli/precheck.ts`, dogfood-027 `run-f97a0e63`), the non-pure check-execution + warn/`--force` launch wiring is the hand-design follow-up — until it lands, the manual `git log`/HEAD check before launch is still the guard. |
| `devbox run run-dogfood`/`chain-dogfood` ends with `exit status 1` / `[ELIFECYCLE] Command failed` after you reject an escalation | Not a crash. A deliberate `chikory approve … --reject` seals the run **FAILED**, so `chikory run --watch` exits non-zero and devbox propagates it, then cleanly tears down the judge-proxy and Temporal (dogfood-017). A failed run *should* exit non-zero; the worktree stays clean. Distinguish from a real crash by the `terminal FAILED — judge escalation rejected: …` line above the teardown. |
| A chain dogfood "passed" but `chikory trace <run-id>` shows ONE step with a `run-` id, and there is no `.chikory/chains/` directory and no `…-node-…` child runs | You launched a chain-intended spec with `chikory run` instead of `chikory chain` (dogfood-041 **F-32**: `run-a28655c9` was THE FIRST CHAIN DOGFOOD but ran as a single `run` — the executor got the whole goal verbatim as one step; the planner, plan meta-judge, and `chainLoop` were never invoked). The task-spec file format is **identical** for `run` and `chain`, so nothing flags the mismatch and the run seals a clean SUCCESS. **A real chain run produces** a `ChainJournal` under `.chikory/chains/<chain-id>`, one `run-<chain-id>-node-<id>` journal per node, and a `chain … · N nodes` trace header. **Discipline: a chain dogfood MUST be launched with `pnpm chikory chain <spec> --watch` (NOT `run`); after it finishes, confirm `.chikory/chains/` and the per-node runs exist before trusting the green.** WP-232 will make this mechanically visible in `dogfood-verify`. |
| The INVERSE: a spec authored single-`run` (its header says "launch as `chikory run`, NOT a chain") was launched as `chikory chain` — run-id is `chain-…-node-<name>` with ONE node, and early steps fail the AC-1 grep | You launched a single-`run` spec via `chikory chain`, so the planner paraphrased the full goal into a compressed `node.goal` and **dropped the grep-pinned literals the parent goal mandated** — the F-64/WP-257 paraphrase bug (dogfood-069 **F-70 → WP-261**: a single-node chain whose `node.goal` dropped 32/35 literals incl. `WP-25`/`WP-255`/`assessSpecStaleness`; steps 1-2 failed AC-1 rebuilding them, ~63% of cost wasted; the run survived ONLY because the F-49 grep pins persisted into the *acceptance criteria* and the judge drove the executor to re-add them). When a spec explicitly says single-`run`, **launch it with `pnpm chikory run <spec> --watch`, NOT `chikory chain`** — a chain re-introduces the very planner paraphrase a single run avoids (the full goal reaches the executor verbatim in a single run). To diagnose after the fact: read the node goal with `sqlite3 .chikory/runs/<chain-node-run-id>/journal.db 'SELECT json_extract(task_json,"$.goal") FROM runs'` and compare to the spec `goal` — or once WP-257's §4 wire lands, `planLiteralGaps(plan)` flags the gaps at plan time. **This is now a 5-run standing operator defect (067/068/069/070/071).** dogfood-070 (**F-72**) — the spec whose ENTIRE PURPOSE is this guard — was itself launched as a chain: the planner split it into two two-sentence node goals dropping the marker regexes / `warning` substrings / truth table / verbatim test cases, and it survived first-try each node ($1.98, cheaper than 069) ONLY because the grep pins held the shape and the executor converged on the un-pinned `warning` substrings by luck (the silent-divergence tail). **WP-261's pure guard is now LANDED** (`src/cli/launch-mode-precheck.ts` — `detectIntendedSingleRun(specText)` + `assessLaunchModeMismatch({intendedSingleRun, launchedAsChain})`): `assessLaunchModeMismatch({true, true})` returns non-null for exactly this mistake, and would have refused/warned dogfood-070's own launch (F-73 🟢). The §4 wire into `cmdChain` is now **LANDED** (dogfood-071 **F-74**, `chain-fd45e5a6-…`): `cmdChain` (`src/cli/chain.ts:403-411`) computes `assessLaunchModeMismatch({ intendedSingleRun: detectIntendedSingleRun(yamlText), launchedAsChain: true })` before the planner and, on a non-null result with `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH` unset, emits the `warning` over `ioPair.err` and `return 1` — refusing at ZERO LLM cost. **Once this delivery is committed, this exact mistake is refused going forward** (the guard closes over its own launcher — dogfood-071 was itself the 5th divergence, and the wire it landed refuses precisely that launch; set `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=1` to override deliberately). **⚠️ Two dogfood-071 delivery caveats (F-75 → WP-262):** (1) the delivered guard emits only ONE `ioPair.err` line — the operator sees the `warning` but **no on-screen hint that `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=1` exists** (the spec's mandated second hint line was paraphrase-dropped); the override still works, it's just undiscoverable until WP-262 restores the hint. (2) the override is narrowed to the literal value `1` (`=== "1"`), so `CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH=yes` still REFUSES — use `=1` exactly until WP-262 broadens it. F-75 is the cautionary case that a chained single-run spec can ship a subtly-drifted delivery GREEN past substring-only ACs — the WP-257 silent-divergence tail realized in delivery, not luck. |
| Two `.chikory/runs/` dirs for the same spec, both SUCCESS, both byte-identical to the working tree | You launched the spec twice (dogfood-020 **F-30**: `run-f24af22c` and `run-3575ba23`, ~11 min apart, ~$1 of duplicate spend). `chikory run` does not guard against a second launch of a spec whose prior run already delivered (and WP-228's baseline precheck won't catch it — neither run is committed to HEAD, so each clones a baseline that legitimately fails the checks). **Discipline: launch once, watch to terminal, then `/dogfood-review`.** Review the newest run; the older duplicate is harmless audit noise — keep it. |
| The run diff is exact, but the landed commit contains extra files outside the spec | Post-run commit-scope contamination (dogfood-031 **F-31**): the judge reviewed the run workspace diff, but `HEAD` (`67eb167`) also included unrelated warning-suppression edits. Since WP-231 / dogfood-032, run `bash scripts/dogfood-landed-scope.sh .chikory/runs/<run-id>/workspace <landed-commit>` or read `dogfood-verify`'s `Landed commit scope` section. It reports `MATCH`, `EXTRA_IN_COMMIT`, `MISSING_IN_COMMIT`, or `DIFFERS_FROM_RUN` and exits nonzero on mismatch. |
| A run's tests pass and `typecheck` is clean, but a test fixture has the wrong shape for a real type | **Fixed by WP-230** (dogfood-020): `typecheck` now type-checks `test/**` via a second `tsc -p tsconfig.test.json` pass, so a wrong-shaped fixture fails the gate. If you still suspect a gap, the manual check below still works. The original gap (dogfood-019 **F-29**): The `typecheck` AC (`tsc --noEmit`) compiles only `src/**` (`tsconfig.json` `include`), and Vitest transpiles tests via esbuild **without** type-checking — so type errors *in test code* are invisible to every dogfood signal (dogfood-019 **F-29**: `judge-trigger.test.ts` built `ArtifactRef` fixtures as `{uri,sha256,bytes}` vs the real `{id,kind,bytes,summary}` — 7 `TS2353` errors, all green). To check a suspect test: add it to a temp tsconfig that `extends ./tsconfig.json`, sets `compilerOptions.rootDir: "."`, and includes both `src/**/*` and the test file, then `pnpm --filter @chikory/sdk exec tsc --noEmit -p <that-config>`. **WP-230** makes a test-inclusive typecheck a standing AC. |
| Live `--watch` shows `verdict ⚠ ESCALATE` and `run is AWAITING_APPROVAL` but no reason | **Fixed by WP-229** (dogfood-018, `run-59115f35`): `followRun` now prints `judge escalated: <reason>` immediately before the AWAITING_APPROVAL line whenever the ESCALATE verdict carries a non-empty `escalateReason`. If you still see no reason, the verdict had an empty `escalateReason` (the line is suppressed by design) — fall back to `pnpm chikory trace <run-id> --step <n>` for the full judge form, or read the `verdict` entry in `.chikory/runs/<run-id>/journal.db`. |
| A LOOSE run sealed FAILED via the 3-consecutive-AC-fail HALT even though the delivery is complete and AC-2 (build/lint/suite) is GREEN — one AC's grep is unsatisfiable | **The AC grep is testing a substring the delivered CODE legitimately produces, or a file layout the goal delegated** (dogfood-075 **F-82**, dogfood-076 **F-83**). Two shapes: (F-82) `test -f <a-new-file>` for a path the loose goal left to the executor; (F-83) a NEGATIVE grep on a BARE WORD that also appears in comments/strings/prose — dogfood-076's `! grep -Eq 'execFile\|spawn' native.ts` matched the doc comment "…is spawned" even though the code has zero `execFile`/`spawn` calls. Either makes the AC false on correct work → it fails every pass → the budget-waste HALT guard fires (a *true* guard fire on a *false* criterion), and later steps flail against the phantom (dogfood-076 steps 3–4 burned ~37 min and broke AC-2). **Prevention (WP-266, LANDED):** run `bash scripts/dogfood-progression.sh --spec <yaml>` before launching — it ⛔s (exit 3) `test -f`/`test -e` in a loose AC and bare-word negative greps. **Authoring rule:** a loose AC's grep must anchor on an OUTCOME symbol as it appears in CODE — a call form (`grep -E '\bcreateNativeAdapter\('`), a registry key, an import — never a bare word natural language can produce, and never a new-file existence test. **The launcher now REFUSES automatically (WP-267, F-84 — `scripts/dogfood.sh` exits on the lint's exit-3 hazard; override `CHIKORY_ALLOW_LOOSE_AC_HAZARD=1`).** |
| Codex steps run far past their `maxSeconds` cap (e.g. ~2×) before being killed, recording 0 tokens / $0 / FAILED | Codex ignores the wall-clock deadline / SIGTERM until it is SIGKILLed (dogfood-076 **F-85 → WP-268**, family of F-76/F-80): steps 3 & 4 ran 1057s (1.76×) and 1188s (1.98×) past the 600s step cap. The cap is enforced LATE (~2×). Treat a run whose wall-clock is dominated by hung dead steps as this, not real work — check per-step `dur` in the trace. Durable fix = WP-268 (escalate to SIGKILL of the executor process group at ~1× the cap). Do NOT raise `budget_usd`/`max_steps` mid-run to rescue it. |
| A `chikory resume <run-id>` appears to hang — the journal is frozen for many minutes and nothing errors, even though the worker is up | **The resumed run lost its judge/router provider config** — `chikory resume` from a shell that did NOT export `OPENAI_COMPAT_BASE_URL` (only `dogfood.sh`'s own shell exports it) starts a judge/router activity with no base URL, and Temporal's activity-retry policy (~65 attempts over ~30 min) loops SILENTLY instead of failing loud (dogfood-082 **F-99**: a step-4 seal stalled ~37 min across the kill→resume boundary purely from this). **`OPENAI_COMPAT_BASE_URL` (and any provider env the spec's `routing` block names) is a RESUME PRECONDITION** — export it before `chikory resume`, or resume from the same shell/`dogfood.sh` context that launched the run. Diagnose a suspected stall: `echo $OPENAI_COMPAT_BASE_URL` (empty = this), and check the worker logs for repeated router-fetch failures. **F-99 CLOSED 2026-07-04 (track-B PR per the §6.1 routing rule): `cmdResume` now runs `resumeProviderEnvGaps` (`src/cli/commands.ts`) — it reads the spec persisted in the run's journal, checks every routed provider's env var (`missingProviderEnv`, `src/taskspec.ts`), and refuses fast (exit 1, naming each var) BEFORE hosting a worker; fail-open when the journal is missing/unreadable so it can never block a legitimate resume. Unit-tested in `test/cli/resume-env-precheck.test.ts`.** Seeing a silent multi-minute resume stall now is a regression — file it. |

## 8. Known P1 limitations (so you don't fight them)

- **`bounded_work_unit` seal-deferral (WP-269) alone yields a HOLLOW horizon —
  use `work_chunks` (WP-270) to distribute work per step** (F-100 → WP-270 CLOSED,
  dogfood-082/083): an active `bounded_work_unit:{min_durable_steps:N}` policy
  forces ONE `chikory run` to seal ≥N durable checkpoints by re-entering the loop
  after a premature `claimsComplete` — but seal-deferral ALONE does NOT make codex
  spread its work across those N steps (dogfood-082: all product code front-loaded
  into step 1, steps 2–6 thin test-tweaks). **WP-270 (dogfood-083) added the
  missing half:** an OPTIONAL ordered `work_chunks: [{name, directive}, …]` list on
  `bounded_work_unit` — with it set, each forced step's instruction is EXACTLY the
  next chunk's directive (not the whole goal), and completion defers until every
  chunk is handed out AND the judge confirms the ACs. So to get a NON-hollow
  horizon (N independent failure surfaces), author a `work_chunks` list with one
  bounded dependency-ordered sub-goal per step. With NO `work_chunks` the behavior
  is byte-for-byte WP-269 seal-deferral — read that as "N seals," NOT "N failure
  surfaces," and pick a host goal whose FIRST step does the real work.
- **✅ `work_chunks` counter no longer skips a rolled-back chunk** (F-101 CLOSED,
  dogfood-083 re-run `run-03d161e9`, un-harvested): chunk consumption previously
  keyed on raw `checkpoints.length`, which increments on every sealed step
  including one whose judge verdict was `ROLLBACK`, so a rolled-back chunk step
  advanced the pointer past the reverted chunk. Fixed: a dedicated
  `consumedWorkChunks` counter increments ONLY on a PROCEED verdict for a
  `use_chunk` step, and a `workChunkMilestone` forces a judge pass on each chunk
  step so the PROCEED-gated counter can advance. LIVE scripted-ROLLBACK
  regression test asserts step instructions `[chunk0, chunk0, chunk1]` (the
  reverted chunk is re-issued, not skipped); 660 tests green.

- **No planner for `chikory run`**: every step gets the full `goal` as its
  instruction, plus the last 5 step summaries, judge feedback, and acceptance
  criteria. Scope goals accordingly (§3.2).
- **`chikory chain` DOES have a planner — and it PARAPHRASES each node's goal,
  dropping grep-pinned literals** (F-62 → WP-257, dogfood-066): the chain planner
  decomposes the spec `goal` into nodes, and each `node.goal` is the planner's
  one-line *summary*, NOT a verbatim slice. `planNodeToTaskSpec` (`src/chain/node-spec.ts:91`)
  hands that summary to the executor as its `goal`. So any **verbatim/grep-pinned
  literal** your AC enforces (the F-49 discipline — e.g. `grep -q "WP-25"` for a
  mandated test fixture) will be **stripped from what the executor actually sees**,
  while the strict AC survives → the node is structurally **unwinnable** (the executor
  passes its OWN self-authored tests, the hidden grep fails every step, the judge
  budget-waste guard HALTs after 3 consecutive fails). dogfood-066's node A burned
  $3.76/$6 this way. **Until WP-257 lands (planner preserves verbatim/grep-pinned
  tokens into node goals), do NOT put grep-pinned mandated literals in a `chikory chain`
  goal** — either deliver that work as a single `chikory run` (which carries the full
  goal+literals straight to the executor), or write chain-node goals whose ACs grep
  only symbols/identifiers the one-line node summary will naturally still contain.
  **Refinement (F-64, dogfood-067): the paraphrase drops more than grep literals — it
  drops load-bearing PROSE SEMANTICS too, and that failure is SILENT.** dogfood-067's
  parent goal spelled out the exact parser rule ("id in the FIRST cell, status in the
  THIRD cell"); the planner compressed node-1's goal to "handling status icons from
  markdown tables and exact ID matching" and the executor built a *different*
  (header-driven, id-in-any-cell) parser that still satisfied the loose AC — so the
  chain went **green while building the wrong function**. The run only avoided a repeat
  of F-62's HALT because the one grep-pinned literal (`WP-25`) had been hardened into
  the **AC-1 `description`** (which IS passed to the node verbatim), not just the goal
  prose. **Practical rule until WP-257: put every load-bearing rule the delivery must
  honor into the AC `check` (grep/test) or the AC `description`, never only in goal
  prose — the planner can paraphrase goal prose away without failing anything.**
  **Further refinement (F-67, dogfood-068): the paraphrase can drop the mandated API
  CONTRACT SHAPE, and a NAME-only grep AC will NOT catch it.** dogfood-068's parent goal
  mandated `SpecStalenessPrecheckResult = { targetWpId, stale, warning }` and a
  `evaluateSpecStalenessPrecheck(input: { goal, planText })` object param; the planner
  compressed node-1's goal to "export `extractTargetWpId`, `evaluateSpecStalenessPrecheck`,
  and the `SpecStalenessPrecheckResult` interface" (no field list, no param shape), and
  the executor shipped `{ targetWpId, warning }` (NO `stale` field) with POSITIONAL
  `(specText, planText)` args. **It stayed green** because AC-1's `grep -q "stale"`
  matched the test's `expect(result.warning).toContain("stale")` STRING (not a result
  field), and `tsc`/`eslint`/`vitest` only enforce *internal* consistency (node-2's wire
  called the divergent signature, so both nodes agreed). **A `grep -q "<name>"` AC pins
  that a symbol NAME appears somewhere — it cannot enforce an interface's FIELDS or a
  function's PARAM SHAPE.** When a goal mandates an exact `export interface` / signature,
  add a tiny tsc-compiled `satisfies` / `expectTypeOf` fixture as an AC so a missing
  field or wrong param shape fails to compile (**F-67 → WP-259**). Related: a wire built
  off such a paraphrase can also read from the wrong source — dogfood-068's `cmdRun`
  passed the whole `yamlText` (incl. comment preamble) to the precheck instead of the
  mandated `spec.goal`, correct only by the dogfood-header-leads-with-target convention
  (**F-68 → WP-260**).
- **A clean `chikory run` journals ~ONE durable step per agent session — step count
  tracks judge-retry rounds, NOT feature size** (F-86, dogfood-077 → WP-508). The codex
  executor completes a whole single-goal build inside one `runStep` (dogfood-077: 51 tool
  calls, 13 files, 2.9M input tokens — ALL in step 1), so the run has ONE checkpoint. Three
  rung-2 attempts on progressively larger single-goal features produced 3/4/1 steps
  (075/076/077); the fewest-step run (077) had the LARGEST clean diff. **Consequence:** the
  WP-265 rung-2 ≥10-step horizon + a meaningful mid-run `kill -9` → `chikory resume` are
  UNREACHABLE by "pick a bigger feature" — 1 step = 1 checkpoint = nothing mid-horizon to
  kill into or measure reliability across. **A ≥10-step durable horizon must come from
  sequential decomposition (`chikory chain`: K goals → ≥K checkpoints), not a heavier single
  goal.** Do NOT size a horizon headline as one big single-goal `chikory run`; use a chain.
- **But `chikory chain` does not GUARANTEE decomposition — the planner can collapse a
  multi-deliverable goal into ONE node, and its src-only auto-writeSet then FALSE-FAILS a
  node that writes the tests its AC requires** (F-88 → WP-509, F-89 → WP-510, dogfood-078).
  dogfood-078's WP-250 goal was authored (per WP-508) to decompose into ≥6 sequential
  deliverables; the chain planner emitted a SINGLE node `wp-250-implementation` and folded
  the whole feature into it (1 checkpoint) — so chain-hosting bought ZERO horizon (rung-2 miss
  #4, now at the planner). That single node's planner-derived `writeSet` was **src-only** (6
  files), so when the executor also wrote the two AC-required test files, the writeSet gate
  (`activities.ts:1015`) sealed the node **FAILED** — even though the judge had PROCEEDED and
  `tsc`/`eslint`/the full vitest suite were all green. **✅ RESOLVED (dogfood-079):** WP-509 landed
  a `min_nodes` decompose floor (`031baa7`) + hardened planner prompt — a `min_nodes: N` spec that
  the planner under-decomposes now FAILS LOUD pre-judge; and WP-510 admits the executor's real
  writes. But WP-510 took **FOUR** iterations because exact-path enforcement is fundamentally
  wrong for a LOOSE chain that delegates file LAYOUT: the gate false-FAILED (1) the AC test tree,
  (2) an **executor-named NEW file** in a declared dir (`src/memory/tiered.ts` where the planner
  guessed `core.ts`), (3) a downstream node **MODIFYING** that file, and (4) an additive **barrel
  `index.*`** re-export. `undeclaredWritePaths` (`src/chain/write-set.ts:130`) is now
  DIRECTORY-scoped: a changed path is admitted if it matches a declared path exactly, is a test
  artifact, is a barrel `index.*`, or sits in a directory a declared entry owns (added OR modified);
  only a write to a directory NO declared entry owns still FAILS. ⚠️ This erodes the writeSet's
  conflict-safety for LOOSE chains — **F-91 → WP-512** asks whether exact-path is the right
  primitive at all (fine for the linear LOOSE chains this targets: no parallel writers, judge +
  full-build AC are the backstop). With both landed, dogfood-079 decomposed into 4 nodes and
  passed 0 false-fails. If a node still seals FAILED on a writeSet gate, hand-harvest the
  workspace delivery (`git -C <run>/workspace diff main HEAD | git apply` at repo root) and re-run
  the full AC against the working tree — the FAILED seal is chain bookkeeping, not a code defect.
- **Even a DELIBERATELY multi-part SINGLE-run goal one-shots — the intra-run horizon (rung 3)
  cannot be summoned by goal size, it must be HARNESS-FORCED** (F-95, dogfood-080 → WP-213 /
  step-forcing). dogfood-080's WP-205 goal was purpose-built (per F-94) to force a long intra-run
  horizon: ONE `chikory run` goal DECOMPOSED into 4 ordered dependent PARTS (command → journal fork
  → workspace fork → branch-on-verdict + live proof), each "with its own tests folded in so the run
  accumulates real durable steps." codex produced ALL 4 parts / 10 files / 626 new lines in step 1's
  single 57-tool-call turn; the run's "2 steps" was 1 attempt + 1 accidental 600s step-cap retry on a
  hanging live test, NOT feature-step accumulation. **This reconfirms F-86 across dogfood-077/079/080:
  the executor collapses ANY single-run goal into one mega-step regardless of internal part structure,
  so the intra-run ≥5-step reliability curve is un-measurable this way.** Do NOT author a rung-3 headline
  as "a bigger, more-decomposed single goal" — it will one-shot again. Rung 3 needs the HARNESS to force
  step boundaries: **WP-213's native tool-loop** (checkpoints at bounded `maxTurns`/`maxSeconds` work-units)
  or an explicit per-part seal-and-re-enter / tool-call-budget mechanism. Additionally, a step KILLED by the
  `maxSeconds` cap reports `$0.00 / 0 tokens` even after 10m / 57 tool calls of real spend, and the retry
  re-bills the full context — the budget gate undercounts timed-out steps (**F-96 → WP-515**; the same kill
  proved WP-268's hard step-cap now holds at exactly 1.00×).
- **Two more chain-authoring gotchas from dogfood-079:** (a) the **WP-257 literal-preservation
  floor fights a decomposing planner** — `planLiteralGaps` REVISE-rejects a plan whose paraphrased
  node goals dropped any backtick literal from `plan.goal`, but decomposition NECESSARILY
  paraphrases; keep grep-pinned literals in the **acceptance criteria** (copied verbatim into
  nodes), NOT the goal prose, and de-backtick the narrative (F-92 → WP-513). (b) the **launch-mode
  guard false-trips on comment prose** — a header `#` comment that merely MENTIONS "single `chikory
  run`" matches `SINGLE_RUN_PATTERNS`; avoid the guard's keywords in narrative comments until
  WP-514 scopes it to intent-bearing fields (F-93 → WP-514).
- **A recursive positive grep AC (`grep -rq '<symbol>' test/`) cannot pin a NET-NEW test** —
  it false-greens on any incumbent file that already contains the symbol (F-90 → WP-511,
  dogfood-078: the required live window-park durable test was absent, yet `grep -rq
  'contextWindowTokens' test/` passed on `compaction-wiring.test.ts`/`trace.test.ts`). For a
  net-new-test AC, anchor on a fresh file (F-45: the new test file must be ABSENT on HEAD) or a
  `git diff`-scoped grep, never a recursive whole-tree grep.
- **Single repo**, no `branch`, no suspend-for-days HITL UX, no
  pacing — P2 (WP-214, -205, -207). (`inject` DONE dogfood-075/WP-212; operator
  suspend/resume DONE dogfood-077/WP-206.)
- **A telemetry-*instrumenting* dogfood shows its own new counter at 0** (F-52):
  a run that adds a journal/trace counter for a mechanism it does **not** itself
  trigger will read that counter at `0` on its OWN trace — by design, not a bug.
  dogfood-050 instrumented the seam (`seams fired N`) without arming it →
  `seams fired 0` on its trace; the telemetry is unit-proven, and live observation
  belongs to the next run that actually arms/triggers the mechanism. Don't "fix" a
  zero counter on an instrumenting run, and don't fold a scaffold-hosted armed
  re-run in just to see it tick — confirm it on the next real triggering run.
  Same shape recurred for pacing (F-53, closed dogfood-052) and now compaction
  (**F-54, dogfood-053 → WP-251**): the `summarizeCompaction` totals segment
  `compactions N (pacing M)` read 0 on its own trace because the build run **parked**
  (`peak window 604% (compact 0 · park 1)`) instead of folding — the standing 1-step
  `codex` runs blow the 200k window ~6× in one step, which the act-half correctly
  parks (folding can't help one overflowing step → WP-250), so a natural fold never
  happens. Closure = a deterministic multi-step run under the `CHIKORY_CONTEXT_WINDOW_TOKENS`
  seam that folds past `keepLastN` with `trigger:"pacing"`, then reads the live count.
- **The `peak window N%` denominator is now CALIBRATED to the executor model** (F-55 →
  WP-252, LANDED dogfood-057): pacing used to divide projected tokens by a hardcoded
  `DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000` (`agent-loop.ts:63`) that ignored the executor's
  real window — a single `codex`/`gpt-5.5` step routinely runs 387k–898k input tokens, so the
  headline read e.g. `peak window 759%`/`904%` and `park` fired unconditionally
  (`pacing.ts:35`), the `compact` branch unreachable. **Fixed:** `agent-loop.ts:355` now sources
  the denominator from `resolveContextWindowForSpec(spec, DEFAULT_CONTEXT_WINDOW_TOKENS)` (a new
  pure `src/runner/context-window.ts` — `CONTEXT_WINDOW_TABLE` + `lookupContextWindow` longest-prefix,
  the `lookupPricing` analog), so `gpt-5.5`→400k, Gemini→1M, Anthropic→200k. The
  `debug.contextWindowTokens` seam still wins for deterministic tests. **CONFIRMED LIVE
  (dogfood-058, F-55 CLOSED BY OBSERVATION):** the first run launched at the post-wire HEAD
  (`6292f62`) journaled `pacing utilization 1.792485` = `716994/400000` and the trace rendered
  the believable `peak window 179%` (vs the pre-wire 904%); the calibrated window also flipped
  the step from `park` to `compact` (`compact 1 · park 0`) — the first WP-203/WP-207 act-half payoff.
- **BUT `peak window N%` STILL over-reads on `codex` steps — don't read it as real context
  pressure** (F-56 → WP-254, dogfood-059): the WP-252 calibration fixed the DENOMINATOR, not the
  NUMERATOR. dogfood-059 was a TRIVIAL 3-file additive task, yet it read `peak window 370%` and
  **parked** (`projectedTokens 1,480,248 · utilization 3.70062`, denominator still exactly 400k —
  calibration HELD). The numerator is `spentTokens + estimatedNextStepTokens = (734,193+5,931)×2`
  (`agent-loop.ts:348–359`), i.e. a fresh `codex` subprocess's `tokens_in` SUMMED across its 27
  internal tool-call turns, fed as if it were live single-prompt window occupancy — even raw
  734k/400k = 1.835× "overflows" though the provider accepted all 734k input (the executor's real
  window is well above 400k; there was zero genuine pressure). The window also keys off
  `routing.stages.code.model`, not the actual codex executor. **So dogfood-058's "park-saturation
  broke" was happenstance** (that step was just light, 716,994 → 1.79× → compact); a heavier codex
  step parks again. Until WP-254 lands, treat `park`/`peak window %` on a 1-step `codex` run as a
  measurement artifact, not context-rot. WP-254 (live-occupancy numerator + executor-keyed window)
  is distinct from WP-250 (the *action* on park) and WP-251 (observe a fold live).
  **Reinforced 10× and now the next headline (dogfood-063 → dogfood-064):** dogfood-063 (a trivial
  3-file additive task) PARKED at `peak window 236%` = `944k/400k` while its true step input was
  466k = 116% of the 400k window. The denominator clause is DONE (`resolveContextWindowForSpec`→
  `lookupContextWindow`, `context-window.ts:13`); the OPEN defect is purely the NUMERATOR. dogfood-064
  lands the pure half — `estimateResidentContextTokens(parts: ResidentContextParts)` in
  `src/runner/pacing.ts` (system preamble + the RETAINED TAIL of `recentSummaries`, not cumulative
  throughput) — the value the agent-loop should feed instead of cumulative `spentTokens` at
  `agent-loop.ts:350`; that feed swap is the §4 follow-up. **PURE HALF LANDED (dogfood-064):**
  `estimateResidentContextTokens` + `ResidentContextParts` are in `pacing.ts` + the barrel + 6 vitest
  cases (`Math.max(0, systemTokens + sum(recentSummaryTokens.slice(-clamp(retainedSummaryCount,[0,length]))))`).
  **The §4 feed swap that RETIRES F-56 is now LANDED (operator, 2026-06-29, uncommitted pending
  review):** `agent-loop.ts:~348` feeds `estimateResidentContextTokens(buildResidentContextParts(...))`
  as `currentInputTokens` AND `estimateTokensFromText(record.summary)` as `estimatedNextStepTokens` —
  both numerator terms swapped off the codex throughput (new pure `CHARS_PER_TOKEN`/`estimateTokensFromText`/
  `buildResidentContextParts` in `pacing.ts`). Intended semantic shift: for `codex` (separate process)
  OUR window barely grows per step, so `park`/`compact` now fire only under REAL resident pressure —
  expect believable `peak window` (well under 100%) and NO spurious park on trivial codex tasks, vs the
  historical 236%–486% parks. NB: dogfood-064's own run predates this wire (and its step was killed,
  F-59), so its trace still reads `peak window 0%` — the first calibrated live read is the NEXT run.
- **A KILLED step loses ALL its telemetry, and the `maxSeconds` cap is not a hard deadline** (F-59 →
  WP-255, dogfood-064): a step that exceeds its per-step wall-clock cap is journaled `step exceeded
  maxSeconds=N; killed (retriable: true)` — but in dogfood-064 the `maxSeconds=600` step actually ran
  **24m32s (2.45× the cap)** before it died. Root cause: `runBounded` (`src/executors/process.ts:48-55`)
  arms a correct `setTimeout(maxSeconds*1000)` that fires `child.kill("SIGTERM"/"SIGKILL")` on time, but
  signals only the DIRECT child (`codex exec`), not its process GROUP — codex's grandchild subprocesses
  keep the stdout/stderr pipes open, so the `close` handler (and thus the step) doesn't resolve until
  they exit naturally. The deadline fires; the tree just isn't reaped. **FIXED (operator, 2026-06-29,
  uncommitted pending review): `runBounded` now `spawn(detached:true)` + signals the process GROUP via
  `process.kill(-pid, signal)` (ESRCH-guarded), so the grandchildren are reaped and the step ends near
  `maxSeconds` — proven by a new `hang-grandchild` conformance case (`durationMs < 10_000` on a 1 s
  cap) on both adapters.** The kill previously **zeroed the step's token/cost telemetry**
  (`0/0` tokens, `$0.00`) because the adapters emit usage only at clean turn completion. Two
  consequences on a killed run: (1) the budget gate reads `$0` executor spend (total cost is
  judge-only) — BLIND, not free; (2) the pacing numerator has no tokens, so `peak window 0%` even on a
  real over-read. **WP-255(b) FIX (operator, 2026-06-29, uncommitted pending review):**
  `parseClaudeCodeOutput` (now curried `(model)=>(stdout)`) recovers the last `assistant`-turn usage
  (priced via `computeCostUsd`) when killed before the `result` event, and `step.ts` enriches the kill
  reason with the actual `{elapsed}s ({ratio}× cap)` so the overrun is VISIBLE — a killed step is no
  longer blindly `0/0`/`$0.00` where any usage is recoverable. (A `codex` step killed mid-turn with no
  `turn.completed` is still genuinely unrecoverable — no usage event exists.) The kill's TRIGGER was
  the executor doing a REDUNDANT post-completion self-verification after the ACs were already met (the
  WP-217 completion-signal gap — no "ACs met → stop" signal). 🟢 The flip side is a genuine thesis WIN:
  the durable + judge-grades-on-disk-artifacts layers RECOVERED the killed executor into a correct
  lint-green SUCCESS (judge ran both ACs on the clone, checkpoint `lastGood true`, no
  rollback/re-execution). Still, on a killed step prefer the JUDGE's re-run + working-tree
  re-verification over the trace counters, and watch the enriched kill reason for the overrun ratio.
  **LIVE-CONFIRMED dogfood-072 (F-76/F-77, `run-1ac16aa8-…`):** clause (a) reaping WORKS —
  a codex step killed at `maxSeconds=600` landed at **653.1s = 1.09× cap** (vs dogfood-064's 2.45×).
  The codex telemetry residual RECURRED as documented (killed codex step sealed `$0.00 / 0 tokens`;
  `codex.ts:62` reads usage only at `turn.completed`). NEW gotcha this run exposed: **a retriable
  wall-clock kill re-executes a FULL executor turn even when the killed step already wrote the complete,
  AC-passing delivery.** dogfood-072 step 1 wrote the whole 3-file delivery (5765-byte diff, AC-1 ✓)
  then got killed → step 2 re-ingested **298k tokens for a 0-byte diff** and paid **96% of the run cost**
  to re-run the ACs and seal SUCCESS. Until F-76 → WP-263 lands (re-run the killed step's ACs → seal via
  a judge-only pass when they pass, no executor re-ingest), budget for a **full extra metered step** on
  any run whose executor risks the wall-clock cap — the retry, not the killed step, is where the money goes.
- **Subscription-auth runs can report $0.00 cost** → rely on `max_steps`
  and the HALT guard when the meter is blind. WP-218 slice 1 (dogfood-004)
  prices the documented zero-secrets path (`gpt-5.5`,
  `gemini-3.1-pro-preview`, …) and makes blindness loud: `chikory trace`
  flags `UNPRICED` steps and appends `⚠ cost meter blind (unpriced
  tokens)` to the run header whenever `costEstimated` ∧ cost=$0 ∧
  tokens>0. Token-denominated budgets (`budget_tokens`) remain — the
  contracts slice of WP-218.
- **Completion no longer costs a probe step (F-11 CLOSED, dogfood-022)** —
  historically WP-217 (landed `ef4b16f`) fired the judge on an empty-diff
  SUCCESS, but the executor first had to *spend* one empty-diff step
  rediscovering "nothing to do" (the F-11 tax, **5.8 %–35.1 %** across twenty
  priced campaigns dogfood-002…021). WP-221 closes it: the executor ends its
  productive step's summary with `CHIKORY_TASK_COMPLETE`, the runner reads it
  (pure `claimsCompleteFromSummary` → `StepRecord.claimsComplete`), and
  `isCompletionMilestone` fires the judge off-cadence **on the productive step
  itself**. Confirmed live by dogfood-022 (`run-499218ef`): the first
  marker-emitting run sealed SUCCESS in one step, `components over time: s0 j@0`,
  no probe. So a well-scoped goal that the executor finishes in one productive
  step now seals in one step — no trailing no-op.
- Executor tool sandboxes are real but different: claude-code is
  file-ops-only (can't run tests itself — the judge does), codex has
  workspace-write (can run tests). Both are fine: SUCCESS is judge-verified
  either way.
- **The Agent-as-a-Judge true-positive catch is still DOGFOOD-UNPROVEN
  (dogfood-045 F-46).** Only the dogfood-001 missing-JSDoc catch exists; no
  run has shown the judge ROLLBACK a *genuinely wrong* diff before it landed.
  You **cannot reliably force one by trapping the executor**: a deterministic
  acceptance check forces you to over-specify the answer in the goal (every
  edge rule + the exact algorithm + the verbatim expected outputs), leaving a
  strong executor zero room to err → it one-shots and the judge has nothing to
  catch (dogfood-045: `codex`/`gpt-5.5` nailed all five `truncateMiddle` edge
  traps in step 1). Under-specifying instead breaks the grep-AC (the executor
  can't reproduce assertions it never saw). This is the same non-determinism
  lesson as the park trigger (F-44 → WP-243): the catch must be **forced
  deterministically** via a `debug.seedBadDiff` injection seam (**WP-244**),
  not chased with ever-cleverer traps. Until WP-244 lands, do **not** queue
  another "hope-the-executor-fails" judge-catch dogfood — it just burns budget
  greening the dashboard.
