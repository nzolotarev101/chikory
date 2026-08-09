# dogfood-128 — a probeable benchmark corpus (WP-597)

**WP:** WP-597 (probeable corpus) · **Date:** 2026-08-08 ·
**Spec:** `examples/dogfood/dogfood-128-wp597-probeable-corpus.yaml` ·
**Run:** `run-951a565d-73a5-4cc8-a230-9b63d872fba9` · **Landed:** this review's commit ·
**Ladder:** P3-rung-5 prerequisite (WP-530 moat ladder) — rung unchanged at 4

## Plain lead

Four of the five benchmark tasks knew where their upstream fix lived, but only
in a human-readable comment no tool could read. This run moved that knowledge
into the field the probe actually reads, wrote the rule into the authoring
guide so future tasks carry it, and taught the product to say "this task can
never be probed" instead of reporting it as a crash. One agent step, 2m 09s,
four cents, both acceptance checks pass, all four gold-patch commits verified
by hand to be the real upstream fix.

**It did not unblock what it was built for.** The corpus went from 0 to 4
probeable tasks — but the fifth, `brownfield-001`, is the *only* task that
separates the two published benchmark arms, and it still has no gold patch.
The product now reports the real corpus as unprobeable and the sweep over it
can never exit 0. The blocker moved; it did not clear.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 1 step · 2m 46s |
| cost | **$0.0425** of $15.00 budget (**0.3%**) — judge share **100.0%** |
| executor | `gemini-cli` (gemini family) · **$0.0000 UNPRICED** on 3,865 metered tokens · **0 tool calls** on an 8-file delivery |
| judge | `openai-compat` / `gpt-5.6-sol xhigh` · 1 pass · $0.0425 · 33 s · 9,019 evidence bytes |
| verdicts | ✓ PROCEED (2/2 criteria, 6/6 rubric) · rollbacks 0 · escalations 0 |
| checkpoints | 1 (`@5`, commit `806b12e1279a`) · `lastGood` true · resumes 0 · injections 0 |
| pacing | 1 event · peak window **75%** · compact 0 · park 0 |
| diff | 8 files · +37 / −4 (8,730 bytes) |
| harvest | 8/8 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 2.9k / 917 | $0.0000 (unpriced) | 2m 09s | ✓ PROCEED (2/2 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

Landed files (all 8 byte-identical to the run workspace):

| file | change |
|---|---|
| `benchmarks/harness/src/main.ts` | `--require-probeable` on `validate` (+10) |
| `benchmarks/harness/src/probe.ts` | `unprobeable` as its own sweep outcome + count (+13/−2) |
| `benchmarks/harness/test/probe.test.ts` | sweep expectation `failed` → `unprobeable` (1 line) |
| `benchmarks/tasks/AUTHORING.md` | gold-patch rule + Format v1 block + checklist row (+12/−1) |
| `brownfield-002` / `003` / `004` / `005` | one `fix_ref:` line each |

### The four gold patches are real — verified independently, not taken on trust

AC-2 proves a declared `fix_ref` resolves in the task's own repo and descends
from the pinned base. That rejects an invented sha but would still accept a
*resolvable wrong* one. Each was therefore fetched by hand and read:

| task | repo | declared `fix_ref` | commit subject at that sha | distance from base |
|---|---|---|---|---|
| `brownfield-002` | `gitify-app/gitify` | `8043b106…abd9` | `refactor(accounts): move account crud into the accounts store (#3036)` | 1 commit |
| `brownfield-003` | `colinhacks/zod` | `34f60159…5324` | `fix(v4): clone Map and Set in shallowClone … (#5855)` | 1 commit |
| `brownfield-004` | `react-hook-form` | `69da9545…84f6` | `🐞 fix: clear internal errors state on argument-less clearErrors() (#13613)` | 1 commit |
| `brownfield-005` | `trpc/trpc` | `dfbafa8e…7f95` | `fix(client): abort JSONL stream on httpBatchStreamLink unsubscribe (#7390)` | 1 commit |

Every one is the **direct child** of the pinned base and its subject matches
the PR/sha each task already named in prose (`#3036`, `#5855`, `69da9545…`,
`dfbafa8e…`). This is transcription, not invention — **trap A rejected**.

### Traps

| trap | rejected? | evidence |
|---|---|---|
| A — invent a plausible sha | ✅ | all 4 resolve, descend from base, trees differ; subjects match the declared upstream PR |
| B — make `fix_ref` mandatory | ✅ | plain `validate benchmarks/tasks` still exits **0** (5 valid, 0 invalid) |
| C — documentation only | ✅ | `--require-probeable` and the sweep both changed behavior |
| D — report a missing patch as a crash | ✅ | `unprobeable` is a separate count; the `failed` count stays 0 |
| E — regress WP-596 / WP-595 | ✅ | re-sweep still skips proven work untouched; per-task `--out` dirs intact |

### Scope

Exactly the 8 files the goal implies. No new dependency, no `any`, no task
`goal`/`requirements`/`status`/`repo.url`/`repo.ref` touched. Full suite green
before hand-fixes: harness **199**, sdk-py **84**, chain-harvest integration PASS.

## New friction

### 🟠 F-284 — WP-597 did not unblock the thing it was built to unblock

The whole probe → gate → sweep stack (WP-593/595/596/597) exists to make
rung-5 corpus evidence trustworthy. Measured against the real corpus after
landing:

```
$ node dist/bin.js validate ../tasks --require-probeable
UNPROBEABLE brownfield-001: missing repo.fix_ref
../tasks: 5 valid, 0 invalid
exit=1
```

Consequences, all three load-bearing for rung 5:

- **`validate --require-probeable` can never pass** over `benchmarks/tasks/`,
  so it cannot be adopted into `devbox run bench` (the $0 authoring guard).
- **`probe --tasks benchmarks/tasks` can never exit 0** — the sweep's exit
  contract (WP-596) is unsatisfiable on the only corpus it exists for.
- **The WP-595 gate would exclude `brownfield-001`'s requirements from the
  score** — and dogfood-123's entire published separation between Chikory
  [83.2%, 100.0%] and raw Claude Code [75.4%, 99.1%] comes from that one task.
  Arming the gate today makes the published comparison *weaker*, which is
  exactly the hazard the spec's own preamble named.

Root cause is a design gap, not executor disobedience: `runProbe` materializes
the fix from the task's **own** `repo.url` (`probe.ts:121-122`,
`ensureGitWorkspace(fixWorkspace, repoUrl, fixRef)`), so a gold patch that
upstream never authored — `brownfield-001` is a self-performed zod v3→v4
migration — **cannot be expressed at all**. The plan row for WP-597 said the
patch should be "self-authored when upstream never made one"; the spec relaxed
that to prose-only exemption, and the ACs only checked the prose.

