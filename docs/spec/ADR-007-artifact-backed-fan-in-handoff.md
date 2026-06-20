# ADR-007 — Artifact-backed fan-in handoff

**Status:** Accepted (2026-06-20)
**Work packages:** WP-239, WP-242
**Extends:** ADR-005 S4

## Context

WP-237 cloned `dependsOn[0]` directly from a predecessor workspace. That proves
linear handoff locally, but it cannot combine two parents and assumes both runs
share one filesystem. Fan-in also needs a rule that cannot silently discard one
parent when independently planned nodes touch the same path.

## Decision

1. Every newly planned node declares an exact, repo-relative `writeSet`.
   Absolute paths, parent traversal, globs, and directory ownership are invalid.
2. Before the plan meta-judge runs, unordered nodes with overlapping write sets
   are deterministically serialized: the later node in plan order depends on the
   earlier node. Existing dependency direction is never reversed.
3. A sealed SUCCESS node must have changed at least one file and every actual
   changed path must be inside its declared write set. Otherwise it seals FAILED
   and publishes no handoff.
4. A valid node publishes a self-contained Git bundle through the configured
   shared `ArtifactStore`. The child receives ordered `ChainNodeHandoff` refs;
   it never needs a predecessor workspace.
5. A child clones the original repository, fetches each bundle, verifies its
   advertised commit, then merges parents in `dependsOn` order. The merged tree
   becomes `chikory-base`, so inherited changes are excluded from the child's
   judge diff.
6. Git conflicts fail closed as a terminal node failure. There is no
   last-writer-wins mode and no automatic content rewrite.
7. Chain harvest applies every successful node-local delta once in stable
   topological order. Plan order breaks ties.

`parentRunId` remains readable for old journals. New chains use
`parentHandoffs`. The default shared store is local and content-addressed; a
multi-worker deployment must inject the same remote-backed `ArtifactStore` into
every worker. Adding an S3 implementation is not part of this ADR.

## Consequences

- Fan-in is deterministic and auditable through bundle hashes, commits, changed
  paths, and chain-journal provenance.
- Conflict avoidance may reduce parallelism, intentionally favoring correctness.
- Declared write sets are a hard execution boundary, not planner advice.
- Multi-repository execution remains a separate runner limitation.
