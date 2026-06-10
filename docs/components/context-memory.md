# Component: Context & Memory

**Phase**: P2 · **WPs**: WP-202, WP-203, WP-204, WP-207 · **Requirements**: CM-1..4, SE-2, FA-3
**Code**: `packages/sdk-ts/src/memory/` (P2; `ContextBundle` + `ArtifactRef` contracts land in WP-002)

## Purpose

Context rot is failure mode #1 in the spec (§2): long sessions degrade non-uniformly, distractors accelerate decay, and in multi-agent setups one agent's rot becomes the next agent's ground truth. Chikory treats mitigation as a **runtime primitive co-designed with checkpointing**, not a prompting pattern (spec §6 vector 2).

## Design principles

1. **The context that gets checkpointed is the context that gets resumed.** Compaction runs at checkpoint boundaries (durable-runner.md); a resumed run rehydrates curated state, never a raw transcript. This is the co-design point that makes CM-1 different from "a compaction util".
2. **Short refs, external bulk** (CM-3): nothing bulky enters context twice.
3. **Provenance on every memory write** (CM-4 poisoning guard): each memory item records source step + author (executor/judge/human-injection); the judge's evidence excludes executor-authored memory when verifying executor claims.

## Memory Pointer store (WP-202 — the dogfood-001 task)

- `ArtifactStore` interface: `put(content, meta) → ArtifactRef`, `get(ref)`, `excerpt(ref, query|range)`.
- P2 backend: content-addressed local FS (`.chikory/artifacts/<sha256>`); S3-compatible backend is a P4 config swap behind the same interface.
- `ArtifactRef = { id, kind, bytes, summary }` — `summary` (≤200 chars, written at put-time) is what enters context; `excerpt()` lets executor/judge pull targeted slices instead of whole blobs.
- Applied to: tool outputs > threshold, transcripts, diffs, test logs, screenshots. Token savings measured and journaled (this number is a headline metric for the dogfood report).

## Compaction & structured notes (WP-203)

- **Compaction**: at each checkpoint, step history beyond a recency window is rewritten into a structured digest (goal status, decisions made, open issues, file map) by a cheap routed model (`stage: plan`). Compaction events are journaled with before/after token counts (NF-2: no silent magic).
- **Structured notes**: the executor is given a `notes` tool (write/read keyed notes that persist across steps and survive compaction verbatim). Notes are the agent's defense against its own context loss; the runner injects them into every `ContextBundle`.
- **Sub-agent pattern**: bounded side-quests (research, large-file analysis) run as separate executor steps with isolated context, returning only an `ArtifactRef` + summary to the parent — distractor density stays low in the main thread.

## Tiered memory (WP-204)

| Tier | Contents | Lifetime | Enters context |
|---|---|---|---|
| Core | Goal, acceptance criteria, active plan item, notes | Whole run | Always, verbatim |
| Recall | Recent N step summaries + last verdict rationale | Rolling window | Always |
| Archival | Everything else (full journal + artifacts) | Forever (cross-session) | On demand via `excerpt()`/search |

Cross-session: a new run on the same repo can mount a previous run's archival tier read-only (brownfield continuity, FA-1) — with provenance intact.

## Window-fit & pacing (WP-207)

Before each step the runner estimates: tokens needed (instruction + core + recall + likely tool output) vs window and budget; chooses batch size (how many plan items this step), test scope, and checkpoint cadence; can decide "park and resume later" (FA-3 break-taking) — emitted as a journaled `pacing` decision with reasoning. Applies to judge passes too (SE-2): evidence assembly trims to the judge's window with `excerpt()`.

## Risks

Compaction can delete the load-bearing detail — mitigations: notes survive verbatim; judge ROLLBACK feedback is always core-tier; compaction digests keep file paths and identifiers exact (rubric for the compactor itself). Memory poisoning — provenance + judge-side exclusion above.
