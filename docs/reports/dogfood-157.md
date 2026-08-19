# dogfood-157 — the next agent in a chain is now told its predecessor's gate never ran (WP-637 + WP-636)

**WP:** WP-637 (a dependent node's prompt must say its predecessor's gate never ran) + WP-636 (the
live chain record and the disk-restored one must agree) · **Date:** 2026-08-19 ·
**Spec:** `examples/dogfood/dogfood-157-wp637-predecessor-verdict-reaches-successor.yaml` ·
**Run:** `run-8b00e28a-3abf-4f91-bd92-4438c79087b0` · **Landed:** this review's commit ·
**Ladder:** rung-0 (off-ladder) — P3's ladder is WP-530 (moat ladder); its next rung, rung-5, is
WP-304's operator-run benchmark arm, which cannot be a spec

## Plain lead

When one agent in a chain hands work to the next, the second agent's written brief now says **which
check never finished** on the work it is building on — previously that brief was byte-identical
whether the first agent's suite passed or was killed by the clock. The judge caught a real design
defect mid-run (the fix was a local patch at the loop instead of at the source that every caller
reads) and the loop **repaired it in the next step**: the third consecutive run where a judge catch
drove a repair rather than a shipped defect.

## Trace

| field | value |
|---|---|
| terminal | 🟢 SUCCESS · 2 steps · 11m 15s |
| cost | **$0.1428** of $20 budget (**0.7%**) — judge share **100.0%** |
| executor | `gemini-cli(gemini)` — **cost meter blind**: 5,985 tokens metered, $0.0000 attributed (F-397 recurs) |
| judge | `openai-compat` (`gpt-5.6-sol`, xhigh) · 3 passes |
| verdicts | rollbacks 0 · escalations 0 · resumes 0 |
| checkpoints | 2 · injections 0 |
| acceptance | AC-1 PASS · AC-2 PASS · AC-3 PASS (re-run in the working tree (brownfield — harvested delivery)) |
| harvest | 7/7 files byte-**IDENTICAL** to the run workspace |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
| 1 | 4.5k/1.5k | $0.0000 | 3m 16s | ✗ 2/3 criteria — AC-1 RED (judge caught the design defect) |
| 2 | 6.2k/2.1k | $0.0000 | 2m 46s | ✓ PROCEED (3/3 criteria) |

No empty-diff probe step — **F-11 (wasted probe step) did not recur**.

## Delivery quality (human review, post-landing)

**Landed files** (7 — 3 source, 4 test; `git status --short`):

| file | change |
|---|---|
| `packages/sdk-ts/src/chain/node-spec.ts` | `deriveNodeOutcome` gains an optional third parameter (`:344`) and spreads the marker onto the outcome only when defined (`:350`) |
| `packages/sdk-ts/src/chain/activities.ts` | `readNodeResult` passes the child's marker into `deriveNodeOutcome` (`:254`), so `NodeResult.outcome` itself carries it; `recordNodeSealed` builds a clean `persistedOutcome` (`:301`) and hoists the marker to the payload's top level (`:312`) |
| `packages/sdk-ts/src/chain/compaction-note.ts` | the successor's note renders `inconclusive_check: <check>` **before** `changed_paths` (`:39`–`:41`) |
| `test/chain/activities-inconclusive.test.ts` | live-vs-restored equality on real journals + both notes (`:61`); the bounded-note case (`:263`) |
| `test/chain/compaction-note.test.ts` | marker rendered (`:122`), clean note byte-exact (`:145`), marker survives an over-cap path list (`:164`) |
| `test/chain/advance.test.ts` | the fold preserves the marker (`:112`) |
| `test/chain/node-spec.test.ts` | attaches when supplied, key absent when not (`:291`) |

Suite grew **1603 → 1609** (+6), which clears AC-3's floor of 1607.

**The goal, line by line.**

