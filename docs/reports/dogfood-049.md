# dogfood-049 — WP-247 (cheapest partial): the pure seam-arming pre-flight decision

- **WP:** WP-247 (pre-flight seam-armed guard) — cheapest dogfoodable partial: the pure `describeSeamArming` decision.
- **Date:** 2026-06-23
- **Spec:** `examples/dogfood/dogfood-049.yaml` (`dogfood-049-wp247-seam-arming-precheck`)
- **Run-id:** `run-26e74ad3-901e-4671-b669-38cd60b76736`
- **Landed commit:** `dde765b` (`feat: implement seam-precheck utility to verify bad-diff configuration and improve test cleanup reliability`)
- **Runtime:** HEAD at launch ≈ `4599a3c`
- **Gate verdict (pre-launch):** ✅ PROCEED
- **Verdict:** 🟢 **SUCCESS in 1 step — clean one-shot, delivery verified independently.**

## Vibe check (plain English)

The agent wrote a small pure function, `describeSeamArming(env)`, that looks at the
four `CHIKORY_SEED_BAD_DIFF_*` environment variables and reports whether the
deterministic "bad-diff" judge-catch seam is **armed** or **disarmed** — plus a
warning when it's armed but would seed an empty file. This is the brain behind a
future launcher banner so an operator can see *before a run finishes* whether the
seam they rely on is actually switched on. It removes the **F-48 footgun** that
silently burned the dogfood-047 headline (a seam-requiring chain launched disarmed
greened without ever entering the catch path). One-shot SUCCESS, $0.54, no judge
catch needed — and the full SDK suite stays green (449 passed).

## Trace excerpt

```
run run-26e74ad3-901e-4671-b669-38cd60b76736 · SUCCESS · 1 steps · $0.54 / $5.00 · 2m 24s · executor codex(openai) · judge openai-compat
 #   step                                 tokens(in/out)   cost     verdict
 1   Implemented the WP-247 seam pre-fli… 387k/4.6k        $0.53    ✓ PROCEED (1/1 criteria)
totals: decisions 1 · judge passes 1 ($0.01, 1.3%) · rollbacks 0 · escalations 0
        injections 0 · checkpoints 1 · feedback frequency 1/1 steps
```

