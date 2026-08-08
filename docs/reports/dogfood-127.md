# dogfood-127 — durable corpus probe sweep (WP-596)

**WP:** WP-596 (durable corpus probe sweep) · **Date:** 2026-08-08 ·
**Spec:** `examples/dogfood/dogfood-127-wp596-durable-corpus-probe-sweep.yaml` ·
**Run:** `run-41fb5957-933b-467e-a16d-36df443f6f41` · **Landed:** this review's commit ·
**Ladder:** P3-rung-5 prerequisite (WP-530 moat ladder) — rung unchanged at 4

## Plain lead

Checking a whole folder of benchmark tasks used to be five separate commands
with no memory: kill it halfway and you started from zero. Now one command
walks the folder, writes each answer to disk the second it is known, and a
re-run skips only what it already proved at the exact commits the task names
today. One agent step delivered it correctly in three minutes for five cents,
both acceptance checks pass, and every existing test stays green.

The review found six defects the checks could not see — the worst of them
would have let a sweep clobber its own evidence and run one task's tests
against another task's leftover build output. All six are fixed on disk.

The larger finding is not about this run: **three consecutive headlines have
now built probe machinery for evidence that no task in the corpus can
produce.** Not one task under `benchmarks/tasks/` carries a `fix_ref`, and the
authoring guide that would produce one has never mentioned the field.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 3m 53s |
| cost | **$0.0472** of $15.00 budget (0.3%) — judge share **100.0%** |
| executor | `gemini-cli` (gemini family) · **$0.0000 UNPRICED** on 4,285 metered tokens · **0 tool calls** on a 4-file delivery |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 1 pass · $0.0472 · 47 s · 12,081 evidence bytes |
| verdicts | ✓ PROCEED (2/2 criteria, 6/6 rubric) · rollbacks 0 · escalations 0 |
| checkpoints | 1 (`@5`, commit `b198dc224b0b`) · `lastGood` true · resumes 0 · injections 0 |
| pacing | 1 event · peak window **75%** · compact 0 · park 0 |
| diff | 4 files · +231 / −7 (11,825 bytes) |
| harvest | 4/4 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| step | tokens in/out | duration | diff bytes | verdict |
|---|---|---|---|---|
| 1 | 2.8k / 1.5k | 3m 02s | 11,825 | ✓ PROCEED (2/2 criteria, 6/6 rubric) |

**Family diversity real:** `gemini-cli` executor vs `openai-compat` judge —
structurally different families, per the core constraint.

## Delivery quality (human review, post-landing)

