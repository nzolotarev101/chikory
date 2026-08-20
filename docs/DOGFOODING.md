# Dogfooding guide — running plan.md work packages through Chikory

This is the complete operating manual for executing Phase 2+ work packages
(`plan.md` §6+) **through Chikory itself**: how to set up, how to write the
task spec for a WP (every field explained), how to launch, supervise, and
recover a run, and how to land the result as a normal PR.

**Status (2026-08-20, bounded — update discipline: REPLACE this block, ≤15 lines;
displaced prose moves verbatim to [`PLAN-HISTORY.md`](PLAN-HISTORY.md); per-run detail:
`docs/reports/`; queue + course correction: `plan.md` §6/§7).**
🟡 **dogfood-161 / WP-643 (the loop recognises a complaint it has already heard, however it is worded) DELIVERED from a FAILED run, landed at review** — `run-eef8a03d-c6b6-4165-9738-d002cef3d56d`, terminal **FAILED (resumable)**, **4 steps, $0.4229/$20.00** (judge share 100%), 48m 13s, AC **3/3** re-measured green, harvest byte-IDENTICAL **2/2**, suite **1,767 → 1,782 passed | 23 skipped**, `docs/reports/dogfood-161.md`. F-412 CLOSED.
🟢 **LIVE-PROVEN on prose nobody fitted it to** — this run's own four completion reviews restate ONE complaint against four revisions of the code. Through the real accumulating history (`src/workflow/agent-loop.ts:263`, pushed at `:1406`): byte-equality granted a repair attempt on all four; the delivered instrument (`src/workflow/completion-review.ts:478`) **stops at review #2**. Pinned at `test/runner/completion-review.test.ts:922`.
🔴 **The run sealed FAILED, and it was RIGHT** — the final completion review named a *falsifiable counterexample* with concrete inputs, and this review ran it through the delivered function and got the wrong answer back. **Judge true-positives ×4**: three repaired in-run, the fourth probe-confirmed and unrepaired.
🟡 **F-416 + F-417 (§8) → WP-644** — the instrument recognises **2 of 6** restatements of one complaint, and soundness is gone: `flushBatchWriter` "drops metadata on retry" vs "loses the checksum on retry" compares as the SAME objection (`completion-review.ts:560`); measured false-positive rate over 298 real cross-run pairs is **1.3%** (byte-equality: 0%). 🟡 **F-418** → track-B: reviews #1→#4 each faulted a *different* shortcut in the *then-current* code and the executor removed each in turn — the run was converging while the objection stayed the same.
🟡 **F-419 (§7) HAND-FIXED** — a FAILED acceptance check printed 8 lines and persisted none, so AC-3's red suite reported counts and not the failing test's name. Full output now lands at `.chikory/review/ac-<run-id>-<AC>.log` with hoisted failure lines (`scripts/dogfood-verify.sh:218`). ℹ️ **F-422 HAND-FIXED** (stale `MAX_PROGRESS_GRANTS` docstring). 🟡 F-420 (§8) → track-B: one flaky test in the declared suite, 1 red in 4 observations of 1,802, name lost to F-419. 🟡 F-421 (§8) → track-B: step 4 killed at the 10m cap with 0 output tokens, waiting on a backgrounded full suite the goal forbade (F-345 recurrence).
**Standing lesson: grade the delivery on prose it could not have fitted to.** Nine hand-authored keyword lists passed 3/3 ACs and 13 self-authored tests. What found both real gaps was replaying the run's OWN judge output through the delivered function — the review's cheapest and sharpest instrument, because that prose did not exist when the code was written.
**NEXT HEADLINE = `dogfood-162` / WP-644** — make the repeat decision defensible in BOTH directions on prose it was not fitted to. Gate ✅ PROGRESSING, so the rung does not bind; P3 rung-5's remainder (WP-304) is still operator-run and not spec-expressible.

Related docs: [`docs/spec/task-spec.md`](spec/task-spec.md) (schema
reference) · [`docs/TASK-PROTOCOL.md`](TASK-PROTOCOL.md) (WP etiquette, §7 is
dogfood-specific) · [`docs/components/cli.md`](components/cli.md) (command
reference) · [`docs/COMMS.md`](COMMS.md) (communication standard — binding for
reports, friction items, spec headers, status blocks).

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
  headline **is the current phase's ladder rung, no exceptions**. New 🔴
  loop-integrity friction is **hand-fixed in the same review sitting**
  (TASK-PROTOCOL §4) or queued track-B — under STALLED it never headlines.
  (Rationale: 🔴s kept appearing for 14 straight runs; if a 🔴 can always
  preempt, the ladder never starts.) *A ladder ALWAYS exists — every phase
  carries one (P2 = WP-265 horizon ladder, retired at rung 5; P3 = WP-530 moat
  ladder). The FIRST dogfood of a new phase must author that phase's ladder
  before its first headline (see §5 gate 0); the ledger `rung` column is
  phase-scoped = highest CURRENT-PHASE rung a run satisfied (0 = off-ladder).*
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
| `claude-code` | `claude` | Anthropic subscription OAuth or `ANTHROPIC_API_KEY` | File-ops tool allowlist; exact cost on the wire. Subscription **session limits are a real failure mode** (killed dogfood run 1) — the run degrades safely. Since WP-308 (limit response: failover / conserving work / exact park) + WP-310 (pacing governor: burn paced against the rolling-5h AND weekly windows), subscription auth is viable for long runs; API-key auth remains the simpler path when available. |
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
- **Never mandate full-suite self-verification in the goal (F-345, dogfood-141).**
  The old "VERIFY YOUR OWN WORK: run build, lint, typecheck and the full vitest
  suite and report the ACTUAL counts" boilerplate is a concern factory: the
  judging rules refuse to trust executor self-reports, so the demanded evidence
  is worthless when present and its ABSENCE reads as a violation — the exact
  concern the F-344 adjudication was then asked to clear against a diff that can
  never prove process compliance. It also collides with the step cap: dogfood-141's
  executor finished its 34 KB diff, launched the full suite in-step, and was
  killed at 601.4 s of a 600 s cap while waiting on it. Tell the executor to run
  only **fast per-package checks** (`pnpm exec tsc --noEmit`, `pnpm exec eslint`,
  the one test file it touched); the trusted full-suite verification is the
  declared `regression_suite` (§3.10) plus judge-executed AC checks — which run
  anyway, on evidence the judge actually trusts.

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

**An oracle-owned AC only proves what it ENUMERATES (F-187, dogfood-114).**
dogfood-113 taught the first half of this rule: an AC that greps for a symbol
proves the symbol exists, not that it computes the right answer, so at least one
AC must **own its oracle** — assert behavior the check itself specifies, with
inputs and expected outputs written into the `check`, against the real built
artifact, never delegated to tests the executor authors. dogfood-114 shipped
exactly such an AC, hand-verified in both directions, and **still shipped a
regression**: every probe used a single-comparator version range (`">=24"`), so
the AND-range family (`">=24 <26"`) went unprobed and silently resolved to the
wrong toolchain. The second half of the rule:

> When the deliverable is a **parser, matcher, resolver or classifier**, the
> oracle-owned AC must enumerate the **input families the real world contains**,
> not just the happy family the goal names — and at least one probe per family
> must assert the NEGATIVE (what must *not* be accepted). Ask, before launching:
> *what shapes of input exist that my check never passes in?* If the goal quotes
> example inputs (`">=24"`, `"^24.1.0"`, `"24.x"`, `"22 || 24"`), that list is the
> executor's test plan and therefore its blind spot — the AC must go **past** it.

**An oracle-owned AC must also pin the output's CONSUMER (F-196, dogfood-116).**
F-187 is the input axis; this is the output axis, and it cost the loop a
half-delivered WP. dogfood-116's AC-1 was the strongest oracle this loop has
produced — a 12-assertion behavioral probe over the real built module across a
2×2×3 input matrix — and it proved exactly one thing: that
`decideCompletionReview` **returns** `"review"`. It could not prove that returning
`"review"` **does** anything, because the consequence lived one layer up in
`agent-loop.ts`, behind a live Temporal run. The delivery fired the extra judge
pass and then discarded the finding; all four ACs passed. The rule:

> When the deliverable's value is **"X now causes Y"**, at least one AC must
> assert **Y**. A pure-decision probe over the pure function is necessary and
> never sufficient — pair it with a check on the consumer (a live test through
> the real workflow asserting the downstream artifact, or an assertion on the
> call site's output). Ask, before launching: *if the function returned the
> right answer and the caller ignored it, would any of my ACs go red?* If the
> answer is no, the oracle is only half armed.

**A warning in the spec preamble is not a control (F-194 recurrence, dogfood-116).**
An AC is an incentive; prose is decoration. dogfood-115 shipped 7 spellings of one
input because AC-1 probed 7; dogfood-116 shipped 6 **after the spec explicitly
told the executor not to**. If an AC must probe several spellings to keep a design
open, expect every spelling to be implemented and say in the AC which ONE the call
site is required to pass — or narrow the AC. Change the check, not the comment.

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
    plan:   { provider: openai-compat, model: gpt-5.6-sol xhigh }
    code:   { provider: openai-compat, model: gpt-5.6-sol xhigh }            # ← a model id the EXECUTOR CLI accepts
    review: { provider: openai-compat, model: gpt-5.6-sol xhigh }
    judge:  { provider: openai-compat, model: gemini-3.1-pro-preview }  # ← passed to the shim's backend CLI (-m)
```

Only `OPENAI_COMPAT_BASE_URL` needs to be set; the `openai-compat` labels on
executor stages are the documented workaround. `judge.family` is then
`openai-compat` — real diversity is whatever model family backs the shim, so
keep it different from the executor's (and pick `judge.model` to match the
backend: a Gemini model id for the `gemini` backend, etc.).

### 3.9 P2-reserved blocks

`pacing` (WP-207) and `notifications` (WP-208) parse but do nothing yet.

### 3.10 `regression_suite` (optional — WP-609, landed dogfood-135)

```yaml
regression_suite: pnpm --filter @chikory/sdk exec vitest run
```

The repository's own verification command. It runs ONCE at the run-completion
review (never per-step; at most twice with the bounded repair), and settles the
machine-settled rubric item `pre_existing_suite_still_green` from its EXIT CODE —
so a delivery that breaks a test the repo already had cannot seal SUCCESS. Red
blocks the seal **without** rolling back (the work stays on disk, terminal state
still reached unattended). Full field reference, caps and caveats:
[`docs/spec/task-spec.md`](spec/task-spec.md) § `regression_suite`. Time your
command first — the per-check cap is a fixed 120 s and a kill still fails the run
(🟡 F-320).

## 4. Launch checklist

```sh
# 0. preconditions
git status                  # commit everything the run should see — the workspace clones HEAD
devbox run build            # dist/ is what runs
devbox run temporal-dev     # running in its own terminal
node scripts/cli-judge-proxy.mjs 8787 gemini &   # zero-secrets path only

# 0b. PREFLIGHT (recommended before every headline) — every launch guard at zero LLM cost:
CHIKORY_PREFLIGHT_ONLY=1 [spec envs…] devbox run run-dogfood

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

**Launch guards (all BEFORE any build or LLM spend; each refusal names its override env).**
The launcher runs `dogfood-progression.sh --spec <yaml> --preflight` plus two env-contract
checks, so a mis-authored hypothesis or an unarmed challenge is caught at $0:

| Guard | Refuses when | Exit | Friction it kills |
|---|---|---|---|
| WP-266 static AC lint | `test -f` file-pin · bare-word negative grep · `grep -c`/`-rc` into arithmetic `test` | 3 | F-82, F-83, F-119 |
| WP-266 **dynamic AC dry-run** | any non-suite `check` EXECUTED against HEAD exits ≥2 (BROKEN — can never gate), or NO check is RED-on-HEAD (no armed challenge; a new-work AC must start red and flip green only when the delivery lands) | 3 | every future F-119/F-114/F-90 class, generically |
| Spec-env contract | the spec text names a `CHIKORY_*` env that is not exported in the launching shell (an env-armed seam that silently no-ops voids the run's whole challenge) | 4 | **F-121** (dogfood-091: the window seam never reached the workflow — `runs.task_json` had no `debug` key) |
| Window sizing | `CHIKORY_CONTEXT_WINDOW_TOKENS` ≥ 20000 — executor scale; the pacing denominator is Chikory's ASSEMBLED-context tokens (~2.1k–3.0k observed), so such a window can never fold | 4 | F-120 |

`CHIKORY_PREFLIGHT_ONLY=1` runs all guards and stops — the one-command answer to "is the
next run's hypothesis + challenge actually armed?". Suite-shaped checks (vitest/tsc/eslint)
are labeled VERIFY-SUITE and not dry-run. Guard regression suite:
`bash scripts/test-dogfood-ac-preflight.sh` (8 cases).

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

### The scripted review loop (2026-08-08)

`/dogfood-review` used to be ~45 separately-approved shell calls plus three
throwaway scripts rebuilt from scratch in every session. The mechanical half is
now five commands; judgment (transcripts, anomaly hunt, prose, gate verdicts,
the next spec's traps) stays with the reviewer.

```sh
# phase 0 — idempotent harvest + evidence pack + progression gate, one approval
devbox run -- bash scripts/dogfood-open.sh [<run-id>]

# phase 4 — report skeleton + the living-doc surgery (facts from phase 0)
FACTS=.chikory/review/<run-id>.facts.json
devbox run -- node scripts/dogfood-docs.mjs scaffold <NNN> --facts "$FACTS"
devbox run -- node scripts/dogfood-docs.mjs block --target dogfooding --block <file>
devbox run -- node scripts/dogfood-docs.mjs block --target plan-latest --block <file>
devbox run -- node scripts/dogfood-docs.mjs ledger <NNN> --facts "$FACTS" --wp WP-n --catches N --rung N
devbox run -- node scripts/dogfood-docs.mjs index  <NNN> --outcome <file>

# phase 5 — arm the next spec's oracle in BOTH directions, timed vs the 120 s cap
devbox run -- bash scripts/dogfood-arm.sh <spec>            # RED on HEAD
devbox run -- bash scripts/dogfood-arm.sh <spec> --green    # vs a reference impl
devbox run -- bash scripts/dogfood-arm.sh <spec> --table    # the report block

# landing — gates, suite, commit, push (refuses to commit if any gate is red)
devbox run -- bash scripts/dogfood-close.sh <NNN> --run-id <run-id>
```

Three properties worth knowing:

- **`dogfood-open.sh` never harvests over unrelated work.** It harvests only when
  no commit references the run AND the tree is clean; a dirty tree with no landed
  commit is a refusal, not a merge.
- **Numbers are derived, not retyped.** `dogfood-verify.sh --facts` writes every
  trace value to `.chikory/review/<run-id>.facts.json`, and `scaffold`/`ledger`
  read it. The ledger's judgment columns (`class`, `rung`, `judge_catches`,
  `spec_format`) are still yours and have no defaults for the first three.
- **Caps and citations are enforced, not remembered.** `block` refuses a
  replacement that busts the ≤15/≤30-line cap and moves the displaced prose
  verbatim to `PLAN-HISTORY.md`; `dogfood-close.sh` fails on any `file:line` in
  the report that does not resolve. Both defects shipped in the dogfood-128
  review when the same work was done by hand.

`scripts/test-dogfood-review.sh` covers all of it, and `devbox run test-scripts`
runs every `scripts/test-*.sh` (before this, `test-dogfood-ac-preflight.sh` and
`test-dogfood-landed-scope.sh` existed but nothing ever executed them).

### Landing the delivery

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

- **The run summary table reports the LAST judge pass per step, so the final
  step can read `(0/0 criteria)`** (F-400, dogfood-157). `chikory trace <run-id>`
  built its step rows from `verdictsByStep`, which keeps the last verdict at each
  step index (`packages/sdk-ts/src/cli/trace.ts:183`), and the WP-311 completion
  review — rubric items, **no** acceptance criteria — is journaled at the final
  step. So a run whose last step passed 3/3 acceptance checks renders as
  `✓ PROCEED (0/0 criteria)` in the summary. The number is not wrong, it is a
  different pass. **Read `chikory trace <run-id> --step <n>` for that step's own
  acceptance verdict** — it lists every pass separately — or the facts pack from
  `scripts/dogfood-verify.sh --facts`, which reads the acceptance pass.

| Symptom | Cause → fix |
|---|---|
| An acceptance check the arming pass proved GREEN fails every judge pass with `exited 2` (or any code the check itself never returns), and re-running it by hand passes | **A SIBLING check broke it — 🔴 F-349, dogfood-142.** The judge runs every acceptance check CONCURRENTLY in ONE shared workspace (`src/judge/evidence.ts:244`, `Promise.all` over `runCheck`). dogfood-142's AC-1 wrote a transient `test/runner/ac1-question-step.generated.test.ts`; AC-2 ran `pnpm run typecheck` over the whole package, compiled AC-1's temp file, and died on `error TS6133: 'FakeJudgeWire' is declared but its value is never read` — 4 passes, `AC-2 failed 3+ consecutive verdicts` → goal-drift HALT → a correct delivery sealed FAILED for $0.1846. `dogfood-arm.sh` runs checks in TURN, so it cannot see this (🟠 F-350). **Until WP-623 lands: never let one AC write into a tree another AC compiles or lints.** Put generated files under a path no whole-tree tool reads, or fold the interfering checks into ONE AC. Diagnose it by opening the run's `test_results` evidence artifact — the sibling's filename is in the error text. A check that DIED is not a criterion failure; verify the delivery independently (`dogfood-open.sh` re-runs the ACs serially) before believing the seal. |
| A converged, all-green run seals `FAILED … escalation_concerns_adjudicated`, and the upheld concern is about MISSING EVIDENCE rather than broken code | **The adjudication was asked a question no diff can answer — 🔴 F-344, dogfood-141.** The judge's concern ("the executor never showed it ran its verification commands") is TRUE by construction — executor self-reports are untrusted — so an honest adjudicator upholds it every time, even while the same pass holds green trusted evidence. Fixed 2026-08-15: the charter (`src/judge/prompt.ts:202`) + rubric item (`src/judge/rubric.ts:110`) now scope upholds to defects in the DELIVERED work and make this pass's trusted checks settle process-evidence concerns. If you see this seal on a pre-fix run: the delivery may be fine — verify it independently (`dogfood-open.sh` re-runs the ACs) before discarding. Companion spec rule: §3.2 (never mandate full-suite self-verification — F-345). |
| A run seals `FAILED … unresolved finding on a converged step` with most of its `max_steps` and budget UNSPENT, `injections 0`, and the judge's finding is a small, precisely-described fix | **The executor was never told — 🔴 F-359, dogfood-144 → WP-627.** The bounded design-fix retry (`packages/sdk-ts/src/workflow/agent-loop.ts:1301`) is guarded by `hasStanding` (`:1284`), and every judge pass pushes its failing rubric rows into `standingFindings` (`:1134`). At `judge.cadence: 1` on a step that converges, the pass that seals IS an earlier pass, so the guard is always true and the repair path never runs. dogfood-144 burned 1 of 6 steps and $0.0831 of $20 this way. **What to do now:** the seal is *resumable* — `chikory resume <run-id>` re-enters it, but that only re-judges; to actually close the gap, read the finding out of `chikory trace <run-id>` and either hand-fix it or queue it as its own WP. **Do not read the FAILED seal as a wrong verdict** — dogfood-144's was a confirmed true positive. Verify it with a probe before you dispute it. |
| A spec's "timed at HEAD" suite baseline disagrees with what the executor reports | **You transcribed it instead of measuring it — 🟡 F-342, dogfood-140.** The dogfood-140 spec asserted `175 files / 1380 tests`; HEAD was `185 files / 1475`, because PRs #19–#30 landed 10 test files in `packages/sdk-ts/test/` between the previous review and the launch. The `1376 → 1379 → 1380` figure carried across reports is a hand-incremented counter, not a measurement. **Run the spec's declared `regression_suite` yourself at the commit you are about to launch from, and paste ITS counts.** The premise is fed to the executor AND used to sanity-check its claims, so a stale one reads as fabrication. → WP-622. |
| `Invalid task spec: provider 'x' … missing env var Y` | Parse-time key validation. Export the key, or use the §3.8 routing workaround for keyless CLI runs. |
| `Is the Temporal dev server up?` | It isn't. `devbox run temporal-dev`. |
| A step summary says the FULL TEST SUITE passed, and the judge's `tests_pass` is ✓ | **Neither is evidence the repo builds green — 🔴 F-316, dogfood-134.** `tests_pass` is JD-4-overridden from the JUDGE-EXECUTED acceptance checks; it literally records *"all N judge-executed checks exited 0"*. And the judge reads the ADDED DIFF, so it cannot see a test the delivery broke in a file it never touched. dogfood-134's summary claimed a clean full suite while 6 tests across 3 files were red — including its own new file. Run `devbox run test` in the review, every time; `dogfood-close.sh` blocks the commit but does not tell you why. Durable fix queued as WP-609. |
| A live-runner test seeds a layering/secret violation and the run seals SUCCESS anyway | **The violation is in the BASE, so no scan can see it — 🔴 F-318, dogfood-134.** The evidence pipeline diffs the workspace against `chikory-base`; anything committed into the source repo BEFORE launch produces no added line and no label. The violation must be introduced BY A STEP. `scriptedRegistry` writes only `step-<n>.txt` at the workspace root, which maps to no layer — write a small adapter that emits a `src/`-pathed file instead (`test/runner/deterministic-rubric-live.test.ts` is the worked example). Related: `decideCompletionReview` (`src/workflow/completion-review.ts:68`) SKIPS the review on a first-verdict seal with a clean rubric, so a clean-diff scenario that must reach the review has to withhold a criterion on pass 1 or it greens vacuously. |
| `packages/sdk-ts/test/chain/fan-in-handoff.test.ts` fails in a FULL `devbox run test` but passes when run alone | **Load flake, not a regression (F-276, 2026-08-08).** The fan-in chain test starts three real chain nodes; under the full suite's parallelism (344 s of test work compressed into a ~48 s wall) node `N-3` can seal `FAILED`/`HALT` on a timeout. Re-run the single file (`pnpm exec vitest run test/chain/fan-in-handoff.test.ts`) before believing a red — and if it fails in ISOLATION, that is a real regression. Do not paper over a red full suite by re-running it blind. |
| `chikory-bench probe --tasks benchmarks/tasks …` reports every task `failed (… missing repo.fix_ref)` | Expected as of 2026-08-08 — **not a probe bug (F-283)**. NO task under `benchmarks/tasks/` carries `repo.fix_ref`, so nothing in the real corpus is probeable yet and the WP-593/595/596 pipeline has no input. `AUTHORING.md` does not yet require or explain the field. Tracked as **WP-597** (gold-patch ref: a real commit where every requirement check passes, self-authored where upstream never made one). Do NOT arm `run --discrimination-ledger` over the real corpus until then: today it would exclude every task, and `brownfield-001` — the only task separating the two published arms — has no upstream fix commit by construction. |
| A probe sweep's per-task `probe.json` files are missing or all describe the same task | You are on a pre-F-277 build. Before the fix, `probe --tasks` without `--out` sent every task to the SAME `<task-dir>/probe-output`, so each task overwrote the previous one's report **and** reused one git workspace across repos — leaving the prior target's untracked `node_modules`/build output in the tree the next task's `base_verification_command` runs in. Fixed 2026-08-08: the per-task dir is now unconditional (`<out-or-task-dir>/probe-output/<task-id>/`). A ledger recorded by an older build is suspect for every task after the first. |
| A probe of a large target dies at 45 minutes | That is `DEFAULT_BASE_VERIFY_TIMEOUT_MS`, and a probe runs the target's FULL suite at **two** refs. Raise it: `probe --task … --base-verify-minutes <n>` or `probe --tasks … --base-verify-minutes <n>` (wired for both modes 2026-08-08, F-278; before that the option existed in the API with no CLI path to reach it). |
| A benchmark arm's I-SR looks the same with and without probe evidence | You did not pass the ledger. Since WP-595 the gate is opt-in and lives on the CLI: `chikory-bench run … --discrimination-ledger <file>` (the file `probe --record <file>` writes). With NO ledger the score is deliberately unchanged, so a forgotten flag is silent (F-274). A missing or damaged ledger is refused before any task runs — an exit 1 naming the file is the flag working, not a bug. |
| A track-B robustness gap (e.g. an F-n queued "track-B, fix pending") tempts you to re-launch the already-green headline spec to fix it | Don't — a re-run of a closed spec consumes a dogfood slot the ladder queue owns and double-counts in the ledger (F-102, dogfood-083 re-run `run-03d161e9` fixed F-101 this way). Land a documented track-B fix as a NORMAL PR against the WP's real code; keep dogfood headlines for the WP-265 ladder rung. (The re-run's fix is legitimate and kept — the process, not the code, is the friction.) |
| The evidence pack (`scripts/dogfood-verify.sh`) prints `⚠ acceptance checks FAILED` on a run that is actually GREEN | **✅ FIXED 2026-07-11 (track-B hand-fix, F-128 closed).** Was: §3 re-ran the run's ACs from the Chikory repo root, so a scaffold-hosted run (writes only into git-ignored `.chikory-examples/…`, never harvested) false-failed (dogfood-095 **F-128**). §3 now reads the spec's `repos` from the journal and picks the check cwd itself — a writable repo == this checkout → working tree (brownfield, verifies the harvest); otherwise → the run's own workspace — and prints which (`cwd:` line). Re-verified on dogfood-095's journal: AC-1 20/20 PASS in-workspace. If it still reads wrong, the `HOSTREPO` heuristic mis-detected — check `task_json.repos` in the journal. |
| Steps fail instantly, `executor exited with code 1` | Read the failure: `pnpm chikory trace <run-id> --step 1`. Check the executor binary works headless in your env (`codex exec`/`claude -p` smoke test). |
| Gemini (`gemini-cli`/`agy`) executor run is SUCCESS but the diff is empty | **`agy` print mode ignores the process cwd** — it edits its own global scratch (`~/.gemini/antigravity-cli/scratch/`) unless the run workspace is registered with `--add-dir`. The `gemini-cli` adapter passes `--add-dir <workspaceDir>` for this reason (F-162, verified 2026-07-23). If a hand-run of `agy` writes nothing to your repo, you forgot `--add-dir`. |
| A benchmark target's whole test suite is red on the UNTOUCHED base ref (e.g. `renderHook`→null, snapshot drift, dozens of failures) | **Node-engine mismatch (F-163, 2026-07-23).** The target repo pins a node version the devbox toolchain doesn't provide (gitify wants `engines.node >=24`; devbox pins `nodejs@22`) → its React-19 test renderer never commits. Check the R1 install log for `[WARN] Unsupported engine: wanted {"node":">=24"}`. Such a task can't be graded reproducibly here: mark it `status: blocked` + `blocked_reason` in its YAML (the suite always skips blocked tasks, never scores them) until per-target node provisioning lands (WP-534). This is NOT a flaky test and NOT agent-caused. |
| A task carries `status: blocked` (or any `blocked_reason`) and you are about to spend a run unblocking it | **RE-MEASURE THE PREMISE FIRST — 🔴 F-203, 2026-07-28.** `brownfield-002` sat `blocked` for five days and four dogfood runs (WP-534/538/540, three at `rung=0`) on F-163's claim that its base was systemically red under Node 22. The check takes ~20 s: clone the target, `git checkout <the pinned ref>`, install, run the declared suite. Measured result: **1128/1128 tests pass in 13.13s under ambient node v22.22.3** — the premise was false, and the most likely source of the original number is that it was taken inside a harness workspace carrying that week's copy-back/install defects (F-157/F-166/F-173) rather than on a clean clone. A `blocked_reason` is a sentence someone wrote, not a measurement; treat it as a hypothesis with a timestamp. |
| Benchmark/dogfood run used the wrong model family (Claude executor, Gemini judge) | **Directive: Gemini executes (`--executor gemini` / `gemini-cli` adapter), Codex judges (`judge-proxy … codex`).** The bench harness default executor is still `claude-code`; pass `--executor gemini` or `CHIKORY_BENCH_EXECUTOR=gemini`. The judge proxy backend is set in `devbox.json` `judge-proxy` (now `codex`) and, for dogfood, `scripts/dogfood.sh` derives it from the spec's judge `model:` (default `codex`). |
| Steps fail with a session/usage-limit message | Subscription executor ran dry (dogfood run 1). **Since WP-308/WP-310 this is machine-handled first:** the run classifies the signal, tries declared failover / limit-independent work, and only then parks exactly until reset — check `chikory trace` for a `limit signal` line + `pace` totals before intervening. Manual fallback (pre-WP-308 posture): reject the escalation, switch `executor` to the other CLI (or API-key auth), relaunch. |
| A chain node seals FAILED with `wrote outside its declared writeSet: …` after a judge pass that PASSED everything | The plan gave that node an exact `writeSet`, and every changed path must sit inside it (or be a test file, a barrel `index.*`, or a sibling of a declared path). Since WP-545/F-218 the executor and the judge BOTH see the boundary in their prompt (`# Workspace boundary` → `## Declared write boundary`), so this should now surface as a step-level `scope_matches_instruction` failure you can fix by moving the file. If you still hit it at seal: the node's evidence/report/provenance artifacts must go to a DECLARED path — check `chikory trace <chain-id>` for the node's writeSet, and note the seal check is terminal (the whole node's work is discarded, a passing verdict does not save it). |
| The plan gate REVISEs with `[oracle override: nodes with no executable acceptance check: …]` | WP-546/F-221. That node's acceptance criteria are all prose, so nothing but an LLM's reading could ever call it done — and the run would still HALT it after three prose fails (that is how dogfood-120 died). The repair pass tells the planner to cover the node with a goal criterion id (whose `check` is copied verbatim from your spec) or merge it into a node that has one. **You** can prevent it: give the goal spec enough per-slice behavioral ACs that every plausible node can own one. A spec with NO executable checks at all is exempt — the floor never blocks a prose-only spec. |
| `chikory chain resume` prints `chain … was frozen with no stepLimits, pacing, unattended … in its node template` | WP-547/F-220. A chain's node template is captured at LAUNCH and replayed by every dispatch, so a chain started before those fields were forwarded never gets them, and resuming will not fix it — expect the default 600s step cap and a human park on escalation instead of your `unattended.escalation`. If the declared surface matters for the work that is left, land what the chain already sealed (`bash scripts/harvest.sh <chain-id>-node-<node-id>`) and launch a FRESH chain over the remainder. |
| `harvest.sh` refuses with `chain is not safely harvestable`, but one node of that dead chain DID seal SUCCESS | Only a SUCCESS chain harvests whole. Name the NODE run explicitly: `devbox run -- bash scripts/harvest.sh <chain-id>-node-<node-id> main` (F-222 — an explicitly named node id is no longer promoted to its chain). Find the sealed node in `chikory chain trace <chain-id>` or the chain journal's `node_sealed` entries, then verify the delivery against the goal spec's ACs by hand before committing. |
| The plan gate repeats the SAME literal gaps across attempts and then stops (`plan gate REVISE (attempt n/4) — repairing: mandated goal literal … appears in no node goal`) | **That is oscillation, not slow convergence — do NOT raise the attempt cap.** dogfood-121 spent $0.7764 over 4 attempts and launched nothing: the repair brief was clamped at 2000 chars with the instruction LAST, so on a real 6-node plan (3,798 chars of node goals) the planner never read "keep what the gate did not object to" and re-rolled every time (F-223, fixed in WP-549 — the brief is budgeted now and the instruction is never truncated). Since WP-551 the loop STOPS the moment a defect returns after being satisfied, and names it: `[repair is oscillating: … returned after being satisfied — …]`. If you see that line, the goal's mandate is the problem, not the planner — read the preflight's mandated-literal report and un-backtick what is narrative. |
| A launch prints `⚠️ carried by NO acceptance criterion (n): …` in the mandated-literal report | Those literals live only in the goal's prose, so the PLANNER must recite each one into a node goal or the plan gate REVISEs (WP-257 floor). Deliverable paths belong there — narrative does not. Un-backtick anything that is context (a prior run id, a SHA, a node name, an elided path) and keep backticks for artifacts the delivery must contain. Shape-exempt prose (`any`, `git`, `devbox run`) is already dropped automatically (F-225/WP-550); the report prints the exempt set too, so you can see what the floor ignored. Run it any time at $0: `devbox run -- bash scripts/dogfood-progression.sh --spec <yaml> --literals` (needs a built `dist`). |
| Judge checks time out | 120 s/check cap. Bare `pnpm` not `devbox run` (§3.4); split slow suites into a focused test file per criterion. |
| A judge check "times out" at 120 s but the judge pass takes MINUTES longer — and/or an AC reads red right after a wall-clock-killed step even though the workspace is complete | **The check-timeout kill does not reap the check's process tree** (dogfood-073 **F-78 → WP-264**). `runCheck` (`src/judge/evidence.ts:76`) runs each `check` via `execFileAsync("/bin/sh", ["-c", …], { timeout })`; Node's `timeout` kills only the direct `/bin/sh`, so grandchildren (vitest tinypool workers, etc.) hold the stdout/stderr pipes and the check doesn't settle until they die naturally — dogfood-072's post-kill AC-2 logged `[check timed out after 120000ms]` yet ran **695,853 ms = 5.8× the cap**, tail `Error: Failed to terminate worker`. Treat such a red as an INFRA artifact, not a code red: re-run the check by hand before trusting a FAILED verdict, and beware the 3-consecutive-fails HALT compounding it. Durable fix = WP-264 (port the WP-255(a) `runBounded` group-kill to `runCheck`). |
| Judge verdict is ESCALATE with `judge raised concerns` | The rubric/concerns fired (e.g. scope creep, deleted tests). `trace --step <n>` shows the full form; approve or reject deliberately. |
| CLI behaves like yesterday’s code (e.g. a just-harvested trace feature missing from `chikory trace`) | Stale `dist/`. `devbox run build`. `harvest.sh` now rebuilds before verification (dogfood-004 F-16); the dogfood script builds *pre-run*, so post-harvest forensics always need the rebuild. |
| `chikory land` succeeded but the landed feature is invisible / verification not run | Pass `--verify` (since WP-224, dogfood-008): it reruns `devbox run build/lint/typecheck/test` against the fresh commit and exits 1 on the first red check (commit kept for inspection). Bare `land` (no flag) still only applies + commits — run the four commands by hand. The stray `Switched to a new branch …` lines are gone (F-18 fixed): git stderr is now captured and only surfaced inside `land failed: …` on real errors. |
| `pnpm chikory: command not found` | Bin link lost: `rm node_modules/.pnpm-workspace-state-v1.json && devbox run -- pnpm install`. |
| Parallel `devbox run` commands fail with `.devbox/gen/scripts/.cmd.sh: No such file or directory` | Devbox 0.17.0 concurrent-startup race (dogfood-016 **F-22**). Run every Devbox command sequentially; do not parallelize test/typecheck/lint invocations. |
| Parallel test execution (vitest/pytest/Temporal workers) triggers too many parallel processes and the machine runs out of memory/crashes | Concurrency/parallelism OOM (🟡 **F-109**). Limit Vitest worker pool (`maxWorkers: 1`) and disable file parallelism (`fileParallelism: false`) in `packages/sdk-ts/vitest.config.ts`. |
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
| A LOOSE run sealed FAILED via the 3-consecutive-AC-fail HALT even though the delivery is complete and full-suite-green — and the failing AC's check counts symbol occurrences with `grep -c`/`grep -rc` piped into `test -ge` | **The `grep -c`/`grep -rc` arithmetic AC is UNSATISFIABLE** (dogfood-091 **F-119**, the sibling of F-82/F-83). `grep -rc <dir>` prints `path:count` ONE LINE PER FILE, so `test "$(grep -rc PAT src/)" -ge N` gets a MULTI-LINE string → `integer expression expected` → exit 2 on EVERY judge pass no matter how correct the delivery. dogfood-091's AC-2 (`test "$(grep -rc 'describeCompactionPressure' src/)" -ge 2`) read RED on all 4 passes though the symbol appeared 4× across `src/`; the budget-waste HALT guard then guillotined a complete, full-suite-green 4-part delivery once part 4 (verify-only, empty diff) stopped producing changes. **Prevention (WP-266, LANDED this review):** `bash scripts/dogfood-progression.sh --spec <yaml>` now ⛔s (exit 3) any AC piping `grep -c`/`grep -rc` into an arithmetic `test`. **Authoring rule:** count occurrences with `grep -roh PAT PATH \| wc -l` or files with `grep -rl PAT PATH \| wc -l` piped into `test` — never `grep -c`/`grep -rc <dir>` directly, which is multiline over a delegated loose path. |
| A live compaction/pacing dogfood run NEVER FOLDS (`peak window 1% · compact 0`) despite arming `CHIKORY_CONTEXT_WINDOW_TOKENS` into what looks like the compact band | **The compact-band seam was sized against the WRONG token denominator** (dogfood-091 **F-120**). `debug.contextWindowTokens` / `CHIKORY_CONTEXT_WINDOW_TOKENS` is compared against the agent-loop's OWN ASSEMBLED-CONTEXT token count (`projectedTokens`, single-digit-k in practice — dogfood-091 stayed `~2.1k→3.0k proj`), NOT the executor's internal per-step token consumption (codex burns ≈400k–900k reloading its own context, but that never reaches Chikory's window tracker). dogfood-091 armed 1.2M for "≈400k–900k codex steps" → 3k/1.2M ≈ 0.25% → never near the compact threshold → 0 folds, headline live-fold KPI unmet (the dogfood-053 overshoot risk realized as an UNDERSHOOT). **Rule:** size the window to a few k (a bit ABOVE the observed `proj` value × `compactAtFraction`, and BELOW it × the park threshold) so the projected assembled-context crosses `contextWindowTokens * compactAtFraction` without triggering a park. Read a prior run's `⏱️ pacing continue — N% window (Xk proj)` lines to find the real `proj` scale before choosing the seam value. **And verify the seam actually ARMED (F-121):** dogfood-091's "armed" 1.2M never reached the workflow at all — `runs.task_json` in the journal carries no `debug` key and every pacing entry's `remainingTokens + projectedTokens` sums to the 400k model default, proving the env was not set in the launching shell (propagation through `devbox run` itself is verified working). The launcher now refuses (exit 4) when a spec-named `CHIKORY_*` env is unset and echoes every armed seam with its compact/park thresholds; post-run, confirm `remainingTokens + projectedTokens = your window` in the first pacing entry before trusting any fold/no-fold conclusion. |
| A live compaction run's window is sized RIGHT (`peak window 115% · compact 4`) yet STILL folds 0× (`pressure-steps K (unfolded K)`, 0 `compaction` entries) | **The run was too SHORT to accumulate foldable history** (dogfood-092 **F-122**). A pacing `compact` DECISION and an actual `compaction` FOLD are two different gates: `decideContextWindowPacing` recommends `compact` as soon as `projectedTokens > contextWindowTokens × compactAtFraction`, but `planCompaction` (`src/runner/compaction.ts:22`) only folds when `summaries.length > triggerAfterSteps AND > keepLastN`. Under pacing pressure the effective trigger is lowered to `keepLastN` (`activities.ts:1103`), and `DEFAULT_COMPACTION_POLICY.keepLastN = 5`. A 4-step run has ≤4 resident summaries → `4 ≤ 5` → `planCompaction` folds NOTHING on every compact decision, so `compact N` in the totals can coexist with 0 folds and `unfolded == pressureSteps`. **This is DISTINCT from F-120's undershoot** (there the window was wrong and no compact decision ever fired; here the window is right and compact fires every step but there is nothing old enough to fold). **Rule:** to observe a LIVE pacing fold you need BOTH a correctly-sized window AND a horizon long enough to pile up `> keepLastN` (≥6) resident summaries — decompose the goal into `min_durable_steps: 6-7` so a real `trigger:"pacing"` fold fires by ~step 6 (matches `compaction-wiring.test.ts`'s maxSteps-7 / fold-at-step-6 deterministic proof). Do NOT respond to a 0-fold-on-a-sized-window run by shrinking the window further — that risks a park; lengthen the run instead. |
| Codex steps run far past their `maxSeconds` cap (e.g. ~2×) before being killed, recording 0 tokens / $0 / FAILED | Codex ignores the wall-clock deadline / SIGTERM until it is SIGKILLed (dogfood-076 **F-85 → WP-268**, family of F-76/F-80): steps 3 & 4 ran 1057s (1.76×) and 1188s (1.98×) past the 600s step cap. The cap is enforced LATE (~2×). Treat a run whose wall-clock is dominated by hung dead steps as this, not real work — check per-step `dur` in the trace. Durable fix = WP-268 (escalate to SIGKILL of the executor process group at ~1× the cap). Do NOT raise `budget_usd`/`max_steps` mid-run to rescue it. |
| A `chikory resume <run-id>` appears to hang — the journal is frozen for many minutes and nothing errors, even though the worker is up | **The resumed run lost its judge/router provider config** — `chikory resume` from a shell that did NOT export `OPENAI_COMPAT_BASE_URL` (only `dogfood.sh`'s own shell exports it) starts a judge/router activity with no base URL, and Temporal's activity-retry policy (~65 attempts over ~30 min) loops SILENTLY instead of failing loud (dogfood-082 **F-99**: a step-4 seal stalled ~37 min across the kill→resume boundary purely from this). **`OPENAI_COMPAT_BASE_URL` (and any provider env the spec's `routing` block names) is a RESUME PRECONDITION** — export it before `chikory resume`, or resume from the same shell/`dogfood.sh` context that launched the run. Diagnose a suspected stall: `echo $OPENAI_COMPAT_BASE_URL` (empty = this), and check the worker logs for repeated router-fetch failures. **F-99 CLOSED 2026-07-04 (track-B PR per the §6.1 routing rule): `cmdResume` now runs `resumeProviderEnvGaps` (`src/cli/commands.ts`) — it reads the spec persisted in the run's journal, checks every routed provider's env var (`missingProviderEnv`, `src/taskspec.ts`), and refuses fast (exit 1, naming each var) BEFORE hosting a worker; fail-open when the journal is missing/unreadable so it can never block a legitimate resume. Unit-tested in `test/cli/resume-env-precheck.test.ts`.** Seeing a silent multi-minute resume stall now is a regression — file it. |
| A LOOSE run seals SUCCESS and every AC is green, but review finds the first PART(s) delivered only a refactor — the "net-new symbol" already had its capability on HEAD | **The spec's premise line was STALE** (dogfood-096 **F-129**): the spec asserted "today `activities.ts` commits only `spec.repos[0]`" but `fadc124` had landed the per-repo commit loop + per-repo diff evidence 6 days before launch, so PARTs 1–2 were satisfied by EXTRACTING existing code into the AC-named symbols (`commitAllRepos`, `collectPerRepoDiffs`) plus a redundant `perRepoCommits` field duplicating `gitCommits` (collapsed into `gitCommits` by the 2026-07-11 track-B hand-fix). The F-90 "symbol absent on HEAD" armor proves the SYMBOL is new, not that the CAPABILITY is missing. **Authoring rule:** before writing a premise ("today X only does Y"), verify it against the CAPABILITY — `git log -S` on the mechanism (call sites, loops), read the current code path — not just a grep proving the symbol is absent. Same failure shape as the plan-lags-main rule (dogfood-088 review). |
| A judge pass reports a headline AC as `DID NOT COMPLETE (killed at the per-check cap) — infra failure, not a code red`, non-deterministically across steps | **The AC's `check` runs longer than the judge's per-check cap (~120s)** (dogfood-102 **F-141**): AC-3 = `tsc --noEmit && eslint . && vitest run` (the whole SDK suite) finishes in ~37s wall standalone but ~262s of test CPU; in the judge's constrained per-check sandbox it blew the cap at steps 3 & 6. It is correctly classed infra (not a code red) so no false ROLLBACK fires, but the "full suite green" rubric leg can't be relied on those passes. **Authoring rule:** a headline AC-3 should be a SCOPED `vitest run <the touched test files>` that fits the cap (time it: `time (cd packages/sdk-ts && pnpm exec vitest run <files>)`), with any whole-suite check left to the harvest verify-pack §3 (which has no cap), not the inner-loop judge. Fold into the WP-266/511 loose-AC-hygiene family. |
| A `gemini-cli` / CLI-executor run seals in ONE step, journals **0 tool calls**, and reports a few thousand tokens for a diff of tens of KB — `max horizon survived` reads 1 on every run | **The CLI executor's OWN agent loop is doing the work inside a single Chikory step** (dogfood-114 **F-190**; same shape in 108, 112, 113). Step 1 of `run-fc10fe73` journaled 0 tool calls and 4.8k/2.4k tokens for a **19,482-byte 6-file diff** — the ~90 actions its summary narrates all happened inside one `agy` turn. This is not a telemetry bug to chase (that is F-176) but a **measurement-validity limit**: on this arm `judge.cadence: 2` can never fire twice, checkpoint granularity is one commit, a mid-session rollback is impossible, context-rot mitigation (WP-203/204) is never exercised, and **every run is a first-verdict seal**, so the F-180 completion-review skip fires unconditionally. Do NOT try to force multi-step by inflating the goal — dogfood-114 tried exactly that and still sealed in 1 step. Read the §1.4 horizon KPI as UNMEASURED (not as 1) on any CLI-executor run, and design gate fixes so they work on a one-step run. |
| Steps report **SUCCESS** with **0-byte diffs**, the judge fails ACs that "should" pass, and the run HALTs — but your own working tree has the delivery in it | **The executor wrote OUTSIDE its workspace** (dogfood-115 **F-192**, `run-c19147fe`). The graded clone lives at `.chikory/runs/<id>/workspace` INSIDE the source repo and its `origin` points back at it, so an agent under `--dangerously-skip-permissions` can edit the original instead of the sandbox. Everything downstream then operates correctly on the wrong data: the judge grades an empty tree, checkpoints commit nothing, rollback restores an identical tree, harvest finds nothing. **Diagnose in three commands** — `git -C .chikory/runs/<id>/workspace status --porcelain` (clean?), `git status --short` in your checkout (dirty?), and compare file mtimes against the step timestamps in `chikory trace <id>`; mtimes inside a step window settle it, prose does not. **As of this fix the harness catches it for you:** an empty-diff step whose source repo gained paths now FAILs with `executor wrote OUTSIDE its workspace: … — <paths>`. **Recovery:** `git stash push -m "<run-id> escape" -- <paths>` to park the stray work, then re-run. Do NOT hand-land it — it was never judged. Prevention is 🔴 WP-539. |
| An acceptance check that passes when you run it by hand shows **FAIL** in `dogfood-verify.sh` §3 (often `SyntaxError: Unexpected end of input`, or a second command silently swallowed) | **The pack was flattening multi-line `check:` bodies** (dogfood-115 **F-193**) — `replace(/\s+/g," ")` folds a `//` JS comment over the rest of a `node -e` script and glues consecutive shell lines into one argv. FIXED 2026-07-27 (base64 emit/decode, `scripts/dogfood-verify.sh:67-73`/`:160-161`). If you see this shape again, the rule is: **the judge's own runner preserves newlines, so trust the journal's `criterionResults` over the pack.** Re-run the stored bytes verbatim — `sqlite3 .chikory/runs/<id>/journal.db "select task_json from runs"`, extract `acceptanceCriteria[].check`, write it to a file, `bash` it — before believing any §3 FAIL. |
| A WP that changes runner/judge BEHAVIOR lands ✅ and you want to know it actually works | **The run that delivers it cannot prove it (F-197, dogfood-116).** The Temporal worker is built from the repo state at launch, so the delivery is never in force during its own run — dogfood-116 fixed "a rubric ✗ must gate the seal" and then sealed SUCCESS on a rubric ✗ with nothing gating it. **Rule:** the proof of a behavior WP is the FIRST SUBSEQUENT run on the new HEAD. When queuing the next spec, write down the journal SIGNATURE that mechanism should leave (e.g. "rubric ✗ → a `completion-review` judge pass + a step summary containing `DESIGN REVIEW BRIEF`; rubric clean → exactly one judge pass"), and make the next review state which signature it saw. Without this a behavior WP can land, be marked done, and never fire in the wild. |
| An acceptance criterion asserts real behavior against the built artifact, was verified RED-on-HEAD and GREEN against a reference impl — and the delivery still ships a wrong answer | **The oracle was right and its INPUT DOMAIN was too narrow** (dogfood-114 **F-187**). AC-1 probed `">=18"`/`">=20"`/`">=22"`/`">=24"`/`">=30"` — every one a single comparator — so the AND-range family (`">=24 <26"`) was never probed and silently resolved to the ambient toolchain, a regression against the code it replaced. **Rule (§3.4):** for a parser/matcher/resolver deliverable, enumerate the INPUT FAMILIES the real world contains and assert at least one NEGATIVE per family. Treat the example inputs quoted in the `goal` as the executor's test plan — hence its blind spot — and make the AC go past them. |
| A chain heal-ladder launched with `CHIKORY_SEED_CHAIN_FAIL_NODE=B` (a node NAME) runs clean — no node fails, seam looks armed but is inert | **The force-fail seam keys on the PLANNER-CHOSEN node id, not your spec label** (dogfood-105 **F-149 → `903be2f`**). The planner emits its own ids (`N-A`/`N-B`/`N-C`), so `=B` never matched `N-B`. **Fixed:** `isSeededFailNode` is now planner-agnostic — a NUMERIC value = 0-based dispatch index (else exact/trailing-segment match). **Launch a mid-chain failure with `CHIKORY_SEED_CHAIN_FAIL_NODE=1`** (middle of a 3-chain), not a guessed label. Confirm the seam fired: the chain journal must carry a `node_replanned` entry. |
| A chain node with a semantically-complete plan HALTs at the plan-gate because it "dropped a required literal" that is a PROSE phrase | **The WP-257 literal-preservation floor mandates BACKTICK prose literals verbatim in a node goal** (dogfood-105 **F-151 → `8a0580f`**). A paraphrasing planner drops a mandated prose phrase (e.g. `` `recovery summary:` ``) nondeterministically → PROCEED force-downgraded to REVISE → chain halts despite a complete plan. **Fix applied:** de-backtick prose literals in the goal (ACs still enforce them at delivery); keep the mandate only for genuine code/command identifiers. WP candidate: the floor should skip prose/punctuated literals, mandate only code-like identifiers. **SUPERSEDED as a halt 2026-07-28 (WP-542/F-207):** the floor no longer ends the launch — the dropped literals become a repair brief and the planner re-decomposes (up to 3 attempts). The planner prompt now also STATES the backtick rule it was being judged on. De-backticking prose is still the right hygiene; it is no longer the difference between a launch and a dead end. |
| `chikory chain` dies in the plan phase with `plan meta-judge gate stopped the chain: plan gate REJECTED the plan — NOT safe to re-run as-is: …` and you fix it by editing the spec YAML, then relaunch — repeatedly | **You are hand-executing the repair loop; before WP-542 there was no other option** (dogfood-120 **F-207**, five launches, zero nodes run). Every plan-phase rejection (planner transport fault, write-set topology, the `min_nodes` floor, the coverage/literal floors, a REVISE verdict) discarded the decomposition and exited 1 — no chain journal, nothing to `chikory chain resume`. **Fixed:** `planAndGateChain` now feeds the gate's own evidence back and re-decomposes, bounded at 3 attempts / 10% of `budget_usd`. **What you should see now:** `plan gate REVISE (attempt k/4) — repairing: <the machine-checked defects>` on stderr, then `plan-judge PROCEED (healed in N repair attempt(s))`. Confirm the seam fired: `chikory chain trace <chain-id>` must carry `plan_verdict` entries, the last one PROCEED. **Do NOT hand-append "decomposition guidance" to a spec to appease the gate** — that hides the very failure the loop exists to absorb, and it makes the next launch prove nothing. If it still stops, read the printed `plan repair trail`: it lists every attempt and its defects, so one read replaces one relaunch per data point. `CHIKORY_PLAN_REPAIR_ATTEMPTS=0` restores the old halt-immediately behavior if you need to reproduce it. |
| A chain node escalation is rejected, the retry is rejected too — and then `chikory chain resume`/`approve` both refuse with `chain <id> has no in-flight node awaiting a decision` | **The chain was left un-sealed, not mis-routed** (dogfood-120 **F-208 → WP-543**, `chain-0723ac0b`). A node sealed `{FAILED, ESCALATE}` parks the chain in `AWAITING_PLAN_APPROVAL` (ADR-005 §S3 rule 1) — but a SEALED escalation was already answered, so nothing could unpark it, and `chainLoop` (which seals only on SUCCESS/FAILED) returned without journaling a `terminal` entry. **Fixed:** the workflow now resolves that park into a resumable FAILED seal, so every chain ends SUCCESS or FAILED and `--watch` always returns. **What you should see now:** `recover with: chikory chain resume <chain-id> --watch` printed at the seal — run it and the failed node gets a fresh heal attempt carrying its rejection reason as the retry brief. A chain orphaned by the OLD build is repaired in place by that same `chain resume` (it writes the missing seal first, then re-enters); it refuses to write if a node is still in flight, the workflow is still live, or Temporal is unreachable. Do NOT relaunch the spec from scratch — that discards the plan and every completed node. |
| A chain node dies on a `criterion … failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)` after spending almost nothing, and the chain then refuses it any heal with `replan budget exhausted: N failed node(s) exceeds max 1` | **The node never received the spec's execution policies, then was charged for strikes it did not earn** (dogfood-120 **F-209…F-214 → WP-544**, `chain-0723ac0b` node `N-2`: HALTed on **$0.2025 of $15**). `ChainNodeTemplate` carried only six fields, so a goal spec's `step_limits` / `unattended` / `pacing` were parsed, validated and **dropped** — `max_seconds: 840` reverted to the 600s default and killed step 0 at 602.9s, and that infra kill spent strike 1. Strike 2 was a verdict a ROLLBACK had already reverted. Then `decideReplan` counted every FAILED outcome EVER — including a lineage that had since SUCCEEDED — against a budget hardcoded to 1. **Fixed:** the template forwards the whole execution surface (with an exhaustiveness assertion, so the next added `TaskSpec` field goes RED not silent); a cap-killed step is `infraFailed` and spends no strike; rule-3 history truncates at the last ROLLBACK; the replan budget is per node LINEAGE with a chain ceiling counted over LIVE plan nodes. **What you should see now:** the node's persisted spec carries your `step_limits`/`unattended`/`pacing`, and a later node still gets its own heal attempt after an earlier one recovered. **Note:** a remediation restore deliberately does NOT clear the strike counter — that would un-bound WP-519. |
| A chain node fails, and the chain replans it into a brand-new empty workspace even though the run sealed `resumable: true` with its work intact | **The chain never read the run's own answer** (dogfood-120 **F-214 → WP-544**). `readNodeResult` dropped `resumable` off the terminal payload, so `replanRemaining` — rewrite the goal, start over — was the only heal a failed node could get, discarding the checkpoint, the remediation brief, and the diff (962 insertions, in `N-2`'s case). **Fixed:** `decideNodeHeal` re-enters the SAME child run first (`node_resumed` in the chain journal, one bounded attempt per node) and only falls through to a replan when the child sealed a dead FAILED or the resume budget is spent. **What you should see now:** `node <id> resumed (attempt 1) — work preserved` in `chikory chain trace`, and the node's run journal continuing in place rather than a fresh `-r1` node id. |
| A killed step's retry crash-loops forever with `git … 'File exists'` / `.git/index.lock`, each ~20m attempt re-hitting it | **A step SIGKILLed mid-git leaves a stale `.git/index.lock`; diff-capture's `git add -N .` hard-throws out of the `executeStep` activity → Temporal retries forever** (dogfood-105 **F-152 → `8274c1f`**). **Fixed:** `clearStaleIndexLock` runs before every diff-capture `add -N .` (single-writer workspace → a leftover lock is always stale). Seeing this on old code = rebuild the SDK. |
| An AC `check` pins one test file but the loose goal let the executor put the delivered test elsewhere → the check exits 0 WITHOUT running the new test | **AC-file-pin blind spot** (dogfood-105 **F-153**, sibling of F-82/F-83; the family-diverse judge caught it and escalated — a genuine true-positive). AC-3 pinned `test/chain/read-trace.test.ts` but the E2E test landed in `test/cli/chain-trace.test.ts`, so the pinned check passed vacuously. **Authoring rule (open WP candidate):** an AC that verifies a test ran must target the test DIRECTORY/suite, or the goal must pin the exact test path the executor will use. |
| `chikory chain approve <chain-id>` on an out-of-rubric ESCALATE re-judges instead of sealing → the node loops (empty-diff approve loop), the operator can't seal it | **Approve on an out-of-rubric ESCALATE (rubric passed, advisory concern persists) resumes `status=RUNNING` and re-judges** (dogfood-105 **F-154**, `agent-loop.ts:968-988`). With the delivery already complete, the resumed step produces an empty diff → the judge re-escalates → infinite loop; there is no force-seal path. A code fix can't rescue an IN-FLIGHT run (Temporal pins the workflow code) — kill it and stop. **Open WP candidate (hand-fix owed):** approve on an out-of-rubric ESCALATE should offer force-seal-SUCCESS, not only resume+re-judge. This is a rung-2 (operator chain resume) prerequisite. |
| `chikory chain resume <chain-id>` on a sealed-FAILED chain prints "resume delivered" then immediately reprints the OLD failed trace verbatim (identical timestamps) and exits 1 — the retry node never dispatches | **`followChain` raced the freshly-started `chainLoop` workflow** (dogfood-106 **F-155 → FIXED same session, `9e01e09`**). `client.workflow.start` only enqueues the start and returns; `followChain`'s poll loop starts immediately and its FIRST tick often lands before the new workflow's worker has picked up the task, so it reads only the PRE-EXISTING FAILED tail from before the resume and treats that stale state as the resume's own terminal verdict. **Fixed:** `followChain` takes an optional `sinceIdx` baseline; `hostChainResumeAndFollow` snapshots the journal's entry count before calling `resumeChain`, and the terminal check now requires at least one entry PAST that baseline (a genuine reopen/dispatch) before honoring a verdict. Seeing this on old code = rebuild the SDK. |
| A headless `claude-code` executor produces no diff / hangs on a task that needs it to run shell commands mid-step (install deps, run tests to diagnose) | **`createClaudeCodeAdapter`'s default `allowedTools` never includes `Bash`, and default `--permission-mode` is `acceptEdits`** (dogfood-108 **F-156**) — fine when the JUDGE runs acceptance checks (the normal dogfood shape), but an agent that must run tests itself to diagnose an unfamiliar bug (e.g. a brownfield benchmark task) has no shell and no operator to answer a permission prompt. **Fix:** set `CHIKORY_ALLOW_BASH=1` in the launching env — `claude-code.ts` adds `Bash` to `allowedTools` and switches `--permission-mode` to `auto` (all prompts auto-approved). Scoped opt-in only; a normal launch without the env is unaffected. |
| A `benchmarks/harness` `chikoryAdapter` run scores suspiciously low (e.g. only the trivially-true requirement passes) even though the executor's transcript shows real work | **The harness was grading the WRONG directory** (dogfood-108 **F-157 → fixed `3791e26`**): before this fix, `chikoryAdapter` graded `ctx.workspaceDir` (the harness's own empty pre-provisioned clone), never `.chikory/runs/<id>/workspace` where the executor's edits actually land in the sandboxed run. **Fixed:** the adapter now `cpSync`s the run's final workspace over `ctx.workspaceDir` before grading. If you're on old code and see a too-low score, verify against the run's own workspace directly before trusting it as a real failure. |
| A benchmark requirement that demands the AGENT produce something ("a new test reproduces the bug") passes even when the agent produced nothing of the kind | **The judge's OWN discriminator probe is in the graded tree** (🔴 **F-164 → WP-535**, suite `20260723-222341`). `workflow/agent-loop.ts:743-793` runs `judgeStep` BEFORE `writeCheckpoint`, so any file a judge-executed `check` writes (e.g. `brownfield-003` R4's `__root-cause-check.test.ts`, `brownfield-002` R4's `__probe__/legacy-gone.probe.ts`) is swept into that step's commit. `brownfield-003` R2 globs `git diff --name-only <base> -- '*.test.ts'` — it finds the judge's probe. **Tell:** byte-compare the executor's step diff artifact against `git show --stat <step commit>`; `run-58b48706` was 2 files / 1,729 B vs a 3-file commit. **✅ FIXED (WP-535, `15649d1`) and LIVE-PROVEN 2026-07-25** (suite `20260725-130418`): the R4 probe is in **0** checkpoint commits and the grader's R2 matched only the agent's own `default.test.ts`. Verification recipe still worth running on any new probe-bearing task: `git ls-tree -r HEAD --name-only | grep <probe-name>` must be empty, and the grader's requirement detail must name the agent's file. ⚠️ Residue **F-175**: the cleanup wraps the JUDGE (`collectEvidence`) only — the harness grader has none, so the probe still lands on disk in the archived workspace (harmless for the run, but the artifact is not re-gradable). |
| A benchmark suite runs the WRONG executor family even though the default was just flipped | **The harness process loaded the PRE-flip module** (🟠 **F-165 → WP-536**). Suite `20260723-222341` launched 18:23:41 and ran `{adapter:"claude-code", family:"anthropic"}`; the gemini-cli default flip is `20a2094` (18:30:29) with `benchmarks/harness/dist/adapter.js` rebuilt at 18:30 — 7 minutes too late. Cost: $2.7075 of real Anthropic spend for an arm that violates the standing directive (Gemini executes / Codex judges). **Rule:** the resolved executor/judge family is only knowable from the run journal's capability entry (`sqlite3 <journal.db> "select payload_json from journal_entries where idx=0"` → `stages.code[0]`). Check it FIRST in any bench review, and pass `--executor gemini` explicitly rather than trusting a default you just changed. |
| A copied-back benchmark workspace shows 3 phantom ` M` files (`.cursorrules`, `CLAUDE.md`, `README.md`) that the agent never touched | **Copy-back resolves relative symlinks to absolute sandbox paths** (🟡 **F-166**, track-B). All three are symlinks to `AGENTS.md`; after copy-back they point at `/Users/…/<results>/<task>/.chikory/runs/run-…/workspace/AGENTS.md`. The artifact is therefore not self-contained (prune the run dir and they dangle) and every scope review has to rule them out by hand. **✅ FIXED 2026-07-25** (`benchmarks/harness/src/adapter.ts:236` now passes `verbatimSymlinks: true`). Root cause: node's `cpSync` resolves a RELATIVE symlink against the SOURCE dir and writes it back absolute. Recurred once (suite `20260725-130418`) before the fix; on old code, treat those 3 files as harness noise, not agent scope creep. |
| `chikory trace` shows a judge pass with real token counts but `$0.00` cost, and `judge.max_cost_share` never bites | **The keyless CLI judge proxy reports no model id** (ℹ️ **F-167**, F-9 family). Journal records `judgeModel {provider:"openai-compat", model:"default"}`, which `pricing.ts` cannot price — suite `20260723-222341` logged 28,312/901 and 26,173/581 tokens at `costUsd: 0`. Judge cost share is structurally unmeasurable, so WP-303/304's "cost per successful task" would under-report by the judge's whole share. Track-B: have the proxy surface its backing model id. |

| A `gemini-cli` step stops after almost exactly 5 minutes with a partial answer, few output tokens, and a summary like "waiting for the background test runner task to complete" — but the journal shows a normal, non-timed-out step | **`agy --print-timeout` defaults to `5m0s` and the executor was not passing it** (🔴 **F-172 → FIXED 2026-07-25**, suite `20260725-130418`). `agy` returns its partial answer with **exit 0**, so `runCliStep` records a clean step and neither the journal, the judge, nor the operator can see the truncation. Bench steps run at `max_seconds: 840`, so **64% of every granted step horizon was silently discarded**; `brownfield-001` steps 1 and 8 both stopped at ~5m05s mid-install, which is what drove that run's empty-diff steps and its HALT. **Fixed:** `packages/sdk-ts/src/executors/gemini-cli.ts` passes `--print-timeout ${input.limits.maxSeconds}s` (the `runCliStep` SIGTERM at `maxSeconds` is still the real cap). Seeing this on old code = rebuild the SDK. |
| A benchmark run burns most of its steps and its judge rollbacks on lockfiles and dependency caches instead of the actual task | **The task's own install check uses a different package manager than the target repo** (🟠 **F-173**, WP-302 residue). `brownfield-001` R1 runs `npm install --legacy-peer-deps` inside zodios, a **Yarn Berry zero-install** repo with a committed `.yarn/cache` — that writes `package-lock.json`, rewrites `yarn.lock` (3,822→5,369 lines) and churns hundreds of `.yarn/cache/*.zip`, all of which the judge then correctly fails under `scope_matches_instruction`/`no_unrelated_deletions`. Suite `20260725-130418` spent 3 ROLLBACKs and ~23 of 33 minutes on this. **Authoring rule:** an install check MUST use the target repo's own package manager; otherwise exclude lockfile and cache paths from the judge's diff evidence. |
| `chikory run` refuses the spec with `provider 'gemini' is routed but not configured: missing env var GEMINI_API_KEY` even though the executor is the keyless `gemini-cli` CLI | **`missingProviderEnv` was capability-blind** (🔴 **F-178 → FIXED 2026-07-26**, dogfood-113 launch). A stage served by a CLI **executor** adapter never touches the router — `routing.stages.code` supplies only the MODEL NAME to `executors/gemini-cli.ts` — but the §9.3 check demanded the router's API key for it anyway, so the directive-correct arm (`executor: gemini-cli` + `code: { provider: gemini }`) was unlaunchable on a machine that holds no keys by design. **Fixed:** `packages/sdk-ts/src/taskspec.ts:missingProviderEnv` resolves endpoint capabilities and skips any stage whose capability is `kind: "executor"`. Failover choices and non-code stages are NOT exempt (they do route). |
| The launcher prints `✅ Preflight OK … env contract … pass`, then the run dies seconds later on a spec-validation error | **The preflight's "env contract" only inspected `CHIKORY_*` vars, never routed-provider keys** (🟠 **F-179 → FIXED 2026-07-26**, dogfood-113). The provider check lived inside `chikory run`, i.e. after the SDK rebuild, Temporal probe and proxy probe — a guaranteed failure that a $0 dry-run reported as green. **Fixed:** `scripts/dogfood.sh` §1c-ter refuses at $0 with the same provider/env-var names, exempting `openai-compat` (the launcher exports `OPENAI_COMPAT_BASE_URL` itself) and the `code:` stage under a CLI executor adapter (F-178). Exit code **5**. Keep its provider→env map in sync with `PROVIDER_ENV_VARS`. |
| A gemini run's `chikory trace` is unreadable — every step reports `toolCalls: 0` and every summary is future tense ("I will run `git status`…", "Please review this plan:") even though real edits landed | **`agy --print` emits plain text with no event stream, so `parseAgyOutput` can recover neither a tool count nor an outcome summary** (ℹ️ **F-176**, track-B under WP-221). Consequence: the empty-diff/wasted-step metric is blind on the directive arm — a productive step and a no-op step both report 0 tool calls. Use the step's `diffRef.bytes` and the presence of a `chikory: step N` commit as the real signal until this is fixed. |
| `scripts/harvest.sh` exits non-zero on a tree you believe is green, and `git status` afterwards shows the delivery never landed | **A flaky test in the full `pnpm test` sweep aborts the harvest (F-186, dogfood-113).** `test/chain/fan-in-handoff.test.ts` fails under full-suite parallel load (fan-in child N-3 seals FAILED/HALT) and passes 2/2 in 6.6 s in isolation — the harvest gate is doing its job on a false red. **Re-run the suspect file alone** (`devbox run -- bash -c 'cd packages/sdk-ts && pnpm exec vitest run <file>'`); if it is green in isolation the tree is fine and the harvest can be re-driven. Never conclude "the run delivered nothing" from a clean `git status` before you have run `scripts/harvest.sh` — the delivery lives in `.chikory/runs/<run-id>/workspace` until harvested, and `dogfood-verify.sh` §3 will show every grep AC RED until then. |
| The judge's rubric flags a real design defect and the run seals 🟢 SUCCESS anyway | **Known and unfixed — F-180 → WP-537 (dogfood-113). Happens on ONE-STEP runs specifically.** The design-fix retry loop exists (`agent-loop.ts:874-900`: completion review → design brief → one bounded fix step), but `workflow/completion-review.ts:38-43` SKIPS it on a *first-verdict seal* (`sealingDiffBase === baseCommit`) — which is exactly what a 1-step run is. The sealing verdict itself comes from `decideVerdict`, where a rubric-only failure falls through to a branch that also returns `PROCEED`, so the rubric result ends up with no consumer at all. A multi-step run would have caught it. **Until WP-537 lands, ALWAYS read the `rubric:` block in `dogfood-verify.sh` §2 on any run that sealed in one step — a `design_serves_overall_goal ✗` there is a real pre-land catch nothing acted on.** On dogfood-113 it named two defects the review independently confirmed. |
| Every benchmark target on a `>=N` engine pin is skipped as "unavailable", or gets a Node OLDER than the ambient one | **F-181 → WP-538 (dogfood-113).** `benchmarks/harness/src/engine.ts:99,104-107` matches the node major by EXACT EQUALITY, so `">=18"` resolves to major 18, finds no node-18 toolchain, and returns `unavailable` — even though ambient v22 satisfies the constraint. `">=20"` provisions node 20 over a satisfying ambient 22. Only an exact-ish pin (gitify's `">=24"`, with node 24 in the store) behaves correctly. Do not add a target on a `>=` engine pin until WP-538 lands. |
| A chain node dies with `unattended judge escalation — judge raised concerns outside the rubric` while the judge form shows **every** acceptance criterion and **every** rubric item passing, and the auto-resume just repeats it until the replan budget is gone | **The judge was reasoning about a CUMULATIVE deliverable while being shown the INCREMENTAL diff** (dogfood-121 🔴 **F-229 → WP-554**, `chain-86fbe5a7…` node `N-3`). Steps 1 and 2 each produced a zero-byte diff — the executor had finished at step 0 — so the judge's free-text `concerns` said *"the diff is empty, so it provides no evidence that the node's requested launcher was added"* about a launcher sitting committed in `e21189a`. F-154's carve-out already described this loop but sat BELOW the unattended seal, so unattended it never fired. **Fixed:** an out-of-rubric ESCALATE over a zero-byte diff, with all criteria AND all rubric items passing, now seals **SUCCESS** with the concern carried verbatim in the seal reason — the run has converged and nothing further can answer the objection. A concern over a NON-empty diff still seals resumable FAILED, and an attended run still awaits the operator. **Tell it apart from a real failure:** read the judge form, not the seal — if every `pass` is `true` and `diffRef.bytes` is 0, the node was done. Seeing this on old code = rebuild the SDK. |
| A chain node fails 3-4 steps in a row with `agy produced no response (empty print output) (executor exit 1: Error: Individual quota reached … Resets in 1h0m8s)`, the CG-1 loop-breaker seals it, and the chain dies on `replan budget exhausted` | **A provider quota wall was counted as executor incompetence** (dogfood-121 🔴 **F-228 → WP-553**, node `N-3-r1`). `runner/activities.ts:320` reads `record.limitSignal` to feed `classifyLimitSignal`, and **no adapter ever set it** — `StepRecord` did not declare the field — so the entire park-until-reset / declared-failover scheduler was reachable only through `CHIKORY_LIMIT_AT_STEP` injection. `CLI_LIMIT_RE` also matched `usage/rate/session limit` but not `quota reached`. **Fixed:** `runCliStep` attaches `{kind:"cli-stderr", stderr, exitCode}` to every FAILED record carrying stderr (all three CLI adapters inherit it), the classifier decides whether it IS a limit, and `quota (reached|exceeded|exhausted)` is matched. **Also 🔴 F-234:** `parseDurationMs` terminated each unit with `\b`, so the COMPACT `1h0m8s` parsed as **8 seconds** — a 450× under-park that would have walked straight back into the wall; `(?![a-z])` now rejects a following letter and accepts a following digit. **Before relaunching after a quota kill, confirm the CLI actually answers** — with WP-553 a mid-run wall parks, but starting into a spent quota still burns the plan phase. Seeing this on old code = rebuild the SDK. |
| `[chikory] WARNING: judge spend is 100.0% of run cost … above judge.maxCostShare` on every single judge pass | **Structurally unsatisfiable with a keyless executor, and now suppressed** (dogfood-121 🟡 **F-230 → WP-555**). `agy`/`codex`/`claude-code` authenticate by CLI OAuth and meter **$0** on the wire, so the judge share is 1.0 by construction and "consider a larger cadence" cannot move it — it printed 12 times in one chain. **Fixed:** the warning fires only when there is executor spend for the share to be measured against; the OTel `cost.share` / `cost.share.breached` attributes are unchanged, so the ratio is still recorded. On old code, ignore it on any CLI-executor run. |
| A FAILED chain sealed with SUCCESS nodes, and `git status` is clean — where is their work? | **Unharvested, and a single harvest will not get all of it.** Each node's `chikory-base` tag points at its **PARENT node's** tip, not the chain base, so `scripts/harvest.sh <chain-…-node-N-2>` lands only `N-2`'s own delta. **Harvest every SUCCESS node explicitly, in dependency order** (the F-222 named-node path — the chain path refuses a non-SUCCESS chain). dogfood-121: `node-N-1` → `brownfield-004` + report (328 lines), `node-N-2` → `brownfield-005` + report (349). Verify with `git -C .chikory/runs/<node-run-id>/workspace diff --stat chikory-base HEAD` before and after. |
| `bench: REFUSING to launch — Running workflow(s) on the Temporal server` | **Earlier runs never sealed, and their workflows are still live.** The guard is right: a `Running` workflow re-attaches to the new worker and resumes spending. The usual cause was a run that could not seal — an ESCALATE with no `unattended` policy waiting forever for `chikory approve`, or a park sleeping past the harness cap, then SIGKILLed (bench-p3-rung-4-2026-08-03 🔴 **F-247/F-249 → WP-579/WP-581**; that arm stranded 3). List them with `temporal workflow list --address 127.0.0.1:7233 --query "ExecutionStatus='Running'"` and terminate each by id. Never `CHIKORY_BENCH_ALLOW_ORPHANS=1` unless you know the workflow belongs to a concurrent run you own. |
| A run escalates with `executor FAILED N consecutive steps` where the failures were cap kills or quota parks | **A strike counted something the agent had no part in** (bench-p3-rung-4-2026-08-03 🔴 **F-246 → WP-578**). `brownfield-001` spent all three CG-1 strikes on two `step exceeded maxSeconds=840` kills and one `park-until-reset`, escalated, and burned 4 h waiting for an approver. `agent-loop.ts` was the last counter reading raw `status === "FAILED"`; it now uses `advanceStrikeCount`, where an infra failure neither adds nor resets. Seeing this on old code = rebuild the SDK. If the failures ARE substantive, the escalation is correct — read the step reasons before assuming. |
| A step is journaled `no executor work was performed`, but the checkpoint right after it commits a real diff | **The record was fabricated, not the diff** (bench-p3-rung-4-2026-08-03 🔴 **F-248 → WP-580**). A wall read off the executor's own stderr arrives after it ran; the deferral used to overwrite the real `StepRecord` with an empty-diff / `ZERO_TOKENS` one. Trust the checkpoint. It also meant the ledger under-counted the tokens `decideLimitPacing` reads, so the NEXT park was computed off a lie. Fixed; on old code, read `git log` in the run workspace rather than the step summary. |
| A Chikory-arm task reports `baseVerified: false` whose reason is a **dependency/lockfile** complaint (`error Your lockfile needs to be updated, but yarn was run with --frozen-lockfile`) rather than a failing test, with `testsPassed: 0` | **The harness verified the agent's output and called it the base** (bench-p3-rung-4-2026-08-06 🔴 **F-258 → WP-587**). `chikoryAdapter` reported no `baseVerification`, so `runSuite` fell back to `ctx.workspaceDir` — which `adapter.ts` has by then overwritten with the POST-agent tree. Any task that legitimately edits its lockfile (every dependency-upgrade task) fails a frozen install by construction; `brownfield-001` did, while the SAME pin verified green (117 passed) through `commandAdapter`. Tasks that leave lockfiles alone passed by luck. **Tell it apart from a real red base:** zero tests ran, and the message is about installing, not testing — re-measure with `commandAdapter` or a manual clone of the pin before believing it. Fixed: both adapters verify pre-agent through one `verifyPinnedBase`, and the fallback now reports `adapter 'x' did not report a base verification` instead of guessing. Seeing this on old code = rebuild the harness. |
| `NOT promoting a canonical summary: 1 of 5 tasks selected` | **Working as intended** (bench-p3-rung-4-2026-08-06 🟠 **F-259 → WP-587**). `chikory-bench run` writes `<out>/summary.json` only for a full-corpus run, so a `--filter <one-task>` diagnostic cannot overwrite the arm two summaries are compared from. The hand-promote it replaced was `ls -d <out>/*-chikory \| tail -1` — "newest directory" — which would have published a one-task diagnostic as the five-task arm. Re-run without the narrow `--filter` to promote. |
| The raw Claude Code baseline arm finishes in minutes with every task scoring its no-op baseline | **The agent got an empty prompt** (bench-p3-rung-4-2026-08-06 🟠 **F-260 → WP-587**). `claude -p` / `--print` is a BOOLEAN flag, so `--cmd 'claude -p "$(cat {goalFile})" …'` passes the goal as a positional the CLI never consumes. Use `devbox run bench-baseline`, which puts the prompt on stdin. Do not hand-write this arm from notes — that is how it went stale the first time. |

| A gemini step's `chikory trace` title reads `<notification> <task_id>…`, or the step summary opens with the model quoting its own system prompt | **The summary is raw CLI stdout** (🟠 **F-306** → **WP-606**, dogfood-132). `parseAgyOutput` records `stdout.trim()` verbatim (`src/executors/gemini-cli.ts:56`); `agy` interleaves background-task `<notification>` envelopes and the model sometimes narrates its own instructions before answering. Measured on `run-8e2c21c7`: **1,088 of 6,729 summary bytes** were neither. This is not cosmetic — the summary rides into the NEXT step's prompt (`src/workflow/agent-loop.ts:883` → `:769`) and the pacing token estimate (`:841`). The `<notification>` envelope is stripped as of the dogfood-132 review; the undelimited narration is not. **Read `diffRef.bytes` and the step's own `### Summary` section, not the first line.** |
| A heal is journaled `🩹 remediation attempt N @ step M — <trigger>` with no `(rolled back to …)` suffix — was the work kept, or was there nothing to keep? | **You cannot tell from the trace** (🟡 **F-307**, track-B, dogfood-132). Since WP-605 the absence of `rollbackTo` means EITHER the verdict condemned nothing and the work was deliberately preserved, OR there was no last-good checkpoint to restore (`src/workflow/heal-rollback.ts:38`). `cli/trace.ts:796` renders both identically. Until a positive marker lands, read the verdict on the step BEFORE the heal: all criteria passing + no destructive rubric failure = preserved. |
| The campaign index in `examples/dogfood/README.md` has no row for a spec you know was written | **A `--row` file that was not a table row was inserted verbatim** (🟡 **F-308**, hand-fixed dogfood-132). `dogfood-docs.mjs index --row` now refuses content that does not start with ``| [`dogfood-<nnn>-`` and does not carry 4 columns (`scripts/dogfood-docs.mjs:182-197`). If you hit an older malformed entry, repair the line in place — the next review's `--outcome` lookup keys on that same prefix and will otherwise die. |
| A run sealed 🟢 `SUCCESS` but the seal rationale reads `completion review: design findings recorded — no_architecture_violations, …` | **That is not a clean run — the judge proved a defect and the gate shipped it anyway** (🔴 **F-310** → **WP-607**, dogfood-133). `no_architecture_violations` is scored from a DETERMINISTIC scan (`src/judge/scan-layering.ts:93`), but it is a non-destructive rubric item, so `agent-loop.ts:1099-1105` grants ONE bounded fix step and then seals SUCCESS **whether or not the retry cleared it**. On `run-83bf691d` a real forbidden `core→judge` import failed the item at 3 of 5 passes including the FINAL review and landed on disk. **Always read the seal rationale, and re-run the scan yourself** over `git diff HEAD` before believing a green. |
| A step is journaled `SUCCESS` with a **0-byte diff** and a summary ending *"Please review this plan. Would you like me to proceed?"* | **The executor is asking an approver who does not exist** (🔴 **F-311** → **WP-608**, dogfood-133). The loop has no notion of a step that ends in a question: it journals the summary, the judge sees an empty diff, scores the rubric clean and PROCEEDs. On `run-83bf691d` this burned 2 of 3 steps and — worse — consumed the single bounded remediation step the WP-537/F-180 gate had granted, on a plan that named the correct fix and never applied it. **Check `diff · 0 bytes` on every step before trusting a step count.** |
| A step summary pastes a `vitest`/typecheck log that green-lights files you do not recognise, or the executor's verification table cites a suite size you cannot reproduce | **The CLI replayed a task log from a DIFFERENT session, and the executor transcribed it as this run's evidence** (🔴 **F-312**, envelope hand-fixed dogfood-133). On `run-83bf691d` the summary carried two `<gmsg name="task_notification">` blocks (48.0% of 6,917 bytes) whose "558/558 tests across 46 test files" named **17 files that do not exist** — the workspace holds 174. Only JD-4 (judge-executed checks override the model's `tests_pass`) kept it out of the acceptance path. Both envelope forms are now stripped (`src/executors/gemini-cli.ts:51,61`), but the transcription into prose is not. **Never let a gate rest on what the executor says it ran — re-run the suite yourself.** |
| A run you expected to finish is sitting in `AWAITING_APPROVAL`, its last verdict `⚠ ESCALATE`, and the judge form shows every criterion AND every rubric item ✓ | **A converged out-of-rubric escalation with no unattended policy** (🟡 F-322, dogfood-135 — parked **11h 59m 31s** overnight). `agent-loop.ts:1213-1224` auto-seals SUCCESS for exactly this state, but only when the spec carries `unattended:` / `escalation: seal_resumable_failed`; dogfood-135's spec omitted it. **Fix now:** `devbox run -- pnpm chikory approve <run-id>` — with all criteria passing, the approve path force-seals SUCCESS at $0 without re-judging (`agent-loop.ts:1252-1258`). Do NOT `--reject`: that routes to heal and spends a strike on a delivery the judge already scored green. **Fix forever:** put the two-line `unattended:` block in every headline spec (dogfood-126/128 have it). Before approving, verify the concern yourself — dogfood-135's escalation ("the full-suite/build/lint claim appears only in the executor's untrusted step summary") was formally right and factually wrong; the hand re-run was 174 files / 1342 tests green. |
| A run seals `FAILED — completion review: deterministic rubric failure — pre_existing_suite_still_green`, but the same suite passes when you run it by hand | **Your declared `regression_suite` was KILLED at the per-check cap, not red** (🟡 F-320 → WP-612, dogfood-135). The rubric justification distinguishes them — a kill reads *"DID NOT COMPLETE (killed at the per-check cap) — infra failure, not a code red"* — but the seal does not: the WP-263(b) infra-skip covers CRITERION rows only (`src/judge/verdict.ts:101`), so an `infraFailed` rubric row still reaches `deterministicFails` (`src/workflow/agent-loop.ts:1108,1127`). The cap is fixed at `DEFAULT_CHECK_TIMEOUT_MS = 120_000` (`src/judge/evidence.ts:37`) and **is not spec-settable**. Declare the narrowest suite that still proves the repository green (sdk-ts alone ≈ 50.7 s; the full `devbox run test` ≈ 68 s, leaving little headroom on a loaded machine). |
| A run seals 🟢 `SUCCESS` with the reason `completion review: design findings recorded — pre_existing_suite_still_green`, but the run's rubric row says DID NOT COMPLETE | **The declared `regression_suite:` was KILLED at its per-check cap and never finished** (🟠 **F-327** → **WP-615**, dogfood-137). WP-612 correctly withdrew the FAILED seal an infra kill used to produce, but the branch it falls through to is the design-finding one (`src/workflow/agent-loop.ts:1113-1118`, `:1132-1137`), so the outcome names the killed gate as a design nit and `report.failure` is `undefined`. **The gate did NOT pass — it never ran to completion.** Read the completion-review verdict's `pre_existing_suite_still_green` row: an infra kill carries `infraFailed: true` and a justification saying `DID NOT COMPLETE (killed at the per-check cap)`. Raise `check_timeout_ms:` on the spec and re-run before believing the SUCCESS. |
| A repair step is handed a brief tens of thousands of characters long, or its context blows up on a red suite | **Fixed 2026-08-12 — but check you are past it** (🔴 **F-326**, dogfood-137 review). `buildCompletionReviewBrief` computed the excerpt budget with `Math.max(0, availableForLog - 2)`, and `String.prototype.slice(-0)` is `slice(0)` — the WHOLE string — with no cap check on the final return. When the fixed part of the brief (header + other failing findings + suite header + closing line) landed within 4 chars of the 2000-char cap, the ENTIRE suite output was emitted: **46,095 chars measured**. Fixed at `src/workflow/completion-review.ts:168-189`; the sweep that catches it is `test/judge/deterministic-rubric-oracle.test.ts:363-393`. |

- **A declared `regression_suite:` cap is now the SPEC'S to choose, but an
  inconclusive run still calls itself a design finding** (F-320 fixed by WP-612,
  dogfood-137; F-327 → WP-615 open). Set `check_timeout_ms: <ms>` on the spec and
  both the acceptance checks and the regression suite are measured against it
  (`src/taskspec.ts:196-197` → `src/runner/activities.ts:1786`); absent, the 120 s
  default is unchanged. A cap kill no longer seals FAILED — but it seals
  `SUCCESS · "design findings recorded — pre_existing_suite_still_green"`, which is
  not what happened. **Never read that SUCCESS as the gate passing.** Also unforwarded
  at the second `runJudgePass` call site (`src/chain/activities.ts:437`, 🟡 F-330) —
  latent while that pass runs no checks. This repo's judge+workflow slice runs in
  ~4 s and its FULL suite in ~50 s; still time your suite at HEAD before you launch.
- **The repair brief now RESERVES room for the failing tests** (F-323/F-324 fixed
  by WP-614, dogfood-137). The excerpt's budget is computed from the room left after
  the header, every other failing finding and the closing line
  (`src/workflow/completion-review.ts:146-196`), so at 0–3 co-occurring design
  findings the brief still names the failing item, carries the output TAIL where the
  test names live, and keeps its closing instruction inside an unchanged 2000-char
  cap. **Residual cost → WP-616 (F-328):** the budget was bought by deleting the
  1000-char bound at the settle site (`src/judge/harness.ts:205-208`), so the RAW
  suite output — up to the 64 KB capture ceiling — now rides into the verdict
  rationale (`src/judge/verdict.ts:44,167-169`) and prints in full in `chikory trace`
  (`src/cli/trace.ts:501,505`). A 44 KB `rationale:` line in the journal is this, not
  corruption.
- **An AC that sweeps one input dimension is blind to the other** (🟡 F-329,
  dogfood-137). dogfood-136's oracle drove one case and missed the co-occurrence
  family (F-324); dogfood-137's closed that family — 0/1/2/3 findings — and missed
  the LENGTH family, at ONE fixed ~353-char justification, shipping F-326. Sharper
  rule for the `ac-must-enumerate-input-families` discipline: **when a check computes
  a budget, an offset or an index FROM a length, that length is an input family and a
  single value is not a sweep — drive the boundary, and assert the boundary was
  actually reached.**
- **A step summary can narrate one command and report another's output**
  (F-325, F-306 lineage → WP-606). On dogfood-136 the executor issued four
  tasks 12–17 s apart, each narrated *"Let's run `pnpm run build`"* and each
  returning a **typecheck** result, echoing a command string the repo does not
  define (`packages/sdk-ts/package.json:21`). The step transcript is bounded,
  so absence of a command from it is **not** evidence the command never ran —
  on that run `build`, `lint` and the full suite had all really run and the
  claimed counts were exact. Re-run the suite yourself; never conclude from
  the transcript alone, in either direction.
- **✅ FIXED — a declared `regression_suite:` now runs before ANY success seal**
  (🔴 F-331 → WP-617, hand-fixed in the dogfood-138 review). The suite executes
  only inside the completion review, which is dispatched from the PROCEED arm;
  the two `ESCALATE` exits that seal SUCCESS used to fire upstream of it, so any
  advisory free-text judge remark on a converged step silently skipped the gate.
  dogfood-138 declared a suite for the third live WP-609 proof and it **never
  executed**: one judge entry, `completionReview` undefined, no
  `pre_existing_suite_still_green` row, terminal `SUCCESS · "converged
  out-of-rubric escalation … (F-229/F-271)"`. Both escalate seals now call
  `regressionGateBeforeSuccess` (`src/workflow/agent-loop.ts:397`, wired at
  `:1301` and `:1339`), which runs a declared suite once and routes the result
  through the shared outcome ladder `sealFromRubricFails` (`:352`). A red suite
  seals FAILED even on a converged escalation; a green one leaves the F-229/F-271
  wording untouched; a run that declares no suite is unaffected and buys no extra
  judge pass. **Reading a run either way:** `chikory trace <run-id>` on a
  suite-declaring run must show a judge pass carrying a settled
  `pre_existing_suite_still_green` row. On any run sealed before 2026-08-13, one
  judge pass plus an `⚠ ESCALATE` seal means the gate was skipped — re-run that
  suite by hand before trusting the green.

- **A dead run still says `RUNNING`, and the run that did the work is a
  `branch-run-…` id** (F-372, dogfood-149). `chikory branch <run-id>@<step>` forks
  a run at a committed checkpoint into a NEW child journal and **leaves the
  parent's status at `RUNNING` forever** — nothing ever seals it. A child that is
  created and then abandoned does the same. After dogfood-149's recovery,
  `chikory status` listed **three** rows for one run: the parent `RUNNING` (dead
  5 hours), an abandoned child `RUNNING` (dead 60 seconds after creation), and the
  child that actually sealed `FAILED`. Nothing is lost — the audit trail is intact
  and the child journal carries a `branch_fork` entry naming
  `parentRunId`/`forkCheckpointId`/`forkCommit` — but **do not read `chikory
  status` as a liveness view after a branch**. To find the run that holds the
  work, sort by `ended_at`, not by status, and expect its id to start with
  `branch-run-`. `/dogfood-review` phase 0 must be pointed at that child id, not
  the parent: `dogfood-open.sh <branch-run-id>`.

- **Commit the spec before you launch it — including a one-word edit** (F-372,
  dogfood-149). The workspace clones HEAD, but the TaskSpec is read from the HOST
  path at launch, so an uncommitted spec edit silently takes effect while nothing
  in the repo records it. dogfood-149's spec was edited at 15:03 (`wp:
  WP-616+WP-631` → `wp: WP-616`) and launched at 15:04; the persisted `task_json`
  carries `WP-616` while the spec's header, goal, and README row all still
  describe both work packages, and **the run is reproducible from no commit at
  all**. This is the same move as editing a plan row to appease the stale-spec
  guard, one file over: if the guard or a precheck objects, re-measure the premise
  and launch with `CHIKORY_ALLOW_STALE_SPEC=1`, do not quietly reshape the spec.

- **An AC grep that pins a code SPELLING can outrank a correct judge finding**
  (F-393, dogfood-155). AC-3 asserted the shared seam with
  `grep -qE 'summary: parsed\.summary|summary: [A-Za-z]+\('` over
  `packages/sdk-ts/src/executors/step.ts`. Judge pass #2 raised a real finding —
  the delivery normalised twice, once into a local `const summary` and again when
  building `base`. Step 2 fixed it exactly as asked, by reusing the variable via
  the ES6 shorthand `summary,` — and AC-3 exited 1 with *"no longer builds
  StepRecord.summary from the parsed result"*. The seam was intact; only the
  spelling had changed. Step 3 (**$0.0796, 36% of the run's spend**) existed
  solely to restore a grep-matching spelling, and the judge's own improvement was
  reverted to satisfy the grader. Two rules. (1) A structural grep must accept
  **every legal spelling** of the thing it pins — for an object property that
  means the shorthand (`summary,`), the explicit assignment
  (`summary: <expr>`), and a spread — or it is grading style, not structure. (2)
  Prefer a behavioural AC that owns its oracle; AC-1 and AC-2 drove the real
  `runCliStep` and never produced a false RED. Structural greps belong on the
  **traps** (a neighbouring contract that must NOT move), where a false RED is
  impossible because nothing is supposed to change.

- **A FAILED acceptance check now keeps its full output — read it, don't re-run
  the suite (🟡 F-419, dogfood-161).** The evidence pack prints only the last 8
  lines of each check, and vitest puts the failing test's NAME hundreds of lines
  above its summary, so a red VERIFY-SUITE check used to report counts and no
  cause. Every check's complete output is now written to
  `.chikory/review/ac-<run-id>-<AC>.log` (`scripts/dogfood-verify.sh:218`), the
  path is printed under each result, and a red check additionally prints its
  hoisted failure lines. When an AC goes red, open that log FIRST — the failing
  assertion is in it. `dogfood-arm.sh` has always done this for arming passes
  (`.chikory/review/arm-<spec>-<pass>-<AC>.log`); the two are now symmetric.

## 8. Known P1 limitations (so you don't fight them)

- **🔴 A SCRIPTED JUDGE IS A JUDGE THAT NEVER REWORDS — AN AC WHOSE ORACLE IS AN
  LLM's OUTPUT MUST VARY THE WORDING** (F-412, dogfood-160). WP-640 had to decide
  whether a completion review was re-raising the objection it already gave, or
  raising a new one. The delivered test was
  `a.justification.trim() === b.justification.trim()` — byte-exact equality on
  LLM-authored prose. Both graded ACs and the committed anti-oscillation guard
  (`packages/sdk-ts/test/runner/deterministic-rubric-live.test.ts`) drive a fake
  judge wire that emits the SAME justification string on every pass, so all three
  certified it. The run's own judge defeated it immediately: completion review #1
  and #2 raised the same complaint — the empty-`attemptedFindings` cap bypass —
  in completely different words. Measured at the review, normalised content-word
  Jaccard: the reworded-repeat pair scores **0.109** and dogfood-159's
  genuinely-different pair **0.077**. **The populations overlap**, so no prose
  threshold separates them and no amount of tuning a similarity function will.
  Contained for now by `MAX_PROGRESS_GRANTS = 2`
  (`packages/sdk-ts/src/workflow/completion-review.ts:34`) so the incompleteness
  cannot cost a whole run's headroom; the instrument itself is **WP-643**.
  **The rule: when a check's oracle is what a model WROTE, the fixture must
  restate it, not repeat it.**

- **🔴 A BOUND THAT CONSULTS ITS OWN HISTORY CAN SWITCH ITSELF OFF** (F-413,
  dogfood-160). The same WP gated the `reviewAttemptsUsed >= MAX_COMPLETION_REVIEWS`
  skip behind `attempted === undefined || attempted.length === 0` — reasonable
  in isolation, and it turned the RED regression test green. But every
  `agent-loop.ts` call site passes `attemptedReviewFindings`, a `const` array
  that is non-empty from the first repair grant onward, so the cap was consulted
  only until the first repair and never again. Probed with the loop's real call
  shape: `{"action":"review"}` at `reviewAttemptsUsed: 99`. **When you make a
  bound conditional, enumerate the call sites and ask what each one actually
  passes** — a unit test constructs the state it wants, the loop constructs the
  state it has.

- **🟡 EXECUTOR STEPS BILL $0.00 ON `gemini-cli` — THE BUDGET GATE GOVERNS JUDGE
  SPEND ONLY** (F-415, dogfood-160). Every step in `run-de555224` recorded
  `$0.0000` against 7.3k–10.4k metered tokens and the trace header prints
  `⚠ cost meter blind (unpriced tokens)`. `gemini-cli` bills through CLI OAuth,
  so there is no per-token price to apply. Benign at these budgets, but it means
  **every `cost_usd` in `docs/reports/dogfood-ledger.csv` for a gemini-executed
  run is judge spend only**, and a runaway executor would not trip the budget
  gate. Read step cost as "judge cost", not "run cost".

- **🔴 A FIX THAT INTRODUCES A SET WILL BE FITTED TO THE ONE MEMBER THE
  ACCEPTANCE CHECK NAMED** (F-401, dogfood-158). WP-589 had to exempt "the
  toolchain's own output" from the write boundary. The spec's example was
  `node_modules/`; AC-1 case C instantiated `node_modules/`; the executor's nine
  committed tests instantiated `node_modules/`; the judge argued about
  `node_modules/` across four passes. The shipped `isToolchainPath` matched
  exactly one path segment. A real chikory workspace
  (`.chikory/runs/run-f3d47cf8-6d56-4c7b-85d1-fcfe185badef/workspace`) carries
  **2,605 gitignored files that are not under `node_modules`** — `packages/sdk-ts/dist`
  (604), `.venv` (1,906), `benchmarks/harness/dist` (64), `.devbox` (31) — so any
  node that built the package would have sealed FAILED, the outcome the spec
  itself called "strictly worse than the hole". Hand-fixed at the review
  (`packages/sdk-ts/src/chain/write-set.ts:133`). **The rule: when a delivery
  introduces a SET (an exemption list, an allowlist, a family of statuses),
  enumerate the set from the real environment — `git ls-files --others --ignored`,
  the actual `.gitignore`, the actual enum — and put every member in an AC. The
  spec's example is a sample, never the set.**

- **🟡 A "WHAT CHANGED" CHECK THAT READS A WORKING-TREE SNAPSHOT MEASURES STATE,
  NOT CHANGE** (F-402, dogfood-158). `publishChainHandoff` reads its ignored-path
  stream with `git ls-files --others --ignored --exclude-standard`
  (`packages/sdk-ts/src/runner/activities.ts:2884`). Every other stream it reads
  is anchored to `BASE_TAG`; this one is not, because `ls-files` has no
  two-endpoint form. An ignored file that existed before the node ran is
  therefore attributed to that node. Probe-confirmed: a fixture with a
  pre-existing ignored file and a node that touched only `src/a.ts` sealed
  FAILED naming the pre-existing file. Queued as WP-638. **The rule: a stream
  with no base in it cannot answer a question about change; snapshot it at base
  time and diff, or say plainly that it reports presence.**

- **ℹ️ A TEST-COUNT FLOOR IS SATISFIED BY COPIES OF THE GRADING CHECKS**
  (F-403, dogfood-158). AC-3 required the committed suite to grow by ≥4 tests, to
  stop a behaviour being proved only by the generated grading checks (F-356). The
  executor satisfied it with nine tests that restate AC-1's cases A–D and AC-2's
  two cases one for one, so the committed suite inherited the ACs' blind spot
  exactly — F-401 is invisible to all nine. The floor measures volume, not
  independence. **The rule: pair a count floor with an instruction in the goal to
  pin at least one input family the acceptance checks do not name.**

- **🟡 A DURABLE SYSTEM WITH A LIVE REDUCER AND A REPLAY RECONSTRUCTOR HAS AS
  MANY BRANCHES AS THE REDUCER HAS OVERRIDES** (F-399, dogfood-157). WP-636 made
  `ChainRecord.nodeOutcomes[id]` agree across the live fold and `chainRecordFrom`
  by attaching the marker where the outcome is *produced* — which fixes every
  path that folds `result.outcome`. It does not fix a path that folds something
  *else*: the WP-521 seeded-fail drill (`CHIKORY_SEED_CHAIN_FAIL_NODE`) replaces
  the outcome with a literal before folding it, while `recordNodeSealed` keeps
  persisting the child's marker, so live ≠ restored on exactly the branch the
  heal and replan drills run on. Hand-fixed at the dogfood-157 review
  (`packages/sdk-ts/src/chain/chain-loop.ts:339`). **The rule: after fixing a
  producer, grep the reducer's call sites for arguments that are NOT the
  producer's output** — those are the branches your fix did not reach.

- **🟠 ENUMERATING THE CONSUMED SEAMS IS THE SPEC AUTHOR'S JOB, AND THE
  ENUMERATION COMES FROM A GREP OF THE FIELD'S TYPE — NOT FROM THE NARRATIVE OF
  THE DATA FLOW** (F-396, dogfood-156 → WP-637). dogfood-156's spec did the
  discipline right as far as it went: it named the point of manufacture
  (`readNodeResult`) and two points of consumption (the persisted `node_sealed`
  entry, the `chikory chain trace` output), and the delivery hit both plus two
  renderers it never asked for. What it missed is the seam its OWN thesis-KPI
  header claimed: the **dependent agent**. `buildStructuredCompactionNote`
  (`packages/sdk-ts/src/chain/compaction-note.ts:29`) is the only channel
  carrying a predecessor's outcome into the child's prompt, and it renders three
  fields — `outcome` (`:37`), `verdict` (`:38`), `changed_paths` (`:39`).
  `grep -c inconclusive` over that file returns **0**, so the successor's brief
  is byte-identical whether the predecessor's suite passed or was killed at cap.
  The spec's five-hop map was written by tracing the *value* forward from where
  it dies; it never asked **who else reads `NodeOutcome`**. Rule: before writing
  the ACs, `grep -rn '<TypeName>' src/` and list every reader; a reader that is
  a PROMPT is a consumed seam exactly like a renderer is.

- **🟠 A FOLD THAT REBUILDS STATE IN MEMORY IS A SECOND RECONSTRUCTOR, AND IT
  WILL DISAGREE WITH THE ONE THAT READS DISK** (F-395, dogfood-156 → WP-636).
  The F-380 family's usual shape is one reconstructor silently dropping an
  additive field. Here there are **two**, and only one got the field:
  `chainRecordFrom` merges the marker into the outcome when the record is
  restored from disk (`packages/sdk-ts/src/chain/store.ts:301`), while the live
  loop folds through `advanceChain(record, node.id, outcome)`
  (`packages/sdk-ts/src/chain/chain-loop.ts:349`) with the bare
  `{status, verdict}` that `deriveNodeOutcome` returns
  (`packages/sdk-ts/src/chain/activities.ts:254`). Same typed field, two truths,
  split by whether the chain ever resumed. Rule: when a durable system has a
  live reducer AND a replay reconstructor, an additive field needs an assertion
  that the two agree — not one test per path.

- **ℹ️ `⚠ COST METER BLIND` FIRES ON EXECUTORS WHOSE $0.00 IS CORRECT**
  (F-397, dogfood-156). `chikory trace`'s header warns "cost meter blind
  (unpriced tokens)" whenever metered tokens carry no price, which includes
  every capability entry declared `subscription-linked` with `zero-wire-cost`
  (F-268). dogfood-156 read `$0.0000` on both steps against 5,336 metered
  tokens and `judge share 100.0%` — all three correct. An operator cannot
  currently distinguish a correctly-$0 subscription executor from a genuinely
  unpriced model, which is why WP-592's "$0.00 is wrong" premise was measured
  FALSE and rejected. Read the capability entry before treating $0.00 as a bug.

- **ℹ️ A STEP SUMMARY STILL OPENS WITH LAUNCH NARRATION** (F-398, dogfood-156;
  F-306 family). WP-606 removed the ephemeral-path bloat — dogfood-156's own
  summaries measure 0 `file://` URLs and 0 absolute paths — but not the
  self-narration. Step 2's persisted `record.summary` (5,615 B) opens with four
  lines of "I have launched … / I am waiting … / I will wait …" (**381 B,
  6.7%**) before any content, and that prefix rides into the next step's prompt
  and the pacing estimate. Down from F-306's measured 16%, not closed.

- **🟠 A "SHARED SITE" IS ONLY SHARED BY THE ADAPTERS THAT ACTUALLY CROSS IT**
  (F-392, dogfood-155, hand-fixed at that review). WP-606 sited the summary
  normalisation at `runCliStep` (`packages/sdk-ts/src/executors/step.ts:216`)
  precisely because it is "the single site every CLI adapter's summary passes
  through", and that is true — `codex.ts:145`, `claude-code.ts:199` and
  `gemini-cli.ts:147` all inherited it without being edited. But there are
  **four** registered adapters, not three (`AdapterYaml`,
  `packages/sdk-ts/src/agents/registry.ts:70`): `native` (WP-213, the raw-LLM
  in-process loop) builds its own `StepRecord` at
  `packages/sdk-ts/src/executors/native.ts` and never calls `runCliStep`, so it
  kept emitting the ephemeral workspace path. This is the F-376/F-380 family at
  the adapter altitude — the bypassing file never appears in the diff, because
  nobody has to touch it to leave it behind. Rule: before a goal says "every X
  inherits this", enumerate X from the **registry enum**, not from the call sites
  you already know, and name in an AC each member that does *not* cross the seam.

- **🔴 AN ADDITIVE CONTRACT FIELD DIES IN THE PLACES THAT REBUILD THE OBJECT, NOT
  IN THE PLACES THAT READ IT** (F-380, dogfood-152). The F-376 rule — grep every
  reader of the symbol before writing the AC's reader list — was followed to the
  letter in dogfood-152's spec, which enumerated all seven readers of
  `form.concerns` including `harness.ts:231` and recorded it as *"still parses and
  carries the whole list"*. It does carry the *list*. It does not carry the
  *form*: `applyCheckOverrides` (`packages/sdk-ts/src/judge/harness.ts`) returns
  `{ form: { criterionResults, rubricResults, concerns } }` — a hand-written field
  list — so the new `concernSeverities` was deleted on **every real judge pass**
  and the whole WP-548 severity floor was a no-op end-to-end on the day it landed.
  A re-constructor never appears in the diff, because nobody has to touch it to
  break it. Three rules follow. (1) For any additive-field WP, sweep for
  **re-constructors** as well as readers: `grep -n "{ *<TypeName-ish field list>"`,
  or more reliably grep the sibling field that IS carried (here, `concerns:`) and
  read every hit that assigns rather than reads. (2) A `.strict()` schema mirror
  does NOT protect you — the object is rebuilt after parsing, so the parse
  succeeds and the field is dropped downstream. (3) At least one AC must drive the
  field through the **real production seam** (the harness, the activity, the
  serializer), never a `JudgeForm` literal built inside the test; every one of
  dogfood-152's 38 hand-built-form unit tests was green while the feature did
  nothing.

- **🟠 AN AC THAT ASSERTS "THE SUITE IS GREEN" MUST NOT PICK ITS OWN SCOPE**
  (F-382, dogfood-152 → WP-634). AC-3's durability clause ran `vitest run
  test/judge/ test/workflow/` and counted 192 passing; the delivery's own new live
  test was in `test/runner/` and was RED, so **all 3 ACs passed on a delivery whose
  declared `regression_suite` was failing**. The executor made the same mistake in
  its self-check, and correctly so — the goal tells it not to run the full suite
  inside a step (F-345, the step time cap) and to trust the declared suite. The AC
  is the half that must change: assert against the spec's declared
  `regression_suite`, or assert the scope is a superset of the paths the delivery
  touched. A subdirectory list frozen when the spec was written cannot see work the
  executor puts anywhere else — and "write a test beside the file it covers" is an
  instruction that actively moves work outside it.

- **🟡 AN ASSERTION CONFOUNDED BY ITS OWN FIXTURE PROVES NOTHING IN EITHER
  DIRECTION** (F-383, dogfood-152). The executor's live test seeded a rubric
  **fail** in pass 1 (to stop the pass sealing), then asserted the completion
  review carries no `escalation_concerns_adjudicated` row — but a standing rubric
  finding puts that row there on its own, so the assertion could never pass
  regardless of the behaviour under test. Its sibling had the mirror-image flaw:
  `toContain(...)` satisfied by the seeded rubric fail rather than by the concern.
  Before writing a presence/absence assertion, ask which **other** element of your
  own fixture can produce the same observation — and if one can, remove it or move
  the assertion onto something only the behaviour under test controls.

- **🔴 A GOAL THAT ASSERTS TWO INVARIANTS MUST SAY WHICH ONE WINS AT THEIR
  BOUNDARY — and one AC must drive an input where they actually collide**
  (F-370, dogfood-149). This is a spec-authoring rule, not a code limitation, and
  it cost a whole run. dogfood-149's goal said *"the accumulation handed to the
  completion review is BOUNDED"* (absolute) **and** *"when entries are left out,
  the oldest and the newest findings survive INTACT — both, in full, not
  truncated"* (preservation). When the two endpoint findings alone exceed the
  budget, **no program satisfies both**. The judge read the goal correctly and
  upheld each half in turn against two successive deliveries; the executor
  oscillated between them; the run sealed FAILED with **3/3 acceptance criteria
  green and the declared suite green**. The oracle never caught it because AC-1
  used six ~950-char findings against a 3072-char cap — the endpoints total
  ~1,900 chars, so the collision shape was **never constructed by any check**.
  Two rules follow. (1) When a goal states an absolute invariant, name the
  invariant that yields at the boundary, in the goal, in one sentence. (2) The
  input families an AC must enumerate include the **size relation between one
  input and the budget**, not just the input COUNT — a bound is a two-variable
  property and an AC that varies only one of them proves nothing about the other.
  Sibling of the older rule that an AC must not contradict its goal: here the ACs
  agreed with each other and the *goal* contradicted itself, which beats both.
  Precedence for this specific function is now settled in code
  (`packages/sdk-ts/src/judge/prompt.ts:236-241`): **bounded wins**, and the clamp
  announces the characters it removed (`clampFinding`, `:210-224`) so a shortened
  finding is never silent.

- **🔴 A WP THAT REMOVES A SPEND IS A BUDGET CHANGE — ASK WHAT THE NEW CEILING
  IS** (F-374, dogfood-150; the same shape as F-365, dogfood-148). WP-632's site 2
  said *"a zero-byte step must not spend a completion-review grant"*. The delivery
  read that as "the stall path spends nothing", and the stall path then had no
  ceiling at all — bounded only by `max_steps`. MEASURED at the dogfood-150 review:
  **5 consecutive 0-byte stalls were all granted a repair, journaling 8 judge
  passes**, where `MAX_COMPLETION_REVIEWS` is 2 and each pass cost ~$0.05 on that
  run's own meter. F-365 was the same mistake in the other direction: a *"stop
  dropping findings"* fix added retention with no growth bound. **Authoring rule:
  when a goal removes or exempts a spend, the goal must name the bound that
  replaces it, and one AC must drive the input that exhausts it** — a *second*
  offence, not just the first.

- **🔴 AN AC THAT OWNS ITS ORACLE STILL ONLY PROBES THE INPUT VALUES IT WRITES
  DOWN** (F-373/F-375, dogfood-150). All three defects that shipped in WP-632's
  delivery lived in input families the ACs and the delivered tests never
  instantiated: a **clean sealing rubric with a standing finding still open**
  (F-373), a **second consecutive stall** (F-374), and **`cadence: 2`** (F-375 —
  the goal's own trap C, armed at cadence 1 only, so the trap was set at the wrong
  altitude). The judge answered `design_serves_overall_goal` **PASS** with an
  accurate, specific justification; it was answering a different question. **When
  a goal names a scalar the loop reads (`cadence`, a retry count, a repeat), at
  least one AC must drive a value of it OTHER than the default.** See also
  `[[ac-must-enumerate-input-families]]`.

- **✅ CLOSED — an empty-diff step no longer scores model-judged rubric rows
  vacuously green** (F-369 → WP-632, landed in the dogfood-150 review,
  `run-17010886-9ade-4937-8d9f-db0a67b143a7`). A judge pass whose whole window
  delivered nothing carries the previous pass's answer for every row
  `isRubricItemSettledAgainstWholeDelivery` does NOT call settled, keeps the fresh
  machine answer for every row it does, and invents nothing when there is no
  previous answer (`reconcileEmptyStepRubric`,
  `packages/sdk-ts/src/judge/rubric.ts:158`). "Whole window", not "last step" —
  at `cadence` ≥ 2 the pass still spans earlier real diffs
  (`everyStepSinceLastVerdictIsEmpty`,
  `packages/sdk-ts/src/runner/activities.ts:853`). The description below is the
  defect as it stood.

- **🔴 An empty-diff step is judged as if it were a delivery, and scores
  model-judged rubric rows vacuously green** (F-369 → WP-632, dogfood-149).
  `decideQuestionStep` (`packages/sdk-ts/src/workflow/question-step.ts:55-65`)
  classifies an empty diff whose summary ASKS for approval; an empty diff whose
  summary ASSERTS completion is not classified at all and goes to the judge as a
  normal step. The judge then answers model-judged rows from an absent diff —
  MEASURED: *"There are no design changes in the supplied diff to judge
  adversely"* scored `design_serves_overall_goal` **PASS** one pass after that row
  FAILED and one pass before it FAILED again, for the same defect — and the step
  bought 2 judge passes for **$0.09997, 36.2% of run spend**, for zero bytes.
  Until WP-632 lands: **when reading a trace, treat any judge pass over a 0-byte
  diff as carrying no information about the model-judged rows**, and check the
  passes either side of it before believing an objection was resolved. Nothing is
  lost today only because `standingRubricFindings` never clears a model-judged id.
  (Superseded by the CLOSED entry above for every run after
  `run-17010886-9ade-4937-8d9f-db0a67b143a7`; kept because every earlier trace in
  `docs/reports/` still has to be read this way.)

- **✅ CLOSED — a second, DIFFERENT objection on the same rubric id no longer
  silently replaces the first** (F-364 → WP-630, landed in the dogfood-148 review,
  `run-2213aec1-9683-4c6a-a496-b74f968975c1`). `standingRubricFindings` is now
  `Map<string, string[]>` (`packages/sdk-ts/src/workflow/agent-loop.ts:272`): the fail
  branch reads before writing and appends only a justification the id does not already
  hold (`:1149`, `:1154`), so two different objections on one id both reach the
  completion review as separate bullet lines while an exact repeat still collapses to
  one. Settlement deletes the whole id at once (`:1157`) — pinned live at
  `packages/sdk-ts/test/runner/standing-findings-overwrite-live.test.ts:213`. This closes
  the last member of the objection-dies-without-adjudication family (F-288, F-295, F-361).

- **✅ CLOSED — standing findings no longer accumulate without a bound** (F-365 →
  WP-631, landed in the dogfood-149 review). The bound lives at the RENDER site
  (`renderCompletionReviewConcerns`, `packages/sdk-ts/src/judge/prompt.ts:243`, cap
  3072), not at the accumulator, so no evidence is destroyed: oldest and newest
  survive in full, middle findings are greedily re-admitted while they fit, and
  `- … [N findings omitted]` states the count. Verified over 4,000 randomised
  shapes at the dogfood-149 review — zero bound violations. The description below
  is the defect as it stood. Only `tests_pass` is ever cleared
  (`isRubricItemSettledAgainstWholeDelivery`, `packages/sdk-ts/src/judge/rubric.ts:134-147`
  returns `false` for the other 5 `STANDING_RUBRIC` rows), and each accumulated string is
  rendered one-to-one with no cap and no near-duplicate collapse
  (`packages/sdk-ts/src/judge/prompt.ts:227`; the only narrowing is an exact-set dedup at
  `packages/sdk-ts/src/workflow/agent-loop.ts:416`). An LLM judge rarely repeats itself
  byte-for-byte, so two passes objecting to the same thing in different words are two
  entries: at cadence 1 over a 30-step run one model-judged id can contribute ~30 bullets
  of justification prose — **8–12 KB from a single rubric row**, growing linearly with
  horizon, into the one prompt whose job is holistic judgement. Same family as F-328/WP-616.
  **What to do until WP-631 lands:** on a long run, check the completion-review prompt size
  in `chikory trace` before trusting the review's judgement — a flooded prompt is a degraded
  one, and this is the CM-3 context discipline failing inside the judge itself.

- **✅ CLOSED — a run whose acceptance check goes RED then GREEN is no longer
  condemned at the seal** (F-361 → WP-629, landed in the dogfood-146 review,
  `71f9987`). `standingFindings` is now `standingRubricFindings: Map<string, string>`
  plus `standingConcerns: string[]` behind one `getStandingFindings()` accessor
  (`packages/sdk-ts/src/workflow/agent-loop.ts:270-274`) that both
  `regressionGateBeforeSuccess` (`:413`) and the completion review (`:1261`) read.
  A rubric row settled against the WHOLE delivery — `tests_pass` when the spec
  declares at least one non-empty `check`, decided by
  `isRubricItemSettledAgainstWholeDelivery`
  (`packages/sdk-ts/src/judge/rubric.ts:134-147`) — is deleted when a later pass
  re-derives it green (`:1147-1149`); the row is machine-derived, not model-authored
  (`packages/sdk-ts/src/judge/harness.ts:149-170` overrides `tests_pass` from check
  exit codes whenever any check ran). Model-judged rows and free-text concerns still
  survive every clean pass to the review, so WP-601's guarantee holds
  (`test/runner/standing-findings-live.test.ts:165`, untouched and green).
  _History:_ the append-only array quoted a stale failure at the seal — **MEASURED**
  (`run-1f2a02e0-4615-47fa-8847-ea37c4164cfb`): `tests_pass` ✗ at pass #1 → ✓ at
  pass #2 → pass #3 sealed **FAILED** quoting pass #1, with both ACs green on disk
  and the full suite green. **The standing "unproven, not disproven" caution for an
  `escalation_concerns_adjudicated` seal is retired** — but the fix is proven by 4
  live tests (`test/runner/standing-findings-settled-live.test.ts`), NOT by a live
  run: dogfood-146 raised no finding at all (F-197 shape), so the first live datum
  is still owed. The second half of F-361 stays open by design: the review is still
  dispatched with `criteria: []` (`:1280`) and holds no `test_results` evidence —
  correct now that a settled row is pruned before it gets there.
  **F-197's opening live datum landed dogfood-147** (`run-a26d41eb-…`,
  `docs/reports/dogfood-147.md`): `tests_pass` FAILED at step 1, PASSED at step 2,
  and the completion review carried no stale row — the prune fires correctly in
  production, not only in the 25 unit/live tests. F-364/WP-630 above was not
  exercised (only one objection on the id that run), so its own live-proof is
  still owed.

- **✅ CLOSED — a judge's out-of-rubric CONCERN is now adjudicated before the
  converged seal** (F-335 → WP-619, landed in the dogfood-140 review). A converged
  out-of-rubric escalation buys exactly ONE completion-review pass, shown the
  concern text verbatim, answering through the `escalation_concerns_adjudicated`
  rubric row: cleared → SUCCESS with the F-229/F-271 wording, upheld → **resumable
  FAILED naming the item**, with or without a declared `regression_suite`.
  Terminal-or-nothing — it never re-enters the loop. **What to look for in
  `chikory trace`:** the `completion-review` verdict carries an
  `escalation_concerns_adjudicated` row *only when a concern was raised*; a
  converged SUCCESS without one means nobody objected, not that an objection was
  waved through. (F-334/WP-621 closed the sibling hole where a non-deterministic
  *rubric* finding on the same path was discarded; F-340 closed this gate's own
  false-positive surface — the row is no longer asked when there is nothing to
  adjudicate.) **Still open in this family: WP-601 (F-295)** — an objection raised
  at step N is not in the judge's incremental diff evidence at step N+2, so a run
  can still outrun a design concern by committing more steps.

- **🟡 The stale-spec launch guard can refuse a legitimate spec** (F-339 →
  WP-620, dogfood-139). `chikory run` reads WP completion out of `plan.md` Notes
  prose, treats a bare `LANDED` as done, and only scans the first 300 characters
  for an open-qualifier — so a row reading *"**DATA HALF LANDED** … Still open:
  <the thing you are about to build>"* refuses the launch at $0. Measured against
  the real `plan.md` it is wrong on **7 rows in both directions** (WP-540 reads
  open though done). **Re-measure the WP by hand, then launch with
  `CHIKORY_ALLOW_STALE_SPEC=1`.** Do not edit the plan row to appease the guard.

- **✅ FIXED — a heal no longer throws away work nobody condemned** (🟠 F-302
  → WP-605, dogfood-132). Whether a self-heal restores a checkpoint is now decided
  from the triggering VERDICT, not from which trigger fired: a failing acceptance
  criterion or a destructive rubric failure still rolls back (WP-519 intact — a
  rule-3 HALT is only ever reached through failing criteria), and a verdict that
  condemned nothing keeps the work with your correction applied on top. **Residual
  🟡 F-307:** a preserving heal and a heal with no anchor look the same in
  `chikory trace` — see §7.

- **✅ FIXED — rejecting an escalation now HEALS a plain run** (🔴 F-296 →
  WP-602, dogfood-131, landed `d499128`). `chikory approve <run-id> --reject
  "<reason>"` routes your reason into the existing WP-519/520 remediation path:
  it becomes the next step's brief **verbatim**, the run rolls back to its last
  good checkpoint and continues to its own terminal state with no further
  operator command. Budget: `max_reject_strikes` in the spec (default 1; `0`
  restores the old dead seal). **Say why** — a reject with no reason, or only
  whitespace, still seals dead immediately and heals nothing, by design.
  **Live caveat (🟠 F-302 → WP-605): the heal rolls back to the last
  PROCEED-with-work checkpoint**, so if the escalation followed a step that
  delivered good work but drew ESCALATE rather than PROCEED, rejecting discards
  that step. Read `chikory trace <run-id>` for the last ✓ PROCEED before you
  reject. The branch-instead advice below now applies only to a **dead-sealed**
  run: **there is no way to tell a branch what went wrong** (🟡 F-298 →
  WP-603) — `branch` takes no guidance flag and `inject` needs a live Temporal
  handle, so a branched child runs unsteered. Check `chikory trace <child>` for
  `injections 0` before assuming your guidance landed; on dogfood-130 it had not.

- **A spec cannot state its own judge rubric item, and losing one is silent**
  (🔴 F-300, dogfood-131 → WP-604). The `judge:` block is a `.strict()` zod
  object (`packages/sdk-ts/src/taskspec.ts:219-229`) — `rubric_extra` is not a
  field, so a spec that declares one **will not parse and the run will not
  start**. The field that looks like the channel, `judge.rubric_packs`, parses
  and has **zero consumers**: it does nothing. Your only repair today is to
  delete the block, and nothing warns you that you did — the preflight lint
  prints all 🟢 afterwards. dogfood-131 shipped with its trap-F guard missing
  this way, and `bb6025b` did the same to dogfood-129. **If you must delete a
  rubric block to launch, paste it verbatim into the run's report** so the lost
  gate is recoverable. An invariant you cannot express as a rubric item has to
  become an executable acceptance criterion instead.

- **An acceptance check that runs `pnpm exec tsc` does NOT typecheck the tests**
  (🔴 F-301, dogfood-131). Tests are a separate TypeScript project; the repo's
  gate is `tsc --noEmit && tsc --noEmit -p tsconfig.test.json` (the
  `typecheck` script). Vitest transpiles without typechecking, so a delivery
  whose new tests carry type errors passes both the judge-executed check and its
  own test run — dogfood-131 did, with three `TS2353` errors, and only the
  harvest gate caught it. **Write acceptance checks against the repo's gate
  command, never a bare compiler invocation.**

- **A step killed at `maxSeconds` leaks an orphaned Temporal dev server**
  (🟠 F-304, dogfood-131). Vitest's global setup boots one; the runner's kill
  never reaches vitest's teardown, so the server survives with `PPID 1`.
  dogfood-131 left `temporal server start-dev --headless --port 52252` running
  for hours. After any kill-recovered step, check
  `lsof -nP -iTCP -sTCP:LISTEN | grep temporal` and kill the strays.

- **A judge design objection expires when the diff window moves past the code**
  (🔴 F-295, dogfood-130 → WP-601). Judge diff evidence is incremental
  (`workspace diff since <last checkpoint commit>`), so an objection to code
  committed at step N is simply absent from the evidence at step N+2 — and
  nothing carries it forward. dogfood-130: pass #1 failed
  `design_serves_overall_goal` naming the `resummarize` aggregate-synthesis
  fallback, pass #3 passed the same rubric item over a later window, and the
  code shipped unchanged. **A run can outrun a design objection by committing
  more steps.** When reviewing, read judge pass #1's rubric, not only the last
  one — a ✓ at the seal does not mean every objection was answered.

- **A `.gitignore` negation cannot re-include a file under an ignored directory**
  (🔴 F-293, dogfood-130). `benchmarks/results/.gitignore` shipped `*` plus
  `!**/probe.json`; git never descends into an ignored **directory**, so the
  negation was inert and `git add` refused every per-task `probe.json` — the
  harvest aborted. The delivery's own AC (`git ls-files -- results`) was green
  only inside the run workspace, where the executor had force-added the files and
  a tracked path bypasses ignore rules entirely. **Rules:** (1) re-include the
  directory first, and keep it depth-scoped (`!/*/`, not `!*/` — the recursive
  form re-exposes nested suite `workspace/` git repos, which `git add -A` then
  stages as orphan mode-160000 gitlinks, the defect that killed `run-838ae110`);
  (2) an AC that asserts "this evidence is committed" must run where the artifact
  will LIVE, not inside the workspace that produced it.

- **A real corpus probe sweep does not fit in one step** (🟠 F-297, dogfood-130).
  `maxSeconds=600` killed 2 of 3 steps (671.7 s and 653.6 s); the sweep installs
  dependencies and verifies at two refs for four tasks. The executor coped by
  backgrounding the sweep and resuming next step, and the checkpointer preserved
  the progress — but one step produced zero output tokens. Give a sweep spec its
  own step budget rather than riding the default cap.

- **`⚠ cost meter blind (unpriced tokens)` is a false alarm on `gemini-cli`**
  (ℹ️ F-299, dogfood-130). `isUnpricedStep` (`cli/trace.ts:194-200`) infers
  "unpriced" from `costEstimated && costUsd === 0 && tokens > 0`, but the adapter
  sets `costUsd: 0` deliberately — keyless Antigravity OAuth has no wire cost
  (`executors/gemini-cli.ts:58-60`), and `gemini-3.6-flash` IS in `pricing.ts:51`.
  Nothing is missing. The real consequence: with a keyless executor the USD budget
  gate bounds **judge spend only**, so the executor horizon is bounded by
  `maxSeconds` alone.

- **An acceptance criterion that contradicts its own goal BEATS a correct judge
  finding** (🔴 F-288/F-289, dogfood-129 — the sharpest lesson of the campaign).
  dogfood-129's goal defined `repo.fix_patch` as "a repo-relative path to a patch
  file in THIS repository"; AC-1's fixture wrote its patches to `mkdtempSync` and
  declared them with ABSOLUTE paths. The judge's completion review caught the
  resulting hole (`resolvePatchPath` accepting any absolute path), step 5 FIXED it,
  AC-1 went red, and step 6 **reverted the fix** — "to allow absolute patch paths,
  as required by the AC-1 oracle fixture script" — and rewrote the unit test so its
  assertion contradicted its own name. The judge then raised an out-of-rubric
  `concern` naming the conflict exactly, and the run still sealed 🟢 SUCCESS
  (F-288: `verdict.ts:126` drops a concern whenever the rubric also failed).
  **Rules:** (1) the AC is the gate and the judge is advisory, so a wrong AC drives
  the delivery toward the anti-goal — before launch, read every AC back against the
  goal sentence it enforces and check they agree; (2) arming in BOTH directions
  cannot catch this — RED-on-HEAD and GREEN-on-reference both pass happily on the
  wrong behavior; (3) when a review finds it after the fact, fix the CODE against
  the goal and record the AC as retro-invalid in the report — never rewrite a spec
  that already ran, and never preserve a green you know is wrong.

- **No stored benchmark suite records the ref it scored each task at** (🟠 F-292,
  found 2026-08-09 while arming dogfood-130). `suite.ts` began recording `repoRef`
  only with WP-595 (dogfood-126, 2026-08-07); every suite stored before that —
  including `benchmarks/results/p3-rung-4/`, the publication of record — lacks it.
  So `isTaskDiscriminationVerified` (`results.ts:173`) compares a real `baseRef`
  against `undefined` and excludes **100%** of tasks, reporting "probed at ref X,
  but scored at ref undefined (stale proof)" — false twice: the proof is not stale
  and the task was not scored elsewhere. **Do not "fix" it by reading today's
  `repo.ref` out of the task file** — the ref may have moved since the suite ran,
  which is the exact F-258 premise error. The case needs its own distinct reason.

- **A dogfood delivery can seal SUCCESS with `devbox run lint` red** (🟡 F-290,
  dogfood-129). Both ACs ran `pnpm exec tsc` and the suites; neither ran `eslint`,
  and the executor's own verification table reported tsc + tests green — accurate
  and incomplete. The harvest gate caught it and refused to land. **If a run's
  goal says "every existing test remains green", say `eslint` too, or expect to
  hand-fix it in review.**

- **An AC that greps a file for PROSE is satisfiable by prose that already exists**
  (🟡 F-287, dogfood-128). AC-2 required `brownfield-001` to "STATE why it carries no
  fix ref" via `/no upstream|never did this migration|self-performed|exempt/i` over the
  raw file. The file is **unmodified** in the delivered diff: the regex matched a
  pre-existing parenthetical on line 27 — `# zod-3 HEAD, before any v4 upgrade attempt
  (upstream never did this migration)` — which explains the **`ref` pin**, not a
  `fix_ref` exemption. The assertion was green before the run began, so it measured
  nothing. **Rule:** a documentation AC must either assert text the delivery had to ADD
  (grep the file at HEAD first and confirm exit 1), or assert a BEHAVIOR instead. Same
  family as F-274/F-277/F-283 — an AC must drive the real entry point — at the
  prose altitude.

- **A CLI flag nobody documents is a flag nobody can use, and an unknown flag that
  parses is a false green** (🟡 F-285, dogfood-128). `parseFlags` accepts any `--flag`
  and silently ignores unrecognized ones, so `validate --require-probable` (one letter
  off) exited **0** — "corpus is fine" from the check built to prove it isn't.
  `validate`/`list` now refuse an unknown flag by name (`VALIDATE_FLAGS`,
  `benchmarks/harness/src/main.ts:141`). **Other commands still parse permissively** —
  when adding a flag elsewhere, document it in `USAGE` and consider the allowlist.

- **A published bundle's raw-evidence pointer is guarded, but only since WP-588
  (2026-08-06).** 🔴 F-261 (dogfood-123): `compareSummaries` derived `rawResultsDir`
  as `dirname(resolve(reference))`, so a `compare` run *inside* a Chikory run
  workspace published both arms' trace links as absolute host paths under
  `.chikory/runs/<run-id>/workspace/…` — a directory `scripts/prune-runs.sh` deletes.
  `publishableRawResultsDir` now **throws** on any reference under a `.chikory/runs`
  segment and otherwise emits a repo-relative path. **If you regenerate an
  older bundle, expect that throw — it is the fix working.** Regenerate from the
  operator's own `benchmarks/results/…` copy, never from a run workspace copy of it.

- **An AC that asserts a path-shaped field is `typeof === "string"` proves nothing**
  (🟠 F-262, dogfood-123). AC-2 accepted a string pointing at a directory scheduled
  for deletion. Any AC over a path field must additionally `existsSync` it, assert it
  is **relative**, and assert it is not under `.chikory/`. Same family as the
  dogfood-113 lesson: a check that proves a symbol EXISTS cannot prove it computes
  the right answer.

- **F-262 recurred one review later — the rule now lives in code, not in spec authors'
  heads** (🟠 F-267 → WP-591, dogfood-124). `leaderboard.ts` stored the `--bundle`
  argument verbatim, so the published `leaderboard.json` cited
  `../publications/p3-rung-4` — a path resolvable ONLY from `benchmarks/harness/`,
  the CWD that ran the command, and from neither the artifact's own directory nor the
  repo root. AC-2 had asserted exactly `typeof e.bundle === "string" && length > 0`.
  **Any directory a published artifact points at now goes through
  `publishableRepoPath()` (`benchmarks/harness/src/results.ts:244`)**, which refuses a
  `.chikory/runs` path and otherwise emits repo-root-relative. A pointer inherited from
  another artifact and written relative to an unrecorded CWD (the old `reference`
  field) cannot be re-anchored — **drop it, do not republish it dead.**

- **"No change to how X behaves" is prose, not a gate — pin X's output for a
  caller OUTSIDE the delivery** (🔴 F-270 / 🟡 F-273, dogfood-125). The dogfood-125
  spec said "no change to how `compare`, `leaderboard` or runSuite behave". To green
  its own trap, the executor edited the shared `publishableRepoPath` walk to start at
  `dirname(absolute)` — after which any target that IS a repo root resolved against
  whatever ancestor repo happened to exist on the operator's disk (`<repo>` →
  `repos/chikory`). Both ACs passed, all six rubric items passed, and the judge called
  it *"a focused change [that] preserves the existing abstraction"*: it reasoned from
  the diff, and no gate asks **what the edited function now returns for the callers
  not in the diff**. WP-591 had also shipped `publishableRepoPath` with no direct unit
  test to regress against. **Rule: when a spec forbids changing a shared surface, one
  AC must assert that surface's output for an input the delivery does not touch** —
  and any extracted shared helper gets its own unit test the day it lands.

- **A judge's free-text concern can outrank its own all-green form** (🔴 F-271,
  dogfood-125 — **fixed**, recorded because the shape recurs). Verdict rule 4
  (`judge/verdict.ts:126-129`) escalates on any concern with no rubric basis, and
  unattended that sealed FAILED even with **2/2 criteria and 6/6 rubric passing**,
  because the F-229 carve-out also demanded `diffRef.bytes === 0`. The step that
  *delivers* the last fix is the most converged state a run reaches, so gating on an
  empty diff failed exactly that. The carve-out now keys on `allCriteriaPass &&
  allRubricPass` alone. **If a run seals FAILED with a green form, read the concern
  before relaunching** — and a concern raised while any criterion is still unmet
  still seals FAILED, which is correct: there the executor has something to answer.

- **A done-marker in a `plan.md` Notes cell can break the test suite** (ℹ️ F-269,
  dogfood-124). `packages/sdk-ts/test/cli/wp-status.plan-integration.test.ts` reads
  the PRODUCTION `plan.md` and anchors on an untouched P3 WP to prove the F-81 gate
  is not inverted. Writing `✅ … LANDED` into WP-303's Notes flipped it green and
  failed the suite. **Any review that marks a WP row done — even half-done — must
  re-run `devbox run test` before committing**, and if the anchor went stale, rotate
  it to a genuinely untouched WP and record the rotation in the test comment.

- **A `gemini-cli` step meters $0.00 no matter how many tokens it burns** (🟡 F-268 →
  WP-592, dogfood-124). The executor endpoint records the model as bare `gemini`;
  `PRICE_TABLE` (`packages/sdk-ts/src/pricing.ts`) is keyed on versioned ids
  (`gemini-3.6-flash`, `gemini-3.1-pro`, …), so nothing matches and the trace prints
  `⚠ cost meter blind (unpriced tokens)`. **`budget_usd` therefore constrains the
  judge only** — do not treat a low run total as evidence the executor was cheap, and
  do not "fix" it by adding a `"gemini"` catch-all row, which would invent a price.

- **The judge's write-boundary rubric reads `git diff`, so gitignored writes are
  invisible** (🔴 F-264 → WP-589, dogfood-123). A run whose declared boundary was
  `benchmarks/publications/p3-rung-4/` wrote **2.1 GiB across 95,068 files** into
  gitignored `benchmarks/results/` and scored `scope_matches_instruction ✓`. Both
  statements were true. **Practical rule when writing a spec: never write an AC that
  reads gitignored host state from inside the workspace** — the workspace is a clone
  of HEAD, so the only way to satisfy such an AC is to import that state into the
  sandbox, burning disk against the WP-560 10 GiB launch floor and leaving it in the
  retained audit trail. Pass the evidence in as an operator-resolved input instead.

- **The `gemini-cli` adapter records `toolCalls: 0` and a message-only transcript**
  (🟡 F-265 → WP-590, dogfood-123). 162 s that rsynced 95k files, ran
  `chikory-bench compare`, and ran two test suites left **no** record of a single
  command, and the reported 2,343/1,401 tokens (which feed the pacing governor's
  projection) are implausible for that work. Do not use a `gemini-cli` step's
  `toolCalls` or token counts as evidence of what happened; read the diff.
  Its `costUsd: 0` is *correct* — subscription-linked metering, declared in the
  `capability` journal entry.

- **`TaskResult.baseVerification` is trustworthy as of WP-587 (2026-08-06) — and was
  not before.** Two eras of the same defect: 🔴 F-198 (dogfood-117) had `runSuite`
  verify an *empty* `workspaceDir`, so every task recorded the constant
  `green:false · "Unparseable suite output: could not find test summary"`; WP-540
  fixed that for `commandAdapter`. 🔴 F-258 (bench-p3-rung-4-2026-08-06) is the same
  mistake surviving in the Chikory arm, where the fallback verified the
  **post-agent** workspace instead. **Do not read `baseVerified` off any Chikory-arm
  result produced before WP-587** — including `20260803-131837-chikory` and
  `20260805-234219-chikory`. Both adapters now verify the pin themselves, pre-agent,
  through one `verifyPinnedBase`; `runSuite` no longer verifies anything and says so
  by name when an adapter reports nothing. The module itself (`base-verify.ts`) was
  correct throughout and is unchanged.
- **~~A benchmark "fix-until-green" task cannot terminally SUCCEED~~ ✅ FIXED AND
  LIVE-PROVEN (WP-533/F-159; landed `b0ec0cb`, proven 2026-07-23 by suite
  `20260723-222341` — `brownfield-001` 2/3 → 3/3, `brownfield-003` 4/4, suite 7/7 at
  $2.7075; `docs/reports/bench-brownfield-20260723-222341.md`).** `runCliStep` (`packages/sdk-ts/src/executors/step.ts`) no longer fails a
  step on a non-zero process exit alone — the adapter parser's structured `ok`
  verdict is now authoritative, so a completed turn is SUCCESS even when the agent's
  own (still-red) test command sets a non-zero exit; the judge + acceptance checks
  gate correctness. The historical failure, for context: step status was derived
  from the executor CLI's process exit code (`exitCode !== 0` ⇒ `FAILED`); on a
  "make the suite pass" task the agent ends each step by running the suite, which
  exits non-zero while any test is red → every step FAILED → the runner's
  3-consecutive-failure escalation sealed the whole run FAILED **even when the judge
  just voted PROCEED** (dogfood-110 `brownfield-001`: judge PROCEED 2/3, run FAILED).
  Read any PRE-`b0ec0cb` benchmark FAILED against the grade + the `chikory trace`
  judge verdict, not as "the agent couldn't do it."
  **Still open — related:** the grading copy-back (`3791e26`)
  skips the terminal-FAILED path (F-157 recurrence) — a FAILED task may be graded
  against a partial tree with no `node_modules` (`vitest`/`tsc` "not found" ⇒ false
  requirement failures); and a superseded launch attempt can leave orphaned Temporal
  workflows retrying `writeCheckpoint` ("no journal run row", F-158 recurrence).
- **~~No read-only `chikory chain trace <chain-id>`~~ ✅ CLOSED (WP-522, F-144,
  landed 2026-07-19 from the dogfood-105 harvest — `chikory chain trace <chain-id>`
  now renders a sealed chain from its local journal; 5 files, 941 TS green).** The
  historical gap, for context:
  A sealed chain's trace — carrying the WP-311 aggregate `review:` line AND
  the per-node design/recovery-summary sections — only renders inline during a live
  `chikory chain` launch/approve/resume follow (`chain.ts:429 finishChain`). `chikory
  trace <chain-id>` errors (`no journal … under .chikory/runs`) because chain journals
  live under `.chikory/chains/`, not `.chikory/runs/`. To inspect a finished chain
  post-hoc today, reconstruct via `scripts/read-chain-record.mjs` + `renderChainTrace`,
  or read `chain.db` directly (`sqlite3 … 'SELECT kind,payload_json FROM chain_entries'`).
  The chain-completion-review pass COST is likewise surfaced nowhere.
- **The progression gate is chain-blind** (🟡 F-145, dogfood-103 → `dogfood-progression`
  track-B). `scripts/dogfood-progression.sh`'s horizon axis counts a single run's
  `max steps`, so a multi-node chain (e.g. dogfood-103's 3 nodes) reads as "3 steps"
  and CANNOT flip ⛔ STALLED even when it moved the chain-horizon axis the review
  credited. When a headline is a `mode=chain` run, read the STALLED verdict with that
  caveat and record the real axis moved in the report (the gate permits "climb the rung
  OR record why not").
- **`CHIKORY_LIMIT_AT_STEP` now EXECUTES the scheduler's decision** (F-136 FIXED,
  dogfood-099 `run-03cd4c21`, WP-308 complete): when the seam fires, `executeStep`
  (`src/runner/activities.ts`) classifies the injected signal, consults
  `decideLimitResponse`, then calls net-new `applyLimitResponse`
  (`src/executors/limit-response.ts`) which ACTS — declared-failover re-dispatches
  the throttled stage via existing routing (real adapter call, real record),
  limit-independent-work runs real conserving work then defers (not skips) the
  throttled item, park honors `retryAfterMs`/`retryAtMs` via a workflow-side durable
  timer (`decideLimitParkDelay`). The old fabricated `claimsComplete:true` record is
  gone. `conserved`/`slept` totals derive from executed actions; a no-signal run is
  byte-identical. The seam is now safe to use in a run whose plan items matter — the
  throttled item is deferred and completed, not silently skipped.
- **The durable-PARK branch of the limit seam — ✅ CLOSED (was ℹ️ F-137, dogfood-099;
  resolved dogfood-100).** dogfood-100 landed a real end-to-end forced-park proof
  (`agent-loop.test.ts:345`): a real `runner.start`→`awaitTerminal` run where step-4's
  429 carries NO `retry-after`, so the park lasts the LEARNED 1000ms (median of steps
  1/3 observed resets), then resumes and completes the throttled item. No longer a
  mocked/`maxSteps` proof.
- **The cross-run learned-capacity seam is now WIRED — WP-309 ✅ DONE (test-complete)**
  (🔴 F-138 CLOSED, dogfood-102 `run-cd98de3e`): the real (non-injected) limit path
  calls net-new `appendEndpointLimitObservations` (`activities.ts`, inside
  `if (observation !== undefined)`) → per declared window persists the learned capacity
  to `<dataDir>/ledger/endpoints.db`; a fresh `EndpointLedger` reads it as
  `windowState().capacityTokens` and `decideLimitPacing` throttles against it (F-97
  co-reference test). Injected seam provably writes nothing (byte-identical held).
  **⚠️ Not live-proven across two real runs** (ℹ️ F-142): the KPI (a real hit in run A
  paces run B) is proven only by deterministic test, because there is NO deterministic
  seam to force a NON-INJECTED limit hit in a live run — the only seam
  (`CHIKORY_LIMIT_AT_STEP`) is `source:"injected"`, which by design never writes the
  ledger (keeps no-op runs byte-identical). A LIVE cross-run/chain proof needs a
  test-only non-injected real-shaped-hit seam gated behind an explicit flag — owed if
  such a proof is ever headlined. The original F-138 authoring lesson stands: before
  writing a dogfood spec for a WP, diff that WP's plan.md row for amendments landed
  since the last run — the ACs must cover the CURRENT scope.
- **`judge.cadence` is INERT on a chunked spec** (dogfood-096 observation, by design
  JD-2): every step that consumes a `work_chunks` entry is a judge milestone
  (`workChunkMilestone`, `src/workflow/agent-loop.ts:633`), so a `min_durable_steps`
  run is judged 1/1 regardless of `cadence`. Do not size judge cost by `cadence` on a
  chunked spec — 096 ran 11/11 judge passes at `cadence: 2` (harmless: 0.7% share).
- **OTel run-root span identity is forced via a private-field mutation** (F-117,
  dogfood-090, track-B under WP-105): `applyDerivedRunRootIdentity` (`src/otel.ts`)
  reassigns the SDK-internal `span._spanContext` (and clears `parentSpanContext`) so
  the emitted `chikory.run` root's spanId equals `resolveRunRootContext(runId)` — the
  OTel **API** has no way to set a span's own spanId. It is guarded by a structural
  typeguard, so an `@opentelemetry/sdk-trace-base` upgrade that reshapes `_spanContext`
  fails **silently**: the guard skips the mutation, the root reverts to a random spanId,
  and children re-orphan (the F-116 symptom, no Map to blame). Clean cure = a per-run
  seeded custom `IdGenerator` or a wrapped-`SpanContext`-only root. Don't rely on the
  root spanId being stable across an OTel SDK bump.
- **The `chikory.run` root span no longer measures run wall-clock lifetime** (F-118,
  dogfood-090, track-B under WP-105): to survive a durable park on a fresh worker,
  `recordRunStartSpan`/`recordRunEndSpan` each emit a zero-duration span with
  `lifecycle:"start"`/`"end"` sharing the SAME derived traceId AND spanId (two spans,
  one spanId — technically non-conformant OTel; some backends may dedup/mis-render).
  Run duration is NOT on the root anymore — recover it by diffing the two spans'
  timestamps, or read the journal. Inherent to the durable design (you can't hold one
  live `Span` object across a cross-worker park).
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
- **✅ The judge is now CHUNK-AWARE and ESCALATE is UNATTENDED-SAFE** (F-107 →
  WP-271 CLOSED, dogfood-086 `run-88235198`; history: dogfood-085 `run-17b5ef57`).
  **What was broken:** the judge received the FULL `spec.goal`, never the active
  `work_chunk` directive — at step 2 of a 5-chunk run (all 4 ACs + 4 rubric items
  PASSING) it raised an out-of-rubric "PART 4 was omitted" concern and ESCALATEd,
  even though PART 4 was deferred BY DESIGN to chunk 4; ESCALATE then blocked on an
  untimed `await condition(...)` (`agent-loop.ts:580`), parking the run until a
  human ran `chikory approve`. **What WP-271 fixed:** the loop now passes the active
  chunk directive into the judge prompt via `renderActiveWorkChunkScope` (a
  `## ACTIVE WORK CHUNK` section telling the judge deferred later parts are NOT
  omissions), so an on-track intermediate chunked step is adjudicated against the
  CURRENT chunk; and `decideEscalationWait` + an opt-in
  `unattended:{escalation:"seal_resumable_failed"}` policy make an ESCALATE seal a
  resumable terminal instead of hanging forever (default = the old approval wait,
  byte-identical). **You may now launch a `work_chunks` run unattended (the ⑦
  overnight rung) IF you set `unattended:{escalation:"seal_resumable_failed"}`** —
  without it, a genuine escalate still parks on an untimed approval wait and hangs.
  ⚠️ **F-110 gotcha for the overnight rung:** the unattended escalate seals
  `status = FAILED`, indistinguishable from a genuine failure EXCEPT by the
  `failure.reason` prefix `unattended {judge|runner} escalation — …`. When you wake
  to a FAILED overnight run, grep the reason for that prefix to tell a policy-park
  (resume-and-approve) from a real defect (investigate). Note F-107 is
  NON-DETERMINISTIC (086 drew 0 spurious escalates on the same pre-fix judge that
  escalated in 085), so an unset unattended policy can get lucky — don't rely on it.
  Residual (F-108, still open): a non-PROCEED chunk verdict leaves
  `consumedWorkChunks` un-incremented and it is NOT restored on resume, so a resumed
  chunked run replays from chunk 0.
- **⚠️ `consumedWorkChunks` is NOT restored on crash→resume** (🟡 F-108, latent,
  WP-206×WP-270): the counter is a loop-local `let = 0` (`agent-loop.ts:146`)
  that the resume-restore block (`:240-253`) does not rehydrate, so a
  `chikory resume` of a `work_chunks` run replays from chunk 0 — already-done
  early chunks produce empty diffs until the executor catches up (self-corrected
  by the AC gate, but wasteful). Not exercised yet (0 resumes); avoid resuming a
  chunked run until fixed.
- **⚠️ Parallel test execution causes memory exhaustion and crashes** (🟡 F-109, track-B):
  running full test suites concurrently via `pnpm -r test` or `vitest run` spawns 
  multiple worker processes/threads, each launching Temporal dev servers and child 
  agent processes. This parallel process tree consumes all system memory and crashes.
  Fix: restrict worker pool and disable file parallelism in `vitest.config.ts`.

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


- **A durability floor that counts TESTS does not raise COVERAGE, and an AC
  armed in both directions is still only as good as the input families it
  names (🟡 F-360, dogfood-144).** dogfood-144's AC-1 owned its oracle, drove
  both real entry points, carried four traps, and was proven RED-on-HEAD and
  GREEN against a reference implementation — and it graded exactly one of the
  three mutation families (create / modify / delete) on the object its goal
  bullet said must survive "byte for byte". The delivery shipped blind in the
  other two, and the LLM judge — not the deterministic check — caught it.
  Worse, the F-356 durability floor (`test -n "$(grep -rl <token> test/…)"`)
  is satisfiable by TRANSCRIPTION: the landed
  `packages/sdk-ts/test/judge/check-isolation.test.ts:151` is a near-verbatim
  copy of AC-1's generated test, so the repo test inherited AC-1's exact blind
  spot. Suite went +5 tests and **zero** input families. **Two rules for the
  next spec you arm:** (1) before writing the `check`, enumerate the mutation
  or input families the goal's own wording implies and put a row for each in
  the AC, plus a negative; (2) make the durability AC demand coverage the
  grading check does NOT have, so copy-paste cannot satisfy it.

- **A diff-scoped judge cannot see an UNCHANGED file, so it can never ask "are
  these all the readers?" (🔴 F-376, dogfood-151).** WP-626 added one optional
  field and had to make four readers branch on it. The delivery fixed three and
  the executor-level OTel span; the judge escalated — correctly — that the span
  it DID fix carried no repo test (F-377), and never noticed that
  `recordRunStepSpan` (`packages/sdk-ts/src/otel.ts:238`), the
  `chikory.run.step` span every durable step emits from four call sites in
  `runner/activities.ts`, still published `tool.calls: 0` as a measurement.
  It could not: that file is absent from the diff, and the judge reasons over
  the diff it is shown plus the tests the executor wrote. **The spec had the
  same blind spot** — its measured premise named `src/executors/step.ts:82` as
  "the span", and AC-3's grep-set asserted the new field appears in
  `src/cli/trace.ts` and `src/executors/step.ts` and never looked at
  `src/otel.ts`. **Rule for the next spec you write:** before listing reader
  sites in the goal or in an AC, run the grep — `grep -rn <symbol> src` — and
  put every hit in the enumeration or say in writing why it is out of scope.
  The contract-mirror discipline (types + CONTRACTS.md + zod + component doc)
  already exists for the WRITE side; this is the same rule for the READ side.

- **An AC must drive the measured MAGNITUDE of its inputs, not a plausible-looking
  literal (🔴 F-384, dogfood-153).** WP-599 made blocking judge concerns ride into
  the executor's next-step feedback beside the failing-criterion evidence. The
  delivery built both sections, joined them, and clamped the concatenation to
  `REMEDIATION_BRIEF_MAX_CHARS` (2,000, `packages/sdk-ts/src/workflow/remediation.ts:21`)
  — and `clampBrief` truncates from the tail, so the concerns section is what
  disappears. That is not a corner case: a judge's failing-criterion
  justification quotes the check it ran, and the three this very run produced
  measured **6,532 / 3,757 / 2,851 bytes**. One failing criterion overruns the
  entire budget, so the feature's payload was dropped silently and always in
  exactly the combined case the goal names. **AC-1 had the right assertion** —
  "failing-criterion evidence is still carried, not replaced" — with a
  24-character justification, and the run's own clamp test asserted only
  `length <= REMEDIATION_BRIEF_MAX_CHARS`, which passes either way. **Rule:** when
  an AC exercises anything bounded — a char budget, a token window, a retention
  cap — take the input's real size from telemetry you already have (here:
  `sqlite3 .chikory/runs/<run-id>/journal.db "select payload_json from
  journal_entries where kind='verdict'"`, then read `criterionResults[].justification.length`)
  and write THAT magnitude into the check. This is the F-187/F-196/F-198 rule
  (drive every input family) extended to a dimension none of them named: input size.

- **A structurally correct diff can still be wrong for a reason the diff does not
  contain (🟡 F-384, dogfood-153).** The judge passed 6 rubric rows twice and
  3/3 criteria over a delivery that used the right policy, the right seam, and
  rejected all four designed traps — and could not work. The fact that condemned
  it (payload 6,532 bytes vs channel 2,000) lived in the judge's OWN previous
  output, not in the change under review. When a WP writes into a bounded
  channel, put the channel's bound and the payload's measured size in the goal,
  so both are inside the evidence the judge reasons over.

- **A fix that says "keep the tail" must own every clamp the value passes
  through (🔴 F-388, dogfood-154).** WP-635 made `applyCheckOverrides` preserve a
  failing check's output TAIL — the assertion and the author's `AC-n FAIL: …`
  sentence — and marked the cut (`packages/sdk-ts/src/judge/harness.ts:137`).
  One seam later `clampBrief` (`packages/sdk-ts/src/workflow/remediation.ts:46`)
  clamped the same string from the HEAD, so at any check output **≥1,890 bytes**
  the executor received build-banner noise and none of the diagnosis. A fully
  GREEN `pnpm --filter @chikory/sdk exec vitest run` prints **17,403 bytes**, so
  this was the common case, not a corner. Two clamps disagreeing about which end
  is the signal is silent and total data loss. Before landing a keep-the-tail
  fix, grep every other bound the value crosses — `clampBrief`, `clampSections`,
  `bound`, the prompt builders — and make them agree, or state in the goal which
  end wins where. Fixed by `clampSectionKeepingTail`
  (`packages/sdk-ts/src/workflow/remediation.ts:166`): section header verbatim,
  body tail-clamped behind the same `… [head truncated]` marker
  `packages/sdk-ts/src/judge/prompt.ts:87` already uses.

- **An AC that owns its oracle at ONE boundary proves nothing about the NEXT
  one (🔴 F-388, dogfood-154).** dogfood-154's AC-1 drove the real
  `applyCheckOverrides` at the real measured magnitudes and was right about
  everything it asserted — it simply stopped at the harness and never crossed
  into `buildCriterionFeedback`, where the value was destroyed. F-384 taught
  "drive the input's measured magnitude"; F-388 is the same lesson one seam
  later: **drive it at every seam it crosses.** When a WP's value is "the
  executor is told X", the AC must assert X arrives at the executor, not that it
  is correct at the point of manufacture.

- **A check's output is head-bounded at collection, so a very loud check loses
  its tail before anything can preserve it (🟡 F-389, dogfood-154).** `runCheck`
  stores `bound(output, 64 * 1024)`
  (`packages/sdk-ts/src/judge/evidence.ts:205`) and `bound`
  (`packages/sdk-ts/src/judge/evidence.ts:109`) slices from the front. Above
  64 KiB the assertion and the author's sentence are gone before F-388's fix can
  act. Reach is limited — a green full-suite run is 17,403 bytes, so this needs
  roughly 20+ failing test blocks — but if you are writing a check that runs a
  broad suite, pipe it through `tail -N` rather than relying on the bound.

- **A budget makes the ORDER of your inputs the untested variable (🔴 F-404,
  dogfood-159).** When a delivery introduces a preservation, spend or retention
  budget, a fixture that puts every input in one flat directory cannot see which
  inputs WIN that budget. dogfood-159's isolation fix allocated 32 MiB in
  `git ls-files` lexical order; on a real 17,372-path judge workspace
  `node_modules/.pnpm` took **9,459 of 9,467** preserved paths and every
  project-owned artifact got none, so the feature did not fire where it mattered.
  Both ACs passed. If the delivery under test carries a budget, one AC must build
  a fixture where two classes of input COMPETE for it, and assert the one you
  care about wins.

- **Two hashes of different kinds are not comparable, and a budget line moves
  (🟡 F-406, dogfood-159).** If your snapshot records a content hash for cheap
  inputs and a metadata fingerprint for expensive ones, any change in the cheap
  set re-partitions the boundary — and an untouched input reads as changed
  because it swapped hash KINDS between snapshots. Record the metadata
  fingerprint for BOTH classes and compare like with like
  (`packages/sdk-ts/src/judge/hermeticity.ts:210`).

- **A run can seal FAILED with most of its budget and steps unspent (🟡 F-408,
  dogfood-159).** The completion-review repair grant is one per run
  (`packages/sdk-ts/src/workflow/agent-loop.ts:1348`), not one per unit of
  headroom. If a second, DIFFERENT design finding lands, the run seals FAILED
  (resumable) even at step 2 of 6 with 98% of budget left, and then waits for a
  human. Recover it with `chikory run resume <run-id>` — the reopen restores the
  last checkpoint and carries the seal's own diagnosis into the next step, so no
  work is lost. Do NOT relaunch. Until WP-640 lands, check on a converged run
  rather than assuming an unattended seal means the run is finished.

- **An acceptance-criterion `check` is a shell script, and it must stay one
  (🔴 F-410, dogfood-159).** `runCheck` runs `/bin/sh -c` with the body
  (`packages/sdk-ts/src/judge/evidence.ts:203`). An outside PR briefly replaced
  that with tokenize-and-exec-the-first-word; every multi-line check then became
  arguments to its own first word and **exited 0 without running** — a vacuous
  PASS on every criterion. If you ever see a check pass while its side effect
  provably did not happen, check this line first. Note the asymmetry that hid it:
  `dogfood-arm.sh` runs check bodies through bash, the judge runs them through
  `runCheck`, so a fully green arming pass proves nothing about the judge path
  until WP-642 lands.

- **`chikory trace` does not show that a run resumed (🟡 F-409, dogfood-159).**
  A `failed_seal` reopen is journaled but not rendered: the header of a resumed
  run reads a flat `SUCCESS · N steps`. To see it, read the journal directly —
  `sqlite3 .chikory/runs/<run-id>/journal.db "select idx, kind, ts from
  journal_entries order by idx"` — and look for a `terminal` entry followed by a
  `control_event`. The gap between their timestamps is the human-latency stall.

- **🟡 One test in the SDK suite is flaky (F-420, dogfood-161).** Measured at the
  same tree, four consecutive runs of `pnpm --filter @chikory/sdk exec vitest run`:
  one red (`1 failed | 1778 passed | 23 skipped`) then three green
  (`1779 passed | 23 skipped`), same 1,802-test total — so it is one flaky test,
  not a missing file. The name was lost to F-419 (now fixed, so the next
  occurrence names itself). The red observation is the only one that ran directly
  after two live-Temporal acceptance checks, which points at a timing-sensitive
  live test under load. **Do not treat a single red suite run as authoritative
  when the failure count is 1** — re-run it before spending a review on it, and
  read `.chikory/review/ac-<run-id>-<AC>.log` for the name.

- **🟡 An executor will background a long suite and then burn the whole step cap
  waiting for it (F-421, dogfood-161; F-345 recurrence).** dogfood-161's goal
  said, in as many words, *"Do NOT run the full vitest suite inside a step — it
  does not fit the step time cap"*. Step 3's summary opens *"I have initiated the
  live Temporal runner test suite ... in the background and am waiting for the
  results"*; step 4 then recorded 10k input tokens, **0 output tokens**, and
  `step killed: exceeded maxSeconds` after **10m 0s** — 21% of the run's wall
  clock, and a repair grant, spent on nothing. A prohibition in the goal text is
  not a control. Assume any spec whose regression suite takes minutes will lose
  one step this way, and size `max_steps` accordingly.
