# dogfood-156 — a chain node whose gate never ran no longer reads like one whose gate passed (WP-618)

**WP:** WP-618 (a node's inconclusive outcome must survive the fan-in) · **Date:** 2026-08-18 ·
**Spec:** `examples/dogfood/dogfood-156-wp618-inconclusive-survives-fanin.yaml` ·
**Run:** `run-3ff7c55a-ba68-48af-a125-218236bbdbca` · **Landed:** this review's commit ·
**Ladder:** rung-0 (off-ladder) — P3's ladder is WP-530 (moat ladder) and its next rung, rung-5,
is WP-304's operator-run benchmark arm, which cannot be a spec

## Plain lead

When one agent in a chain hands work to the next, the second agent used to be told "the first one
passed" even when the first one's test suite was killed by the clock and nobody ever found out.
The chain now writes down **which check never finished** and prints it on that node's line, while a
node whose checks really ran gains nothing at all. The judge caught one genuine design defect
mid-run — the marker was being stored in two places at once — and the loop **repaired it in the next
step** rather than shipping it: the second consecutive run where a judge catch drove a repair.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 2 steps · 13m 48s |
| cost | **$0.1925** of $20 budget (**0.9%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **cost meter blind**: 5,336 tokens metered, $0.0000 attributed (F-397) |
| judge | `openai-compat` (`gpt-5.6-sol`, xhigh) · 4 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 12/12 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 3.7k/1.6k | $0.0000 | 4m 33s | ✓ PROCEED (3/3 criteria) |
| 2 | 5.1k/1.6k | $0.0000 | 2m 18s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (12 — 8 source, 4 test; `git status --short`):

| file | change |
|---|---|
| `packages/sdk-ts/src/chain/activities.ts` | `NodeResult.inconclusiveCheck` (`:70`); `readNodeResult` reads it off the child terminal payload with a report fallback (`:252`) and sets it (`:262`); `recordNodeSealed` takes it (`:296`) and spreads it onto the persisted payload (`:307`) |
| `packages/sdk-ts/src/chain/chain-loop.ts` | passes it into `recordNodeSealed` (`:343`) |
| `packages/sdk-ts/src/chain/store.ts` | `NodeSealedPayload.inconclusiveCheck` (`:82`); `chainRecordFrom` folds it onto the reconstructed outcome (`:301`) |
| `packages/sdk-ts/src/chain/read-trace.ts` | `chikory chain trace`'s node status line gains ` · inconclusive: <check>` (`:45`) |
| `packages/sdk-ts/src/chain/trace.ts` | the table renderer's outcome cell gains ` (inconclusive: …)` (`:17`) |
| `packages/sdk-ts/src/cli/chain.ts` | the raw `node_sealed` entry line names it, via the typed payload rather than an inline cast (`:470`) |
| `packages/sdk-ts/src/types.ts` | `NodeOutcome.inconclusiveCheck?: string` (`:861`) |
| `packages/sdk-ts/src/schemas.ts` | `NodeOutcomeSchema` accepts it — the schema is `.strict()`, so this was mandatory (`:657`) |
| `test/chain/activities-inconclusive.test.ts` | new — seeds two real child journals, drives the real activities, re-opens the chain journal from disk |
| `test/chain/store.test.ts` · `test/chain/trace.test.ts` · `test/cli/chain-trace.test.ts` | +3 tests across the fold and both renderers |

**The goal, line by line.**

| goal clause | verdict | evidence |
|---|---|---|
| marker survives to what the chain **writes down** (persisted `node_sealed`) | 🟢 | `activities.ts:307` writes it; re-opened from disk and asserted in `test/chain/activities-inconclusive.test.ts` |
| marker survives to what an **operator sees** (`chikory chain trace`) | 🟢 | `read-trace.ts:45`; and the executor swept **two more** renderers the spec never named — `trace.ts:17` and `cli/chain.ts:470` |
| TRAP 1 — `NodeOutcome`'s value set unchanged | 🟢 rejected | no `INCONCLUSIVE` status anywhere; `deriveNodeOutcome` is back to its 2-arg form (`activities.ts:254`) |
| TRAP 2 — silence stays silent | 🟢 rejected | conditional spreads at `activities.ts:307`, `store.ts:301`, `read-trace.ts:45`; the clean node's rendered line is asserted **byte-exact** (`test/cli/chain-trace.test.ts`) |
| TRAP 3 — run-level plumbing untouched | 🟢 rejected | `src/runner/activities.ts`, `src/journal/journal.ts`, `src/cli/trace.ts` all absent from the diff |
| TRAP 4 — `reason` still populated | 🟢 rejected | `activities.ts:252` adds a variable; the `reason` assignment is untouched |
| tests live in the repo, not copied from the grading checks (F-356/F-360) | 🟢 | suite **1,599 → 1,603 passed** (23 skipped), 194 → 195 files. The repo tests are *stricter* than the ACs: they assert the marker's **canonical location** (`incPayload.inconclusiveCheck` present, `outcome.inconclusiveCheck` `undefined`) — something the ACs deliberately did not pin |

**Independent verification the ACs took on trust.** The ACs assert the value reaches the persisted
entry and the rendered line. They do **not** enumerate every consumer of the chain record. I swept
them: `resume-summary.ts:151` folds `node_sealed` for reopen boundaries and reads only `status`
(correct — a reopen boundary is not a gate report); `cli/chain.ts:1221` writes a second
`node_sealed` for an **abandoned** node, which has no child result at all, so no marker applies;
`reviewChainCompletion` (`chain/activities.ts:392`) reads only `.status`. One consumer does diverge
— see F-395.

**Scope discipline.** 🟢 Every file is chain-level or its test. `node-spec.ts` was edited in step 1
(a 3-arg `deriveNodeOutcome`) and fully reverted in step 2, so it carries **no net diff**. No
dependency changes, no planner/gate/reducer/budget/Python edits.

**Judge behaviour.** All 3 acceptance checks were judge-executed and exited 0 on both passes
(`db8df092f66f`, `377ea09fc123`). Family diversity is real: executor `gemini-cli(gemini)`, judge
`openai-compat/gpt-5.6-sol`. **One genuine true-positive:** judge pass #2's
`cumulative_design_coherent` found that step 1 had persisted the marker **twice** — inside `outcome`
(via a 3-arg `deriveNodeOutcome`) *and* at the payload top level, with nullish-coalescing
reconciliation at every read site, and noted the tests accepted either location. Step 2 collapsed it
to one canonical representation; pass #4 confirmed `cumulative_design_coherent` ✓. The catch did
**not** gate (verdict was `✓ PROCEED`, "non-destructive rubric failures" — the standing F-335
shape), but the loop acted on it anyway. **The judge did not find F-395**, even though
`advanceChain`'s call site sits 6 lines below a hunk it reviewed.

**F-197 duty discharged — WP-606 is live-proven.** dogfood-155 delivered
`normalizeWorkspaceRefs` but could not exercise its own fix (harness is HEAD-at-launch), and left a
signature to check here. Measured from this run's journal (`record.summary` on both `step`
entries): **10,167 bytes total, 0 `file://` URLs, 0 absolute `/Users/…` paths** — against
dogfood-155's own 14,637 B / 34 URLs. WP-606 confirmed working in production.

## New friction

### F-395 🟡 — the live chain record and the disk-restored chain record disagree about the marker

`ChainRecord.nodeOutcomes[id]` now has two truths. Reconstructed from disk, `chainRecordFrom`
merges the marker **into** the outcome object (`packages/sdk-ts/src/chain/store.ts:301`). In the
live loop it never gets there: `chain-loop.ts:349` folds via
`advanceChain(record, node.id, outcome)` where `outcome` is `result.outcome` — built by
`deriveNodeOutcome(report.status, report.lastVerdict?.kind)` (`chain/activities.ts:254`), status and
verdict only. The marker rides beside it on `NodeResult` (`chain/activities.ts:262`) and goes
straight to the journal, bypassing the in-memory fold.

So the same typed field is populated after a `chikory chain resume` (which restores through
`chainRecordFrom`) and `undefined` on a chain that never resumed. **Latent today** — no live
consumer reads it: `chain-loop.ts:443` hands `record.nodeOutcomes` to the WP-311 chain-completion
judge, which reads only `.status` (`chain/activities.ts:392`). But this is exactly the
F-380/F-388/F-392 shape the spec warned about, one hop past where the ACs looked, and the next
reader of `record.nodeOutcomes[x].inconclusiveCheck` in the loop gets silence. **→ WP-636.**

### F-396 🟡 — a dependent node's prompt still cannot see that its predecessor's gate never ran

The spec's own thesis line is *"a dependent node must not build on a node whose verdict was never
actually earned."* That is still not true. The only channel carrying a predecessor's outcome into
the child's context is `buildStructuredCompactionNote` (`packages/sdk-ts/src/chain/compaction-note.ts:29`,
called at `chain-loop.ts:254`), and it renders exactly three fields —
`outcome` (`compaction-note.ts:37`), `verdict` (`:38`), `changed_paths` (`:39`). `grep -c
inconclusive` over that file returns **0**. The successor's brief is byte-identical whether the
predecessor's suite passed or was killed at cap.

