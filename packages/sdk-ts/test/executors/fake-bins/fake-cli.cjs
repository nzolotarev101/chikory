#!/usr/bin/env node
/**
 * Fake CLI agent for the executor conformance suite (WP-111). Speaks either
 * wire dialect (FAKE_DIALECT=claude|codex) and misbehaves on demand
 * (FAKE_MODE=ok|hang|fail|error-result). This is a transport-level fake (like
 * the router's fake HTTP servers in WP-103) — the REAL agents run in the
 * gated @e2e tests; no LLM is mocked here, only the subprocess wire format.
 *
 * In "ok" mode it executes the same toy-task instruction grammar the real
 * agents receive in e2e: "Create a file named X containing exactly: Y" /
 * "Replace the contents of the file named X with exactly: Y".
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const dialect = process.env.FAKE_DIALECT || "claude";
const mode = process.env.FAKE_MODE || "ok";
const providerEnvVars = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_COMPAT_BASE_URL",
  "OPENAI_COMPAT_API_KEY",
];

function prompt() {
  const args = process.argv.slice(2);
  const p = args.indexOf("-p");
  if (p !== -1 && args[p + 1]) return args[p + 1];
  return args[args.length - 1] || "";
}

function doWork() {
  const text = prompt();
  const re =
    /(?:Create a file|Replace the contents of the file) named ([\w./-]+) (?:containing|with) exactly: (.+)/g;
  let m;
  let last;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) return "nothing to do";
  const target = path.resolve(process.cwd(), last[1]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, last[2] + "\n");
  return `wrote ${last[1]}`;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function withEnvSummary(summary) {
  if (process.env.FAKE_ECHO_ENV !== "1") return summary;
  const present = providerEnvVars.filter((name) => process.env[name] !== undefined);
  return `${summary}; provider_env=${present.length > 0 ? present.join(",") : "none"}`;
}

if (mode === "hang") {
  if (process.env.FAKE_TRAP_TERM === "1") {
    process.on("SIGTERM", () => {});
  }
  if (process.env.FAKE_SPAWN_GRANDCHILD === "1") {
    // Spawn a grandchild that INHERITS our stdout pipe and is a separate process
    // (WP-255 / F-59 reproduction). A bare `child.kill()` on the direct child does
    // NOT reach this grandchild, so it keeps the runner's stdout pipe open and
    // `close` never fires — only a process-group kill (`process.kill(-pid)`) reaps it.
    const { spawn } = require("node:child_process");
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    grandchild.unref();
  }
  emit({ type: "system", subtype: "init" });
  setInterval(() => {}, 60_000); // stay alive, produce nothing
} else if (mode === "fail") {
  process.stderr.write("boom: fake agent crashed\n");
  process.exit(2);
} else if (dialect === "claude") {
  emit({ type: "system", subtype: "init", cwd: process.cwd() });
  const summary = withEnvSummary(mode === "ok" ? doWork() : "did nothing");
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use" }, { type: "text", text: summary }] },
  });
  if (mode === "error-result") {
    emit({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "fake execution error",
      num_turns: 1,
      total_cost_usd: 0.001,
      usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 },
    });
  } else {
    emit({
      type: "result",
      subtype: "success",
      is_error: false,
      result: summary,
      num_turns: 2,
      total_cost_usd: 0.0123,
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
        output_tokens: 40,
      },
    });
  }
} else {
  // codex dialect
  emit({ type: "thread.started", thread_id: "fake-thread" });
  emit({ type: "turn.started" });
  const summary = withEnvSummary(mode === "ok" ? doWork() : "did nothing");
  emit({ type: "item.completed", item: { id: "item_0", type: "command_execution" } });
  emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: summary } });
  if (mode === "error-result") {
    emit({ type: "turn.failed", error: { message: "fake codex failure" } });
  } else {
    emit({
      type: "turn.completed",
      usage: { input_tokens: 1400, cached_input_tokens: 200, output_tokens: 50 },
    });
  }
}
