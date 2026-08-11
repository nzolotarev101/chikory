---
name: dogfood-review
description: Post-run review of a finished Chikory dogfood run — verify the delivery independently, hunt anomalies, write the numbered dogfood report, feed friction into plan.md/REQUIREMENTS.md/DOGFOODING.md, and ready the next spec. Run after every dogfood run reaches a terminal state.
---

# Dogfood run review

Input: a run-id (`$ARGUMENTS`), or find it — latest dir in `.chikory/runs/`,
or the `Ref: run-id:` line in the harvest commit. Everything below runs via
devbox (CLAUDE.md hard rule). The procedure has five phases; do them in
order, and **do not skip phase 4 even when the run looks clean** — the
report is a first-class plan input (TASK-PROTOCOL §7), and dogfood-002
proved a SUCCESS run can still surface three plan-changing gaps.

## Scripted vs judgment — read this before anything else

Every step that is the same in every review is a script. **Use them.** Rebuilding
one by hand in the scratchpad is how a review turns into 45 approval prompts and
how transcription errors get into the report.

| step | command | approvals |
|---|---|---|
| phase 0 — harvest + evidence + progression | `devbox run -- bash scripts/dogfood-open.sh [<run-id>]` | 1 |
| phase 4 — report skeleton | `devbox run -- node scripts/dogfood-docs.mjs scaffold <nnn> --facts <json>` | 1 |
| phase 4 — bounded status blocks | `… dogfood-docs.mjs block --target dogfooding\|plan-latest --block <file>` | 1 |
| phase 4 — ledger row | `… dogfood-docs.mjs ledger <nnn> --facts <json> --wp WP-n --catches N --rung N` | 1 |
| phase 4 — README index row | `… dogfood-docs.mjs index <nnn> --outcome <file>` / `--row <file>` | 1 |
| phase 5 — arm the ACs | `devbox run -- bash scripts/dogfood-arm.sh <spec> [--green\|--table\|--extract AC-n\|--only AC-n]` | 1 |
| landing — gates + suite + commit + push | `devbox run -- bash scripts/dogfood-close.sh <nnn> --run-id <id>` | 1 |

**Yours, and not scripted:** reading every step transcript and judge pass · the
line-by-line diff-vs-goal review · the phase-3 anomaly hunt · all report prose,
friction severity and disposition · the §0–§1.5 gate verdicts · designing the next
spec and its traps · writing the throwaway reference implementation for the GREEN
arming pass.

**Three traps that have cost real time — do not relearn them:**

- **Never inline multi-line code into `devbox run -- node -e '…'`** — devbox mangles
  the newlines and you get `SyntaxError: Expected unicode escape`. Write a file and
  run it, or use a `node - <<'NODE'` heredoc with values passed through the
  environment (never string-interpolated).
- **Never rebuild a throwaway script the scripts already cover** — AC extraction,
  bounded-block surgery, ledger/README rows and check re-runs all have a
  subcommand (`dogfood-arm.sh --extract/--only`, `dogfood-docs.mjs`). Retiring
  those throwaways is the entire point of `scripts/dogfood-*`; if you find
  yourself writing one, the script is missing a flag — add it there instead.
- **Never `cd` out of the repo root, and remember the harness shell is zsh** — zsh
  does not word-split unquoted `$var`, so `for x in "a b c"; set -- $x` silently
  breaks; and a `cd` into `.chikory/runs/<id>/workspace` makes every later relative
  read resolve against the run's tree instead of yours. Every script here anchors
  itself with `cd "$(dirname "$0")/.."`; ad-hoc commands should use absolute paths.

## 0. Open the review — one command

```sh
devbox run -- bash scripts/dogfood-open.sh <run-id>   # or omit for the newest run
```

This is phase 0 in a single approval, and it is **idempotent** — safe to re-run:

1. **Harvest** the delivery onto the working tree, but only when it is
   unambiguously safe: no commit already references the run AND the tree is clean.
   Already landed → says so and reviews the tree as-is. Dirty tree with no landed
   commit → **refuses**, rather than harvesting on top of unrelated work.
2. **Evidence pack** (`dogfood-verify.sh --facts`): trace header/rows/totals ·
   per-step diff bytes, cost, checkpoint chain, judge criteria/rubric/verdict ·
   every acceptance check re-run against the tree the delivery lives in ·
   `git status --short` · harvest byte-diff vs the run workspace · cost-share with
   the empty-diff **probe step → F-11 %** data point.