**What landed (the run's own diff):**

```
M benchmarks/harness/src/probe.ts        (+138 / −3)   runProbeSweep
M benchmarks/harness/src/main.ts          (+19 / −3)   probe --tasks routing + usage errors
M benchmarks/harness/test/probe.test.ts   (+72 / −1)   sweep unit test
M benchmarks/harness/src/index.ts          (+2)        public exports
```

**Independently verified ✅** — both ACs re-run against the working tree after
harvest: **AC-1 PASS**, **AC-2 PASS**; harness suite **197 green**; full repo
suite green (sdk-ts 1,304 · sdk-py 84); lint + typecheck clean.

All five designed traps rejected:

| trap | what a wrong delivery would do | what landed |
|---|---|---|
| **A** write once at the end | hold hours of verdicts in memory | each task's verdict is written by `runProbe`'s own `--record` upsert before the next task starts; AC-1 kills the sweep in flight and finds task 1 on disk |
| **B** skip on task id alone | treat proof taken at a moved ref as current | the skip requires `entry.baseRef === task.repo.ref` **and** `entry.fixRef === task.repo.fixRef` (`probe.ts:339-344`) |
| **C** re-probe proven work | make resuming cost the same as starting | a matching pair `continue`s before any clone; `probedAt` untouched, asserted twice |
| **D** abort on one bad task | end the sweep on the first throw | `try/catch` per task, counted `failed`, named in the output, loop continues (`probe.ts:366-371`) |
| **E** regress the single-task path | change `probe --task` or the WP-595 gate | AC-2 drives the swept ledger through the **real** `run --discrimination-ledger` CLI and re-asserts `publishableRepoPath` + `parseDiscriminationLedger` for their existing callers |

**Reuse over reinvention ✅** — every ledger helper the sweep needs
(`getLedgerEntry`, `readDiscriminationLedger`, `parseDiscriminationLedger`,
`sanitizeFileName`) already existed from WP-593/WP-595 and was imported, not
re-implemented. `results.ts` is untouched.

**One genuinely good defensive call the spec did not ask for.** The exit-code
computation is `discriminatingCount === selected.length && failedCount === 0`.
The second clause is load-bearing: a task whose re-probe *throws* keeps its
stale ledger entry, so a verdict-only count would have let the sweep exit 0 on
proof it no longer holds.

**Scope discipline ✅** — four files, all named or trivially entailed. No task
file, no `benchmarks/results/` or `benchmarks/publications/` artifact, no
`summarize` change, no new dependency.

## New friction

### 🔴 F-277 — a sweep without `--out` shares one output dir across every task

`runProbeSweep` scoped its per-task output dir **only when `--out` was given**:

```ts
const taskOutDir = options.outDir ? join(resolve(options.outDir), sanitizeFileName(task.id)) : undefined;
```

With `--out` omitted — the shortest form of the operator's own rung-5 command,
`probe --tasks benchmarks/tasks --record ledger.json` — every task fell through
to `runProbe`'s default, `<task-dir>/probe-output`. Two consequences, both
silent:

- **Evidence destroyed.** Each task overwrote the previous task's
  `probe.json`. Only the last task's report survives — and `probe.json` is the
  only place a `not-discriminating` verdict explains itself per requirement.
- **Cross-task workspace contamination.** `base-workspace/` and
  `fix-workspace/` are shared, so `ensureGitWorkspace` re-points one clone at
  each successive task's repo (`adapter.ts:143-157`). `git checkout -f` does
  not remove untracked or ignored files, so the previous target's
  `node_modules/` and build output stay behind — and the very next thing the
  probe does is run that task's `base_verification_command` (install + full
  suite) in that dirty tree. **This is F-258's family: a base verdict
  manufactured from a workspace that is not what it claims to be**, and it
  would have been recorded into the ledger the scoring gate trusts.

Both ACs always passed `--out`, so neither could see it.

**Disposition — HAND-FIXED THIS SITTING.** The per-task scoping is now
unconditional; with no `--out` the default becomes
`<task-dir>/probe-output/<task-id>/` (`probe.ts:355-364`). +1 test that runs a
two-task sweep with no `--out` and asserts each task has its own faithful
`probe.json` and that no shared one exists.

### 🟠 F-282 — the durable ledger was written non-atomically

`runProbe` persisted the ledger with a plain
`writeFileSync(recordPath, JSON.stringify(...))`. A kill landing inside that
write truncates the file — and F-275 (fixed last review, correctly) makes a
damaged ledger **throw** rather than be silently reset. So the failure mode of
the one mechanism WP-596 exists to provide is: kill at the wrong microsecond,
lose the entire multi-hour sweep, with the only recovery being to delete the
ledger and start over. The durability guarantee had a hole exactly where it
was being claimed.

AC-1 kills the sweep, but the window is microseconds wide; no realistic
acceptance check can hit it.

**Disposition — HAND-FIXED THIS SITTING.** `writeLedgerAtomically`
(`probe.ts:77-91`) writes a pid-suffixed sibling and `renameSync`s it into
place — atomic on POSIX, so a reader sees the old ledger or the new one, never
half of either; the temp file is removed if the rename fails.

### 🟡 F-278 — neither probe mode could reach the base-verification cap

`RunProbeOptions.baseVerifyTimeoutMs` and `RunProbeSweepOptions.baseVerifyTimeoutMs`
both exist and both are honored — and **no CLI path set either**. `run` has
`--base-verify-minutes` (F-241, default 45); `probe` did not, so 45 minutes was
the only cap any operator could ever get, for a command that runs the target's
full suite at **two** refs. `brownfield-001` is 1,128 tests after a full
install, run twice.

This is **F-274's shape one WP later**: an option that exists in the API with
no path from the product to reach it — the same class the last review closed
for the ledger flag.

**Disposition — HAND-FIXED THIS SITTING.** `--base-verify-minutes` now applies
to both probe modes, validated identically to `run`'s (`main.ts:494-503`,
usage at `main.ts:36-50`). +1 CLI test covering the malformed value in both
modes and a well-formed one passing through.

### 🟡 F-279 — the sweep's `discriminating` count could include stale proof

