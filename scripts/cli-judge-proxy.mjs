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
import { pathToFileURL } from "node:url";

const port = Number(process.argv[2] ?? 8787);
const backend = process.argv[3] ?? "codex";
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

/**
 * Split a codex model id into the name and its reasoning-effort suffix.
 *
 * `gpt-5.6-sol xhigh` is Chikory's spelling, not codex's: the CLI takes
 * `-m gpt-5.6-sol -c model_reasoning_effort="xhigh"` and rejects the joined
 * form outright ("The 'gpt-5.6-sol xhigh' model is not supported"). Exported so
 * the launch probe (WP-575) builds the SAME argv the judge does — probing a
 * different command than the run uses proves nothing.
 */
export function splitCodexModel(model) {
  const match = /^(.*?)\s+(xhigh|high|medium|low)$/.exec(model);
  if (match === null) return { model, effort: undefined };
  return { model: match[1], effort: match[2] };
}

async function codexComplete(prompt, model) {
  const args = ["exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-c", 'approval_policy="never"', "-C", sandbox];
  if (model !== "default") {
    const { model: modelName, effort } = splitCodexModel(model);
    args.push("-m", modelName);
    if (effort) {
      args.push("-c", `model_reasoning_effort="${effort}"`);
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

/**
 * Map a requested model onto an id `agy` actually accepts.
 *
 * WP-570: the previous table returned DISPLAY strings ("Gemini 3.5 Flash
 * (High)", "Claude Opus 4.6 (Thinking)"). `agy models` emits slug ids —
 * `gemini-3.6-flash-high`, `claude-opus-4-6-thinking` — so those display forms
 * were not selectable. The list below is verbatim from `agy models`; anything
 * already in slug form is passed straight through.
 *
 * Note what is NOT here: Claude 5. Antigravity tops out at `claude-sonnet-4-6`
 * and `claude-opus-4-6-thinking`, so a `claude-sonnet-5` / `claude-opus-5`
 * request must go to the `claude` CLI instead (see `dispatchFor`).
 */
const AGY_MODELS = new Set([
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
]);

export function mapAgyModel(model) {
  if (model === "default") return model;
  const lower = model.toLowerCase();
  if (AGY_MODELS.has(lower)) return lower;

  // Effort suffix is part of the id; default to the strongest tier when absent.
  const effort = /-(high|medium|low)$/.exec(lower)?.[1];
  const base = effort ? lower.slice(0, -(effort.length + 1)) : lower;
  const withEffort = (slug, fallback) => {
    const candidate = `${slug}-${effort ?? fallback}`;
    return AGY_MODELS.has(candidate) ? candidate : `${slug}-${fallback}`;
  };

  if (/gemini-3\.6.*flash|gemini.*3\.6-flash/.test(base)) return withEffort("gemini-3.6-flash", "high");
  if (/gemini-3\.5.*flash|gemini-1\.5-flash/.test(base)) return withEffort("gemini-3.5-flash", "high");
  if (/gemini-3\.1.*flash/.test(base)) return withEffort("gemini-3.5-flash", "high");
  if (/gemini-3\.1-pro|gemini-1\.5-pro/.test(base)) return withEffort("gemini-3.1-pro", "high");
  if (base.includes("sonnet")) return "claude-sonnet-4-6";
  if (base.includes("opus")) return "claude-opus-4-6-thinking";
  return model;
}

/**
 * Which CLI serves this model. The judge reaches every vendor over one
 * `openai-compat` transport, so the MODEL NAME is the only routing signal —
 * this function is the authority the SDK's `inferBackendFromModel` mirrors.
 *
 * Claude 5 ids go to the `claude` CLI because Antigravity does not carry them.
 */
export function dispatchFor(model, fallbackBackend) {
  const lower = model.toLowerCase();
  if (lower.includes("gpt") || lower.includes("codex")) return "codex";
  if (/claude-(opus|sonnet|haiku)-5|claude-fable-5|\bfable\b/.test(lower)) return "claude";
  if (
    lower.includes("gemini") ||
    lower.includes("claude") ||
    lower.includes("sonnet") ||
    lower.includes("opus")
  ) {
    return "agy";
  }
  return fallbackBackend;
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

/**
 * WP-570: Claude 5 judge members. `agy` only carries 4.6-era Claude, so an
 * `opus-5` / `sonnet-5` class member has to reach the `claude` CLI directly.
 * Print mode with a 1-turn cap — the judge fills a form, it does not need tools.
 */
async function claudeComplete(prompt, model) {
  const args = ["-p", prompt, "--max-turns", "1", "--setting-sources", "project"];
  if (model !== "default") args.push("--model", model);
  const stdout = await run("claude", args, { cwd: sandbox });
  const text = stdout.trim();
  if (!text) throw new Error(`claude produced no response: ${stdout.slice(-500)}`);
  // Print mode reports no usage — estimated, and flagged as such so token
  // budgets never mistake it for a metered count.
  return {
    text,
    tokens: { input: estimateTokens(prompt), output: estimateTokens(text), estimated: true },
  };
}

/**
 * Is this CLI failure a quota wall? Mirrors `CLI_LIMIT_RE` in
 * `packages/sdk-ts/src/limit-signal.ts` — the two must agree, or a judge-side
 * wall classifies on one side of the proxy and not the other.
 */
const LIMIT_RE =
  /\b(rate|usage|session|quota)\s+limit\b|\b(limit|quota)\s+(reached|exceeded|exhausted|hit)\b/i;

/** Seconds until reset, parsed from the CLI's own "Resets in 4h6m22s" phrasing. */
export function retryAfterSeconds(message) {
  const match =
    /\b(?:retry|try again|reset|resets|available)[^\n.]*?\bin\s+((?:\d+(?:\.\d+)?\s*(?:h|hours?|hrs?|m|minutes?|mins?|s|seconds?|secs?)(?![a-z])\s*)+)/i.exec(
      message,
    );
  if (!match) return undefined;
  let total = 0;
  for (const [, amount, unit] of match[1].matchAll(
    /(\d+(?:\.\d+)?)\s*(h|hours?|hrs?|m|minutes?|mins?|s|seconds?|secs?)(?![a-z])/gi,
  )) {
    const n = Number(amount);
    const u = unit.toLowerCase();
    if (u.startsWith("h")) total += n * 3600;
    else if (u.startsWith("m")) total += n * 60;
    else total += n;
  }
  return total > 0 ? Math.round(total) : undefined;
}

const backends = {
  codex: codexComplete,
  gemini: geminiComplete,
  agy: agyComplete,
  claude: claudeComplete,
};
/**
 * WP-570: this file is both a server and a module — `mapAgyModel`,
 * `dispatchFor` and `retryAfterSeconds` are unit-tested, and importing a file
 * that binds a port (or calls `process.exit`) as a side effect is not testable.
 * Everything below the guard runs only when the file is the entry point.
 */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

const complete = backends[backend];
if (isEntryPoint && !complete) {
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

      // Dynamic dispatch based on requested model name (F-138/dogfood-102 fix;
      // WP-570 adds the `claude` backend for Claude 5 members).
      const activeBackend = dispatchFor(model, backend);
      const completeFn = backends[activeBackend] ?? complete;

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
      // WP-570: a quota wall must leave as an HTTP 429, not a blanket 500.
      // `classifyLimitSignal` only treats an HTTP signal as a limit on status
      // 429 (limit-signal.ts), so a walled judge used to arrive as a generic
      // retriable 500: the router burned all five attempts and failed the pass,
      // and no cooldown was ever recorded because nothing recognised a wall.
      const isLimit = LIMIT_RE.test(err.message);
      const retryAfter = isLimit ? retryAfterSeconds(err.message) : undefined;
      console.error(
        `[cli-judge:${backend}] ${isLimit ? "QUOTA WALL" : "FAILED"} after ` +
          `${Date.now() - startedAt}ms: ${err.message}`,
      );
      res.writeHead(isLimit ? 429 : 500, {
        "content-type": "application/json",
        ...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
      });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
  });
});

if (isEntryPoint) {
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `[cli-judge] OpenAI-compat shim on http://127.0.0.1:${port} (backend: ${backend} CLI)`,
    );
  });
}

export { server };
