#!/usr/bin/env node
/**
 * CLI-backed judge shim (WP-143 dogfood). A local OpenAI-compatible
 * `/v1/chat/completions` endpoint backed by a locally-authenticated agent
 * CLI — the judge gets a structurally different model family with zero API
 * keys on the machine, through the router's existing openai-compat seam.
 *
 * Backends: `codex` (ChatGPT OAuth, GPT-5 family), `agy` (Antigravity OAuth,
 * Gemini family — replaces the deprecated standalone `gemini` CLI, whose free
 * OAuth Google retired in favor of Antigravity), and `gemini` (legacy, dead).
 * Not a mock: a real frontier model fills the judge form. P2 candidate:
 * first-class CLI-backed judge adapters so this shim becomes unnecessary.
 *
 * Token usage: `codex`/`gemini` report provider-metered counts; `agy` print
 * mode surfaces none, so its usage is an explicit estimate flagged
 * `estimated: true` (see `estimateTokens`) and never priced as metered.
 *
 * Usage: node scripts/cli-judge-proxy.mjs [port] [backend]
 *        (defaults: 8787 codex)
 *
 *        To run chikory with this shim:
 *        OPENAI_COMPAT_BASE_URL=http://127.0.0.1:8787 pnpm chikory run <spec.yaml> --watch
 *
 * The request's `model` is passed through to the CLI (`-m`) unless it is
 * the literal "default".
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 8787);
const backend = process.argv[3] ?? "agy";
// Empty cwd: the judge prompt carries all evidence; the CLI must not wander.
const sandbox = mkdtempSync(join(tmpdir(), "cli-judge-"));

function renderPrompt(messages) {
  return messages
    .map((m) => (m.role === "system" ? `<instructions>\n${m.content}\n</instructions>` : m.content))
    .join("\n\n");
}

// Heuristic token estimate for backends whose CLI does not report usage
// (agy print mode). No local BPE tokenizer ships for the Gemini family, so
// this is an explicit estimate, not a metered count: it blends a word-rate
// (~0.75 words/token) and a char-rate (~4 chars/token), which tracks
// GPT/Gemini BPE within ~10-15% on mixed prose+code. Always flagged
// `estimated` upstream so token budgets/observability never mistake it for a
// provider-reported figure.
function estimateTokens(s) {
  if (!s) return 0;
  const words = (s.match(/\S+/g) ?? []).length;
  const byWords = words / 0.75;
  const byChars = s.length / 4;
  return Math.max(1, Math.round((byWords + byChars) / 2));
}

function run(bin, args, opts, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
      else resolve(stdout);
    });
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function codexComplete(prompt, model) {
  const args = ["exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-c", 'approval_policy="never"', "-C", sandbox];
  if (model !== "default") {
    let modelName = model;
    let reasoningEffort = undefined;
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
  args.push("-");
  const stdout = await run("codex", args, {}, prompt);
  let text = "";
  let usage = { input_tokens: 0, output_tokens: 0 };
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        text = event.item.text ?? text;
      }
      if (event.type === "turn.completed" && event.usage) usage = event.usage;
    } catch {
      // non-JSON chatter on stdout — ignore
    }
  }
  if (!text) throw new Error(`codex exec produced no agent_message: ${stdout.slice(-500)}`);
  return { text, tokens: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } };
}

async function geminiComplete(prompt, model) {
  const args = ["-o", "json"];
  if (model !== "default") args.push("-m", model);
  args.push("-p", prompt);
  const stdout = await run("gemini", args, {
    cwd: sandbox,
    env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
  });
  const parsed = JSON.parse(stdout);
  if (typeof parsed.response !== "string" || parsed.response.length === 0) {
    throw new Error(`gemini produced no response: ${stdout.slice(-500)}`);
  }
  const modelStats = Object.values(parsed.stats?.models ?? {})[0];
  return {
    text: parsed.response,
    tokens: {
      input: modelStats?.tokens?.prompt ?? 0,
      output: (modelStats?.tokens?.candidates ?? 0) + (modelStats?.tokens?.thoughts ?? 0),
    },
  };
}

function mapAgyModel(model) {
  if (model === "default") return model;
  const lower = model.toLowerCase();
  if (lower.includes("gemini-3.5-flash") || lower.includes("gemini-1.5-flash") || lower.includes("gemini-3.1-flash")) {
    return "Gemini 3.5 Flash (High)";
  }
  if (lower.includes("gemini-3.1-pro") || lower.includes("gemini-1.5-pro")) {
    return "Gemini 3.1 Pro (High)";
  }
  if (lower.includes("sonnet")) {
    return "Claude Sonnet 4.6 (Thinking)";
  }
  if (lower.includes("opus")) {
    return "Claude Opus 4.6 (Thinking)";
  }
  return model;
}

async function agyComplete(prompt, model) {
  // Antigravity CLI: pure-text print mode. No structured token stats, so
  // usage is reported as zero (the judge is keyless/free anyway).
  const mappedModel = mapAgyModel(model);
  const args = ["--print", prompt];
  if (mappedModel !== "default") args.push("--model", mappedModel);
  const stdout = await run("agy", args, { cwd: sandbox });
  const text = stdout.trim();
  if (!text) throw new Error(`agy produced no response: ${stdout.slice(-500)}`);
  return {
    text,
    tokens: { input: estimateTokens(prompt), output: estimateTokens(text), estimated: true },
  };
}

const backends = { codex: codexComplete, gemini: geminiComplete, agy: agyComplete };
const complete = backends[backend];
if (!complete) {
  console.error(`unknown backend '${backend}' (have: ${Object.keys(backends).join(", ")})`);
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const startedAt = Date.now();
    try {
      const { messages = [], model = "default" } = JSON.parse(body);

      // Dynamic dispatch based on requested model name (F-138/dogfood-102 fix)
      let completeFn = complete;
      let activeBackend = backend;
      const lowerModel = model.toLowerCase();
      if (lowerModel.includes("gpt") || lowerModel.includes("codex")) {
        completeFn = codexComplete;
        activeBackend = "codex";
      } else if (
        lowerModel.includes("gemini") ||
        lowerModel.includes("claude") ||
        lowerModel.includes("sonnet") ||
        lowerModel.includes("opus")
      ) {
        completeFn = agyComplete;
        activeBackend = "agy";
      }

      const { text, tokens } = await completeFn(renderPrompt(messages), model);
      console.log(
        `[cli-judge:${activeBackend}] ${model} · ${Date.now() - startedAt}ms · ` +
          `${tokens.input}/${tokens.output} tokens${tokens.estimated ? " (estimated)" : ""}`,
      );
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `cli-judge-${Date.now()}`,
          object: "chat.completion",
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: tokens.input,
            completion_tokens: tokens.output,
            ...(tokens.estimated ? { estimated: true } : {}),
          },
        }),
      );
    } catch (err) {
      console.error(
        `[cli-judge:${backend}] FAILED after ${Date.now() - startedAt}ms: ${err.message}`,
      );
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[cli-judge] OpenAI-compat shim on http://127.0.0.1:${port} (backend: ${backend} CLI)`);
});
