/**
 * Claude Code headless adapter (WP-112) — the ADR-003 reference executor.
 * Drives `claude -p` with stream-json output inside the prepared workspace;
 * the shared runCliStep machinery (WP-111) owns bounds, artifacts, status
 * normalization, and the step span.
 */
import { computeCostUsd } from "../pricing.js";
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
  // Per-assistant-turn usage rides on the message; the final `result` event
  // carries the authoritative total (WP-255: the per-turn usage is the partial
  // telemetry recoverable when a step is killed before `result`).
  message?: { content?: Array<{ type?: string; text?: string }>; usage?: ClaudeUsage };
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
export function parseClaudeCodeOutput(
  model: string | undefined,
): (stdout: string) => ParsedCliResult {
  return (stdout) => {
    let resultEvent: ClaudeStreamEvent | undefined;
    let toolCalls = 0;
    // WP-255: keep the most-recent assistant-turn usage so a step killed before
    // the `result` event still reports the partial token spend (the pacing
    // numerator + token budget gate would otherwise read a misleading 0/0).
    let lastAssistantUsage: ClaudeUsage | undefined;
    let assistantTurns = 0;
    // On error_max_turns the result event's `result` field is EMPTY — the last
    // assistant text is the only executor account of the step, and without it
    // the next step's `recentSteps` handoff is blank (dogfood-111: each capped
    // step restarted the same exploration from scratch).
    let lastAssistantText = "";

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
        const content = event.message?.content ?? [];
        toolCalls += content.filter((b) => b.type === "tool_use").length;
        const text = content
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (text) lastAssistantText = text;
        if (event.message?.usage) {
          lastAssistantUsage = event.message.usage;
          assistantTurns += 1;
        }
      } else if (event.type === "result") {
        resultEvent = event;
      }
    }

    if (!resultEvent) {
      // No authoritative total — recover best-effort partial usage from the last
      // assistant turn (WP-255), pricing it from the table since the killed run
      // never emitted `total_cost_usd`.
      const tokens = usageTokens(lastAssistantUsage);
      const recovered = lastAssistantUsage !== undefined;
      return {
        ok: false,
        summary: "",
        toolCalls,
        tokens,
        costUsd: recovered && model ? computeCostUsd(model, tokens) : 0,
        costEstimated: true,
        failure: {
          reason: recovered
            ? `no result event in claude stream-json output (partial usage recovered from ${assistantTurns} assistant turn${assistantTurns === 1 ? "" : "s"})`
            : "no result event in claude stream-json output",
          retriable: true,
        },
      };
    }

    const tokens = usageTokens(resultEvent.usage);
    const costUsd = resultEvent.total_cost_usd ?? 0;
    const costEstimated = resultEvent.total_cost_usd === undefined;
    // `error_max_turns` is a SUCCESSFUL bounded invocation: the turn cap is the
    // contract working as designed; the diff is real and the judge gates it.
    // The real CLI flags that event `is_error: true`, so the subtype must be
    // checked before `is_error` — gating both subtypes behind `is_error !== true`
    // re-FAILed every capped step and re-tripped the CG-1 loop-breaker WP-533
    // removed (dogfood-111). Only execution errors fail the step.
    const ok =
      resultEvent.subtype === "error_max_turns" ||
      (resultEvent.is_error !== true && resultEvent.subtype === "success");

    return {
      ok,
      summary: resultEvent.result || lastAssistantText,
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
  };
}

export function createClaudeCodeAdapter(opts: ClaudeCodeAdapterOptions): ExecutorAdapter {
  const bin = opts.binPath ?? "claude";
  const allowedTools = opts.allowedTools ??
    (process.env.CHIKORY_ALLOW_BASH === "1"
      ? [...CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS, "Bash"]
      : CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS);

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
        process.env.CHIKORY_ALLOW_BASH === "1" ? "auto" : "acceptEdits",
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
        parse: parseClaudeCodeOutput(opts.model),
      });
    },
  };
}