3. **Progression gate** — ✅ PROGRESSING / ⛔ STALLED plus the §1.5 cap check.
   **Phase 5 is bound by this verdict.**
4. A **state-of-play** summary, and a machine-readable facts blob at
   `.chikory/review/<run-id>.facts.json`.

**That facts file is the single source for every number in the report and the
ledger row.** Pass it to `dogfood-docs.mjs scaffold` and `ledger` — do not retype
costs, steps, token counts or verdicts by hand.

## 1. Reconstruct what happened (journal is ground truth)

From the phase-0 pack: record terminal state, steps, judge passes/verdicts,
tokens in/out per step, cost vs budget, duration, executor/judge families,
checkpoint chain. **Still read every step's full transcript and every judge
pass by hand** — the pack surfaces the salient lines, not the whole
transcript:

```sh
devbox run -- pnpm chikory trace <run-id> --step <n>   # full diff/transcript refs, judge form, rationale
```

Locate the spec (`examples/dogfood/dogfood-<NNN>.yaml`, see
`examples/dogfood/README.md` index) and the harvest commit
(`git log --grep <run-id>`).

## 2. Verify the delivery independently — never trust the run's own green

The pack's §3 already re-ran every acceptance `check` against the working
tree and its §5 byte-diffed the harvested files — confirm both are green.
The judgment half is still yours:

- Review the landed diff against the spec's `goal` **line by line**: every
  named file/symbol present; conventions honored (AGENTS.md); nothing
  out of scope; no new dependencies unless the goal allowed them; for
  parity/port work, compare against the source-of-truth artifact
  (e.g. `types.ts` / CONTRACTS.md / shared fixtures).
- Confirm scope discipline against the pack's §4 / `git show --stat` — only
  files the goal names (or trivially entailed) changed. If §5 reports
  `DIFFERS`, the harvest diverged from what ran — investigate before trusting
  the green.

## 3. Hunt anomalies — the checklist that has caught real findings

Walk all of these explicitly (the phase-0 pack feeds several — cost
telemetry, token-per-step, the probe-step %, judge criteria/rubric — but the
judgment is yours); each earlier hit became a WP:

- **Wasted/filler steps**: empty diffs, "already done" summaries, steps
  spent re-verifying (F-8 → WP-217).
- **Cost telemetry**: $0.00 with nonzero tokens? model missing from
  `packages/sdk-ts/src/pricing.ts`? budget gate effectively inert?
  (F-9 → WP-218).
- **Token economics**: input tokens per step vs work done — record the
  number; it's baseline data for WP-203/WP-207.
- **Judge behavior**: did checks actually execute (look for
  "judge-executed check … exited 0")? rubric justifications sane? any
  ESCALATE/ROLLBACK — was it a true positive? family diversity real
  (shim backend ≠ executor family)?
- **Human ceremony**: count what the human did by hand around the run
  (slicing, launching, harvesting) — F-10 territory; note anything WP-219/
  WP-220 wouldn't already fix.
- **Loop integrity**: duplicate journal entries, re-executed steps after
  any resume, checkpoint/lastGood consistency.

## 4. Write the report and update the living docs

The surgery is scripted; the prose is not. Start from the scaffold so the trace
numbers are copied by a machine, then write into the `TODO` sections.

```sh
FACTS=.chikory/review/<run-id>.facts.json
devbox run -- node scripts/dogfood-docs.mjs scaffold <NNN> --facts "$FACTS"
```

1. **Report** `docs/reports/dogfood-<NNN>.md` — NNN matches the spec. The
   scaffold pre-fills the header, trace table, per-step table and harvest line.
   You write: the **plain lead**, "Delivery quality (human review, post-landing)",
   "New friction", the friction disposition table, "Verdict on the thesis" and the
   KPI table. **Friction numbering is global and sequential across all reports**
   (dogfood-001 = F-1…F-7, dogfood-002 = F-8…F-10; continue from the highest
   existing F-n). Every friction item states the evidence and names the WP it
   spawns (or says why none). **Cite `file:line` freely — `dogfood-close.sh`
   verifies every citation resolves**, so a guessed line number is caught before
   it lands (it was not, in dogfood-128).
