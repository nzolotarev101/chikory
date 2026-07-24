/**
 * Gemini CLI executor adapter (WP-216) — drives the Antigravity CLI (`agy`,
 * Gemini family) as a wrapped executor over the shared runCliStep machinery
 * (WP-111). Antigravity replaced Google's retired standalone `gemini` CLI; it
 * authenticates via keyless Antigravity OAuth, so wire cost is $0 and token
 * usage is ESTIMATED (print mode reports no structured usage) — the parallel
 * to the codex adapter's `costEstimated: true`.
 *
 * `agy` has no `--json` event stream (unlike claude-code stream-json / codex
 * exec --json): print mode emits the agent's final text answer. The parser is
 * therefore text-shaped — success = a non-empty response — and toolCalls are
 * not observable (reported as 0). File edits happen agentically in the cwd
 * (the prepared workspace) under `--dangerously-skip-permissions --mode
 * accept-edits`; the diff runCliStep captures is the real deliverable.
 */
import type { ArtifactStore, ExecutorAdapter, StepInput, StepRecord, TokenUsage } from "../types.js";
import { scrubExecutorEnv } from "./env.js";
import { renderStepPrompt } from "./prompt.js";
import { runCliStep, type ParsedCliResult } from "./step.js";

export interface GeminiCliAdapterOptions {
  /** Where diff/transcript artifacts go. */
  store: ArtifactStore;
  /** From `RoutingPolicy.stages.code`; CLI default model when absent/"default". */
  model?: string;
  /** Binary path — overridable for tests (fake CLI) and pinned installs. */
  binPath?: string;
  /** Env passed to the CLI (defaults to process.env — auth comes from there). */
  env?: Record<string, string | undefined>;
  killGraceMs?: number;
}

/**
 * Heuristic token estimate — `agy` print mode ships no usage counts and no
 * local BPE tokenizer for the Gemini family exists. ~4 chars/token tracks
 * mixed prose+code within ~10-15% (same constant the CLI judge proxy uses).
 * The estimate is telemetry only: this endpoint is keyless, so cost is $0.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Parse `agy --print` output: plain text, no structured usage. */
export function parseAgyOutput(prompt: string): (stdout: string) => ParsedCliResult {
  return (stdout) => {
    const summary = stdout.trim();
    const ok = summary.length > 0;
    const tokens: TokenUsage = {
      input: estimateTokens(prompt),
      output: estimateTokens(summary),
    };
    return {
      ok,
      summary,
      // Print mode does not enumerate tool calls; the diff is the evidence.
      toolCalls: 0,
      tokens,
      // Keyless Antigravity OAuth — no wire cost; token counts are estimated.
      costUsd: 0,
      costEstimated: true,
      failure: ok
        ? undefined
        : { reason: "agy produced no response (empty print output)", retriable: true },
    };
  };
}

export function createGeminiCliAdapter(opts: GeminiCliAdapterOptions): ExecutorAdapter {
  const bin = opts.binPath ?? "agy";

  return {
    name: "gemini-cli",
    modelFamily: "gemini",
    runStep(input: StepInput): Promise<StepRecord> {
      // No --max-turns equivalent: `agy` steps are bounded by maxSeconds (and
      // the instruction scope), like the codex adapter.
      const prompt = renderStepPrompt(input);
      const args = [
        // Auto-approve every tool permission request — the unattended-run
        // contract (no interactive prompt can block the step).
        "--dangerously-skip-permissions",
        // Apply file edits without confirmation (agentic execution).
        "--mode",
        "accept-edits",
        // `agy` does NOT operate on the process cwd: print mode edits its own
        // global scratch dir unless the workspace is registered explicitly.
        // --add-dir binds the run workspace so the diff lands where runCliStep
        // captures it (verified: without this the workspace diff is empty).
        "--add-dir",
        input.workspaceDir,
      ];
      const isGeminiModel =
        opts.model &&
        opts.model !== "default" &&
        !opts.model.startsWith("gpt-") &&
        !opts.model.startsWith("claude-");
      if (isGeminiModel && opts.model) {
        let modelName: string = opts.model;
        let effort: string | undefined;
        for (const level of ["low", "medium", "high"] as const) {
          if (modelName.endsWith(` ${level}`)) {
            modelName = modelName.slice(0, -(level.length + 1));
            effort = level;
            break;
          }
        }
        args.push("--model", modelName);
        if (effort) args.push("--effort", effort);
      }
      // `--print <prompt>` runs a single prompt non-interactively; keep it last
      // so the prompt is the flag's value (mirrors the CLI judge proxy).
      args.push("--print", prompt);

      return runCliStep({
        adapterName: "gemini-cli",
        store: opts.store,
        input,
        bin,
        args,
        env: scrubExecutorEnv(opts.env ?? process.env, ["GEMINI_API_KEY"]),
        killGraceMs: opts.killGraceMs,
        parse: parseAgyOutput(prompt),
      });
    },
  };
}
