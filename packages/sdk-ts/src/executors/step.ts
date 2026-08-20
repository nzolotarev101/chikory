/**
 * Shared CLI-step machinery (WP-111) — every wrapped-CLI adapter (WP-112
 * Claude Code, WP-113 Codex, WP-216 Jules/Antigravity) is this flow plus a
 * wire-format parser. Guarantees the step contract uniformly: bounded
 * runtime, diff + transcript artifacts, explicit SUCCESS/FAILED (invariant
 * #4), and a `chikory.step` span (CONTRACTS.md §8).
 */
import { createHash } from "node:crypto";
import { SpanStatusCode } from "@opentelemetry/api";

import { getTracer } from "../otel.js";
import type { ArtifactStore, StepInput, StepRecord, TokenUsage } from "../types.js";
import { runBounded } from "./process.js";
import { assertGitWorkspace, captureWorkspaceDiff, sourceRepoDirtyPaths } from "./workspace.js";

export const SPAN_STEP = "chikory.step";
export { isInfraStepFailure, LEGACY_CAP_KILL_PREFIX } from "./infra-failure.js";

/**
 * WP-221 completion-marker protocol (vendor-neutral). The step prompt
 * (`renderStepPrompt`) instructs the wrapped agent to end its final message
 * with this exact line — and only that line, on its own — when, and only when,
 * it judges the task fully complete. `runCliStep` detects it in the parsed
 * summary and sets `StepRecord.claimsComplete`, which `isCompletionMilestone`
 * ORs into the WP-217 empty-diff trigger so the *productive* step is judged
 * directly, removing the dedicated empty-diff probe step (F-11). The marker is
 * a runner↔executor protocol token, never a contract/journal field.
 */
export const COMPLETION_MARKER = "CHIKORY_TASK_COMPLETE";

/** Detects the WP-221 completion claim that removes the F-11 probe step. */
export function claimsCompleteFromSummary(summary: string): boolean {
  return summary.split("\n").some((line) => line.trim() === COMPLETION_MARKER);
}

/** Escape regex special characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * WP-606 (dogfood-155 / F-390): Normalises references to files inside the run
 * workspace so they are workspace-relative and outlive the ephemeral run
 * directory, while preserving the line information the agent emitted. Paths
 * outside the workspace and summaries with nothing to normalise are left untouched.
 */
export function normalizeWorkspaceRefs(summary: string, workspaceDir: string): string {
  if (!summary || typeof summary !== "string") return summary;
  if (!workspaceDir || typeof workspaceDir !== "string") return summary;
  const wsRoot = workspaceDir.replace(/\/+$/, "");
  if (!wsRoot || wsRoot === "/") return summary;

  const escapedWs = escapeRegex(wsRoot);
  const pattern = new RegExp(
    `(?:file:\\/\\/*)?${escapedWs}(?:\\/([^\\s)\\]>"'\`#?]+))?(?:#(?:L|l)?(\\d+)(?:[-:](?:L|l)?(\\d+))?|:(\\d+)(?:-(\\d+))?)?(?=[\\s)\\]>"'\`,;!?]|$)`,
    "g",
  );

  return summary.replace(
    pattern,
    (
      _match,
      relPath?: string,
      hashLineStart?: string,
      hashLineEnd?: string,
      colonLineStart?: string,
      colonLineEnd?: string,
    ) => {
      let cleanRel = relPath || "";
      let trailingPunct = "";
      const lineStart = hashLineStart || colonLineStart;
      const lineEnd = hashLineEnd || colonLineEnd;

      if (!lineStart && cleanRel) {
        const punctMatch = cleanRel.match(/([.,;:!?]+)$/);
        if (punctMatch) {
          trailingPunct = punctMatch[1];
          cleanRel = cleanRel.slice(0, -trailingPunct.length);
        }
      }

      let lineRef = "";
      if (lineStart && lineEnd) {
        lineRef = `:${lineStart}-${lineEnd}`;
      } else if (lineStart) {
        lineRef = `:${lineStart}`;
      }

      if (!cleanRel) {
        return (lineRef ? `.${lineRef}` : ".") + trailingPunct;
      }

      return cleanRel + lineRef + trailingPunct;
    },
  );
}

/** What an adapter's parser extracts from the CLI's stdout. */
export interface ParsedCliResult {
  ok: boolean;
  /** Executor's own account of what it did. */
  summary: string;
  toolCalls: number;
  /** WP-626: false when the executor cannot enumerate its tool calls. */
  toolCallsObserved?: boolean;
  tokens: TokenUsage;
  costUsd: number;
  /** True when the CLI reports no exact cost and we estimated (or zeroed) it. */
  costEstimated: boolean;
  /** Required when ok=false. */
  failure?: { reason: string; retriable: boolean };
}