2. **plan.md** — mark the WP/slice done in §6 (cite run-id + landed commit); a new
   friction item becomes a WP row **only within the DOGFOODING §1.5 friction
   budget** (🔴 loop-integrity → may queue as headline; anything else → track-B
   note or hand-fix, still recorded). For the bounded status block, write the
   replacement to a file and run:

   ```sh
   devbox run -- node scripts/dogfood-docs.mjs block --target plan-latest \
     --block <file> --note "dogfood-<NNN> review"
   ```

   It replaces the block, moves the displaced prose **verbatim** to
   `docs/PLAN-HISTORY.md` under a dated header, and **refuses a replacement that
   busts the ≤30-line cap**. Never prepend a new paragraph, and never raise a cap.
   Do NOT touch the §6 table header schema (`| WP | Title | Tag | Notes |` — F-81:
   adding a `Status` column would activate the staleness gate with inverted
   semantics; the close-out gate checks this).
3. **docs/REQUIREMENTS.md** — new WPs into the requirement rows they serve; reopen
   rows the findings prove aren't actually done; update WP status (e.g. IF-2
   in-progress with landed commit). Hand-edited — the rows are prose.
4. **docs/DOGFOODING.md** — new operational gotchas into §7 (troubleshooting) or §8
   (known limitations), citing the friction id; then replace the bounded header
   status block with `dogfood-docs.mjs block --target dogfooding` (≤15 lines, same
   verbatim-overflow rule — never stack "LATEST/Earlier" paragraphs).
5. **examples/dogfood/README.md** — the campaign index row:

   ```sh
   devbox run -- node scripts/dogfood-docs.mjs index <NNN> --outcome <file>  # update
   devbox run -- node scripts/dogfood-docs.mjs index <NNN> --row <file>      # insert new
   ```
6. **docs/reports/dogfood-ledger.csv** — append THIS run's row (the progression
   gate's data source; mandatory, one row per terminal run):

   ```sh
   devbox run -- node scripts/dogfood-docs.mjs ledger <NNN> --facts "$FACTS" \
     --wp WP-n --catches <n> --rung <n> [--format loose|prescribed] [--class product|meta]
   ```

   `outcome`, `steps`, `cost_usd`, `resumes` and `rollbacks` come from the facts
   blob — never retype them. You supply only the judgment columns:
   `spec_format` = `loose`/`prescribed` (what the spec actually was);
   `class` = `product`/`meta` (§1.5 definition, by the deliverable's primary
   surface); `rung` = highest CURRENT-PHASE ladder rung this run satisfied (P2 =
   WP-265, P3 = WP-530; phase-scoped, 0 = off-ladder);
   `judge_catches` = genuine true-positives only (not seam drills). The script
   validates the 12-column schema and refuses a duplicate run number.
   (`rollbacks` counts judge ROLLBACK verdicts including seam drills; drill
   catches stay excluded from `judge_catches`; pre-084 rows lack the column.)

Constraints: never rewrite the `goal`/criteria of a spec that already ran;
keep `.chikory/runs/<run-id>` (journal + artifacts are the audit trail);
docs in `docs/` listed as living docs must not drift from code.

## 5. Ready the next run

