# dogfood-121 (five-task baseline range, CHAIN) — WP-302 + WP-304: two real benchmark tasks landed, the campaign died on a quota wall and an empty diff

**Plain:** The chain did two of its five jobs well — it researched two real, still-open-source bugs
and turned them into pinned, runnable benchmark tasks, with provenance I re-verified against GitHub
and found exact. It then died twice for reasons that had nothing to do with the quality of the work:
the quality judge killed a node for showing it an empty list of changes when the deliverable was
already committed one step earlier, and the retry ran straight into a Gemini subscription quota
wall that the harness treated as the agent failing rather than as a door that reopens in an hour.
Both good nodes' output is now landed. Four harness defects were hand-fixed in this sitting; two
factual errors in the delivered task files were corrected against upstream.

- **WP:** WP-302 (brownfield task authoring) + WP-304 (baseline runs and publication)
- **Date:** 2026-07-30 (America/Toronto; journal timestamps below are UTC)
- **Spec:** [`examples/dogfood/dogfood-121-wp302-wp304-five-task-baseline-range.yaml`](../../examples/dogfood/dogfood-121-wp302-wp304-five-task-baseline-range.yaml)
- **Chain:** `chain-86fbe5a7-e5af-4d1f-b054-a67ea3de7097`
- **Plan:** `plan-d43e4fc8-b019-4e43-812b-c57bf0c9d9ee` → `-r1` (one replan)
- **Base HEAD:** `9b9e9bd`
- **Outcome:** ⛔ FAILED · 5-node plan · 2/5 nodes SUCCESS · 4 node incarnations · 10 steps ·
  12 judge passes · 1h 05m · **$0.8869 / $60.00** ($0.1869 plan phase + $0.6999 nodes; all of it
  judge spend — the CLI-OAuth executor meters $0)
