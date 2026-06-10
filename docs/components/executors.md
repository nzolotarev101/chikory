# Component: Executors

**Phase**: P1 (lane M2), extended P2 · **WPs**: WP-111..113, WP-213, WP-216 · **Requirements**: RT-8, RT-10, FA-1, FA-2 · **ADR**: 003
**Code**: `packages/sdk-ts/src/executors/`

## Purpose

An executor does the actual software work. Per ADR-003, Chikory's MVP executors are **wrapped CLI coding agents** (Claude Code, Codex, Jules, Antigravity) — we sit above them (RT-8), adding durability + judging + governance, not replacing their app-building capability. A native router-driven loop (WP-213, P2) exists for benchmark control runs and CLI-less environments.

## The step contract (WP-111) — most important design decision in this component

CLI agents run many internal actions autonomously; Chikory cannot journal each one. The journalable/judgeable/checkpointable unit is therefore the **bounded invocation**:

> **Step** = one executor invocation with explicit bounds (instruction scope + turn/time/token caps) executed in a controlled workspace, producing a `StepRecord`.

The runner sizes step instructions (one task-plan item per step in P1; pacing-driven batches in P2 via WP-207). Small enough that a judge verdict can cheaply roll one back; large enough that the agent does coherent work.

```ts
export interface ExecutorAdapter {
  readonly name: string;                       // "claude-code", "codex", "native", ...
  readonly modelFamily: LLMProvider;           // for judge-diversity enforcement (invariant #2)
  runStep(input: StepInput): Promise<StepRecord>;
}

export interface StepInput {
  workspaceDir: string;          // prepared git worktree — the ONLY place the executor may write
  instruction: string;           // bounded scope for this step
  context: ContextBundle;        // task goal, acceptance criteria, judge feedback, injected corrections, memory refs
  limits: { maxTurns?: number; maxSeconds: number; maxCostUsd?: number };
}

export interface StepRecord {
  status: "SUCCESS" | "FAILED";  // invariant #4 — always explicit
  diffRef: ArtifactRef;          // workspace diff produced this step
  summary: string;               // executor's own account of what it did
  toolCalls: number;
  tokens: { input: number; output: number };
  costUsd: number;
  costEstimated: boolean;          // CLIs without exact cost reporting (ADR-003)
  durationMs: number;
  transcriptRef: ArtifactRef;    // full raw transcript, stored outside context (CM-3 pattern from day 1)
  failure?: { reason: string; retriable: boolean };
}
```

### Conformance suite (part of WP-111)

Every adapter must pass the same suite: (1) completes a 3-step toy task; (2) respects `maxSeconds` (hang → killed → FAILED, workspace intact); (3) never writes outside `workspaceDir`; (4) `StepRecord` fields populated (cost may be estimated; flag `costEstimated`); (5) FAILED on nonzero exit with stderr captured. This is what makes adapters 🟢 mechanical work after the first one.

Implementation: `test/executors/conformance.ts` registers the suite for any adapter, plus a `chikory.step` span assertion (CONTRACTS.md §8) via in-memory exporter. Wire-level behaviors (hang, crash, error events) run against a fake CLI fixture (`test/executors/fake-bins/`) — a transport-level fake like the router's fake HTTP servers, not an LLM mock; each adapter additionally has a gated `@e2e` block driving the **real** binary through the toy task (`CHIKORY_E2E_CLAUDE=1` / `CHIKORY_E2E_CODEX=1`).

`maxSeconds` is enforced as a **wall-clock cap** on the whole invocation (covers both hangs and chatty-but-stuck agents): overrun → SIGTERM, then SIGKILL after a grace window → FAILED(retriable: true). Evidence (diff + transcript artifacts) is captured even on failure — the runner needs the partial diff to decide reset-vs-retry (FA-2).

## Claude Code adapter (WP-112)

- Invocation: `claude -p "<instruction+context>" --output-format stream-json --max-turns <n>` with `cwd=workspaceDir`; deny-by-default permissions outside the workspace.
- Cost/tokens parsed from result JSON; transcript stream captured to blob → `transcriptRef`.
- Diff: `git diff` against step-start commit (workspace is always a git worktree; uncommitted changes are committed by the checkpointer, not the agent).
- Hang handling: no output for `maxSeconds` → SIGTERM, then SIGKILL → FAILED(retriable: true).
- Model choice flows from `RoutingPolicy.stages.code` → `--model` flag; `modelFamily = "anthropic"` feeds judge-diversity check.

## Codex / Jules / Antigravity adapters (WP-113, WP-216)

Same pattern: headless/non-interactive mode, JSON output where available, conformance suite green. Spec lives in each adapter file header; these are 🟢 tasks — the design questions are already answered by WP-111/112.

## Native loop executor (WP-213, P2)

Router-driven plan→act loop with a minimal tool set (read/write/edit/bash/test) where every tool returns explicit SUCCESS/FAILED. Exists so (a) benchmarks can isolate Chikory's contribution from CLI-agent quality, (b) open-model-only environments work. Not an agent framework — one loop, no graph DSL (NF-1).

## Failure semantics (FA-2)

Adapter failures never corrupt a run: the workspace is reset to the last checkpoint before any retry; a FAILED step is journaled and the runner (not the adapter) decides retry/rollback/escalate. Repeated identical failures (3×) escalate rather than loop (CG-1).