**Pick by thesis value AND product progress, not by safety — and prove it before
writing the spec.** The loop's standing failure mode is twofold: defaulting to the
safest slice (a pure 1-file parity port an agent can't fail), **and** riding a
thesis mechanism on **throwaway scaffolding that moves no product WP** — seeding a
bad diff into an invented utility just to force a judge-catch (dogfood-046 `clamp`,
047 `roundTo`/`roundToCents`, 048 `truncateDecimals`/`truncateToCents`). Both green
the dashboard while the `plan.md` backlog stands still. **You MUST apply all three
gates yourself, in order, on every candidate** — do not defer to a human trigger;
no spec is written without a recorded verdict from these gates. (`/dogfood-assessor`
remains available for an explicit second opinion; if the user already ran it, honor
its `⛔ VETO`.)

0. **Progression gate (MECHANICAL, binding — runs before all judgment gates).**
   **FIRST — phase-ladder check (a ladder ALWAYS exists).** Every phase carries
   its own graduated-proof ladder (P2 = WP-265 horizon ladder, retired at rung 5;
   P3 = WP-530 moat ladder). If the run you just reviewed is the LAST of one phase
   and the next headline opens a NEW phase (or no ladder is defined for the current
   phase yet), you MUST **author that phase's ladder BEFORE writing the next spec**:
   define its rungs 1–N in `plan.md` §<phase> as a `WP-<n>` row + intro block
   (mirror WP-265/WP-530), each rung a graduated thesis proof ending in the phase
   exit gate, and record it in DOGFOODING §5. The ledger `rung` column is
   phase-scoped (highest CURRENT-PHASE rung a run satisfied, 0 = off-ladder). Only
   then pick the next headline = the phase ladder's next rung. Then read the
   `scripts/dogfood-progression.sh` verdict (not advisory):
   - `⛔ STALLED` → the next headline **IS the current phase's ladder rung**
     (plan.md §<phase> queue) — no exceptions. New 🔴 loop-integrity friction found
     this review is **hand-fixed in the same sitting** (TASK-PROTOCOL §4) or
     queued track-B; it does not headline. Write the ladder spec.
   - `🔴 CAP BUSTED` → the next headline must be `class=product` regardless of
     anything below.
   - `✅ PROGRESSING` → proceed to gates 1–4, default candidate = next ladder
     rung; a non-ladder candidate must beat the rung on thesis value AND pass
     every gate below.
   The candidate spec must carry `# Ladder-rung:` and `# Thesis-KPI:` headers
   and pass `scripts/dogfood-progression.sh --spec <file>` format lint (a
   prescribed headline without a sanctioned-exception declaration is a ⛔).
1. **Failure-surface test (DOGFOODING §1.1).** A headline run must be something
   a competent agent could *plausibly fail*: 2–6 steps, cross-file or a thesis
   pillar (durable execution / multi-run chains WP-219 / judge-catching /
   crash→resume WP-206 / context-rot WP-203/204) or a real bug surface. A pure
   single-file deterministic-test port is **track-B** — land it as a normal PR,
   never the dogfood headline.
2. **Product-progress gate (DOGFOODING §1.2, mandatory).** The candidate's *landed
   diff* must advance a **real open `plan.md` §6 product WP** (feature code on a
   thesis pillar — memory store, chains, compaction wiring, control-plane), not
   invented disposable code. A thesis mechanism (judge-catch seam, chain) is a
   **vehicle seeded INTO that WP's real code**, never a fresh throwaway utility.
   **Prefer a real open WP to host the mechanism.** Scaffold-hosted is allowed
   **only** under the §1.2 fallback carve-out — *no* open WP can host it because
   every candidate is blocked by a **frozen-contract / ADR wall** (TASK-PROTOCOL §4)
   or **harness the dogfood mechanism itself depends on**. If the carve-out fires,
   name the blocking WP/contract and make unblocking it the next priority.
3. **Mission-critical gate (DOGFOODING §1.3, binding veto).** Apply the
   `/dogfood-assessor` two-axis logic inline: if the candidate is **🟡 Busy Work**
   or **🟡 Scaffold-hosted** AND any thesis-stressing slice on a real product WP is
   unblocked (🟢/🟡, no un-landed contract), the candidate is **VETOED** — queue the
   real-WP slice instead. A scaffold-hosted or busy headline is permitted ONLY when
   nothing real is unblocked. Record the verdict (`✅ PROCEED` / `⛔ VETO` /
   `🟡 ALLOW (fallback)`) in your output.
4. **Friction-budget gate (DOGFOODING §1.5, mandatory — course correction
   2026-07-02).** Compute the trailing-3-run meta:product headline ratio
   (harness-meta = deliverable's primary surface is `scripts/`,
   `examples/dogfood/`, launch prechecks, spec hygiene, or verifier plumbing).
   A harness-meta candidate is **⛔ VETO** unless it is 🔴 loop-integrity AND
   the cap (≤1 harness-meta headline per 3 runs) is not busted. Default
   headline = the current phase's ladder rung (P2 = WP-265 §6, P3 = WP-530 §7).

Then write `examples/dogfood/dogfood-<NNN+1>.yaml` per DOGFOODING §3, **in the
format the track demands**: a headline (ladder) spec is LOOSE — goal states the
OUTCOME + constraints, ACs pin what done means, implementation left to the
executor; a track-B spec may prescribe exact files/symbols/tests (parity ports,
hand-off verification). Either way the run advances **a real open plan.md §6
product WP** — a judge-catch seam or chain mechanism is seeded **into that WP's
real code** (not a new disposable utility); for a chain dogfood, a goal that
genuinely decomposes — launched with `chikory chain`, not `run`);
judge-executed checks that fit the 120 s cap (time them — bare toolchain
binaries, not `devbox run`); zero-secrets routing block if no API keys.
Validate it parses (`parseTaskSpec` over the file, or `pnpm chikory run`/`chain`
which validate first). Add the README index row ("not yet run"). Remind the
user: commit everything before launching — the workspace clones HEAD.

