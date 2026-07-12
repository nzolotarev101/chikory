# Authoring benchmark tasks

Anyone can add a task to the Chikory suite with one YAML file and one PR. This
guide is the complete contract: the format, the design rules, and the checklist
a task must pass before it is scored. The format is **v1, frozen** — it is
validated mechanically by the WP-301 (evaluation harness) loader, and
`devbox run bench` must say your file is valid before review starts.

## What makes a task worth adding

The suite exists to measure long-horizon reliability, not demo polish. A good
task:

- **Has a real failure surface.** A task any agent one-shots clean measures
  nothing. There must be a plausible wrong turn: a breaking API change, an
  ambiguous requirement resolved only by reading the code, a test that goes red
  mid-way and forces recovery.
- **Is multi-hour by design.** Target 2–8h for a competent human
  (`horizon`). Short tasks belong in unit tests, not benchmarks.
- **States an outcome, not an edit script.** The `goal` says what must be true
  after; which files to touch, what to name things, and how to get there are
  the agent's decisions.
- **Is brownfield-first.** Real OSS repos at pinned commits are the branch the
  suite weights up — greenfield generation is increasingly saturated.

## Format v1 (frozen)

```yaml
id: brownfield-004          # <class>-<nnn>, three digits, never reused
class: brownfield           # brownfield | greenfield — must match the id prefix
status: draft               # draft | pinned (see lifecycle below)
repo:                       # REQUIRED for brownfield
  url: https://github.com/fastify/example-app
  ref: 0123456789abcdef0123456789abcdef01234567   # full 40-hex sha once pinned
horizon: 4-8h               # estimated hours for a competent human
goal: |
  Upgrade fastify 4 → 5. All existing tests pass unmodified except where they
  assert fastify's own changed behavior; those are updated with a one-line
  justification each. No new deprecation warnings at startup.
requirements:               # each independently checkable
  - id: R1                  # R<n>, unique within the task
    description: dependency at target major; install clean
    check: grep -q '"fastify": "\^5' package.json && npm ci
  - id: R2
    description: full pre-existing test suite green
    check: npm test
    prerequisites: [R1]     # optional; feeds dependency-adjusted scoring (D-SR)
metrics_notes: |            # what this task stresses (see ../README.md metrics)
  Per-step reliability over ~20 edit sites; recovery after a mid-upgrade break.
tags: [dependency-upgrade]  # optional
```

Field rules the validator enforces:

- `id` matches `^(brownfield|greenfield)-\d{3}$` and agrees with `class`.
- Requirement ids are unique `R<n>`; `prerequisites` must reference existing
  ids and must not form a cycle.
- Brownfield tasks must carry a `repo` block.
- A `pinned` task may contain **no TBDs**: `repo.ref` is a full 40-hex commit
  sha and every `check` is executable.

## Writing checks

Checks are commands run in the task workspace after the agent finishes; exit 0
means satisfied. Rules learned the hard way in dogfooding (each numbered
`F-n` — a logged friction lesson):

- **Behavioral, not symbol-presence** (F-97/F-103): run the tests, boot the
  app, hit the endpoint. `grep` for a function name proves transcription, not
  behavior. Never grep for a bare type name (F-114) — types get renamed and
  re-exported; function symbols and observable behavior don't lie.
- **No file-layout pins** (F-82): the agent chooses filenames. A check that
  hardcodes `src/utils/upgrade-helper.ts` fails correct solutions.
- **No bare-word negative greps** (F-83): `! grep -r deprecated .` fires on
  comments, docs, and lockfiles. Anchor negatives to a real observable
  (e.g. "startup log contains no deprecation lines").
- **Deterministic and hermetic**: no network beyond what the pinned repo
  itself needs; no wall-clock assertions; a check must give the same answer on
  every machine devbox runs on.
- Each requirement checkable **on its own** — the harness also reports
  dependency-adjusted satisfaction (D-SR), so use `prerequisites` for real
  ordering (test suite green presupposes install clean) rather than mega-checks.

## Lifecycle: draft → pinned

1. **Draft** (`status: draft`): shape the goal and requirements; `repo.ref` and
   checks may be `TBD`. Drafts load, list, and validate, but are skipped by
   suite runs.
2. **Pin**: choose the exact upstream commit, replace every TBD, then prove
   reproducibility — clone the repo at the sha and confirm each check fails on
   the unmodified tree for the right reason (a check that passes pre-work
   measures nothing).
3. **Validate**: `devbox run bench` (validates `benchmarks/tasks/` +
   `benchmarks/devai/instances/`); exit 0 required.
4. **PR**: one task per PR, with a short note on the intended failure surface
   (what wrong turn you expect agents to take) in the description.

## Grading model (context for authors)

Authored-task requirements are graded by their `check` commands. DevAI-original
requirements are natural-language criteria graded by an LLM judge from a
structurally different model family than the executor under test (the
same bias-mitigation invariant the Chikory runtime enforces). Authored tasks
should always prefer `check` — machine-checkable beats judged wherever a
command can capture the requirement.

## Checklist before you open the PR

- [ ] `devbox run bench` exits 0
- [ ] Goal is outcome-shaped — no file paths, no step lists
- [ ] Every check verified red on the unmodified pinned tree
- [ ] Every check verified green on at least one known-good solution (yours)
- [ ] Failure surface described in the PR body
- [ ] Horizon estimate honest (2–8h human time)
