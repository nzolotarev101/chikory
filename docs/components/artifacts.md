# Component: Artifact Store

**Phase**: P1 minimal, P2 full · **WPs**: WP-002 (contract), WP-122 (git snapshots), WP-202 (blob store), WP-211 (browser state) · **Requirements**: AR-1, CM-3
**Code**: `packages/sdk-ts/src/artifacts/`

## Purpose

Spec §5.6: the runtime and the judge reason about **software artifacts directly** — repo snapshots, task trees, test results, browser state, PR diffs — as first-class runtime objects, not as text pasted into prompts.

## Artifact kinds

| Kind | Producer | Consumed by | Storage |
|---|---|---|---|
| `repo_snapshot` | checkpointer (git commit per step) | rollback, branch, resume | git (run-private branch in worktree) |
| `diff` | checkpointer (step + cumulative) | judge evidence, trace, final PR export | blob |
| `test_results` | judge harness (it runs the tests itself) | verdict computation, trace | blob (raw) + structured summary |
| `task_tree` | planner (plan items + status) | pacing, trace, milestone detection | journal (small, structured) |
| `browser_state` | Playwright capture (WP-211) | UI-snapshot judging | blob (png + DOM snapshot) |
| `transcript` | executor adapters | forensics, P3 dataset | blob |
| `tool_output` | any tool over size threshold | Memory Pointer pattern | blob |

## Contract (WP-002)

```ts
export interface ArtifactRef { id: string; kind: ArtifactKind; bytes: number; summary: string; }
export interface ArtifactStore {
  put(content: Buffer | string, meta: { kind: ArtifactKind; summary: string }): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Buffer>;
  excerpt(ref: ArtifactRef, sel: { range?: [number, number]; query?: string }): Promise<string>;
}
```

- P1: minimal local-FS implementation, enough for diffs/transcripts/test logs (the judge needs these on day one). P2 (WP-202) completes content-addressing + excerpting. P4 adds S3-compatible backend behind same interface.
- Refs are stable across resume/branch (content-addressed); the journal stores refs, never bulk.
- Git is **not** wrapped: repo snapshots are plain commits, inspectable with normal git tooling (no magic, NF-2). Run-private branches keep user history clean; final output exported as a single reviewable diff/PR.

## Retention

Local: artifacts persist with the run directory; `chikory gc --keep-last N` (P2 nicety). P3's dataset pipeline (WP-306) consumes journals + artifacts in `--json` interchange form — design refs/IDs now so that pipeline needs no migration.