This is **not a delivery defect** — the goal declared two consumed seams (the persisted entry and
the operator trace) and both were hit. It is a **scoping gap in the spec**: the thesis-KPI header
claimed compounding-error mitigation, but the acceptance surface stopped at the operator. The
compounding-error claim needs the third seam. **→ WP-637** (and the obvious next headline).

### F-397 ℹ️ — the trace warns "cost meter blind" on a run whose $0.00 is correct

Header prints `⚠ cost meter blind (unpriced tokens)`; both steps show `$0.0000` against 5,336
metered tokens; judge share reads **100.0%**. The figure is *right* — the executor's capability
entry declares it subscription-linked with `zero-wire-cost` (F-268) — but the warning says the
meter failed. An operator cannot tell a correctly-$0 subscription executor from a genuinely
unpriced model. This is the same measurement that made WP-592's premise unsafe to spend a run on.
**track-B note.**

### F-398 ℹ️ — executor summaries still open with launch narration (F-306 family, much reduced)

Step 2's persisted `record.summary` (5,615 B) opens with four lines of *"I have launched … and will
inspect the output once it finishes / I am waiting for the test suite execution to complete / I
will wait for the Vitest test task to complete"* — **381 B, 6.7%** — before any content, and that
prefix rides into the next step's prompt and the pacing estimate. WP-606 removed the *path* bloat
(F-397 above confirms 0 URLs), not the self-narration. Down from F-306's measured 16%.
**track-B note.**

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-395 | 🟡 | the live chain record's `nodeOutcomes` drops the marker that the disk-restored record carries (`chain-loop.ts:349` vs `store.ts:301`) — one typed field, two truths | **→ WP-636 (queued)** |
| F-396 | 🟡 | the successor node's compaction note renders only outcome/verdict/changed_paths (`compaction-note.ts:37`–`:39`), so the compounding-error claim is unproven | **→ WP-637 (queued)** — next headline |
| F-397 | ℹ️ | `⚠ cost meter blind` fires on a declared `zero-wire-cost` executor whose $0.00 is correct | **track-B note** — recorded in DOGFOODING §8 |
| F-398 | ℹ️ | 381 B / 6.7% of a step summary is launch narration that rides into the next prompt | **track-B note** — F-306 family, reduced not closed |