**Then arm the acceptance oracle, and say so.** An AC that greps for a symbol
proves the symbol EXISTS; it cannot prove the symbol COMPUTES THE RIGHT ANSWER.
dogfood-113 passed 4/4 symbol-greps on a delivery whose central function was
semantically inverted, because the only behavioral evidence was tests the
executor wrote for itself — and it pinned the one case it got right. So:

- At least one AC on every headline spec must **own its oracle** — assert
  BEHAVIOR the check itself specifies, against the real built artifact, with
  inputs and expected outputs written into the `check`. Never delegate the
  correctness question to a test file the executor authors.
- Prove that AC **both ways** before launching: RED on HEAD (clean exit 1), and
  GREEN against a throwaway reference implementation. An AC verified in only one
  direction may be unsatisfiable, and you will not find out until the run burns.
- `scripts/dogfood.sh` classes any check shelling out to `tsc`/`vitest`/`pnpm
  exec` as VERIFY-SUITE and will NOT dry-run it — those are exactly the
  behavioral ACs. **`dogfood-arm.sh` exists precisely to close that gap: it runs
  EVERY check, VERIFY-SUITE included, and times each against the 120 s judge cap.**

```sh
SPEC=examples/dogfood/dogfood-<NNN+1>-….yaml

# 1. RED on HEAD — commit first; a dirty tree makes "RED on HEAD" meaningless
#    (the script warns). Every AC must exit 1; exit 0 cannot gate new work and
#    exit ≥2 is a broken check that can never pass (F-119 class).
devbox run -- bash scripts/dogfood-arm.sh "$SPEC"

# 2. Write a throwaway reference implementation, then prove GREEN.
devbox run -- bash scripts/dogfood-arm.sh "$SPEC" --green

# 3. Emit the arming table for the report + README.
devbox run -- bash scripts/dogfood-arm.sh "$SPEC" --table

# 4. Revert the reference BY NAME (restore the files you edited from a copy you
#    made first). `--discard` runs `git checkout -- .` over the WHOLE tree and
#    will delete an uncommitted review along with the reference.
```

  Results accumulate in `.chikory/review/arm-<spec>.json` across passes, and
  `--table` flags any AC that is not verified in BOTH directions — the failure
  mode that burns a run. Paste its output into `## NEXT RUN` and the README cell.

  **Read the RED output, never just the exit code.** A check that DIES exits 1
  exactly like a genuine RED: in dogfood-133 an over-escaped backtick inside a
  generated test made AC-2 exit 1 from a `SyntaxError`, and the arming pass
  reported `🟢 RED-on-HEAD (clean exit 1) — challenge armed` for a check that
  could never pass in either direction. `dogfood-arm.sh` now scans the output for
  died-before-judging signatures (`SyntaxError`, `Cannot find module`, `command
  not found`, `error TS…`, esbuild `Transform failed`) and calls that
  `⛔ BROKEN CHECK` regardless of exit code — but the signature list is not the
  oracle, your eyes are. A genuine RED prints the check's OWN assertion text.

  **Never rebuild a YAML extractor in the scratchpad to diagnose a check.** Every
  check's full output is kept at `.chikory/review/arm-<spec>-<pass>-<AC>.log` and
  the path is printed under each result; to re-run one check by hand, ask the
  script for it:

```sh
devbox run -- bash scripts/dogfood-arm.sh "$SPEC" --extract AC-2  # byte-exact body → a runnable file
devbox run -- bash scripts/dogfood-arm.sh "$SPEC" --only AC-2     # re-run just that AC, timed
```

  **Two quoting traps inside an AC `check` that shells into `node -e '…'`:** an
  apostrophe anywhere in the script — including a prose comment — closes the bash
  string; and a backtick or `${` destined for a GENERATED file must be escaped
  once for the outer template literal (`` \` ``, `\${`), not twice. Both produce
  a check that dies rather than judges.

Then run the launch preflight at $0 and confirm the spec-pick glob resolves to
the file you just wrote:

```sh
devbox run -- bash -c 'CHIKORY_PREFLIGHT_ONLY=1 bash scripts/dogfood.sh --run'
```

Finally, write the `## NEXT RUN` section required by the Output rules below. It
is the last thing on the page and nothing follows it.

## Output

Your output — and the report/friction/status docs you write — must follow the
binding communication standard in [`docs/COMMS.md`](../../../docs/COMMS.md): plain
lead first, gloss every ID on first use (`WP-271 (chunk-scoped judge)`, not bare
`WP-271`), structure over prose. Use the report and friction templates there. The
structured summary must additionally follow these rules:

1. **Vibe Check (Simplified Summary First)**: Begin with a 1–2 sentence high-level, jargon-free summary of the run's verdict. Explain what was completed and what it means in plain English (e.g., "The run successfully implemented the logic, but highlighted that a precheck script is needed to prevent wasted runs").
2. **Context Conservation**: Maintain all exact numbers, including:
   - Run ID, commit SHA, file paths, and exact line ranges.
   - Cost details: Total cost in USD, input/output tokens per step, and execution duration.
3. **Structured Visual Layout**: Present cost metrics, step progress, or comparisons using markdown tables and bullet points. Avoid walls of text. Use visual status indicators (e.g., `🟢`, `🟡`, `🔴`, `⚠️`, `ℹ️`).
4. **Acronym & Terminology Explanations**: Explain any complex domain terms (e.g., WP, AC, OTel spans, probe steps) in detail when summarizing, so a reader can digest it without needing external documentation.
5. **KPI Table (mandatory)**: Report the DOGFOODING §1.4 KPI values for this run and the trailing window: max horizon survived (steps / wall-clock), kill→resume count, judge true-positives pre-land, trailing-3-run meta:product headline ratio, per-step reliability (runs ≥5 steps), current-phase ladder rung vs the phase exit gate.
6. **Friction disposition table (mandatory)**: every friction item this review
   opened gets ONE row — `F-n · severity · one-line defect · disposition`, where
   disposition is exactly one of **HAND-FIXED THIS SITTING** (with the file:line
   and the test count proving it), **→ WP-n (queued)**, or **track-B note**. No
   friction may be reported without a disposition; "found it" is not an outcome.

7. **`## NEXT RUN` section — mandatory, LOUD, and LAST.** The review is worthless
   to the operator if they have to reconstruct what happens next. End every
   review with a section headed exactly `## NEXT RUN`, containing, in order:

   - **One bolded sentence naming the target in plain English** — what the next
     run makes true that is not true today, with no IDs in it. ("Make the harness
     pick a Node version that actually satisfies each target's declared range,
     resolved once and shared by the run and grading paths.")
   - **The spec file path** and the **WP it advances**, glossed.
   - **Why THIS and not the ladder rung** — one line. If the phase ladder rung is
     not the candidate, the §0 progression verdict plus the reason the rung
     cannot run yet must be stated explicitly, not implied.
   - **The designed trap** — the plausible-but-wrong delivery the ACs are built
     to reject. If you cannot name one, the spec is too easy (§1.1).
   - **Gate verdicts** — §0 / §1.1 / §1.2 / §1.3 / §1.5, each ✅/⛔/🟡, one line each.
   - **AC arming evidence** — which ACs dry-ran RED-on-HEAD, and for any AC the
     preflight classed VERIFY-SUITE (so did NOT dry-run), the hand-verification
     you performed in BOTH directions plus its wall-clock vs the 120 s judge cap.
   - **The exact launch command**, in its own fenced block, as the final thing on
     the page.

   Nothing may follow `## NEXT RUN`. If the review ends without it, the review is
   incomplete.

8. **Landing**: harvest the run FIRST (`dogfood-open.sh`, before any doc edits),
   and commit + push everything LAST, once every gate is green. (Standing user
   override of the older "leave edits uncommitted" rule.) One command:

   ```sh
   devbox run -- bash scripts/dogfood-close.sh <NNN> --run-id <run-id>
   ```

   It runs the four gates in order and **refuses to commit if any is red**:
   bounded blocks within cap · every `file:line` citation in the report resolves ·
   living-doc coverage (report, plan.md, REQUIREMENTS, DOGFOODING, README, ledger
   all carry this campaign) · full suite. Then it commits with the run-id in a
   `Ref: run-id:` trailer and pushes. Use `--check-only` to run the gates without
   landing, `--message` for a custom subject, `--no-push` to hold the commit local.
   State the commit SHA and whether the push succeeded.

