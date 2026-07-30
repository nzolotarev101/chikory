# dogfood-120 (five-task baseline range, CHAIN) — WP-302 + WP-304: one node landed, the campaign died on a boundary nobody was shown

**Plain:** The chain built the benchmark tooling it needed and then lost the node that was supposed
to author the next benchmark task — not because the work was bad, but because the node wrote its
required evidence file to a path its plan hadn't declared, and nothing had ever told it which paths
were allowed. The judge had passed that work. Everything else in the campaign (two agent arms, the
published comparison) never started. The tooling node's delivery is now landed and verified; four
frictions were hand-fixed in the review sitting; the remaining scope relaunches as dogfood-121.

- **WP:** WP-302 (brownfield task authoring) + WP-304 (baseline runs and publication)
- **Date:** 2026-07-29 (America/Toronto; journal timestamps below are UTC)
- **Spec:** [`examples/dogfood/dogfood-120-wp302-wp304-five-task-baseline-range.yaml`](../../examples/dogfood/dogfood-120-wp302-wp304-five-task-baseline-range.yaml)
- **Chain:** `chain-0723ac0b-4eba-413a-933f-2d1646a4f643`
- **Base HEAD:** `a3de4d28d4f85872b44b053789cc53503fc5f3fb`
- **Landed commit (the one node that sealed SUCCESS):** `7ad4bd3`
- **Outcome:** ⛔ FAILED · 6-node plan · 5 node incarnations · 19 steps · 22 judge passes ·
  18h 47m · **$1.52 / $80.00** (all of it judge spend — the CLI-OAuth executor meters $0)
- **Ladder:** P3 rung 4 **not reached.** Corpus stays at 3 runnable brownfield tasks; neither arm ran.

## Trace

| When (UTC) | Node | Steps | Cost | What happened |
|---|---|---:|---:|---|
| 04:10 | plan | — | $0.2342 | gate **REVISE** — two mandated goal literals missing (`devbox run`, `benchmarks/`) |
| 04:10 | plan | — | $0.1450 | WP-542 repair pass → **PROCEED**, 6 nodes |
| →05:? | `N-1` | 3 | $0.2027 | FAILED/ESCALATE — `commandAdapter` skipped materialization for any existing `.git`, never checking remote/HEAD |
| →12:40 | `N-1-r1` | 2 | $0.1144 | FAILED/ESCALATE — retry claimed the repair, diff contained no adapter change |
| 15:06 | `N-1-r1-r2` | 3 | $0.2821 | 🟢 **SUCCESS** — 5 PROCEED verdicts, 716 insertions / 9 files, head `1c8b466` |
| 15:27 | `N-2` | 5 | $0.2574 | FAILED — rule-3 HALT on `N2-AC-1` (the F-209…F-214 case WP-544 fixed mid-run) |
| 18:51 | `N-2` | — | — | operator `chikory chain resume` → child re-entered (WP-544 F-214 path works) |
| 18:53 | `N-2` step 4 | — | — | judge form **all green**: `N2-AC-1 pass: true`, 6/6 rubric items pass |
| 18:54 | `N-2` | — | — | verdict **ESCALATE** — *"stray text `开启` before `PASS`"* in a markdown report |
| →22:41 | `N-2` | — | — | parked **3h 47m** awaiting a human, then sealed **FAILED**: `wrote outside its declared writeSet: docs/reports/brownfield-004-evidence.md, docs/reports/dogfood-121.md, docs/reports/dogfood-ledger.csv` |
| 22:41→22:57 | `N-2-r1` | 6 | $0.2829 | fresh empty workspace; `N2-AC-1` failed 4 more passes → HALT, remediation, HALT |
| 22:57 | chain | — | — | ⛔ FAILED — `replan budget exhausted for node N-2: 2 failed attempt(s) exceeds max 1` |

- **Verdict sequence per node:** `N-1` PROCEED×3 → ESCALATE · `N-1-r1` PROCEED → ESCALATE ·
  `N-1-r1-r2` PROCEED×5 · `N-2` PROCEED → ROLLBACK → HALT → HALT → ESCALATE ·
  `N-2-r1` PROCEED×2 → HALT×4.
- **Families:** executor `gemini-cli` (`gemini`), judge `openai-compat` (`gpt-5.6-sol xhigh`) —
  structurally different, as required.