## Verdict on the thesis

🟢 **The judge is earning its place, twice running.** Three green ACs and a green suite could not
see that step 1 had persisted one fact in two places; the *cumulative-design* pass could, said so,
and the executor spent step 2 collapsing it — $0.0472 of judging bought a design repair that no
deterministic check in this spec would ever have caught. Combined with dogfood-155, that is two
consecutive repair-driving catches after a five-run drought.

🟡 **But the judge is still not the gate, and still not the sweep.** The catch rode a
`✓ PROCEED` verdict (F-335 stands). And it missed F-395 — an inconsistency six lines below a hunk
it reviewed — which is the same blind spot as F-376: the judge reasons about *what changed*, not
about *what should have changed and didn't*.

🟡 **The "assert at the consumed seam" discipline worked, as far as the seams were named.** The
spec named two consumed seams and pinned both; the executor volunteered two more renderers. What it
could not do is find the seam the spec forgot (F-396). **The lesson for the next spec: enumerating
consumed seams is now the spec author's binding job, and the enumeration must be derived from a
grep of the field's *type*, not from the narrative of the data flow.**

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 2 steps / 13m 48s | 3 steps (dogfood-155) over trailing-3 |
| kill → resume count | 0 | 0 over trailing-8 |
| judge true-positives pre-land | **1** (cumulative-design, repaired in-run) | 2 over trailing-3 (155: 1, 154: 0) |
| meta:product headline ratio | 0:1 (product) | **0:3** over trailing-3 — cap ≤1/3 not busted |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% — 9 rollbacks / 170 steps, 21 runs ≥5 steps (target 99%+) |
| ladder rung vs exit gate | rung-0 (off-ladder) | P3 exit gate = WP-530 rung-5; blocked on WP-304's operator-run benchmark arm since dogfood-139 |

