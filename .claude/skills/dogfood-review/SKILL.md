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

## 0. Run the mechanical evidence pack — one command

The repetitive phase 1–2 checks are scripted. Run it FIRST and reason over
its output:

```sh
devbox run -- bash scripts/dogfood-verify.sh <run-id>
# or: devbox run dogfood-verify   # newest run
```

Then run the **progression gate** (course correction 2026-07-02) and keep its
output — phase 5 is bound by its verdict:

```sh
devbox run -- bash scripts/dogfood-progression.sh
# ✅ PROGRESSING / ⛔ STALLED over docs/reports/dogfood-ledger.csv, + §1.5 cap check
```

It pulls the acceptance checks from the run's OWN journal (`task_json`, so
they always match the run), and emits one markdown block:

1. **Trace** — header · per-step rows · totals.
2. **Per-step evidence** — diff bytes, cost, checkpoint chain, judge pass
   (criteria/rubric/verdict/rationale) per step.
3. **Acceptance checks re-run** against the working tree — `PASS/FAIL` +
   exit code + output tail for each.
4. **Scope** — `git status --short`.
5. **Harvest byte-diff** — each changed `packages/…` file vs the run
   workspace (`IDENTICAL`/`DIFFERS`/not-in-workspace).
6. **Cost-share** — exact total (steps+judge), budget %, judge share, and
   the empty-diff **probe step → F-11 % data point** (the WP-221 number).

`devbox run` does NOT forward positional args to named scripts, and Devbox
0.17.0 can make Vitest abort when `devbox run` is prefixed with an env
assignment. Use the direct script form above for an explicit run-id. The
script writes nothing and touches no doc; judgment stays yours (phases below).

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

1. **Report** `docs/reports/dogfood-<NNN>.md` — NNN matches the spec.
   Mirror dogfood-002.md's shape: header line (WP/date/spec/run-id/landed
   commit), trace excerpt, "Delivery quality (human review, post-landing)",
   "New friction", "Verdict on the thesis". **Friction numbering is global
   and sequential across all reports** (dogfood-001 = F-1…F-7,
   dogfood-002 = F-8…F-10; continue from the highest existing F-n).
   Every friction item states the evidence and names the WP it spawns (or
   says why none).
2. **plan.md** — mark the WP/slice done in §6 (cite run-id + landed
   commit); a new friction item becomes a WP row **only within the
   DOGFOODING §1.5 friction budget** (🔴 loop-integrity → may queue as
   headline; anything else → track-B note or hand-fix, still recorded);
   **REPLACE lines inside the bounded status block (hard cap ≤30 lines —
   never prepend a new paragraph)**; displaced prose moves verbatim to
   `docs/PLAN-HISTORY.md` under a dated header. Do NOT touch the §6 table
   header schema (`| WP | Title | Tag | Notes |` — F-81: adding a `Status`
   column would activate the staleness gate with inverted semantics).
3. **docs/REQUIREMENTS.md** — new WPs into the requirement rows they
   serve; reopen rows the findings prove aren't actually done; update WP
   status (e.g. IF-2 in-progress with landed commit).
4. **docs/DOGFOODING.md** — new operational gotchas into §7
   (troubleshooting) or §8 (known limitations), citing the friction id;
   **REPLACE the bounded header status block (≤15 lines, same
   PLAN-HISTORY.md overflow rule — never stack "LATEST/Earlier"
   paragraphs)**.
5. **examples/dogfood/README.md** — index row for this campaign:
   outcome, run-id, landed commit, report link.
6. **docs/reports/dogfood-ledger.csv** — append THIS run's row (the
   progression gate's data source; mandatory, one row per terminal run):
   `run,wp,mode,outcome,steps,cost_usd,spec_format,class,resumes,judge_catches,rung,rollbacks`.
   `spec_format` = `loose`/`prescribed` (what the spec actually was);
   `class` = `product`/`meta` (§1.5 definition, by the deliverable's primary
   surface); `rung` = highest WP-265 ladder rung this run satisfied (0 = none);
   `judge_catches` = genuine true-positives only (not seam drills);
   `rollbacks` = judge ROLLBACK verdicts from chikory trace totals (seam-drill rollbacks count here; drill catches still excluded from `judge_catches`; pre-084 rows lack the column).

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
   Use the phase-0 `scripts/dogfood-progression.sh` output (re-run it if the
   ledger row was just appended). Its verdict is not advisory:
   - `⛔ STALLED` → the next headline **IS the current WP-265 ladder rung**
     (plan.md §6 queue) — no exceptions. New 🔴 loop-integrity friction found
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
   headline = the current WP-265 horizon-ladder rung (plan.md §6 queue).

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
5. **KPI Table (mandatory)**: Report the DOGFOODING §1.4 KPI values for this run and the trailing window: max horizon survived (steps / wall-clock), kill→resume count, judge true-positives pre-land, trailing-3-run meta:product headline ratio, per-step reliability (runs ≥5 steps), current ladder rung vs the P2 exit gate.
6. **Clear Call-to-Action**: End with the exact command to run the next spec (unblocked and verified). Leave all edits uncommitted for the user's review.