| Metric | Value |
| --- | --- |
| Terminal state | 🟢 SUCCESS (1 step, `max_steps` 8) |
| Total cost | **$0.5362** exact (`$0.54` header) / $5.00 budget = **10.8%** |
| Step 1 cost / tokens | $0.5292 · **387k in / 4.6k out** · 2m 9s · 19 tool calls · diff 4791 bytes |
| Judge pass #1 | `openai-compat/gemini-3.1-pro-preview` · **$0.0070** · 6329 evidence bytes · 14s · ✓ PROCEED (1/1) |
| Judge share | **1.3%** (cap was 50%) |
| Duration | 2m 24s |
| Family diversity | 🟢 `codex`/**openai** executor vs Google `gemini-3.1-pro-preview` judge |
| Checkpoint | `run-26e74ad3-…@3` · commit `3d1cecfa3ab7` · lastGood true |
| Probe step (F-11) | none — no empty-diff step this run |

**Acronyms:** *WP* = work package (a unit on `plan.md` §6). *AC* = acceptance
criterion (the machine-graded `check` the judge re-runs). *Seam* = the
`debug.seedBadDiff` injection that deterministically corrupts a file after the
executor finishes, forcing the judge to catch a regression on demand. *Family
diversity* = executor and judge from structurally different model families (bias
mitigation, a core thesis invariant).

## Delivery quality (human review, post-landing)

🟢 **The landed code is correct and matches the spec line-by-line.**

- `packages/sdk-ts/src/cli/seam-precheck.ts` (48 lines) — `SeamArmingReport`
  interface + pure `describeSeamArming(env)`, both with JSDoc, named-export ESM, no
  default export. Semantics verified against the spec and the real host-side readers
  (`cli/chain.ts:158-171`, `cli/commands.ts:235`):
  - `armed === true` **iff** `CHIKORY_SEED_BAD_DIFF_PATH` present and non-empty. ✓
  - When armed: `path` set; `atStep = Number(…_AT_STEP ?? 0)`; `nodeIndex` present
    **only** when `…_NODE_INDEX` is in the env (spread-omitted otherwise — the
    interface's optional field stays truly absent). ✓
  - Disarmed: `atStep 0`, `path`/`nodeIndex` absent, `warnings []`,
    `lines: ["no seam armed"]`. ✓
  - Armed + empty/missing `…_CONTENT` ⇒ exactly one warning ("seam will seed an
    empty file"). ✓
  - `lines[0]` starts with the literal `🧪 seam armed` and includes the path (and
    node index when present). ✓
- `packages/sdk-ts/src/index.ts:114` — re-exports `describeSeamArming` +
  `type SeamArmingReport` next to the `evaluateBaselinePrecheck` re-export. ✓
- `packages/sdk-ts/test/cli/seam-precheck.test.ts` (57 lines, 4 tests) — all four
  mandated assertions present **verbatim** (grep-pinned per F-49) + the
  armed-no-CONTENT warning assertion. ✓

**Independent verification (not the run's own green):**

- The run's own AC-1 re-run against the working tree by `dogfood-verify.sh` §3:
  **PASS, exit 0** (`grep`-pins + `vitest` 4/4 + `tsc --noEmit` + `eslint .`).
- Full SDK suite re-run by hand: **🟢 449 passed | 19 skipped (468)**, 20.95s —
  including the seam end-to-end path (`verdict-gating.test.ts` "seedBadDiff ARMED…")
  and `chikory land (WP-220)`. The operator's `land.test.ts` cleanup edit (see F-51)
  did not break anything.
- **Scope discipline:** the run itself touched exactly **3 files** (`seam-precheck.ts`,
  `seam-precheck.test.ts`, `index.ts` — judge rubric `scope_matches_instruction ✓`).
  The spec's "touch ONLY these two files [+ the index re-export]" was honored by the
  *run*.

## New friction

### F-51 — the harvest commit conflated run output with an unrelated operator hand-edit, and cites no run-id

**Evidence.** The landed commit `dde765b` changed **4 files**:
`seam-precheck.ts`, `index.ts`, `seam-precheck.test.ts` (the run's 3 files) **plus**
`packages/sdk-ts/test/cli/land.test.ts` (+13/−1: a `rmRecursive` retry-wrapper for
flaky macOS `rm` during `chikory land` test cleanup). The **run never touched
`land.test.ts`** — the step-1 diff (4791 bytes) and the judge's
`scope_matches_instruction ✓` both confirm 3 files. So `land.test.ts` is an
**operator hand-edit** folded into the harvest commit (the commit subject even bolts
on "and improve test cleanup reliability"). Two costs:

1. **Audit-trail pollution.** A reader trusting the harvest commit as "what the run
   produced" sees a 4th file the agent never wrote. The run/delivery boundary blurs —
   exactly what the dogfood audit trail (`.chikory/runs/<run-id>` + a clean harvest)
   is supposed to keep crisp.
2. **Broken run-id traceability.** `dde765b`'s message cites no run-id, so
   `dogfood-verify.sh` §6 (`git log --grep <run-id>`) reported **"no landed commit
   found"** and the skill's own phase-1 `git log --grep <run-id>` step fails. The link
   from run → landed commit survives only by date/subject guesswork. dogfood-046/047/048
   harvest commits (`5b6ca24`, `37cddb1`, `2c516d5`) are **equally run-id-less** — this
   is a standing convention gap the verify script's §6 mechanically depends on, not a
   one-off.

**WP it spawns → WP-249.** Harvest-commit hygiene: (a) land the run's harvested diff
in its **own** commit, separate from operator hand-edits (the `land.test.ts` flaky-rm
fix is a legitimate fix — it just belongs in its own `fix:` commit); (b) put the
run-id in the harvest commit message (a `Ref: run-id: <id>` trailer) so
`git log --grep` and `dogfood-verify.sh §6` resolve the landed commit deterministically.
Cheapest partial: a `chikory land`/harvest path that stamps the `Ref: run-id:` trailer
automatically (it already knows the run-id). Tag 🟡 — it's audit-integrity debt on the
dogfood loop's own ground truth, not a product-thesis pillar.

**No new friction from the run mechanics themselves** — cost telemetry non-zero and
sane ($0.5292 step, $0.0070 judge, both models priced), no filler/probe step, judge
executed its check (`exited 0`), family diversity real, no duplicate journal entries,
single checkpoint `lastGood true`. F-11 (empty-diff probe cost) did not recur. The
one-shot SUCCESS is honest data: a pure branchy function with grep-pinned assertions
that the `codex`/`gpt-5.5` executor got right first try (387k input tokens for ~48
lines — consistent with the recent 525k–757k single-step reads on comparably small
pure functions; baseline data for WP-203/WP-207).

## Verdict on the thesis

🟢 **Net-positive, on-pillar, and it pays down a real loop footgun rather than
re-proving a settled mechanism.** dogfood-046/048 already proved the judge-catch
(per-run and chain-level); this run did **not** re-prove it on fresh scaffolding —
it delivered the pure core of the **operability** WP (WP-247) that stops the next
operator from silently launching a seam-spec disarmed (the F-48 mode that cost
dogfood-047 a whole headline). The function is now on HEAD; the thin launcher wire
(`console.error(describeSeamArming(process.env).lines.join("\n"))` in
`cli/chain.ts` + `cli/commands.ts`) is a 2-line frozen-launcher edit to hand-land as
a TASK-PROTOCOL §4 follow-up.

**Residuals carried forward:**

- **F-47 → WP-245** (seam still journals **zero** telemetry — every armed run's trace
  reads `injections 0`, masking the most important catch). Now the **top** remaining
  observability debt and the chosen next headline (dogfood-050).
- **F-48 → WP-247** — the pure decision landed; the **structural** guard (launcher
  refuses/warns a disarmed seam-spec) and the banner wire are still owed.
- **F-50 → WP-248** (graded gate enforces behaviour + assertions but not all spec
  prose — e.g. mandated JSDoc).
- **F-51 → WP-249** (harvest-commit hygiene — *new this report*).