| goal clause | verdict | evidence |
|---|---|---|
| live fold and disk-restored fold agree on `nodeOutcomes[id]` | 🟢 | the marker is attached at `deriveNodeOutcome` (`src/chain/node-spec.ts:350`), so `readNodeResult`'s outcome (`src/chain/activities.ts:254`) is already complete when `chain-loop.ts:355` folds it; `chainRecordFrom` (`src/chain/store.ts:301`) rebuilds the same object |
| the successor's note names the check that never ran | 🟢 | `src/chain/compaction-note.ts:39`–`:41`; the note is the only channel into a dependent node's prompt (`src/chain/chain-loop.ts:255`, single call site — `grep -rn buildStructuredCompactionNote src/`) |
| trap 1 — silence stays silent, byte for byte | 🟢 | conditional spread means no key when absent; pinned byte-exact at `test/chain/compaction-note.test.ts:145` and again inside AC-1 |
| trap 2 — the note stays bounded and the marker survives | 🟢 | marker line sits **above** the unbounded `changed_paths`, and `limit()` clips the tail (`src/chain/compaction-note.ts:12`); pinned at `test/chain/compaction-note.test.ts:164` (400-path input, note ends `...`) |
| trap 3 — WP-618's durable representation intact | 🟢 | `persistedOutcome` (`src/chain/activities.ts:301`) strips the marker from the persisted `outcome` and re-adds it top-level (`:312`); the committed WP-618 test that pins this stayed green |
| `NodeOutcome`'s value set unchanged | 🟢 | no `INCONCLUSIVE` status anywhere; `src/types.ts:857`–`:862` untouched this run |
| planner / plan gate / reducer arithmetic / budget / Python mirror / TaskSpec untouched | 🟢 | `git diff --cached --stat` — 3 source files, all `src/chain/` |

**Independent verification the ACs did not do.** Three things the checks took on trust, verified
by hand this review:

- **Every reader of the widened value.** `grep -rn "nodeOutcomes" src/` returns 12 reader
  modules. The two that render an outcome for an operator (`src/chain/read-trace.ts:45`,
  `src/chain/trace.ts:17`) already branched on the marker from WP-618 and now see it on **live**
  records too — a strict gain, no double-render. The reducers (`src/chain/advance.ts:22`,
  `src/chain/replan.ts:95`) read `.status` only, so the marker cannot move chain status.