**→ WP-598 (queued, next headline).** A gold patch whose commit does not exist
upstream must still be probeable — the fix source has to be declarable
separately from `repo.url`. The tempting wrong fix is an `exempt: true` escape
hatch that waves a task past the gate unproven, which un-does WP-593/595
entirely.

### 🟡 F-285 — the new flag was undiscoverable, and a typo read as "corpus fine"

`--require-probeable` appeared nowhere in `USAGE`, and `parseFlags`
(`main.ts:137-161`) accepts **any** `--flag` and silently ignores unknown ones
— a documented precondition of the spec that nobody then guarded. So
`validate ../tasks --require-probable` (one letter) exited **0**: a false green
on the exact check meant to catch an unprobeable corpus.

**HAND-FIXED THIS SITTING** — `main.ts:35-38` (USAGE entry),
`main.ts:141-142` + `main.ts:183-191` (`VALIDATE_FLAGS` allowlist; an unknown
flag on `validate`/`list` is now named and exits 1). +2 tests
(`test/main.test.ts`), harness **199 → 201** green.

### 🟡 F-286 — the gold-patch rule is enforced nowhere authors actually run

`scripts/bench.sh:20` — the `devbox run bench` $0 guard — calls
`validate benchmarks/devai/instances benchmarks/tasks` **without**
`--require-probeable`. The rule lives in `AUTHORING.md` prose and in a flag no
pipeline passes, so the next pinned brownfield task authored with no `fix_ref`
still goes green. This is F-283's shape one WP later: the check exists, nothing
drives it.