## NEXT RUN

**Make the next agent in a chain read, in its own briefing, that the work it is building on was
never actually verified — and make that true on a chain that never restarted, not just one that
did.**

- **Spec:** `examples/dogfood/dogfood-157-wp637-predecessor-verdict-reaches-successor.yaml`
- **WP:** WP-637 (a dependent node's prompt must say its predecessor's gate never ran), with
  WP-636 (the live chain record and the disk-restored one must agree) entailed — WP-637 cannot be
  real without it.
- **Why THIS and not the ladder rung:** the §0 progression gate reads ✅ **PROGRESSING**, so the
  default candidate is P3's ladder rung — but rung-5 (WP-530, the moat ladder) is WP-304's
  operator-run, quota-bound, multi-hour benchmark arm. dogfood-122 established an LLM executor may
  not supervise it, so it cannot be a spec, and has not been one since dogfood-139. WP-637 is the
  seam dogfood-156's own spec forgot to enumerate, and closes the compounding-error claim WP-618
  made in its header but scoped out of its goal.
- **The designed trap:** read the marker off `record.nodeOutcomes[predecessor.id]` inside the note.
  It compiles, it typechecks, it passes any test whose record came from `chainRecordFrom` — and it
  is dead on every live chain, because `chain-loop.ts:349` folds through `advanceChain` with the
  bare `{status, verdict}`. Second trap: append the marker *after* `changed_paths`, which is
  unbounded caller input, and the 1,200-char cap silently truncates it away while every other
  check stays green. Third trap: reach rule 1 by widening the persisted payload's `outcome`, which
  turns WP-618's own committed canonical-location test RED.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ PROGRESSING | ladder rung-5 is operator-run (WP-304) and cannot be a spec; candidate must beat it on thesis value, and does |
| §1.1 failure surface | ✅ | cross-file on a thesis pillar (durable multi-run chains, WP-219); three named traps, each a plausible delivery the ACs reject |
| §1.2 product progress | ✅ | real open `plan.md` §6 product WPs (WP-636, WP-637) in `packages/sdk-ts/src/chain/` — no scaffolding, no invented utility |
| §1.3 mission-critical | ✅ PROCEED | 🟢 real-WP, not busy work: it is the one seam that carries an unearned verdict into the next agent's context |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1/3 not busted |

**AC arming evidence** — every AC is VERIFY-SUITE, so `dogfood.sh` will NOT dry-run any of them;
all three were hand-verified in **both** directions with `dogfood-arm.sh`:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **2s** | ✅ exit 0, **2s** | 2 % |
| AC-2 | ✅ exit **1**, **2s** | ✅ exit 0, **1s** | 2 % |
| AC-3 | ✅ exit **1**, **77s** | ✅ exit 0, **75s** | 64 % |

Worst case **77 s = 64 % of the 120 s judge cap**. Every RED printed the check's **own** assertion
text, not a died-before-judging signature: AC-1 failed on *"the LIVE fold must know exactly what
the RESTORED fold knows about N-1"* (`toEqual`, live vs restored), AC-2 on *"the marker must
survive the bound"* (the note was already within its cap — it simply never named the check), AC-3
on the durability floor (1603 < 1607). The throwaway reference was reverted **by name** from a
pre-edit copy; `git diff` on both touched files is empty.

⚠️ **One honest caveat on the RED pass:** it ran against a working tree carrying this review's own
WP-618 delivery, not a committed HEAD — `dogfood-arm.sh` warned. That tree is byte-for-byte what
HEAD becomes at this review's commit and is exactly what the run's workspace will clone, so the
measurement is the right one; there was no third state to confuse it with.

**The GREEN pass found a real design constraint before the run burned.** The first reference
implementation put the marker on `NodeResult.outcome` and turned WP-618's own committed test RED —
that test pins the marker's canonical durable home as *top-level on the payload*, not inside
`outcome`. That collision is now written into the spec as PRECEDENCE rule 3 rather than left for
the executor to discover mid-run. Arming in both directions is what surfaced it.

```sh
devbox run -- bash -c 'CHIKORY_PREFLIGHT_ONLY=1 bash scripts/dogfood.sh --run'   # $0 preflight
devbox run run-dogfood                                                            # launch
```