- **The strict schema.** `NodeOutcomeSchema` is `.strict()` (`src/schemas.ts:659`) and already
  admitted the field from WP-618 (`:657`) — the additive field would otherwise have died at
  validation (F-380's family).
- **The one live path that still disagreed** — see F-399 below; found by probe, hand-fixed.

**The designed trap was rejected — but only after the judge forced it.** The spec's trap was the
one-line fix that reads the marker off `record.nodeOutcomes[pred.id]` inside the note: it compiles
and passes any test built through `chainRecordFrom`, and is dead on every live chain. Step 1 did
not take that trap, but took a *sibling* of it — enriching the outcome with a **local adapter
inside `chainLoop`** rather than at the source. AC-1 (which folds the real `readNodeResult` outcome
through `advanceChain`) went RED, and the judge's `design_serves_overall_goal` rubric named the
reason in its own words: *"the consumed advanceChain seam still loses the marker when passed the
real readNodeResult outcome."* Step 2 moved the attachment to `deriveNodeOutcome` and **deleted**
the adapter — the final diff touches no `chain-loop.ts` at all.

**Scope discipline.** 🟢 3 source files, all `src/chain/`, all named or entailed by the goal. No
new dependencies. `chain-loop.ts` was edited in step 1 and fully reverted in step 2 (no net diff
from the run; this review then edits it for F-399).

## New friction

### F-399 🟡 — the WP-521 seeded-fail drill branch still folds an outcome the journal disagrees with

The delivery makes live and restored records agree **everywhere `result.outcome` is folded** — but
`chainLoop` has one branch that does not fold `result.outcome`. When the WP-521 force-fail seam
fires (`CHIKORY_SEED_CHAIN_FAIL_NODE`, `src/chain/chain-loop.ts:334`), the loop folds a bare
literal, while `recordNodeSealed` still persists the child's marker top-level. Probed this review
against the harvested tree, driving the real activities:

```
LIVE    : {"status":"FAILED","verdict":"HALT"}
RESTORED: {"status":"FAILED","verdict":"HALT","inconclusiveCheck":"suite_killed_at_cap"}
```

That is exactly the WP-636 invariant the run was launched to establish, with one branch left open —
and it is the branch the chain-heal and replan drills run on. **HAND-FIXED THIS SITTING.**

### F-400 ℹ️ — the run summary table reports the *last* judge pass per step, so the final step reads `(0/0 criteria)`

`chikory trace <run-id>` renders step 2 as `✓ PROCEED (0/0 criteria)`, while `--step 2` shows that
step's acceptance pass was **3/3**. `verdictsByStep` keeps the last verdict at each step index
(`src/cli/trace.ts:183`, `map.set` with no guard), and the completion review — which evaluates
rubric items and **no** acceptance criteria — is journaled at the final step. So on every run that
gets a completion review, the summary line an operator reads first understates the last step's
acceptance evidence. The `dogfood-verify.sh` facts pack reads the acceptance pass instead, so the
two renderers of one journal disagree. Cosmetic, but it is the same "two reconstructors" shape this
campaign keeps paying for. **track-B note.**

### F-397 ℹ️ recurs — `⚠ cost meter blind` on a run whose $0.00 is correct

Header prints `⚠ cost meter blind (unpriced tokens)`; both steps show `$0.0000` against 5,985
metered tokens; judge share reads **100.0%**. Unchanged from dogfood-156: the executor's capability
entry declares it `subscription-linked` / `zero-wire-cost`, so the figure is right and the warning
is noise. Already recorded in DOGFOODING §8. **track-B note.**

### F-398 ℹ️ recurs, further reduced — launch narration still opens the persisted summary

Step 1's summary opens with **4 lines / ~242 B of 4,243 B (5.7%)** of *"I have launched the test run
… Waiting for the test execution to complete."*; step 2 with **1 line / ~80 B of 5,739 B (1.4%)**.
It rides into the next step's prompt and the pacing estimate. Down again from dogfood-156's 6.7%
and F-306's original 16%. **track-B note.**

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| F-399 | 🟡 | the seeded-fail drill branch folds a bare `{FAILED, HALT}` literal while the journal persists the marker — live ≠ restored on the branch the heal/replan drills use | **HAND-FIXED THIS SITTING** — `src/chain/chain-loop.ts:339` now folds `deriveNodeOutcome("FAILED", "HALT", result.inconclusiveCheck)`; 1 new test at `test/chain/activities-inconclusive.test.ts:339`, verified **RED** against the pre-fix file (probe output above) and **GREEN** after; suite 1609 → 1610 |
| F-400 | ℹ️ | `chikory trace`'s step table shows the completion review's `(0/0 criteria)` as the final step's verdict (`src/cli/trace.ts:183`) | **track-B note** — recorded in DOGFOODING §7; no WP (renderer cosmetics, no loop effect) |
| F-397 | ℹ️ | `⚠ cost meter blind` fires on a declared `zero-wire-cost` executor whose $0.00 is correct (recurrence, 2nd run) | **track-B note** — already in DOGFOODING §8 |
| F-398 | ℹ️ | 242 B / 5.7% of step 1's summary is launch narration paid into the next prompt (recurrence, F-306 family) | **track-B note** — reduced, not closed |

## Verdict on the thesis

🟢 **The strongest evidence yet for the inner-loop judge.** The executor's step-1 delivery was
green on 2 of 3 acceptance checks, typechecked, lint-clean, and would have looked complete to any
diff review that read only what changed. It was also **architecturally wrong in the exact way the
spec predicted** — a patch at the consumer instead of the producer. The judge failed it on both
`tests_pass` **and** `design_serves_overall_goal`, quoted the seam by name, and the next step
rewrote the fix at the source and deleted the adapter. Three consecutive runs (155, 156, 157) where
a judge catch produced a **repair inside the run** rather than a defect on `main`.

⚠️ **The standing caution holds, and this review is its fourth data point.** The judge again
reasons about *what changed*, not about *what should have changed and didn't*: the seeded-fail
branch (F-399) sits 5 lines below a hunk it reviewed twice, folds an outcome the journal
contradicts, and no pass mentioned it. F-376's blind spot is unchanged — and the spec author's
enumeration is what caught it, not the gate.

📌 **What the ACs got right and what they cost.** AC-1 asserting at the *consumed* seam
(`advanceChain(record, id, readNodeResult().outcome)`) is what made a fake fix impossible — the
lesson from F-380/F-388/F-392/F-395 finally applied. The cost: that AC also pins the call site's
*shape*, so a loop-level fix that is equally correct in production would have been marked RED. The
judge's rubric independently argued for the source-level fix, so the outcome was right, but the AC
alone could not have told a better design from a wrong one.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | 2 steps / 11m 15s | 3 steps (dogfood-155/149) over trailing 3 |
| kill → resume count | 0 | 0 over trailing 8 runs |
| judge true-positives pre-land | **1** (step-1 design defect, repaired in-run) | 3 over trailing 3 (155, 156, 157) |
| meta:product headline ratio | product | **0:3** harness-meta over trailing 3 — cap ≤1/3 🟢 |
| per-step reliability (runs ≥5 steps) | n/a (<5 steps) | 94.7% (9 rollbacks / 170 steps, 21 runs) — target 99%+ |
| ladder rung vs exit gate | rung-0 (off-ladder) | P3 exit gate = WP-530 rung-5 (WP-304 operator-run benchmark arm) |

## NEXT RUN

**Stop a run from writing outside the folder it was told to write in, even when the files it
leaves behind are the kind git normally hides — while still letting it install its dependencies.**

- **Spec:** `examples/dogfood/dogfood-158-wp589-boundary-sees-ignored-writes.yaml`
- **WP:** WP-589 half (1) (the write-boundary check must see gitignored writes; F-264) — plan.md
  §6 calls it "the highest-value open seam"
- **Why THIS and not the ladder rung:** the §0 progression gate reads ✅ **PROGRESSING**, so the
  default candidate is P3's ladder rung — but rung-5 of WP-530 (moat ladder) is WP-304's OpenHands
  benchmark arm, a quota-bound multi-hour suite the **operator** runs by hand (dogfood-122's
  lesson), so it cannot be an agent-supervised spec and has not been since dogfood-139.
- **The designed trap:** the plausible-but-wrong delivery enumerates ignored paths and hands them
  to the same admission check. It closes the hole, typechecks, and seals **FAILED on every node
  that ever ran `pnpm install`**, because `node_modules/` is ignored and in no `writeSet` — worse
  than the hole. The mirror-image error is an exemption broad enough to re-open it. A third trap
  sits beside them: widening `RepoHandoff.changedPaths` to carry ignored paths would push them into
  the 1,200-char note dogfood-157 just fixed (F-365), so AC-1 pins that channel unchanged.
- **Premise measured AND probed at this review** (F-203/F-342): driving the real
  `publishChainHandoff` with `writeSet: ["src/a.ts"]` and a write to `results/big.txt` returns
  `{"status":"SUCCESS", … "changedPaths":["src/a.ts"] …}`.

**Gate verdicts**

| gate | verdict | one line |
|---|---|---|
| §0 progression | ✅ PROGRESSING | ladder rung-5 is operator-run (WP-304); spec-format lint 🟢 LOOSE, headers present |
| §1.1 failure surface | ✅ | 2–6 steps, cross-file, a real containment bug on the chain pillar (WP-219) — and the naive fix is worse than the defect |
| §1.2 product progress | ✅ | WP-589 is a real open plan.md §6 product WP; the mechanism is seeded into its own code, no scaffolding |
| §1.3 mission-critical | ✅ PROCEED | not busy work, not scaffold-hosted — this is the gate that failed open on 2.1 GiB |
| §1.5 friction budget | ✅ | `class=product`; trailing-3 harness-meta headlines **0/3**, cap ≤1/3 |

**AC arming evidence** — all three ACs are VERIFY-SUITE (they shell into `vitest`/`pnpm`), so the
launcher does NOT dry-run them; `dogfood-arm.sh` ran every one in both directions:

| AC | RED on HEAD | GREEN vs reference | % of 120 s cap |
|---|---|---|---|
| AC-1 | ✅ exit **1**, **2s** | ✅ exit 0, **3s** | 3 % |
| AC-2 | ✅ exit **1**, **2s** | ✅ exit 0, **3s** | 3 % |
| AC-3 | ✅ exit **1**, **76s** | ✅ exit 0, **76s** | 63 % |

Worst case **76s = 63% of the 120s judge cap**. Both REDs print their own assertion text (case A
sealing `SUCCESS`; the 400-file escape sealing `SUCCESS`), not a died-before-judging signature. The
arming pass also **corrected two fixtures against the real admission rules**: the boundary is
directory-scoped, so a sibling of a declared file is admitted (`write-set.ts:102`), and `index.*`
is auto-admitted as a barrel (`write-boundary.ts:51`) — the first draft's case C would have passed
vacuously against a delivery with no exemption at all.

```sh
devbox run -- bash -c 'CHIKORY_PREFLIGHT_ONLY=1 bash scripts/dogfood.sh --run'   # $0 preflight
devbox run run-dogfood                                                           # launch
```