export interface CliStepOptions {
  adapterName: string;
  store: ArtifactStore;
  input: StepInput;
  bin: string;
  args: string[];
  env?: Record<string, string | undefined>;
  killGraceMs?: number;
  /** Never throws on malformed output — runCliStep wraps it. */
  parse: (stdout: string) => ParsedCliResult;
}

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0 };

/** observability.md: chikory.step attrs — instruction hash, status, tokens, cost, duration. */
function recordStepSpan(opts: {
  adapterName: string;
  instruction: string;
  record: StepRecord;
}): void {
  const span = getTracer().startSpan(SPAN_STEP, {
    startTime: Date.now() - opts.record.durationMs,
  });
  span.setAttribute("executor", opts.adapterName);
  span.setAttribute(
    "instruction.hash",
    createHash("sha256").update(opts.instruction).digest("hex").slice(0, 16),
  );
  span.setAttribute("status", opts.record.status);
  span.setAttribute("tokens.input", opts.record.tokens.input);
  span.setAttribute("tokens.output", opts.record.tokens.output);
  span.setAttribute("cost.usd", opts.record.costUsd);
  span.setAttribute("duration.ms", opts.record.durationMs);
  if (opts.record.toolCallsObserved !== false) {
    span.setAttribute("tool.calls", opts.record.toolCalls);
  }
  if (opts.record.status === "FAILED") {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: opts.record.failure?.reason ?? "step failed",
    });
  }
  span.end();
}