- **Ladder:** P3 rung 4 **attempted, not reached.** The corpus grows **3 → 5** runnable brownfield
  tasks (the rung's precondition), but neither arm ran and no comparison bundle exists.

## Trace

| When (UTC) | Node | Steps | Cost | What happened |
|---|---|---:|---:|---|
| 21:26:56 | plan | — | $0.1869 | gate **PROCEED** first pass, 5 nodes — WP-549/550/551 held; no repair loop |
| 21:26:56 | `N-1` | 1 | — | 3m 15s of upstream research + probe work |
| 21:31:05 | `N-1` | — | $0.0500 | ESCALATE — judge: horizon claim unsupported, report not self-contained, `\|\| true` in R2 |
| 21:31:05 | `N-1` | — | — | auto-resume, non-empty diff → executor answers the concerns |
| 21:32:46 | `N-1` | 2 | $0.1287 | 🟢 **SUCCESS** (PROCEED) — `brownfield-004` + report, 328 insertions, head `6e0a366` |
| 21:41:44 | `N-2` | 1 | $0.0528 | 🟢 **SUCCESS** (PROCEED) — `brownfield-005` + report, 349 insertions, head `0655be4` |
| 21:41:44 | `N-3` | — | — | 45m 19s in step 0 — wrote `benchmarks/run-p3-rung-4.sh` (75 lines), commit `e21189a` |
| 22:27:54 | `N-3` | — | $0.0465 | judge pass 0 **PROCEED** over the real diff, AC-1 pass, 5/6 rubric |
| 22:28:21 | `N-3` | — | $0.0356 | completion review **PROCEED**, `cumulative_design_coherent` pass |
| 22:28:54 | `N-3` | 2 | $0.0360 | step 1 **empty diff** → all ACs pass, 6/6 rubric pass → **ESCALATE** → sealed FAILED |
| 22:29:32 | `N-3` | 3 | $0.0389 | resumed; step 2 empty again → same all-green ESCALATE → sealed FAILED |
| 22:29:32 | `N-3-r1` | — | — | replanned; workspace re-seeded from `0655be4` — `e21189a` discarded |
| 22:29:43 | `N-3-r1` | 1–3 | $0.1209 | every step: `agy` exit 1 — `Individual quota reached … Resets in 1h0m8s` |
| 22:31:19 | `N-3-r1` | — | — | CG-1 loop-breaker → sealed FAILED → auto-resume → step 3 same wall |
| 22:32:02 | chain | — | — | ⛔ **FAILED** — replan budget exhausted for `N-3` (2 attempts > max 1) |

`N-4` (raw Claude Code arm) and `N-5` (comparison bundle) never started.

## Salvage (done)

Neither node's output was on `main`. Each node's `chikory-base` tag points at its **parent node's**
tip, so a single harvest lands only that node's own delta — both were harvested explicitly, in
order, via the F-222 named-node path:

```
devbox run -- bash scripts/harvest.sh chain-86fbe5a7-…-node-N-1   # brownfield-004 + report (328)
devbox run -- bash scripts/harvest.sh chain-86fbe5a7-…-node-N-2   # brownfield-005 + report (349)
```

`N-3`'s 75-line launcher was deliberately **not** harvested: it was never proven to run an arm, and
the replan child had already discarded it.

## Delivery quality (human review, post-landing)

**Provenance is genuine — verified independently against GitHub, not taken from the report.**

| Task | Upstream | Fix commit | Parent = pinned `repo.ref` | Verdict |
|---|---|---|---|---|
| `brownfield-004` | react-hook-form PR #13613 | `69da9545b222aceb5fc8ea15e851cab83b1c84f6` | `d96c5ceef12cb53266ce1ae5e65fba301a31fe57` ✅ | real, exact |
| `brownfield-005` | trpc PR #7390 | `dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95` | `cdbc28049889a9da9ea2abb6bd6519afe2279ead` ✅ | real, exact |

Commit message, fix SHA and parent SHA match on both. No invented fixture repo, no trivial leaf
utility, no shimmed binary, no marker file — the dogfood-120 fabrication failure mode did **not**
recur. Both tasks parse through `parseAuthoredTask`, and the whole 5-task corpus still loads.

Two substantive defects survived the judge and were corrected by hand:

- **The `horizon: 3-6h` claim is not supported by either upstream fix.** Measured source diffs:
  `brownfield-004` = **+2/−1** in one file; `brownfield-005` = **+11/−2** in one file. The `N-1`
  judge said exactly this ("the presented root cause and known fix are a single explicit
  `_formState.errors = {}` assignment") and the auto-resume overrode it — **a true positive that
  was discarded.** Both now read `horizon: 1-3h`, with the measured upstream diff recorded in the
  YAML and in a new *Upstream Fix Size (measured)* section of each report, so the claim is auditable
  rather than asserted (F-231).
- **`brownfield-005` described a root cause that is false at its own pinned ref.** The YAML header
  and the goal both claimed `httpBatchStreamLink` "initializes an `AbortController` and passes its
  signal into `loader.load()`" with only the teardown missing. At `cdbc280…` there is **no
  AbortController in the request path at all** — the upstream fix *creates* it, races it against the
  caller's signal (`raceAbortSignals(op.signal, ac.signal)`), tracks completion, and aborts only an
  unfinished request. The original wording would have pointed the agent at a one-line edit instead
  of the real design change. Header, goal and report corrected, with the correction recorded inline
  (F-232).

The pasted RED-on-pin / GREEN-on-known-fix transcripts were **not** independently re-executed —
each would require a full clone plus install plus a 1208-test Jest run per ref. Provenance being
exact on both tasks is meaningful supporting evidence, and the R4 probe assertions match the real
upstream patch semantics in both cases, but that specific claim stands unverified here.

## New friction

### 🔴 F-228 — a provider quota wall is treated as executor incompetence · **HAND-FIXED**

`runner/activities.ts:320` reads `record.limitSignal` to feed `classifyLimitSignal`. **No adapter
ever set that property and `StepRecord` never declared it** — only the scripted test adapter did.
The entire park-until-reset / declared-failover scheduler at `activities.ts:1117-1200` was therefore
reachable only through `CHIKORY_LIMIT_AT_STEP` injection. `agy`'s `Individual quota reached …
Resets in 1h0m8s` became four ordinary FAILED steps → CG-1 loop-breaker → node FAILED → replan
budget spent → chain dead, over a door that reopens in an hour.

Second half of the same defect: `CLI_LIMIT_RE` matched `usage|rate|session limit` and
`limit reached|exceeded|hit` — and **not** `quota reached`. "your limits" is not "usage limit".

**Fix:** `StepRecord.limitSignal?: RawLimitSignal` (additive; `RawLimitSignal` moved into `types.ts`
so the contracts file stays self-contained, re-exported from `limit-signal.ts`); `runCliStep`
attaches `{ kind: "cli-stderr", stderr, exitCode }` to every FAILED record with stderr, so all three
CLI adapters inherit it; regex widened to `quota (reached|exceeded|exhausted)`. Schema, CONTRACTS.md
and `docs/components/executors.md` updated in step (the executors.md drift guard caught the omission).
Tests: `test/limit-signal.test.ts` (verbatim `agy` stderr → `cli-usage-limit`, 3,608,000 ms park;
wording variants; a negative), `test/executors/gemini-cli.test.ts` (new `quota` fake-bin mode → the
signal travels and classifies end to end).

### 🔴 F-229 — an out-of-rubric concern over an empty diff is a death sentence, unattended · **HAND-FIXED**

`workflow/agent-loop.ts`. On `N-3` steps 1 and 2 the judge passed **every acceptance criterion and
every rubric item**, saw a zero-byte diff, and objected only in free text — *"the diff is empty, so
it provides no evidence that the node's requested launcher was added"* — while the launcher sat
committed in `e21189a` one checkpoint earlier. The judge is shown the **incremental** diff and was
reasoning about a **cumulative** deliverable.

F-154's carve-out already stated this failure verbatim ("resuming into RUNNING would re-judge an
empty diff, re-raise the same concern, and loop forever") — but it sat *below* the unattended seal,
so unattended it was unreachable. The run had converged and the loop had no way to say so.

**Fix:** hoist the rule above the unattended seal, gated on `record.diffRef.bytes === 0` (the same
signal `isCompletionMilestone` uses) plus all-criteria **and** all-rubric passing, and scoped to
`unattended.escalation === "seal_resumable_failed"` so an attended operator still adjudicates. The
concern is carried verbatim into the seal reason — recorded, never dropped.
Tests (`test/runner/verdict-gating.test.ts`, live Temporal): empty diff → SUCCESS with the concern
in the seal; **non-empty** diff → still FAILED (the `N-1` path that recovered correctly); attended →
still awaits approval. **RED proven** by stashing the fix: `expected 'FAILED' to be 'SUCCESS'`.

### 🔴 F-234 — a compact reset window parses as its last unit · **HAND-FIXED**

Found while arming F-228. `parseDurationMs` terminated each `<number><unit>` with `\b`, which is the
wrong test: in `1h0m8s` the `h→0` and `m→8` positions are both word-char boundaries, so only the
trailing `8s` matched. `agy`'s one-hour wall parsed as **8 seconds** — parking for it walks straight
back into the wall. Spaced forms (`1h 30m`) were unaffected, which is why it survived until a compact
one arrived. **Fix:** `(?![a-z])` in place of `\b`, in both `DURATION_RE` and the per-part scan —
rejects a following *letter* (`5months` is not five minutes), accepts a following *digit*. Five
duration forms plus a negative are pinned in `test/limit-signal.test.ts`.

### 🟡 F-230 — the JD-7 cost-share warning is unsatisfiable with a keyless executor · **HAND-FIXED**

`runner/activities.ts:1547`. Every dogfood executor authenticates by CLI OAuth and costs **$0** on
the wire, so `judgeCostShare` is 1.0 by construction and the warning's own advice ("consider a larger
cadence") cannot move it. It printed **12 times** in this one chain, which is how real warnings get
ignored. **Fix:** warn only when there is executor spend to measure the share against; the OTel
`cost.share` / `cost.share.breached` attributes are unchanged, so telemetry still records the ratio.
Tests: the existing breach test now seeds real step spend (still warns); a new keyless case asserts
`cost.share === 1`, `breached === true`, and **no** console warning.

### 🟡 F-231 — a benchmark task's `horizon` is unverified prose · **HAND-FIXED (data), track-B (rule)**

Both new tasks claimed `3-6h` against upstream fixes of +2/−1 and +11/−2. The whole corpus uses
`3-6h`/`4-6h` with nothing behind it. Data corrected above; the **rule** — any rung-4 task-authoring
AC must settle the horizon claim against the measured upstream diff, never against prose — is a
track-B note, not a WP: it is spec-authoring discipline, and the next rung-4 spec is where it binds.

### 🟡 F-232 — a delivered task described a root cause that is false at its own pin · **HAND-FIXED**

Detail above. The generalizable point: the judge verified that evidence *existed* and that paths and
scope were legal; nothing checked the task's narrative against the upstream patch it cites. An
authoring AC that diffs the stated root cause against the real fix would have caught it — the same
"own your oracle" lesson as F-187/F-196/F-198, at the prose altitude.

### 🟡 F-233 — a replan child silently discards the failed attempt's judged work · **track-B note**

`N-3-r1`'s workspace was seeded from `0655be4` (`N-2`'s tip), so `N-3`'s 75-line launcher — which
had drawn a **PROCEED** and a clean completion review — vanished. Defensible (a FAILED node's tree is
untrusted) but it contradicts the "work preserved" line the operator is shown, and here it discarded
the only artifact of a 45-minute step. No behavior change this sitting.

## Verdict on the thesis

- **Long-horizon durability: mixed.** The chain survived a 45-minute step and two auto-resumes, and
  its two authoring nodes produced genuinely researched, correctly pinned work — the substance rung
  4 needs. It then lost the campaign to two harness defects, neither about the work. Both are fixed;
  this is the pattern the loop exists to surface.
- **Agent-as-a-Judge: one true positive, discarded; one false negative, and one self-inflicted
  kill.** The `N-1` horizon objection was *correct* and the resume overrode it (F-231). The `N-3`
  escalations were the judge reasoning past the evidence it was given (F-229). And nothing checked
  the delivered narrative against the upstream patch it cites (F-232). The judge's free-text channel
  is doing real work — it needs an evidence base that matches the altitude it reasons at.
- **Compounding error:** 10 node steps, 0 rollbacks. The two node deaths were terminal-state
  decisions, not step-level regressions.
- **Rung 4 is closer, not climbed.** Its precondition — five real, pinned, runnable brownfield tasks
  — is now **met**. What remains is the two arms and the comparison bundle.

## Friction disposition

| F-n | Severity | Defect | Disposition |
|---|---|---|---|
| F-228 | 🔴 | quota wall never reaches the limit scheduler (`StepRecord.limitSignal` set by nobody; regex misses `quota reached`) | **HAND-FIXED THIS SITTING** — `types.ts:307`, `executors/step.ts:202`, `limit-signal.ts:40`; 1184 TS green |
| F-229 | 🔴 | unattended out-of-rubric ESCALATE over an empty diff seals FAILED and can only repeat | **HAND-FIXED THIS SITTING** — `workflow/agent-loop.ts:1028`; 3 live tests, RED proven by stash |
| F-234 | 🔴 | `1h0m8s` parses as 8 s — park window off by 450× | **HAND-FIXED THIS SITTING** — `limit-signal.ts:42,95`; 5 forms + a negative pinned |
| F-230 | 🟡 | JD-7 warning fires 12×/chain on a share no cadence can change | **HAND-FIXED THIS SITTING** — `runner/activities.ts:1547`; 4 telemetry tests |
| F-231 | 🟡 | `horizon` asserted, not measured (3-6h over a +2/−1 fix) | **HAND-FIXED THIS SITTING** (both tasks + both reports) · rule → **track-B note** |
| F-232 | 🟡 | `brownfield-005` root cause false at its own pinned ref | **HAND-FIXED THIS SITTING** — YAML header/goal + report correction block |
| F-233 | 🟡 | replan child discards the failed attempt's PROCEED-judged work | **track-B note** |