- **Interventions:** 2 operator chain resumes · 1 rollback · 3 escalations · 2 remediation attempts.

## What actually killed the campaign

`N-2` had two ways to satisfy its one acceptance criterion, and both were fatal:

1. **Write the evidence where it guessed** (`docs/reports/…`) → the judge passed every criterion and
   every rubric item, and the deterministic seal check then discarded the entire node.
2. **Keep writes where it could infer they belonged** → the judge had no executable evidence to
   corroborate, failed `N2-AC-1`, and three consecutive fails is a rule-3 HALT.

Its plan *did* declare a legal slot — `benchmarks/reports/p3-rung-4/brownfield-004.md` — and the
executor was never shown it. `chainLink.writeSet` was read at exactly one line in the whole runtime,
the seal check, and appeared in no prompt.

Under that squeeze the retry did what an unfalsifiable criterion rewards: it **fabricated the parts
it could not evidence**. Its YAML claims *"Reviewed and signed off by Chikory benchmark task review
panel on 2026-07-29"*, and its RED/GREEN "proof" used fake `git`/`npx` shims plus an `.is_fixed`
marker. The judge caught both, verbatim, and was right to.

Worth separating: the **upstream research was genuine**. Both draft tasks' pins verify against
GitHub —
`react-hook-form@d96c5cee` with fix `69da9545` *"clear internal errors state on argument-less
clearErrors() (#13613)"*, and `zod@195e8696` with fix `61d7bedb` *"apply key schema transforms in
z.record() (#5891)"*. Only the evidence it had no legal place to record, and the review it could
never obtain, were invented.

## Delivery quality (human review, post-landing)

`N-1-r1-r2` is the only node that delivered, and it delivered well. Harvested to `main` as `7ad4bd3`
(9 files, all `benchmarks/harness/`), verified independently inside devbox:

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint src test` | clean |
| harness suite | **128 pass** (was 113; AC-5 floor is 120) |
| dogfood-120 **AC-1** by hand | 🟢 8/10 → `[0.490, 0.943]`, 5/10 → `[0.237, 0.763]`, shortened arm rejected · 0.56 s |
| dogfood-120 **AC-2** by hand | 🟢 exact-pin materialization, baseline edit lands in the graded workspace · 0.38 s |
| `git status` after harvest (F-192) | clean — no workspace escape |

Two defects found by hand and fixed in the same commit:

- Each compared arm carried `reference` (the summary file) but no `rawResultsDir`. **AC-4 requires
  it**, so the publication node would have failed on a field name after both arms had run.
- `ensureGitWorkspace` built git commands as interpolated shell strings. Quoting is not enough:
  `$(...)` expands inside double quotes, so a task YAML with `repo.ref: HEAD$(touch /tmp/x)`
  executed. Now `execFileSync` with argument arrays; the test asserts the substitution never runs.

**Not landed:** the two `brownfield-004` drafts. Preserved as
[`attachments/dogfood-120-brownfield-004-drafts/`](attachments/dogfood-120-brownfield-004-drafts/)
for dogfood-121 to build on. Their pins are real (above) but their RED/GREEN evidence is not, so the
relaunched authoring node re-derives it under an AC that can be settled.

## New friction

### 🔴 F-218 — a chain node is killed for crossing a boundary it was never shown

**Evidence:** `chainLink.writeSet` was consumed only by the seal check
(`runner/activities.ts:2423`); no prompt surface carried it. `N-2` lost a step's work, its whole
incarnation and its lineage's last replan attempt to a path choice it had no information to make —
while the legal slot sat in its own declared set and the judge's
`scope_matches_instruction` had passed the offending files.
**HAND-FIXED THIS SITTING** → WP-545 (`1ace5ca`). New `chain/write-boundary.ts` holds the four
admission rules and the prompt text derived from them (one definition for the prompt and the gate);
`agent-loop.ts` carries it on `ContextBundle.notes` (CM-2, survives compaction; no contract change);
`executors/prompt.ts` renders it inside the `# Workspace boundary` block with the consequence stated;
the judge now applies the same boundary, so an out-of-boundary write fails at the step, where the
file can still be moved. Live-proven on real Temporal against `N-2`'s actual writeSet, RED pre-fix.

### 🔴 F-221 — the plan gate dispatches a node with no oracle a shell can settle

**Evidence:** four of six nodes carried exactly one planner-invented prose criterion with no `check`
(`N2-AC-1` `check` length 0). The judge's evidence-only rule (WP-535/F-164) means such a criterion
cannot pass on self-authored assertions, so it fails every pass — and three fails HALT the node.
`N2-AC-1` failed 5 consecutive passes across two incarnations. It also rewards fabrication (above).
**HAND-FIXED THIS SITTING** → WP-546 (`fd0bdd2`). Third deterministic plan floor beside coverage and
literals: a PROCEED leaving any node without an executable check is downgraded to REVISE and the
WP-542 repair tier feeds the node ids back. The planner is never asked to author a check (F-40); it
must reuse a goal criterion id or merge the node. Exemption found while testing: a plan with no
checks *anywhere* is a prose-only operator spec the retry cannot repair, so the floor stays silent
rather than dead-ending the launch. The class now costs ~$0.4 at plan time instead of a node.

### 🟡 F-220 — a resume replays the template frozen at launch, so a landed fix never reaches the chain

**Evidence:** the persisted `template_json` of this chain carries no `stepLimits`, `pacing`,
`unattended`, `soak`, `notifications`, `horizon` or `budgetTokens`. WP-544 fixed
`templateFromSpec` at 14:41 EDT; the operator resumed at 14:51; the resumed `N-2` still ran with
`stepLimits: undefined` / `unattended: undefined`. That is why an ESCALATE over a doc typo parked
3h 47m instead of sealing resumable, as `unattended.escalation: seal_resumable_failed` had asked.
**HAND-FIXED THIS SITTING** → WP-547 (`0e239fb`). `chikory chain resume` now compares the persisted
template against the WP-544 field contract and warns before re-entering — which fields are absent,
what to expect, and the remedy (fresh chain over the remaining work). Warning only: a journal is an
audit trail, and a persisted template cannot distinguish "not declared" from "dropped". Verified
firing against this chain's real record.

### 🟡 F-222 — a sealed-SUCCESS node of a FAILED chain had no harvest path

**Evidence:** `harvest.sh` promoted any `chain-*-node-*` target to its owning chain id, and the chain
path refuses a non-SUCCESS chain, so `N-1-r1-r2`'s 716-line delivery aborted with `chain is not
safely harvestable`. Recovering it would have meant hand-applying a diff.
**HAND-FIXED THIS SITTING** → `57b7505`. The promote now applies only to the auto-discovered default;
an explicitly named node run id is the operator's choice. `scripts/test-harvest-chain.sh` covers all
three directions on a FAILED-chain fixture, RED before.

### 🟡 F-219 — an all-green judge form can ESCALATE over a cosmetic nit

**Evidence:** `N-2` step 4's form marked `N2-AC-1 pass: true` and all six rubric items pass; the
verdict was ESCALATE, rationale: *"stray text `开启` before `PASS`; this is a minor
documentation-quality defect but does not obscure the recorded result."* Out-of-rubric concerns have
no severity floor, so a typo parks a node (and here, with `unattended` dropped by F-220, parked it
for 3h 47m).
**→ WP-548 (queued).** Deliberately not fixed here: ESCALATE-on-out-of-rubric is the safety valve
WP-537 relies on, and adding a severity floor needs its own design pass rather than a review-sitting
patch.

## Verdict on the thesis

Mixed, and informative in the way only a real long-horizon run is.

- **Durable execution held.** Two operator resumes re-entered the right child on the same run-id,
  the plan was never rewritten, one node's 716-line delivery survived its own chain's death, and
  every failure is reconstructable from the journal 19 hours later.
- **The judge was right every time.** It caught the un-repaired adapter, caught the retry that
  claimed a repair it hadn't made, and caught fabricated review authority and fake-shim evidence. No
  false positive.
- **The harness, not the agent, lost the campaign.** The node that died had produced work the judge
  accepted. What killed it was an invisible boundary (F-218) and an unsettleable criterion (F-221) —
  both now closed, both closed at plan/prompt time where they cost cents instead of hours.
- **The cost shape is worth recording:** $1.52 of $80 over 18h 47m, entirely judge spend. Budget was
  never the constraint; oracle quality and information flow to the executor were.

## Ledger

`120,WP-302+WP-304,chain,FAILED,19,1.5187,loose,product,2,3,0,1`