The summary line counted any final-ledger entry with `verdict === "discriminating"`,
ignoring which refs it was taken at. A task whose re-probe threw keeps its old
entry, so the operator's coverage number could exceed what the sweep actually
proved. The exit code was saved by the `failedCount === 0` clause; the reported
number was not.

**Disposition — HAND-FIXED THIS SITTING.** The count now requires the entry's
`baseRef`/`fixRef` to match what the task declares today (`probe.ts:389-400`) —
the same rule the skip decision and WP-595's gate already use.

### 🟡 F-281 — the sweep re-walked the task dir, forking `run`'s selection

The goal said `--tasks` selects "the same selection `run` uses". The delivery
called `loadTaskDir` for its `invalid` map and then **walked the directory a
second time by hand**, re-implementing the extension rules, the
`manifest.json` exclusion, and both parsers — because `loadTaskDir` returned
tasks without their source paths and the probe needs a path. Two copies of the
selection rules is one divergence away from a sweep that probes a different
task set than the suite scores.

**Disposition — HAND-FIXED THIS SITTING.** `LoadReport` gained
`sources: Record<taskId, path>` (`suite.ts:26-52`); the sweep now consumes
`loadTaskDir`'s own result and the duplicate walk is deleted
(`probe.ts:313-320`, −20 lines).

### 🟡 F-280 — the sweep test's name claimed a case its body never ran

`it("probes tasks durably, skips settled tasks at same ref pair, **re-probes
moved refs**, and continues past bad tasks")` — the body never moved a ref.
Trap B had unit coverage only in the reader's imagination; the real proof lived
in AC-1, which is a spec file, not the suite. A test name that overstates its
body is worse than a missing test: it stops anyone from writing the real one.

**Disposition — HAND-FIXED THIS SITTING.** The test now makes a third commit,
re-pins `fix_ref` to it, and asserts the entry's `fixRef` and `probedAt` are
both replaced with a fresh `discriminating` verdict.

### 🔴 F-283 — the corpus cannot produce the evidence three headlines built for

Not a defect in this delivery; a defect in the campaign it completes.

| WP | what it built | 2026-08-08 state |
|---|---|---|
| WP-593 | `probe --task` writes a discrimination ledger | works |
| WP-595 | the score counts only requirements proven at the scored ref | works |
| WP-596 | a durable, resumable sweep over a whole task dir | works |

**Zero tasks under `benchmarks/tasks/` carry `repo.fix_ref`**, and
`benchmarks/tasks/AUTHORING.md` — the guide that governs how a task is written
— **does not mention the field at all**. `fix_ref` parses and is SHA-validated
(`task.ts:102,206-207`), but nothing asks an author for one. Running the new
sweep over the real corpus today probes nothing: all five tasks throw
`missing repo.fix_ref` and are counted as failures.

Worse, arming the WP-595 gate over today's corpus would make the published
comparison *weaker*, not stronger. dogfood-123's separation comes from
`brownfield-001` alone — and `brownfield-001` is a **self-performed** zod v3→v4
migration for which, by its own task file, no upstream fix commit exists. It
can never carry an upstream `fix_ref`, so the gate would exclude the only task
that distinguishes the two arms.

**Disposition — → WP-597 (queued), and it is the next headline.** A pinned
brownfield task needs a *gold patch*: a real commit where every requirement
check passes, self-authored when upstream never made one. The rule belongs in
`AUTHORING.md`, probeability belongs in what `validate` reports, and the
existing tasks need real refs.

### ℹ️ F-268 recurrence — the executor still meters $0.00

`⚠ cost meter blind (unpriced tokens)`; the step reads `$0.0000` on 4,285
metered tokens because `gemini-cli` records the bare alias `gemini`, which
matches no row in `packages/sdk-ts/src/pricing.ts`. Already **→ WP-592
(queued)**. Judge share reads 100% only because the executor half is unpriced.

### ℹ️ F-265 recurrence — `0 tool calls` on a 4-file delivery

The gemini-cli adapter reports no tool calls for work that necessarily read and
wrote four files. Already **→ WP-590 (queued)**.

## Anomaly checklist

