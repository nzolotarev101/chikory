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
   commit); turn each new friction item into a WP row queued by priority
   (next free WP number, tag 🔴/🟡/🟢, "Next up (dogfood-NNN F-n)" note);
   update the **Status** line.
3. **docs/REQUIREMENTS.md** — new WPs into the requirement rows they
   serve; reopen rows the findings prove aren't actually done; update WP
   status (e.g. IF-2 in-progress with landed commit).
4. **docs/DOGFOODING.md** — new operational gotchas into §7
   (troubleshooting) or §8 (known limitations), citing the friction id;
   update the header "proven path" line.
5. **examples/dogfood/README.md** — index row for this campaign:
   outcome, run-id, landed commit, report link.

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

Then write `examples/dogfood/dogfood-<NNN+1>.yaml` per DOGFOODING §3: goal a
self-contained brief naming exact files/symbols/tests **of the real product WP the
run advances** — if a judge-catch seam or chain is the mechanism, it is seeded
**into that WP's real code** (not a new disposable utility); for a chain dogfood, a
goal that genuinely decomposes — launched with `chikory chain`, not `run`);
judge-executed checks that fit the 120 s cap (time them — bare toolchain
binaries, not `devbox run`); zero-secrets routing block if no API keys.
Validate it parses (`parseTaskSpec` over the file, or `pnpm chikory run`/`chain`
which validate first). Add the README index row ("not yet run"). Remind the
user: commit everything before launching — the workspace clones HEAD.

## Output

Your output must end with a structured summary formatted for readability. To ensure it is simple to read, visually clear, and detailed while conserving full context, adhere strictly to these rules:

1. **Vibe Check (Simplified Summary First)**: Begin with a 1–2 sentence high-level, jargon-free summary of the run's verdict. Explain what was completed and what it means in plain English (e.g., "The run successfully implemented the logic, but highlighted that a precheck script is needed to prevent wasted runs").
2. **Context Conservation**: Maintain all exact numbers, including:
   - Run ID, commit SHA, file paths, and exact line ranges.
   - Cost details: Total cost in USD, input/output tokens per step, and execution duration.
3. **Structured Visual Layout**: Present cost metrics, step progress, or comparisons using markdown tables and bullet points. Avoid walls of text. Use visual status indicators (e.g., `🟢`, `🟡`, `🔴`, `⚠️`, `ℹ️`).
4. **Acronym & Terminology Explanations**: Explain any complex domain terms (e.g., WP, AC, OTel spans, probe steps) in detail when summarizing, so a reader can digest it without needing external documentation.
5. **Clear Call-to-Action**: End with the exact command to run the next spec (unblocked and verified). Leave all edits uncommitted for the user's review.