export async function runCliStep(opts: CliStepOptions): Promise<StepRecord> {
  await assertGitWorkspace(opts.input.workspaceDir);

  // F-192: sample the SOURCE repo's dirty set before the step, so an already
  // dirty operator checkout is not mistaken for a sandbox escape below.
  const escapeBaseline = await sourceRepoDirtyPaths(opts.input.workspaceDir);

  const proc = await runBounded(opts.bin, opts.args, {
    cwd: opts.input.workspaceDir,
    env: opts.env,
    maxSeconds: opts.input.limits.maxSeconds,
    killGraceMs: opts.killGraceMs,
  });

  // Evidence is captured even on failure: a partial diff is exactly what the
  // runner needs to decide reset-vs-retry (FA-2) and the judge needs to see.
  const diff = await captureWorkspaceDiff(opts.input.workspaceDir);
  const escapedPaths =
    diff.length === 0 && escapeBaseline
      ? [...((await sourceRepoDirtyPaths(opts.input.workspaceDir)) ?? [])]
          .filter((p) => !escapeBaseline.has(p))
          .sort()
      : [];
  const transcriptText =
    proc.stderr.length > 0 ? `${proc.stdout}\n--- stderr ---\n${proc.stderr}` : proc.stdout;

  const [diffRef, transcriptRef] = await Promise.all([
    opts.store.put(diff, {
      kind: "diff",
      summary: `${opts.adapterName} step diff (${diff.length} bytes)`,
    }),
    opts.store.put(transcriptText, {
      kind: "transcript",
      summary: `${opts.adapterName} step transcript (${transcriptText.length} bytes)`,
    }),
  ]);

  let parsed: ParsedCliResult;
  try {
    parsed = opts.parse(proc.stdout);
  } catch (err) {
    parsed = {
      ok: false,
      summary: "",
      toolCalls: 0,
      tokens: ZERO_TOKENS,
      costUsd: 0,
      costEstimated: true,
      failure: {
        reason: `unparseable CLI output: ${err instanceof Error ? err.message : String(err)}`,
        retriable: false,
      },
    };
  }

  const base = {
    diffRef,
    transcriptRef,
    summary: normalizeWorkspaceRefs(parsed.summary, opts.input.workspaceDir),
    toolCalls: parsed.toolCalls,
    tokens: parsed.tokens,
    costUsd: parsed.costUsd,
    costEstimated: parsed.costEstimated,
    durationMs: proc.durationMs,
    ...(parsed.toolCallsObserved !== undefined
      ? { toolCallsObserved: parsed.toolCallsObserved }
      : {}),
  };

  let record: StepRecord;
  if (proc.timedOut) {
    // WP-255 / F-59: surface the ACTUAL elapsed wall-clock so a cap overrun is
    // visible in the trace, not masked. With the process-group reap this lands
    // near the cap; the number is the telemetry that made F-59 invisible before.
    const cap = opts.input.limits.maxSeconds;
    const elapsedSeconds = proc.durationMs / 1000;
    const overrunRatio = cap > 0 ? elapsedSeconds / cap : 0;
    record = {
      ...base,
      status: "FAILED",
      summary: base.summary || "step killed: exceeded maxSeconds",
      // F-210: the cap killed the step — the judge may still report on whatever
      // landed, but this outcome must not spend a rule-3 strike.
      infraFailed: true,
      failure: {
        reason:
          `step exceeded maxSeconds=${cap}; killed after ${elapsedSeconds.toFixed(1)}s ` +
          `(${overrunRatio.toFixed(2)}× cap)`,
        retriable: true,
      },
    };
  } else if (escapedPaths.length > 0) {
    // F-192: an EMPTY workspace diff paired with fresh edits in the repo the
    // workspace was cloned from means the executor worked outside its sandbox.
    // Left silent this is the worst failure shape the harness has: the step
    // reads SUCCESS, the judge grades an empty tree, every AC goes RED, the run
    // burns its budget to a HALT — and the real delivery is sitting unversioned
    // in the operator's checkout, invisible to trace, harvest and rollback
    // alike (dogfood-115 `run-c19147fe`: 4 steps, $0.16, terminal FAILED).
    // FAILED + retriable: the next attempt starts from a clean checkpoint.
    record = {
      ...base,
      status: "FAILED",
      summary: base.summary,
      failure: {
        reason:
          `executor wrote OUTSIDE its workspace: the step diff is empty but ` +
          `${escapedPaths.length} path(s) changed in the source repo this workspace was cloned ` +
          `from — ${escapedPaths.slice(0, 10).join(", ")}${escapedPaths.length > 10 ? ", …" : ""}. ` +
          `The delivery is not in the graded tree; revert those paths before retrying.`,
        retriable: true,
      },
    };
  } else if (!parsed.ok) {
    // WP-533/F-159: the adapter's PARSER is the authority on whether the executor
    // completed a valid turn — `parsed.ok === false` is a genuine execution error
    // (crash, no result event, provider error) → FAILED. When the process ALSO
    // exited non-zero, fold the exit code + stderr into the reason so a hard crash
    // stays debuggable (this preserves the old "nonzero exit with stderr" forensics
    // for the case where the executor really did fail).
    const exitCtx =
      proc.exitCode !== 0
        ? ` (executor exit ${proc.exitCode}${proc.stderr ? `: ${proc.stderr.slice(0, 1000)}` : ""})`
        : "";
    const failure = parsed.failure ?? { reason: "executor reported failure", retriable: false };
    const infraFailed = parsed.tokens.output === 0;
    record = {
      ...base,
      status: "FAILED",
      summary: base.summary || failure.reason,
      failure: { ...failure, reason: `${failure.reason}${exitCtx}` },
      ...(infraFailed ? { infraFailed: true } : {}),
      // F-228 (WP-553): hand the raw stderr to the limit scheduler. A quota or
      // rate wall reads as an ordinary executor failure here — `agy`'s
      // "Individual quota reached … Resets in 1h0m8s" FAILED four consecutive
      // steps on dogfood-121 `N-3-r1`, tripped the CG-1 loop-breaker, and spent
      // the node's whole replan budget on a wall that clears itself in an hour.
      // `classifyLimitSignal` (activities) is the authority on whether this IS a
      // limit; attaching the evidence unconditionally is what makes the existing
      // park-until-reset / declared-failover path reachable outside injection.
      ...(proc.stderr
        ? { limitSignal: { kind: "cli-stderr", stderr: proc.stderr, exitCode: proc.exitCode } as const }
        : {}),
    };
  } else {
    // WP-533/F-159: `parsed.ok` — the executor completed a valid turn. A non-zero
    // PROCESS exit code is deliberately NOT a step failure here. Once Bash is
    // allowed, the agent's own final verification command (e.g. a still-red test
    // suite on a "fix-until-green" task) sets the process exit code; gating that
    // is precisely the Agent-as-a-Judge inner loop's job, not a crude exit-code
    // heuristic. The old `exitCode !== 0 → FAILED` branch auto-FAILed every such
    // step and tripped the CG-1 consecutive-failure loop-breaker BEFORE the judge
    // ever ran — overriding the judge's own PROCEED verdict (dogfood-110). Step
    // status now reflects only that the executor DID its turn; correctness is
    // decided downstream by the judge + acceptance checks.
    record = {
      ...base,
      status: "SUCCESS",
      claimsComplete: claimsCompleteFromSummary(base.summary),
    };
  }

  recordStepSpan({
    adapterName: opts.adapterName,
    instruction: opts.input.instruction,
    record,
  });
  return record;
}
