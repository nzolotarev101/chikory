# Communication Standard

**Binding for every human-facing thing an agent writes** — living docs (`plan.md`,
`DOGFOODING.md`, friction notes), per-run reports (`docs/reports/dogfood-NNN.md`),
spec YAML preambles (`examples/dogfood/*.yaml`), and in-session chat.

The goal: any artifact is readable by someone who does **not** already hold the
run's context. The #1 barrier today is **jargon density** — coined IDs and
acronyms (`WP-271`, `F-107`, `rung-3`, `§1.2`, `JD-3`) used bare, so the reader
must reconstruct context to parse a single line. Rule 1 kills that.

[`GLOSSARY.md`](GLOSSARY.md) is the single source of truth for every ID family and
term. Register an ID there before first use.

---

## The four rules

### Rule 1 — Gloss on first use (the anti-jargon rule)

Every coined ID or acronym gets a **≤6-word plain-English gloss in parentheses the
first time it appears in each artifact**. Bare reuse is fine after that.

> Write `WP-271 (chunk-scoped judge)` — not `WP-271`.
> Write `F-107 (judge ignores active chunk)` — not `F-107`.

ID families and their canonical shape (full meanings in [`GLOSSARY.md`](GLOSSARY.md)):

| Family | Means | Example first-use |
|---|---|---|
| `WP-n` | work package — one PR-sized planned unit | `WP-271 (chunk-scoped judge)` |
| `F-n` | friction — a problem a run surfaced | `F-107 (judge ignores active chunk)` |
| `rung-N` | horizon-ladder rung (run difficulty tier) | `rung-3 (multi-step non-hollow)` |
| `§n` | a `plan.md` section | `§6 (the work queue)` |
| `RT/DX/JD/CM/CG-n` | requirement codes (route/durable/judge/memory/cost) | `JD-3 (judge trust)` |
| `dogfood-NNN` | a self-hosting run (Chikory builds Chikory) | `dogfood-086 (the WP-271 run)` |
| `run-<id>` | a durable workflow execution id | `run-88235198 (the 086 run)` |

Also gloss non-obvious status words on first use: `harvest` (land the run's diff as
a PR), `hollow`/`non-hollow` (step did trivial vs. real work).

### Rule 2 — Plain lead

Open every artifact with **1–2 jargon-free sentences** stating the outcome or state
in human terms — what happened and why it matters — before any IDs or metrics.

> "The run added chunk-awareness to the judge so it stops flagging work that was
> deferred on purpose. It also proved a stuck run can no longer hang forever."

### Rule 3 — Structure over prose

- Bullets and tables beat paragraphs.
- **No paragraph over ~4 lines. One idea per line.**
- Status/summary blocks are bounded; displaced detail moves to an archive
  (`PLAN-HISTORY.md`) or the per-run report, not the live block.
- Keep exact identifiers (run-ids, SHAs, `file:line`, USD cost, tokens, exit
  status) — conserve context; just gloss and structure it.

### Rule 4 — Glossary is canonical

An ID family or coined term must exist in [`GLOSSARY.md`](GLOSSARY.md) **before**
its first use anywhere. New family → add the glossary row in the same change.

---

## Before you post — self-check

Run this against any artifact before it ships:

- [ ] **Lead is plain?** First 1–2 sentences readable with zero prior context.
- [ ] **Every ID glossed on first use?** No bare `WP-`/`F-`/`rung`/`§`/`JD-`… .
- [ ] **No paragraph over ~4 lines?** Walls broken into bullets/tables.
- [ ] **New IDs registered?** Any new family/term added to `GLOSSARY.md`.

---

## Templates (fixed skeletons)

### Friction item (F-n)

```markdown
### <🟢|🟡|🔴> F-<n> — <plain one-line title> → <WP or disposition>
- **Plain:** <1 sentence, zero jargon: what breaks, who feels it>
- **Evidence:** <file:line + observed behavior>
- **Impact:** <severity · who · why it matters>
- **Next:** <WP spawned / track-B / deferred>
```

### Dogfood report (`docs/reports/dogfood-NNN.md`)

Fixed section order; **first line is the plain summary**, then the data.

```markdown
# dogfood-NNN — <WP-n (gloss)>: <plain one-line outcome>

**Plain:** <1–2 jargon-free sentences: what the run did + what it revealed.>

## Trace           <!-- step/token/cost/verdict block -->
## Delivery        <!-- line-by-line vs goal; table of parts -->
## Anomalies       <!-- cost, tokens, judge behavior, loop integrity -->
## New friction    <!-- F-n items, using the friction template above -->
## Verdict         <!-- what the run proved for the thesis -->
## KPI             <!-- this run + trailing window -->
```

### Spec YAML header (`examples/dogfood/*.yaml`)

Replace free-prose preamble with fixed fields. Keep the comment block short; the
rationale lives in the linked report/plan, not here.

```yaml
# Plain: <1 line, no jargon — what this run should accomplish>
# WP: WP-n (gloss)          # the product work package this hosts
# Ladder-rung: N             # run difficulty tier (0 = off-ladder)
# Thesis-KPI: <§1.4 KPI name>
# Format: loose | prescribed (why, if prescribed)
name: dogfood-NNN-...
goal: >
  ...
```

### plan.md status block

Bounded rolling block. **One line per item, every ID glossed.** Deep rationale
stays displaced in `PLAN-HISTORY.md`.

### Live agent chat

The four rules apply verbatim: plain lead first, then glossed IDs, then structured
data. Never open a reply with a bare ID or metric.