Not hand-fixable today — wiring the flag in would turn `devbox run bench` red
immediately on `brownfield-001` (F-284). **→ WP-598 (queued)**, same slice: the
flag goes into the $0 guard in the commit that makes the corpus able to pass it.

### 🟡 F-287 — an AC "the file must STATE why" passed on prose that predates the run

AC-2 required `brownfield-001` to state why it carries no fix ref:

```
A(/no upstream|never did this migration|self-performed|exempt/i.test(one.raw), …)
```

`brownfield-001` is **unmodified** in the delivered diff. The regex matched a
pre-existing parenthetical on line 27 — `# zod-3 HEAD, before any v4 upgrade
attempt (upstream never did this migration)` — which explains the **`ref` pin**,
not a `fix_ref` exemption. The assertion was green before the run started, so
it measured nothing about the delivery.

Joins the F-274/F-277/F-283 family (an AC must drive the real entry point) with
a new altitude: **an AC that greps a file for prose is satisfiable by prose that
already exists** — it must assert text the delivery had to *add*, or assert a
behavior instead. **→ track-B note** (AC-authoring rule, recorded in
DOGFOODING §8; no WP).

### ℹ️ F-9 recurrence — cost meter blind on the executor family

`⚠ cost meter blind (unpriced tokens)`: the step reports **$0.0000** on 3,865
metered tokens because `gemini-cli` has no entry in `pricing.ts`. Judge share
therefore reads 100.0% by construction. Known, unchanged, no new WP.

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-284 | 🟠 | the one task carrying the published separation is still unprobeable; `--require-probeable` and the sweep can never pass over the real corpus | **→ WP-598 (queued — next headline)** |
| F-285 | 🟡 | `--require-probeable` undocumented; an unknown flag was silently ignored → false green | **HAND-FIXED THIS SITTING** — `main.ts:35-38,141-142,183-191`; +2 tests, harness 199 → **201** |
| F-286 | 🟡 | `devbox run bench` validates without the flag, so a new task with no `fix_ref` still passes the $0 guard (`scripts/bench.sh:20`) | **→ WP-598 (queued)** — cannot wire until F-284 clears |
| F-287 | 🟡 | AC-2's "must STATE why" matched pre-existing prose on an unmodified file | **track-B note** (DOGFOODING §8 AC-authoring rule) |

## Verdict on the thesis

**Positive.** A loosely-specified, cross-file, five-repo-lookup task with five
named traps was delivered correctly in one step for four cents, and the
independently-verified evidence (four upstream commits fetched and read by
hand) says the agent did lookup and transcription rather than invention — the
single failure mode that would have silently corrupted every future score.

**The standing caution is now four runs old.** dogfood-125/126/127/128 each
delivered a real product WP and each recorded `rung=4`: probe → gate → sweep →
corpus, all prerequisites to the P3 exit gate, none of them the gate. The
progression gate reads ⛔ STALLED with ⚠️ LADDER-PACE. F-284 is the reason the
rung still cannot run, and it is now a *named, measured, single* blocker rather
than a diffuse "the corpus is too small" — which is progress, but the pace
argument only survives one more prerequisite.

**Judge behavior:** 2/2 criteria + 6/6 rubric, both checks genuinely executed
(`all 2 judge-executed checks exited 0`), rationales specific to the diff
(the rubric named the single flipped test assertion). Family diversity real —
executor `gemini-cli`, judge `openai-compat`/`gpt-5.6-sol`. **0 true
positives**: every defect this review found was outside what the ACs asked, and
F-287 shows one AC was satisfiable without the run.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 1 step / 2m 46s | 4 steps (dogfood-125) over trailing 3 |
| kill → resume count | 0 | 0 over trailing 3 |
| judge true-positives pre-land | 0 | 1 over trailing 3 (dogfood-125) |
| meta:product headline ratio | product | **0:3** (126, 127, 128 all product) |
| per-step reliability (runs ≥5 steps) | n/a (1 step) | **94.5%** — 9 rollbacks / 164 steps, 20 runs; target 99%+ |
| ladder rung vs exit gate | **4** | exit gate = **rung 5**; unchanged across 125–128 |
