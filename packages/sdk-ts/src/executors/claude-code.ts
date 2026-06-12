/**
 * Claude Code headless adapter (WP-112) — the ADR-003 reference executor.
 * Drives `claude -p` with stream-json output inside the prepared workspace;
 * the shared runCliStep machinery (WP-111) owns bounds, artifacts, status
 * normalization, and the step span.
 */
import type { ExecutorAdapter, StepInput, StepRecord, TokenUsage } from "../types.js";
import type { ArtifactStore } from "../types.js";
import { scrubExecutorEnv } from "./env.js";
import { renderStepPrompt } from "./prompt.js";
import { runCliStep, type ParsedCliResult } from "./step.js";

export interface ClaudeCodeAdapterOptions {
  /** Where diff/transcript artifacts go. */
  store: ArtifactStore;
  /** From `RoutingPolicy.stages.code` (WP-104); CLI default when absent. */
  model?: string;
  /** Binary path — overridable for tests (fake CLI) and pinned installs. */
  binPath?: string;
  /** Env passed to the CLI (defaults to process.env — auth comes from there). */
  env?: Record<string, string | undefined>;
  /**
   * Tool allowlist. The default is file-ops only: with cwd=workspace this
   * keeps writes inside the workspace (deny-by-default outside, executors.md).
   * Adding "Bash" widens capability but escapes the path sandbox — opt-in.
   */
  allowedTools?: string[];
  /** Used when StepInput.limits.maxTurns is absent. */
  defaultMaxTurns?: number;
  killGraceMs?: number;
}

export const CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];
export const CLAUDE_CODE_DEFAULT_MAX_TURNS = 25;

interface ClaudeUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface ClaudeStreamEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: ClaudeUsage;
  message?: { content?: Array<{ type?: string }> };
}

function usageTokens(usage: ClaudeUsage | undefined): TokenUsage {
  // Accounting view: input = everything the model read this step, including
  // cache writes/reads (the CLI's total_cost_usd already prices them).
  return {
    input:
      (usage?.input_tokens ?? 0) +
      (usage?.cache_creation_input_tokens ?? 0) +
      (usage?.cache_read_input_tokens ?? 0),
    output: usage?.output_tokens ?? 0,
  };
}

/** Parse the stream-json transcript; the final `result` event is the verdict. */
export function parseClaudeCodeOutput(stdout: string): ParsedCliResult {
  let resultEvent: ClaudeStreamEvent | undefined;
  let toolCalls = 0;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(trimmed) as ClaudeStreamEvent;
    } catch {
      continue; // interleaved non-JSON noise is not fatal
    }
    if (event.type === "assistant") {
      toolCalls += (event.message?.content ?? []).filter((b) => b.type === "tool_use").length;
    } else if (event.type === "result") {
      resultEvent = event;
    }
  }

  if (!resultEvent) {
    return {
      ok: false,
      summary: "",
      toolCalls,
      tokens: { input: 0, output: 0 },
      costUsd: 0,
      costEstimated: true,
      failure: { reason: "no result event in claude stream-json output", retriable: true },
    };
  }

  const tokens = usageTokens(resultEvent.usage);
  const costUsd = resultEvent.total_cost_usd ?? 0;
  const costEstimated = resultEvent.total_cost_usd === undefined;
  // `error_max_turns` is a SUCCESSFUL bounded invocation: the turn cap is the
  // contract working as designed; the diff is real and the judge gates it.
  // Only execution errors fail the step.
  const ok =
    resultEvent.is_error !== true &&
    (resultEvent.subtype === "success" || resultEvent.subtype === "error_max_turns");

  return {
    ok,
    summary: resultEvent.result ?? "",
    toolCalls,
    tokens,
    costUsd,
    costEstimated,
    failure: ok
      ? undefined
      : {
          reason: `claude result: ${resultEvent.subtype ?? "unknown"}${
            resultEvent.result ? ` — ${resultEvent.result.slice(0, 500)}` : ""
          }`,
          retriable: true,
        },
  };
}

export function createClaudeCodeAdapter(opts: ClaudeCodeAdapterOptions): ExecutorAdapter {
  const bin = opts.binPath ?? "claude";
  const allowedTools = opts.allowedTools ?? CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS;

  return {
    name: "claude-code",
    modelFamily: "anthropic",
    runStep(input: StepInput): Promise<StepRecord> {
      const maxTurns = input.limits.maxTurns ?? opts.defaultMaxTurns ?? CLAUDE_CODE_DEFAULT_MAX_TURNS;
      const args = [
        "-p",
        renderStepPrompt(input),
        "--output-format",
        "stream-json",
        "--verbose", // required by the CLI for -p + stream-json
        "--max-turns",
        String(maxTurns),
        // Reproducibility: user-level settings (hooks, plugins) must not
        // leak into runs; only the workspace's own project settings apply.
        "--setting-sources",
        "project",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        allowedTools.join(","),
      ];
      if (opts.model) args.push("--model", opts.model);

      return runCliStep({
        adapterName: "claude-code",
        store: opts.store,
        input,
        bin,
        args,
        env: scrubExecutorEnv(opts.env ?? process.env, ["ANTHROPIC_API_KEY"]),
        killGraceMs: opts.killGraceMs,
        parse: parseClaudeCodeOutput,
      });
    },
  };
}
