/**
 * Native raw-LLM executor (WP-213) — drives the model directly through the
 * vendor-neutral Router and executes a small, workspace-scoped tool set
 * in-process. No CLI agent binary is spawned.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";

import { SpanStatusCode } from "@opentelemetry/api";

import { getTracer } from "../otel.js";
import type {
  ArtifactStore,
  ExecutorAdapter,
  LLMProvider,
  Message,
  Router,
  StepInput,
  StepRecord,
  TokenUsage,
} from "../types.js";
import { renderStepPrompt } from "./prompt.js";
import { claimsCompleteFromSummary, SPAN_STEP } from "./step.js";
import { assertGitWorkspace, captureWorkspaceDiff } from "./workspace.js";

export interface NativeAdapterOptions {
  store: ArtifactStore;
  router: Router;
  modelFamily: LLMProvider;
  defaultMaxTurns?: number;
}

interface NativeToolCall {
  id?: string;
  name: "list_files" | "read_file" | "write_file" | "edit_file";
  arguments: Record<string, unknown>;
}

interface NativeModelTurn {
  summary?: string;
  final?: boolean;
  tool_calls?: NativeToolCall[];
}

interface NativeTranscriptEntry {
  role: "request" | "assistant" | "tool";
  turn: number;
  content?: string;
  tool?: string;
  status?: "SUCCESS" | "FAILED";
  observation?: string;
}

const DEFAULT_MAX_TURNS = 25;
const ZERO_TOKENS: TokenUsage = { input: 0, output: 0 };

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    final: { type: "boolean" },
    tool_calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { enum: ["list_files", "read_file", "write_file", "edit_file"] },
          arguments: { type: "object" },
        },
        required: ["name", "arguments"],
      },
    },
  },
} as const;

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing string argument '${name}'`);
  }
  return value;
}

function parseModelTurn(content: string): NativeModelTurn {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`native response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObject(raw)) throw new Error("native response must be a JSON object");

  const parsed: NativeModelTurn = {};
  if (raw.summary !== undefined) {
    if (typeof raw.summary !== "string") throw new Error("native response summary must be a string");
    parsed.summary = raw.summary;
  }
  if (raw.final !== undefined) {
    if (typeof raw.final !== "boolean") throw new Error("native response final must be a boolean");
    parsed.final = raw.final;
  }
  if (raw.tool_calls !== undefined) {
    if (!Array.isArray(raw.tool_calls)) throw new Error("native response tool_calls must be an array");
    parsed.tool_calls = raw.tool_calls.map((call, index) => {
      if (!isObject(call)) throw new Error(`tool_calls[${index}] must be an object`);
      const name = call.name;
      if (
        name !== "list_files" &&
        name !== "read_file" &&
        name !== "write_file" &&
        name !== "edit_file"
      ) {
        throw new Error(`tool_calls[${index}].name is not a supported native tool`);
      }
      if (!isObject(call.arguments)) {
        throw new Error(`tool_calls[${index}].arguments must be an object`);
      }
      return {
        ...(typeof call.id === "string" ? { id: call.id } : {}),
        name,
        arguments: call.arguments,
      };
    });
  }
  return parsed;
}

async function workspacePath(workspaceDir: string, requestedPath: string): Promise<string> {
  if (requestedPath.startsWith("/") || requestedPath.length === 0) {
    throw new Error(`path must be workspace-relative: ${requestedPath}`);
  }
  const root = await realpath(workspaceDir);
  const candidate = resolve(root, requestedPath);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`path escapes workspace: ${requestedPath}`);
  }
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes workspace: ${requestedPath}`);
  }
  return candidate;
}

async function existingWorkspacePath(workspaceDir: string, requestedPath: string): Promise<string> {
  const candidate = await workspacePath(workspaceDir, requestedPath);
  const root = await realpath(workspaceDir);
  const resolved = await realpath(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes workspace: ${requestedPath}`);
  }
  return resolved;
}

async function writableWorkspacePath(workspaceDir: string, requestedPath: string): Promise<string> {
  const candidate = await workspacePath(workspaceDir, requestedPath);
  const root = await realpath(workspaceDir);
  const parent = await realpath(dirname(candidate)).catch(() => root);
  if (parent !== root && !parent.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes workspace: ${requestedPath}`);
  }
  return candidate;
}

async function executeTool(workspaceDir: string, call: NativeToolCall): Promise<string> {
  switch (call.name) {
    case "list_files": {
      const path = call.arguments.path === undefined ? "." : stringArg(call.arguments, "path");
      const dir = await existingWorkspacePath(workspaceDir, path);
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort()
        .join("\n");
    }
    case "read_file": {
      const path = stringArg(call.arguments, "path");
      return readFile(await existingWorkspacePath(workspaceDir, path), "utf8");
    }
    case "write_file":
    case "edit_file": {
      const path = stringArg(call.arguments, "path");
      const content = stringArg(call.arguments, "content");
      const target = await writableWorkspacePath(workspaceDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return `${call.name} ${path} (${content.length} bytes)`;
    }
  }
}

function toolObservation(call: NativeToolCall, status: "SUCCESS" | "FAILED", output: string): Message {
  return {
    role: "user",
    content: JSON.stringify({
      type: "tool_observation",
      id: call.id,
      name: call.name,
      status,
      output,
    }),
  };
}

async function buildRecord(opts: {
  adapterName: string;
  store: ArtifactStore;
  input: StepInput;
  startedAt: number;
  transcript: NativeTranscriptEntry[];
  status: "SUCCESS" | "FAILED";
  summary: string;
  toolCalls: number;
  tokens: TokenUsage;
  costUsd: number;
  failure?: { reason: string; retriable: boolean };
}): Promise<StepRecord> {
  const durationMs = Math.max(0, Date.now() - opts.startedAt);
  const diff = await captureWorkspaceDiff(opts.input.workspaceDir);
  const transcriptText = JSON.stringify(opts.transcript, null, 2);
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

  const base = {
    diffRef,
    transcriptRef,
    summary: opts.summary,
    toolCalls: opts.toolCalls,
    tokens: opts.tokens,
    costUsd: opts.costUsd,
    costEstimated: false,
    durationMs,
  };
  const record: StepRecord =
    opts.status === "SUCCESS"
      ? { ...base, status: "SUCCESS", claimsComplete: claimsCompleteFromSummary(opts.summary) }
      : {
          ...base,
          status: "FAILED",
          failure: opts.failure ?? { reason: opts.summary || "native executor failed", retriable: true },
        };

  const span = getTracer().startSpan(SPAN_STEP, { startTime: opts.startedAt });
  span.setAttribute("executor", opts.adapterName);
  span.setAttribute(
    "instruction.hash",
    createHash("sha256").update(opts.input.instruction).digest("hex").slice(0, 16),
  );
  span.setAttribute("status", record.status);
  span.setAttribute("tokens.input", record.tokens.input);
  span.setAttribute("tokens.output", record.tokens.output);
  span.setAttribute("cost.usd", record.costUsd);
  span.setAttribute("duration.ms", record.durationMs);
  span.setAttribute("tool.calls", record.toolCalls);
  if (record.status === "FAILED") {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: record.failure?.reason ?? "step failed",
    });
  }
  span.end();
  return record;
}

export function createNativeAdapter(opts: NativeAdapterOptions): ExecutorAdapter {
  return {
    name: "native",
    modelFamily: opts.modelFamily,
    async runStep(input: StepInput): Promise<StepRecord> {
      const startedAt = Date.now();
      await assertGitWorkspace(input.workspaceDir);

      const maxTurns = input.limits.maxTurns ?? opts.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
      const deadlineMs = startedAt + input.limits.maxSeconds * 1000;
      const messages: Message[] = [
        {
          role: "system",
          content:
            "You are Chikory's native in-process executor. Respond only with JSON matching the requested schema. " +
            "Use tool_calls to inspect or edit the workspace. Set final=true only when this step is complete.",
        },
        { role: "user", content: renderStepPrompt(input) },
      ];
      const transcript: NativeTranscriptEntry[] = [
        { role: "request", turn: 0, content: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n") },
      ];
      let tokens = ZERO_TOKENS;
      let costUsd = 0;
      let toolCalls = 0;
      let summary = "";

      for (let turn = 1; turn <= maxTurns; turn++) {
        if (Date.now() > deadlineMs) {
          return buildRecord({
            adapterName: "native",
            store: opts.store,
            input,
            startedAt,
            transcript,
            status: "FAILED",
            summary: `step exceeded maxSeconds=${input.limits.maxSeconds}`,
            toolCalls,
            tokens,
            costUsd,
            failure: { reason: `step exceeded maxSeconds=${input.limits.maxSeconds}`, retriable: true },
          });
        }

        const result = await opts.router.complete({
          stage: "code",
          messages,
          maxTokens: 4096,
          temperature: 0,
          responseSchema: RESPONSE_SCHEMA,
        });
        if (result.status === "FAILED") {
          return buildRecord({
            adapterName: "native",
            store: opts.store,
            input,
            startedAt,
            transcript,
            status: "FAILED",
            summary: result.reason,
            toolCalls,
            tokens,
            costUsd,
            failure: { reason: result.reason, retriable: result.retriable },
          });
        }

        tokens = addTokens(tokens, result.tokens);
        costUsd += result.costUsd;
        messages.push({ role: "assistant", content: result.content });
        transcript.push({ role: "assistant", turn, content: result.content });

        let modelTurn: NativeModelTurn;
        try {
          modelTurn = parseModelTurn(result.content);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return buildRecord({
            adapterName: "native",
            store: opts.store,
            input,
            startedAt,
            transcript,
            status: "FAILED",
            summary: reason,
            toolCalls,
            tokens,
            costUsd,
            failure: { reason, retriable: false },
          });
        }

        summary = modelTurn.summary ?? summary;
        if (modelTurn.final === true) {
          return buildRecord({
            adapterName: "native",
            store: opts.store,
            input,
            startedAt,
            transcript,
            status: "SUCCESS",
            summary,
            toolCalls,
            tokens,
            costUsd,
          });
        }

        const calls = modelTurn.tool_calls ?? [];
        if (calls.length === 0) {
          return buildRecord({
            adapterName: "native",
            store: opts.store,
            input,
            startedAt,
            transcript,
            status: "FAILED",
            summary: summary || "native model returned no tool calls and did not set final=true",
            toolCalls,
            tokens,
            costUsd,
            failure: {
              reason: "native model returned no tool calls and did not set final=true",
              retriable: true,
            },
          });
        }

        for (const call of calls) {
          toolCalls++;
          let status: "SUCCESS" | "FAILED" = "SUCCESS";
          let observation: string;
          try {
            observation = await executeTool(input.workspaceDir, call);
          } catch (err) {
            status = "FAILED";
            observation = err instanceof Error ? err.message : String(err);
          }
          messages.push(toolObservation(call, status, observation));
          transcript.push({
            role: "tool",
            turn,
            tool: call.name,
            status,
            observation,
          });
        }
      }

      const reason = `step exceeded maxTurns=${maxTurns}`;
      return buildRecord({
        adapterName: "native",
        store: opts.store,
        input,
        startedAt,
        transcript,
        status: "FAILED",
        summary: reason,
        toolCalls,
        tokens,
        costUsd,
        failure: { reason, retriable: true },
      });
    },
  };
}
