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
import { assertGitWorkspace, captureWorkspaceDiff } from "./workspace.js";

export const SPAN_STEP = "chikory.step";

/** What an adapter's parser extracts from the CLI's stdout. */
export interface ParsedCliResult {
  ok: boolean;
  /** Executor's own account of what it did. */
  summary: string;
  toolCalls: number;
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
  span.setAttribute("tool.calls", opts.record.toolCalls);
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

  const proc = await runBounded(opts.bin, opts.args, {
    cwd: opts.input.workspaceDir,
    env: opts.env,
    maxSeconds: opts.input.limits.maxSeconds,
    killGraceMs: opts.killGraceMs,
  });

  // Evidence is captured even on failure: a partial diff is exactly what the
  // runner needs to decide reset-vs-retry (FA-2) and the judge needs to see.
  const diff = await captureWorkspaceDiff(opts.input.workspaceDir);
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
    summary: parsed.summary,
    toolCalls: parsed.toolCalls,
    tokens: parsed.tokens,
    costUsd: parsed.costUsd,
    costEstimated: parsed.costEstimated,
    durationMs: proc.durationMs,
  };

  let record: StepRecord;
  if (proc.timedOut) {
    record = {
      ...base,
      status: "FAILED",
      summary: parsed.summary || "step killed: exceeded maxSeconds",
      failure: {
        reason: `step exceeded maxSeconds=${opts.input.limits.maxSeconds}; killed`,
        retriable: true,
      },
    };
  } else if (proc.exitCode !== 0) {
    record = {
      ...base,
      status: "FAILED",
      summary: parsed.summary || `executor exited with code ${proc.exitCode}`,
      failure: {
        reason: `exit code ${proc.exitCode}: ${proc.stderr.slice(0, 1000)}`,
        retriable: false,
      },
    };
  } else if (!parsed.ok) {
    record = {
      ...base,
      status: "FAILED",
      summary: parsed.summary || (parsed.failure?.reason ?? "executor reported failure"),
      failure: parsed.failure ?? { reason: "executor reported failure", retriable: false },
    };
  } else {
    record = { ...base, status: "SUCCESS" };
  }

  recordStepSpan({
    adapterName: opts.adapterName,
    instruction: opts.input.instruction,
    record,
  });
  return record;
}
