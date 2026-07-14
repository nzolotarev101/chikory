/**
 * Codex CLI adapter (WP-113) — `codex exec --json` (JSONL events). Same
 * shape as the Claude Code adapter: wire-format parser over the shared
 * runCliStep machinery. Codex reports token usage but no dollar cost, so
 * cost is estimated from the pricing table when the model is known
 * (`costEstimated: true` — ADR-003 consequence).
 */
import { computeCostUsd } from "../pricing.js";
import type { ExecutorAdapter, StepInput, StepRecord, TokenUsage } from "../types.js";
import type { ArtifactStore } from "../types.js";
import { scrubExecutorEnv } from "./env.js";
import { renderStepPrompt } from "./prompt.js";
import { runCliStep, type ParsedCliResult } from "./step.js";

export interface CodexAdapterOptions {
  store: ArtifactStore;
  /** From `RoutingPolicy.stages.code`; CLI default model when absent. */
  model?: string;
  binPath?: string;
  env?: Record<string, string | undefined>;
  killGraceMs?: number;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexEvent {
  type?: string;
  usage?: CodexUsage;
  error?: { message?: string };
  item?: { type?: string; text?: string };
}

/** Parse codex exec JSONL; `turn.completed` carries usage, agent_message the summary. */
export function parseCodexOutput(model: string | undefined): (stdout: string) => ParsedCliResult {
  return (stdout) => {
    let summary = "";
    let toolCalls = 0;
    let tokens: TokenUsage | undefined;
    let failureReason: string | undefined;

    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let event: CodexEvent;
      try {
        event = JSON.parse(trimmed) as CodexEvent;
      } catch {
        continue;
      }
      if (event.type === "item.completed" && event.item) {
        if (event.item.type === "agent_message") {
          summary = event.item.text ?? summary;
        } else if (event.item.type !== "reasoning") {
          // command_execution, patch_apply, file_change, … = the agent acting.
          toolCalls += 1;
        }
      } else if (event.type === "turn.completed") {
        tokens = {
          // cached_input_tokens is a subset of input_tokens (OpenAI convention).
          input: event.usage?.input_tokens ?? 0,
          output: event.usage?.output_tokens ?? 0,
        };
      } else if (event.type === "turn.failed" || event.type === "error") {
        failureReason = event.error?.message ?? "codex turn failed";
      }
    }

    const ok = tokens !== undefined && failureReason === undefined;
    const finalTokens = tokens ?? { input: 0, output: 0 };
    return {
      ok,
      summary,
      toolCalls,
      tokens: finalTokens,
      // No exact cost on the wire — estimate from the pricing table ($0 for
      // unknown/default models; the ledger tracks the estimate flag).
      costUsd: model ? computeCostUsd(model, finalTokens) : 0,
      costEstimated: true,
      failure: ok
        ? undefined
        : {
            reason: failureReason ?? "no turn.completed event in codex output",
            retriable: true,
          },
    };
  };
}

export function createCodexAdapter(opts: CodexAdapterOptions): ExecutorAdapter {
  const bin = opts.binPath ?? "codex";

  return {
    name: "codex",
    modelFamily: "openai",
    runStep(input: StepInput): Promise<StepRecord> {
      // No --max-turns equivalent: Codex steps are bounded by maxSeconds (and
      // the instruction scope); limits.maxTurns is not enforceable here.
      const args = [
        "exec",
        "--json",
        // Reproducibility + isolation, mirroring the Claude adapter's
        // --setting-sources: no user config, no session files left behind.
        "--ignore-user-config",
        "--ephemeral",
        "--skip-git-repo-check", // workspace IS a git repo; skip the cwd≠root warning path
        "-s",
        "workspace-write", // deny-by-default outside the workspace (executors.md)
        // `codex exec` has no `-a/--ask-for-approval` flag (that lives on the
        // interactive TUI); approval policy is a config key here. "never" =
        // never block on an approval prompt — auto-run within the sandbox,
        // auto-deny escalations — which is the unattended-run contract.
        "-c",
        'approval_policy="never"',
        "-C",
        input.workspaceDir,
      ];
      if (opts.model) {
        let modelName = opts.model;
        let reasoningEffort: string | undefined;
        if (modelName.endsWith(" xhigh")) {
          modelName = modelName.slice(0, -6);
          reasoningEffort = "xhigh";
        } else if (modelName.endsWith(" high")) {
          modelName = modelName.slice(0, -5);
          reasoningEffort = "high";
        } else if (modelName.endsWith(" medium")) {
          modelName = modelName.slice(0, -7);
          reasoningEffort = "medium";
        } else if (modelName.endsWith(" low")) {
          modelName = modelName.slice(0, -4);
          reasoningEffort = "low";
        }
        args.push("-m", modelName);
        if (reasoningEffort) {
          args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
        }
      }
      args.push(renderStepPrompt(input));

      return runCliStep({
        adapterName: "codex",
        store: opts.store,
        input,
        bin,
        args,
        env: scrubExecutorEnv(opts.env ?? process.env, ["OPENAI_API_KEY"]),
        killGraceMs: opts.killGraceMs,
        parse: parseCodexOutput(opts.model),
      });
    },
  };
}
