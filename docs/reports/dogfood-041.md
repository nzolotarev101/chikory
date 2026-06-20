# Dogfood-041 — WP-219 S3 "first chain dogfood": across 5 attempts, the chain finally RAN end-to-end (attempt 5) — durable 2-node chain, plan gate PROCEED, per-node judge gating, and the judge HALTing a bad node all worked; it FAILED only on the deferred S4 context handoff (F-37). (Attempts 1–4 closed F-32/F-35/F-36; F-34 fixed.)

> ℹ️ **This report spans 5 attempts; the addenda below tell the story in order.**
> Attempt 1 shipped the deliverable as a single `run` (F-32). Attempt 2 engaged
> the chain but died on a transient proxy fault (F-33/F-34). Attempt 3 got both
> LLM calls through but hit a meta-judge schema bug (F-35, fixed). Attempt 4
> passed the schema but tripped the coverage-floor id trap (F-36, fixed).
> **Attempt 5 (the headline win): the chain executed end-to-end** — plan gate
> PROCEED → node 1 SUCCESS → node 2 HALT → chain FAILED — proving the durable
> multi-run machinery and exposing the one deferred gap that actually blocks a
> green chain: **S4 context handoff (F-37)**.

**WP**: WP-219 (Goal decomposition & run chaining, ADR-005 §S3) · **Date**: 2026-06-20 · **Task spec**: [`examples/dogfood/dogfood-041.yaml`](../../examples/dogfood/dogfood-041.yaml) · **Run**: `run-a28655c9-3e5e-456a-bd90-becfdeddff2a` · **Outcome**: **SUCCESS** (judge PROCEED 3/3) — *as a single run* · **Landed**: harvested byte-`IDENTICAL`, staged + uncommitted on the working tree (pending the user's review)

> ⚠️ **The deliverable shipped; the dogfood's purpose did not.** dogfood-041 was
> written and queued as **THE FIRST CHAIN DOGFOOD** — the deliberate break from
> the 39-run pure-leaf streak, meant to launch with the new `chikory chain` verb
> so a goal *decomposes into a multi-node Plan*, gets *gated by the
> different-family plan meta-judge*, and *each node runs as its own judge-gated
> child run* through the durable `chainLoop` Temporal workflow. **None of that
> happened.** The run is a plain single `run-…` journal: **1 step**, executor
> codex drove the *entire* goal directly, no `.chikory/chains/` directory exists,
> and no `…-node-…` child runs were created. The step's `plan item` is the goal
> string **verbatim** — there was no planner, no plan meta-judge, no fold. It was
> launched with `chikory run`, not `chikory chain`. The thesis pillar this run
> existed to test (durable multi-run execution + compounding error + a real judge
> surface across dependent nodes) is **still unproven** — for the 40th straight
> time. This is **F-32**, and it is the headline of this report. The good news is
> narrow and real: the *feature* the goal asked for — the `chikory trace <chain-id>`
> CLI branch — was implemented correctly and lands clean. So the chain forensics
> *surface* now exists; it was simply built by a non-chain run, which means the
> chain machinery it serves is **still** unexercised end-to-end.

## The run

Zero-secrets setup as usual: Codex executor (OpenAI family) + Gemini judge behind
the OpenAI-compatible shim. Family diversity held (executor `openai`, judge
`gemini-3.1-pro-preview`). But note what the trace header shows — `1 steps`, a
`run-` id, `executor codex`:

```text
run run-a28655c9-3e5e-456a-bd90-becfdeddff2a · SUCCESS · 1 steps · $1.07 / $15.00 · 3m 48s · executor codex(openai) · judge openai-compat
 1   Implemented the trace CLI chain bra…  791k/6.9k  $1.06  ✓ PROCEED (3/3 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 0.7%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
        issues found 0 · changes made 1 (issues:changes 0:1)
        components over time: s0 j@0
```

A chain run would have produced a `ChainJournal` under `.chikory/chains/<chain-id>`
plus one `run-<chain-id>-node-<id>` journal per node, and `chikory trace` would
have shown a `chain … · N nodes` header. Instead this is the F-11-closed
single-run shape (`components over time: s0 j@0`) — the **seventeenth** straight
one-step run. **That streak count is itself the F-32 symptom**: the run that was
specifically designed to be the first *multi-step, multi-run* campaign greened as
yet another one-step run, because it was never launched as a chain. The streak
KPI rewarded exactly the triviality dogfood-041 set out to escape (the
dogfood-039 review already flagged retiring that KPI).

### Evidence that no chain ran

| Check | Expected for a chain | Observed | 
|---|---|---|
| Run id shape | `chain-…` + per-node `run-…-node-…` | plain `run-a28655c9…`, single 🔴 |
| `.chikory/chains/` | `ChainJournal` directory present | **does not exist** 🔴 |
| Node child runs | ≥2 `…-node-…` journals | **none** 🔴 |
| Step count | one step *per node* across runs | **1 step total** 🔴 |
| Step `plan item` | a single decomposed node goal | the **full goal verbatim** 🔴 |
| Planner / plan meta-judge | a `plan` + meta-judge verdict | **absent** (only the per-step executor judge) 🔴 |

## Delivery quality (human review, post-landing)

Setting the launch-method failure aside, the *code that landed* is correct and
in-scope. The diff is the staged working tree (`git diff --cached`), byte-`IDENTICAL`
to the run workspace (phase-0 §5), 2 files, +138/−6:

- **`packages/sdk-ts/src/cli/commands.ts`** (`cmdTrace`, +25 net) — reviewed line
  by line against the spec's goal:
  - When `journalPath(args.dataDir, args.runId)` does **not** exist, it now checks
    `chainJournalPath(args.dataDir, args.runId)`; if that is also absent it errors
    with the updated message `no journal for run or chain '<id>'` and returns 1.
  - If the chain journal exists, it opens `new ChainJournal(chainPath)`, builds the
    record via `chainRecordFrom(chainJournal)`, and on a non-null record prints
    `renderChainTrace(record, chainJournal.entries())` and returns 0 — **reusing
    the existing pure renderer** (dogfood-037), not reimplementing it. A null
    record errors `chain journal … has no chain row`. The `ChainJournal` is closed
    in a `finally`.
  - Run-journal precedence is preserved exactly: the run-journal branch is checked
    first and is unchanged, with an inline comment documenting the precedence on
    an id collision — `// A run journal is the historical 'trace <id>' target;
    keep it authoritative if an id collision ever leaves both run and chain
    journals on disk.` This satisfies the goal's "prefer the run-journal path when
    both somehow exist" instruction.
  - Imports added: `ChainJournal, chainRecordFrom` from `../chain/store.js`,
    `renderChainTrace` from `../chain/trace.js`, and `chainJournalPath` added to
    the existing `../runner/paths.js` import. Named imports only, ESM, no default.
- **`packages/sdk-ts/test/cli/trace.test.ts`** (+113) — adds a
  `describe("cmdTrace journal resolution")` with two cases over real temp data
  dirs (`mkdtempSync`/`rmSync`), driving the actual `cmdTrace` with captured
  `out`/`err`:
  1. *renders a chain trace when the id resolves to a chain journal* — builds a
     2-node `ChainJournal` (`N-1`→`N-2`, N-1 sealed SUCCESS/PROCEED), asserts the
     output contains `chain plan-cli-trace · SUCCESS · 2 nodes · 1/2 succeeded`,
     the per-node rows (`N-1 · … ✓ SUCCESS (PROCEED)`, `N-2 · … pending`), and
     does **not** contain a per-run `run … ·` header.
  2. *keeps the run trace authoritative when both journals exist* — creates both a
     run journal and a chain journal under the same id `same-id`, asserts the
     per-run trace renders (`run same-id · SUCCESS · 1 steps`, `run journal wins`)
     and the chain header does not — directly verifying the precedence comment.

`types.ts` / `schemas.ts` / the chain executor / the pure `renderChainTrace` /
any contract model were **not** touched (phase-0 §4 scope: only the two named
files, both `M`). No new dependency.

Independent checks from the phase-0 verifier, re-run against the working tree —
all green:

```text
AC-1  cd packages/sdk-ts && pnpm exec tsc --noEmit                          PASS (exit 0)
AC-2  cd packages/sdk-ts && pnpm exec vitest run test/cli/trace.test.ts     PASS (20 passed)
AC-3  cd packages/sdk-ts && pnpm exec eslint .                              PASS (exit 0)
```

The trace test file grew to 20 cases (the executor's own summary reported the
full SDK suite at 50 files / 371 pass / 19 skip). Harvest integrity held — both
changed files byte-`IDENTICAL` to the run workspace. The diff is staged and
uncommitted, left for the user's review per the skill default.

## New friction

### 🔴 F-32 — a chain-intended dogfood was launched with `chikory run` and passed as a single-run SUCCESS, with nothing flagging the mismatch

**Evidence.** dogfood-041.yaml is explicitly and repeatedly documented as a chain
dogfood ("THE FIRST CHAIN DOGFOOD", "launched with the NEW `chikory chain`
command", "the goal below is DECOMPOSED into a multi-node Plan"). The actual run
`run-a28655c9` is a single per-run journal: 1 step, plain `run-` id, no
`.chikory/chains/` directory, no `…-node-…` child runs, the step `plan item` ==
the goal verbatim (no decomposition), and only the per-step executor judge fired
(no planner, no plan meta-judge). The launcher used `chikory run <spec>` where the
spec was meant for `chikory chain <spec>`. The task-spec file format is
**identical** for `run` and `chain`, so nothing — not the CLI, not
`dogfood-verify.sh`, not the judge — detected that a chain-intended spec ran down
the single-run path. The run sealed a clean SUCCESS at full one-step cost and the
F-11 streak ticked up, perfectly camouflaging the miss.

**Why it matters.** This is the standing failure mode of the loop (DOGFOODING
§1.1 / the dogfood-review phase-5 warning) reasserting itself one layer lower:
even after the `chikory chain` launch path was hand-built *this session*
specifically to break the pure-leaf streak, the actual launch reverted to `run`,
greening the dashboard while testing none of the thesis. The chain executor
(`chainLoop`, the planner→plan-meta-judge gate, `advanceChain` fold, halt-on-FAILED)
has **never** run against a real goal. Until it does, WP-219's durable-multi-run
claim is unvalidated.

**WP it spawns → WP-232** (chain-launch verification): the review/launch tooling
must make a `run`-instead-of-`chain` launch impossible to mistake for a passed
chain run. Minimum bar: `dogfood-verify.sh` detects when a spec named/annotated
as a chain dogfood produced only a single run journal (no `ChainJournal` under
`.chikory/chains/<id>`) and flags **"chain path NOT exercised — launched as
`run`?"** rather than printing a clean green. Stronger option: a spec-level
`mode: chain` (or a `nodes:`-implying marker) that `chikory run` refuses, telling
the user to use `chikory chain`. Sits in the same family as WP-228
(baseline-precheck) and WP-231 (landing-scope audit) — mechanical guards that
stop a misleading green.

**Consequence for dogfood-041 itself.** The *delivery* (the trace-CLI branch) is
done and correct, but the *headline purpose* (first real chain execution) is
**unmet**. dogfood-041 is **not** complete as a chain dogfood. See "Ready the
next run" for the two recovery paths (re-run as a chain vs. promote this delivery
to track-B and pick a fresh chain goal).

### Other anomaly checks

- **Wasted steps**: none *within* the single run — one productive step, no
  trailing probe (F-11 stays closed). The waste is at a higher level: the entire
  chain apparatus was bypassed.
- **Cost telemetry**: exact sum **$1.0659** (step $1.0579 + judge $0.0080);
  budget used **7.1 %** of $15.00; judge share **0.7 %**. Metering nonzero and
  consistent; no `.00`-with-tokens bug, no `UNPRICED` warning. ℹ️ **The $15
  budget was sized for a multi-node chain (Σ node budgets) but a single run
  consumed only 7.1 % of it** — the budget gate was effectively inert here, a
  second-order symptom of the chain not running.
- **Token economics**: step 1 used **791k input / 6.9k output** over **32 tool
  calls** for a 7694-byte 2-file diff. High band — the one-step series now reads
  021 862k → 022 969k → 023 451k → 024 976k → 025 467k → 026 807k → 027 527k →
  028 410k → 029 462k → 030 434k → 031 375k → 033 327k → 034 594k → 035 318k →
  036 398k → 037 793k → 038 625k → 039 755k → **041 791k** (032 excluded — 2-step;
  040 not run). Still noisy, not monotonic. The 32 tool calls (vs ~28 for the
  comparable dogfood-037 renderer slice) reflect the executor reading the chain
  store + reference renderer to wire the branch. WP-203/WP-207 stay the input-side
  lever.
- **Judge behavior**: the per-step executor judge executed all three check
  commands (`tsc --noEmit`, `vitest run test/cli/trace.test.ts`, `eslint .`),
  each exited 0, PROCEED 3/3. Rubric (`tests_pass`, `no_unrelated_deletions`,
  `no_secrets_introduced`, `scope_matches_instruction`) all passed with sane
  justifications ("changes only the CLI trace implementation and its corresponding
  tests"). 9383 evidence bytes, 13 s, family diversity real (Gemini ≠ codex). ℹ️
  **No plan meta-judge ran** — the different-family plan-gating judge that is half
  the thesis was never invoked, because there was no plan to gate.
- **Human ceremony**: the launch itself is the F-32 finding — the human ran
  `chikory run` instead of `chikory chain`. No zero-step residue this run.
- **Loop integrity**: one checkpoint (`run-a28655c9@3`, commit `a3f86b0ae6cc`,
  `lastGood true`), no rollback, no resume, no duplicate journal entries.

## Verdict on the thesis

- 🟡 **The chain forensics surface now exists — built by a non-chain run.**
  `chikory trace <chain-id>` correctly loads a `ChainJournal` and renders it via
  the pure `renderChainTrace` (dogfood-037), with run-journal precedence on id
  collision. This is a real, clean deliverable and the last pure/CLI piece the
  chain executor needed to be legible. Irony noted: the tool to *read* a chain was
  shipped without ever *running* a chain.
- 🔴 **The thesis pillar is still unproven (F-32).** Durable multi-run execution,
  compounding error across dependent nodes, and a plan meta-judge catching a bad
  node before its dependents run — none of it was exercised. After 40 campaigns,
  Chikory's central claim has zero end-to-end dogfood evidence. The `chikory chain`
  launch path exists and is unit-tested, but has never driven a real goal.
- 🟢 **The F-11 single-run fix remains stable** — but its "Nth straight one-step"
  KPI is now actively harmful: it camouflaged F-32. The dogfood-039 recommendation
  to retire that KPI is reaffirmed and upgraded to urgent.
- **Process finding → WP-232.** A `run`/`chain` launch mismatch must be mechanically
  visible. Until then, every "chain dogfood" is one fat-fingered verb away from
  silently regressing to a single run. The next run **must** be an actual chain.

---

## Addendum — Attempt 2 (2026-06-20): the chain path finally engaged, then died at the gate

Per the Path-A recovery, the single-run delivery was reverted (`git restore`) and
the docs landed (`a6880f3`), then the SAME spec was re-launched — this time the
`chikory chain` verb actually ran (`dogfood.sh:115` auto-detects `chain` by
grepping the spec for the string "chikory chain"). **This is real progress past
F-32: the chain executor was finally invoked.** It then failed:

```text
$ chikory chain examples/dogfood/dogfood-041.yaml --watch
chikory: plan meta-judge gate stopped the chain: plan meta-judge LLM call failed
after 5 attempts: transport error: fetch failed
[ELIFECYCLE] Command failed with exit code 1.
```

### What actually happened (sequence)

1. ✅ **Spec parsed** and `chikory chain` entered `cmdChain` (`src/cli/chain.ts:215`).
2. ✅ **The planner LLM call SUCCEEDED** — `runPlannerPass` (the `plan`-stage call
   through the shim) returned a valid multi-node `Plan`. We know it succeeded
   because the failure message is the *meta-judge* phase, not "goal decomposition
   stopped the chain" (chain.ts:253). **This is the first time a real goal was
   decomposed into a Plan by the chain launcher.**
3. 🔴 **The plan meta-judge LLM call FAILED transport** — `runPlanJudgePass` (the
   `judge`-stage call) hit a retriable `transport error: fetch failed`; the router
   retried **5×** (`router.ts:41` `DEFAULT_RETRY.maxAttempts = 5`, exp backoff),
   all 5 failed. The harness (`meta-judge-harness.ts:80`) folds a router failure
   into an **ESCALATE `PlanVerdict` as a value** (invariant #4 — never throw,
   `costUsd: 0`).
4. 🔴 **`cmdChain` fail-closed** — `gate.verdict.kind !== "PROCEED"` → "plan
   meta-judge gate stopped the chain" (chain.ts:252-258), exit 1. *(Fail-closing
   is correct — ADR-005 D2: never run nodes ungated.)*
5. 🔴 **Zero durable state persisted.** All of the above runs **host-side, before
   `startChain`** (chain.ts:239-259 → `hostChainAndFollow` only on PROCEED). No
   `ChainJournal` was created (`.chikory/chains/` does not exist), no run journal,
   no new `.chikory/runs/` entry. The decomposed Plan from step 2 was computed and
   **thrown away**. There is nothing to resume, nothing to inspect.

Setup note: `dogfood.sh` printed `Proxy port 8787 is already in use. Assuming
proxy is already running.` — it did **not** start or health-check the proxy. The
planner call got a reply but the meta-judge call got `fetch failed`, consistent
with a stale/unhealthy listener on :8787 (or a flaky shim backend) — see F-34.

### New friction

#### 🔴 F-33 — host-side decompose+gate is non-durable: a transient meta-judge transport error is fatal, unrecoverable, and indistinguishable from a substantive plan rejection

**Evidence.** Attempt 2 above: a `transport error: fetch failed` (a transient
*infrastructure* failure to reach the shim) on the meta-judge call, after 5
router retries, aborted the entire chain launch with exit 1 and **zero persisted
state** — no `ChainJournal`, no record of the successfully-decomposed Plan. By
ADR-005's deliberate design (chain.ts:17-20) decomposition + gating run in the
host process so the workflow body stays deterministic; the cost is that the
*planning layer itself is not durable*. Two distinct problems compound:
1. **No durability/resume at the planning layer.** Chikory's entire thesis is
   durable execution that survives transient failures — yet the first two LLM
   calls of every chain (decompose, gate) are outside the durable substrate. A
   network blip here = total loss + manual full re-run. The expensive,
   successful planner output (step 2) is discarded.
2. **Transport failure conflated with a substantive verdict.** The meta-judge
   harness turns *both* "the plan is bad / needs a human" (a true ESCALATE) and
   "I couldn't reach the judge" (an infra error) into the same ESCALATE-and-stop
   path. The user message says "plan meta-judge gate stopped the chain" — which
   reads like the plan was rejected, when in fact the judge was simply
   unreachable. These need different handling: a transport error should be a
   retryable/resumable infra fault ("re-run, the judge was down"), not a plan
   verdict.

**WP it spawns → WP-233.** Make the chain planning layer survive transient
faults: (a) classify router transport/infra failures distinctly from substantive
non-PROCEED verdicts in `planAndGateChain`, surfacing "infra error — safe to
re-run" instead of a verdict-shaped stop; and (b) persist the decomposed Plan +
gate attempt before/around the gate (a pre-chain record, or run decompose+gate in
a short-lived durable activity) so a transient gate failure is resumable and the
successful plan is not thrown away. Until then, a flaky shim makes the chain
un-launchable with no diagnostic trail.

#### 🟡 F-34 — `dogfood.sh` assumes any in-use :8787 is a healthy judge proxy, with no health check

**Evidence.** `dogfood.sh:79-84`: if port 8787 is in use the script prints
"Assuming proxy is already running" and skips startup — it never probes that the
listener is actually the `cli-judge-proxy` and actually serves. A stale/dead
process, a half-crashed proxy, or one whose backend CLI is failing all present as
an in-use port, then yield `transport error: fetch failed` mid-run (the F-33
trigger this attempt). The proxy was also already torn down by the time review
started (no `cli-judge-proxy` process running), consistent with an unhealthy or
short-lived listener.

**WP it spawns → WP-234.** `dogfood.sh` should health-probe the existing proxy
(a cheap request to `http://127.0.0.1:8787` expecting a known response) before
assuming it is usable; on a failed probe, kill+restart it (or abort with a clear
message) rather than launching a run that will die at the first LLM call.
Operational sibling of the WP-228 baseline-precheck / WP-232 chain-launch guard.

### Verdict on attempt 2

- 🟢 **The chain launcher works up to the gate.** `chikory chain` parsed the
  spec, invoked the planner, and decomposed a real goal into a multi-node Plan —
  the first genuine exercise of the decomposition path end-to-end. F-32's "ran as
  a plain run" failure did not recur.
- 🔴 **The thesis is still unproven, and a new durability gap is exposed.** No
  node ever ran; the durable `chainLoop` was never reached. Worse, the failure
  revealed that the planning layer itself is non-durable (F-33) — a transient
  shim error is fatal with no resume and no trail, which is precisely the failure
  mode Chikory claims to eliminate.
- **The first real chain run is STILL owed.** Next: fix the proxy health (F-34 /
  WP-234, the immediate unblock), re-launch `chikory chain` once the shim is
  verified healthy, and — separately — harden the planning layer (F-33 / WP-233).

---

## Addendum — Attempt 3 (2026-06-20): proxy healthy, BOTH LLM calls succeeded, then the gate died on its OWN schema bug

The `dogfood.sh` proxy health-check (lines 80–95 — F-34 addressed: it now probes
`http://127.0.0.1:8787` and kills+restarts a non-responsive listener) cleared the
F-33/F-34 infra failure mode. Attempt 3 got the **furthest yet**:

```text
Setup: Starting cli-judge-proxy on port 8787 with backend 'agy'...
[cli-judge] OpenAI-compat shim on http://127.0.0.1:8787 (backend: agy CLI)
$ chikory chain examples/dogfood/dogfood-041.yaml --watch
[cli-judge:agy] gpt-5.5 · 13845ms · 649/358 tokens (estimated)
[cli-judge:agy] gemini-3.1-pro-preview · 5468ms · 886/97 tokens (estimated)
chikory: plan meta-judge gate stopped the chain: plan meta-judge reply failed schema validation: [
  {
    "code": "unrecognized_keys",
    "keys": [ "uncoveredCriteria" ],
    "path": [],
    "message": "Unrecognized key(s) in object: 'uncoveredCriteria'"
  }
]
[ELIFECYCLE] Command failed with exit code 1.
```

### What actually happened (sequence)

1. ✅ **Spec parsed**, `chikory chain` entered `cmdChain`.
2. ✅ **The planner LLM call SUCCEEDED** — `gpt-5.5 · 13845ms · 649/358 tok`
   (the `plan`-stage call) decomposed the goal into a real multi-node `Plan`.
3. ✅ **The plan meta-judge LLM call SUCCEEDED** — `gemini-3.1-pro-preview ·
   5468ms · 886/97 tok` (the `judge`-stage call). **No transport error** — F-33's
   trigger did not recur; the shim served both calls. Family diversity held
   (planner `gpt-5.5` openai-family ≠ judge `gemini-3.1-pro-preview`).
4. 🔴 **The reply FAILED schema validation deterministically.** The meta-judge
   returned a well-formed JSON object **including** `uncoveredCriteria` — because
   the response schema sent to the model (`PLAN_VERDICT_RESPONSE_SCHEMA`,
   `meta-judge-prompt.ts:4-19`) lists it as `required` and the system prompt
   (lines 36-37) instructs the model to enumerate it — but the **parse schema**
   `PlanJudgeReplySchema` (`schemas.ts:462`) was `.strict()` over only
   `{ kind, rationale }`, so it rejected the very field it had asked for.
5. 🔴 **`runPlanJudgePass` folded the parse error into an ESCALATE value**
   (`meta-judge-harness.ts:106-115`, invariant #4 — never throw), and `cmdChain`
   fail-closed (`gate.verdict.kind !== "PROCEED"` → exit 1). Fail-closing is
   correct; the verdict it fail-closed on was a self-inflicted contract bug.
6. 🔴 **Zero durable state persisted** — same as attempt 2 (host-side, before
   `startChain`): no `.chikory/chains/`, no node runs, the decomposed Plan thrown
   away. (This is still F-33; not re-counted.)

### New friction

#### 🔴 F-35 — the plan meta-judge gate has a self-contradictory `uncoveredCriteria` contract: the response schema REQUIRES the field, the parse schema REJECTS it → the gate fails 100% of the time a provider honors the schema (FIXED this session → WP-235)

**Evidence.** Three contracts in the same feature disagreed:
| Surface | File | Says about `uncoveredCriteria` |
|---|---|---|
| Response schema (sent TO the model) | `meta-judge-prompt.ts:7,14` | `required`, `additionalProperties:false` |
| System prompt | `meta-judge-prompt.ts:36-37` | "List in `uncoveredCriteria` every goal criterion id…" |
| Parse schema (validates the reply) | `schemas.ts:462-464` | `.strict()` over `{ kind, rationale }` only — **rejects it** |

A schema-honoring provider (gemini-3.1-pro-preview here) dutifully emits
`uncoveredCriteria` → the strict Zod parse throws `unrecognized_keys` → ESCALATE →
chain stops. This is **deterministic**: every compliant judge reply fails. The
field is also **dead data** — `buildPlanVerdict` (`meta-judge-verdict.ts:24`)
**recomputes** the authoritative coverage gap via `planCoverageGaps` and never
reads the model's value. So the gate demanded a field, then rejected it, then
would have ignored it anyway.

**Why the unit tests missed it.** `meta-judge-harness.test.ts` fed the harness
replies shaped `{ kind, rationale }` — **without** `uncoveredCriteria` — i.e. a
shape the production prompt + response schema never produce. The mock masked the
real failure mode exactly as CLAUDE.md warns ("Mock the LLM layer in integration
tests (masks real failure modes)" — Do-not list).

**Fix landed this session (WP-235).**
- `schemas.ts` — `PlanJudgeReplySchema` now accepts
  `uncoveredCriteria: z.array(z.string()).default([])` (accepts the real shape;
  `.default([])` tolerates a provider that omits it; existing `{ kind, rationale }`
  tests stay green). The deterministic floor (`planCoverageGaps`) remains the
  authoritative source — the model's value stays advisory. Stale doc-comment
  corrected.
- `meta-judge-harness.test.ts` — new regression case
  *"accepts the real reply shape that includes uncoveredCriteria"* drives the
  harness with the production reply shape and asserts PROCEED.
- Verified: `tsc --noEmit` exit 0; `vitest run test/planner/meta-judge-*.test.ts`
  → **13 passed** (harness 8, was 7).

### Verdict on attempt 3

- 🟢 **The chain launcher now works through the full plan→gate path.** `chikory
  chain` parsed, decomposed a real goal (planner OK), AND got a real meta-judge
  reply back (judge OK) — both LLM calls succeeded for the first time. F-32, F-33,
  F-34 all did not recur.
- 🟢 **F-35 is fixed** — the gate can now accept a schema-compliant verdict.
- 🔴 **The thesis is STILL unproven — but the last *code* blocker to a PROCEED is
  removed.** No node has run yet; `chainLoop` is still untouched. With F-35 fixed,
  attempt 4 is the first launch where a PROCEED verdict can actually flow into
  `startChain`. **The first real chain run is owed and now unblocked** — re-launch
  `devbox run dogfood` (the SDK rebuild will pick up the schema fix).

---

## Addendum — Attempt 4 (2026-06-20): the gate parsed the verdict, then the deterministic coverage floor overrode the LLM's PROCEED — on an id convention the planner was never told

F-35 fixed → the meta-judge reply parsed cleanly. Attempt 4 went one layer deeper:
the judge LLM returned **PROCEED** with a rationale that explicitly maps every
node to every goal criterion — then the deterministic coverage floor flipped it
to REVISE and the chain stopped:

```text
[cli-judge:agy] gpt-5.5 · 8036ms · 649/311 tokens (estimated)
[cli-judge:agy] gemini-3.1-pro-preview · 5500ms · 841/88 tokens (estimated)
chikory: plan meta-judge gate stopped the chain: The plan's nodes fully cover all
requested goal acceptance criteria. Node 1 ('detect-and-branch') handles the chain
detection and rendering using renderChainTrace (AC-1) and ensures the run-id
fallback is preserved (AC-2). Node 2 ('verify-and-test') ensures comprehensive
test coverage and runs typing and linting checks (AC-3). The dependency structure
is clean and coherent. [coverage override: plan leaves goal criteria uncovered:
AC-1, AC-2, AC-3 - cannot PROCEED]
uncovered goal criteria: AC-1, AC-2, AC-3
```

### What actually happened (sequence)

1. ✅ Planner SUCCEEDED — `gpt-5.5 · 8036ms · 649/311 tok` — decomposed into a
   clean 2-node plan (`detect-and-branch` → `verify-and-test`).
2. ✅ Meta-judge LLM SUCCEEDED and **PROCEEDed** — `gemini-3.1-pro-preview ·
   5500ms · 841/88 tok` — its rationale *correctly* maps N-1→AC-1/AC-2,
   N-2→AC-3 and calls the dependency structure coherent.
3. 🔴 **`buildPlanVerdict`'s deterministic coverage floor overrode PROCEED→REVISE**
   (`meta-judge-verdict.ts:25-31`). `planCoverageGaps(plan, goalCriteria)`
   (`coverage.ts:16-22`) marks a goal criterion covered **iff some node carries
   an acceptance criterion with the *same id***. The planner — told by both the
   spec ("the planner derives per-node criteria … let the planner choose … the
   per-node acceptance criteria") and the planner prompt to invent node criteria —
   gave its nodes **its own ids**, none of which equal `AC-1/AC-2/AC-3`. Zero id
   overlap → all three reported uncovered → override fires → REVISE.
4. 🔴 `cmdChain` fail-closed (v1: no auto-replan, D3 deferred). Zero durable state
   (still host-side before `startChain`; F-33 unchanged, not re-counted).

The override message is actively misleading: it asserts "plan leaves goal criteria
uncovered: AC-1, AC-2, AC-3" immediately after the LLM's own text says all three
ARE covered. The floor and the LLM are measuring two different things — id-equality
vs. semantic coverage — and the floor silently wins.

### New friction

#### 🔴 F-36 — the coverage floor requires nodes to reuse goal criterion ids verbatim, but nothing told the planner that → a correct plan is rejected 100% of the time (FIXED this session → WP-236)

**Evidence.** Attempt 4 above. The coverage contract is split across four places
that disagreed:
| Surface | File | Reality |
|---|---|---|
| Coverage floor | `coverage.ts:19-21` | covered ⇔ a node AC `id` **equals** the goal criterion id |
| Planner prompt | `prompt.ts` (pre-fix) | "Every goal acceptance criterion must be covered…" — **never said "reuse the id"** |
| Planner response schema | `prompt.ts` `PLAN_RESPONSE_SCHEMA` | node AC `id` is `string minLength 1` — **no constraint to match goal ids** |
| The spec itself | `dogfood-041.yaml` | "the planner derives per-node criteria … let the planner choose … the per-node acceptance criteria" — actively tells the planner to invent ids |

So the floor enforced an id-reuse convention the planner was explicitly steered
*against*. Like F-35, this is a deterministic 100%-fail trap: any plan whose node
criteria use fresh ids (the documented expectation) is rejected, even when
coverage is genuinely complete. The floor — meant as a safety net against a plan
that truly drops a criterion — instead blocked every plan.

**Fix landed this session (WP-236).** Thread the goal criterion ids through to the
nodes so the floor measures real coverage:
- `prompt.ts` `PLANNER_SYSTEM_PROMPT` — new rule: a node COVERS a goal criterion
  ONLY by including an acceptance criterion whose `id` is **exactly** that goal
  criterion's id (copy verbatim; coverage is matched by id, not wording); extra
  node-specific criteria with new ids are allowed; across all nodes every goal id
  must appear ≥ once.
- `prompt.ts` `buildPlannerMessages` — the user criteria block now says
  "Reuse each id below VERBATIM on the node(s) that cover it."
- `prompt.test.ts` — regression case asserting the id-reuse contract is in both
  the system prompt and the user message.
- Verified: `tsc --noEmit` exit 0; `vitest run test/planner/` → **41 passed**.

The floor itself is unchanged — it stays a real safety net; with the planner now
threading ids, it trips only when a criterion is genuinely dropped. (Residual
risk: a model that still ignores the instruction is rejected with no auto-replan
until D3/WP-219 lands; a follow-up could soften the override to a warning or add
D3 replan-on-REVISE. The prompt contract is the correct primary fix.)

### Verdict on attempt 4

- 🟢 **The full plan→judge→verdict path now executes end to end** — planner
  decomposed, meta-judge PROCEEDed with a sound rationale, the verdict parsed.
  Every prior blocker (F-32, F-33, F-34, F-35) stayed closed.
- 🟢 **F-36 fixed** — the coverage floor will now see the planner's threaded ids.
- 🔴 **The thesis is STILL unproven — but this was the last *gating* blocker.**
  With F-36 fixed, a PROCEED can finally flow into `startChain`/`chainLoop` and
  the nodes can execute. **The first real chain run is owed and now unblocked** —
  re-launch `devbox run dogfood` (the SDK rebuild picks up the prompt fix).

---

## Addendum — Attempt 5 (2026-06-20): 🎉 THE CHAIN RAN END-TO-END. Durable 2-node chain, gate PROCEED, per-node judge, HALT-on-stuck-node, halt-on-FAILED — all worked. It FAILED only on the deferred S4 context handoff.

This is the run dogfood-041 was written for. Every gating blocker (F-32, F-33,
F-34, F-35, F-36) stayed closed and the durable chain machinery executed:

```text
plan plan-6d618e76-… · 2 nodes · plan-judge PROCEED
  resolve-id-and-render-trace — Modify chikory trace CLI branch to detect chain-id and render chain trace.
  verify-and-test (after resolve-id-and-render-trace) — Verify implementation with tests, verify typecheck and lint stay green.
chain-id: chain-d3794c24-c99f-4250-8f8a-ba6e8ba3e992
[…] node resolve-id-and-render-trace started → …-node-resolve-id-and-render-trace
[…] node resolve-id-and-render-trace sealed SUCCESS (PROCEED)
[…] node verify-and-test started → …-node-verify-and-test
[…] node verify-and-test sealed FAILED (HALT)
[…] chain FAILED
chain plan-6d618e76-… · FAILED · 2 nodes · 1/2 succeeded
```

### 🟢 What worked (the thesis pillars, finally exercised)

| Pillar | Evidence |
|---|---|
| Durable multi-run chain | `.chikory/chains/chain-d3794c24…/chain.db` + 2 per-node run journals (`…-node-resolve-id-and-render-trace`, `…-node-verify-and-test`), deterministic `chain-<id>-node-<nodeId>` ids |
| Plan decompose → meta-judge gate | `2 nodes · plan-judge PROCEED` (F-35/F-36 fixes held — planner `gpt-5.5 · 815/136`, judge `gemini-3.1-pro-preview · 765/73`) |
| Per-node judge gating | node 1 sealed `SUCCESS (PROCEED 2/2 criteria)`, 1 step, **changes made 1**, $1.44/$8.00 |
| **Judge caught a bad node** | node 2: 3 steps, **changes made 0** every step, executor kept claiming "Verification is complete. AC-3 is met", judge scored **0/1** each time → `criterion AC-3 failed 3+ consecutive verdicts → HALT (goal drift / budget-waste guard)`. The HALT guard stopped an empty-diff node from spinning forever — Agent-as-a-Judge doing exactly its job. |
| halt-on-FAILED chain semantics | `deriveChainStatus` → chain sealed FAILED at 1/2; no phantom further nodes |
| `renderChainTrace` on a real chain | the `chain … · FAILED · 2 nodes · 1/2 succeeded` trace + per-node rows + `failed:` line all rendered (the dogfood-037/041 deliverable, now exercised against a live chain) |

### 🔴 Why node 2 FAILED — the root cause

Node 2 (`verify-and-test`) depended on node 1 but ran against a **fresh clone of
HEAD that did not contain node 1's diff**, so the implementation it was told to
"verify" was not present. With nothing to do, it produced an empty diff, claimed
completion, and the judge correctly refused it three times → HALT.

- `chain-loop.ts:87` spawns each node via `planNodeToTaskSpec(node, template,
  plan.id)` with **no `parentRunId`**; `node-spec.ts:68` gives every node the
  shared `template.repos` (the original HEAD). Nodes are fully independent
  fresh-HEAD clones.
- This is the **deferred S4 context handoff** (`chain-loop.ts:16-17`: "S4 context
  handoff (predecessor checkpoint + compaction note) … deferred"). The v1 chain
  executor runs each node as a fresh TaskSpec by design.

### New friction

#### 🔴 F-37 — no S4 context handoff: a dependent node clones HEAD and cannot see its predecessor's work, so any genuinely dependent multi-node plan fails (→ WP-237, the now-top-priority keystone; NOT fixed this session — real Temporal/checkpoint engineering)

**Evidence.** Attempt 5 above. Node 2 `verify-and-test` (`dependsOn:
resolve-id-and-render-trace`) sealed FAILED/HALT with `changes made 0` across all
3 steps because node 1's chain-trace branch was absent from node 2's workspace.
`planNodeToTaskSpec` (`node-spec.ts:56-79`) bases every node on the same
`template.repos`; `chainLoop` (`chain-loop.ts:88`) never threads node 1's sealed
checkpoint into node 2's spec. The `parentRunId` field exists on `chainLink` for
D4 traceability but is not even passed at the call site.

**Why it matters.** Context handoff is the *whole point* of chaining for
compounding work: later nodes build on earlier ones. Without S4, the only
decompositions that can pass are a single node or fully independent (parallel)
nodes — exactly the shapes that don't exercise compounding error, the thesis. The
chain machinery is proven (this run), but it can only chain *independent* work
until S4 lands. This makes WP-219 S4 the critical-path keystone, no longer an
optional follow-up.

**WP it spawns → WP-237** (chain S4 context handoff): when a node's `dependsOn`
predecessor sealed SUCCESS, base the node's workspace on that predecessor's sealed
checkpoint (its run-private branch / harvested commit) instead of HEAD, and pass a
short predecessor digest into the node's context (ADR-005 §S4: "predecessor
checkpoint + compaction note"). This is hand-design keystone work (TASK-PROTOCOL
§4) — a Temporal-deterministic activity that resolves the predecessor run's final
tree and seeds the child run's clone — **not** a review-time patch.

#### 🟡 F-38 — the planner emitted a verification-only node, which has no diff of its own and is both unsatisfiable and redundant with the per-node judge (FIXED this session → WP-238)

**Evidence.** The planner split the goal into `resolve-id-and-render-trace` (does
the work) + `verify-and-test` (a pure "verify tests/typecheck/lint pass" node).
The second node has no code change to make — every node is *already*
independently judge-gated and its acceptance `check`s run automatically, so a
verification-only node has nothing to deliver and cannot PROCEED (node 2's `issues
found 3 · changes made 0`). Even with S4 handoff it would be redundant with the
per-node judge. The planner prompt did not forbid this shape.

**Note:** F-38 is the *trigger* the planner happened to pick; F-37 is the
underlying gap. Forbidding verify-only nodes (F-38) makes the planner fold
verification into the working node, which both removes this dead node AND means a
2-node plan only survives if its nodes are independent — so a passing *dependent*
multi-node chain still needs F-37/WP-237.

**Fix landed this session (WP-238).** `PLANNER_SYSTEM_PROMPT` (`prompt.ts`) now
requires every node to produce a concrete code change (a non-empty diff) and
explicitly forbids verification-only / testing-only / review-only nodes, telling
the planner to fold tests and verification into the node that makes the change
(each node is independently judge-gated). Regression test in `prompt.test.ts`.
Verified `tsc --noEmit` exit 0; `vitest run test/planner/prompt.test.ts` → 6 passed.

### Other anomaly checks

- **Cost**: node 1 $1.44/$8.00 (1089k in / 7.4k out, 1 step); node 2 $0.57/$7.00
  (224k+99k+100k in / 1.9k+0.71k+0.73k out, 3 stuck steps). Chain total ≈ $2.01.
  Node 2 burned $0.57 spinning on an impossible task before HALT — the budget
  guard worked, but F-37 is what made the spend unavoidable. Per-node judge share
  tiny ($0.01 each, ~0.5–1.7%).
- **Judge behavior**: node 2's HALT is a **true positive** — the executor's
  "verification complete" claims over an empty diff were correctly rejected. No
  false ESCALATE/ROLLBACK. Family diversity real (judge `gemini-3.1-pro-preview` ≠
  executor `codex`/openai).
- **Loop integrity**: each node journaled `node_started`/`node_sealed`; chain
  folded via `advanceChain`; no duplicate entries; checkpoints per node
  (`…-node-verify-and-test@11` last good).
- **Review tooling gap (still F-32/WP-232 family)**: `dogfood-verify.sh` and
  `chikory trace` assume one run journal; a chain produces a `ChainJournal` +
  per-node run journals. `chikory trace <node-run-id>` works (per-run), but a
  chain-aware verify pass is still owed.

### Verdict on attempt 5

- 🟢 **The thesis pillar is PROVEN to run.** Durable multi-run execution, a gated
  plan, per-node judge gating, a judge catching and HALTing a bad node, and
  halt-on-FAILED chain semantics all worked end-to-end for the first time in 41
  campaigns. dogfood-041's core purpose is met: the chain machinery is real.
- 🔴 **A passing *dependent* chain still needs S4 context handoff (F-37 → WP-237).**
  Until a node can see its predecessor's work, only single/independent-node chains
  can go green. This is now the critical-path keystone.
- 🟢 **F-38 fixed** — the planner will no longer emit dead verification-only nodes.
- **Next:** build WP-237 (S4 handoff) by hand, then re-launch dogfood-041 for the
  first *green* dependent chain. A re-launch *before* S4 lands will, with the F-38
  fix, likely produce a single working node (green but not a compounding test).