| check | result |
|---|---|
| wasted/filler steps | none — 1 step, 11,825 diff bytes, no empty-diff probe step (F-11 did not recur) |
| cost telemetry | 🔴 executor unpriced (F-268 → WP-592); judge priced correctly; budget gate inert on the executor half |
| token economics | 2.8k in / 1.5k out for a 4-file delivery — spec fits one context, no rot pressure (peak window 75%) |
| judge behavior | checks genuinely executed (both exited 0 in-workspace, both re-verified here); rubric rationales specific and accurate — but 6/6 green over a delivery carrying six review-found defects |
| family diversity | real — `gemini-cli` executor vs `openai-compat` judge |
| human ceremony | spec authored + launched + harvested by hand; 6 hand-fixes this sitting |
| loop integrity | clean — 1 checkpoint, `lastGood` true, no duplicate journal entries, no resume; workspace escape check (F-192) clean: `git status` empty before harvest |

## KPI table (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 3m 53s | 4 steps (dogfood-125) over trailing 3 |
| kill→resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | 0 | 1 over trailing 3 (dogfood-125) |
| meta:product headline ratio | product | **0:3** — cap intact (≤1 meta per 3) |
| per-step reliability (runs ≥5 steps) | n/a (1 step) | 94.5% (9 rollbacks / 164 steps, 20 runs) — target 99%+ |
| ladder rung vs exit gate | **4** | P3 exit gate = rung 5 (published *separating* ranges + leaderboard) |

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-277 | 🔴 | a sweep without `--out` shares one output dir: `probe.json` clobbered, and one git workspace re-pointed across repos leaves the prior target's untracked build output for the next base verification | **HAND-FIXED THIS SITTING** — `probe.ts:355-364`, +1 test (199 green) |
| F-283 | 🔴 | no corpus task carries `fix_ref` and `AUTHORING.md` never mentions it — WP-593/595/596 built for evidence nobody can produce; gating today's corpus would drop `brownfield-001`, the only separating task | **→ WP-597 (queued)** — the next headline, `examples/dogfood/dogfood-128-wp597-probeable-corpus.yaml` |
| F-282 | 🟠 | the ledger was written non-atomically; a kill mid-write truncates it and F-275 then (correctly) refuses the whole file — total loss of a multi-hour sweep | **HAND-FIXED THIS SITTING** — `probe.ts:77-91` temp+rename |
| F-278 | 🟡 | `--base-verify-minutes` existed only on `run`; both probe APIs' `baseVerifyTimeoutMs` was unreachable from the CLI (F-274's shape) | **HAND-FIXED THIS SITTING** — `main.ts:36-50,494-503`, +1 CLI test |
| F-279 | 🟡 | the sweep's `discriminating` count included entries taken at a ref pair that has since moved | **HAND-FIXED THIS SITTING** — `probe.ts:389-400` |
| F-281 | 🟡 | the sweep re-walked the task dir by hand, forking the selection rules `run` uses | **HAND-FIXED THIS SITTING** — `suite.ts:26-52` `sources` map, duplicate walk deleted |
| F-280 | 🟡 | the sweep test's name claimed a moved-ref case its body never ran | **HAND-FIXED THIS SITTING** — moved-ref case added |
| F-268 | ℹ️ | executor meters $0.00 — `gemini` is an unversioned alias absent from `pricing.ts` | recurrence → **WP-592 (queued)** |
| F-265 | ℹ️ | `0 tool calls` reported for a 4-file delivery | recurrence → **WP-590 (queued)** |

## Verdict on the thesis

The executor got the hard part right. Durability is easy to claim and easy to
fake, and the obvious fake — accumulate verdicts, write once at the end — is
exactly what the ACs were built to reject. It was rejected. The skip decision
keys on the ref pair rather than the task id, one bad task is a result instead
of an ending, and the exit code refuses to call stale proof current. Three
minutes, five cents, 231 lines.

And the judge said 6/6 over a delivery with a 🔴 in it. The pattern across the
last three reviews is now stable enough to name: **the ACs prove the mechanism
under the conditions the spec author imagined, and the defects live in the
conditions they did not.** Both of this delivery's checks passed `--out`, so
neither could see that the default path shares one workspace across every task
— and the consequence was a false base verdict written into the very ledger the
scoring gate was built to trust. F-277 is F-258 wearing a different hat.

The campaign-level finding is the one worth carrying. Three consecutive
headlines built probe, gate, and sweep — a complete, working, tested pipeline
for evidence that **no task in the corpus can currently produce**. Each run
passed its own acceptance criteria honestly. Nobody asked, until now, whether
the inputs existed. That is F-274 at campaign altitude: not "a gate with no
switch" but *a switch with nothing wired to the other end.* The next run wires
it.
