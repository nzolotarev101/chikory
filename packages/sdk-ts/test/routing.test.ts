/**
 * Per-stage routing policy (WP-104) — RT-4/RT-5/RT-6.
 *
 * The acceptance test: an identical task function runs under two different
 * routing policies (Anthropic-exec/Gemini-judge vs OpenAI-exec/Anthropic-judge)
 * with zero code changes — only the policy object differs. Transport-level
 * fakes record which provider+model served each stage.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRouter, type RouterOptions } from "../src/router.js";
import { defaultPolicy } from "../src/taskspec.js";
import type { LLMProvider, Router, RoutingPolicy, Stage } from "../src/types.js";

interface StageHit {
  provider: LLMProvider;
  model: string;
}

/** One fake per provider, each speaking its real wire format. */
const fakes = new Map<LLMProvider, { server: Server; url: string }>();
const hits: Array<StageHit & { path: string }> = [];

function respond(provider: LLMProvider, res: ServerResponse, text: string): void {
  res.setHeader("content-type", "application/json");
  switch (provider) {
    case "anthropic":
      res.end(
        JSON.stringify({
          content: [{ type: "text", text }],
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      );
      break;
    case "gemini":
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        }),
      );
      break;
    default:
      res.end(
        JSON.stringify({
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      );
  }
}

async function startProviderFake(provider: LLMProvider): Promise<void> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { model?: string };
      // Gemini carries the model in the path, not the body.
      const model =
        parsed.model ?? /models\/([^:]+):/.exec(req.url ?? "")?.[1] ?? "unknown";
      hits.push({ provider, model, path: req.url ?? "" });
      respond(provider, res, `${provider} says ok`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  fakes.set(provider, { server, url: `http://127.0.0.1:${port}` });
}

beforeAll(async () => {
  for (const p of ["anthropic", "openai", "gemini"] as const) await startProviderFake(p);
});

afterAll(async () => {
  for (const { server } of fakes.values()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const ENV = {
  ANTHROPIC_API_KEY: "k",
  OPENAI_API_KEY: "k",
  GEMINI_API_KEY: "k",
};

function routerOptions(): RouterOptions {
  return {
    env: ENV,
    baseUrls: {
      anthropic: fakes.get("anthropic")!.url,
      openai: fakes.get("openai")!.url,
      gemini: fakes.get("gemini")!.url,
    },
    retry: { baseDelayMs: 1, jitter: false },
  };
}

/**
 * The "task" — identical for every policy. Swapping vendors must require
 * zero changes here (RT-4): the policy object is the only variable.
 */
async function runTaskStages(router: Router): Promise<Record<Stage, StageHit>> {
  const out = {} as Record<Stage, StageHit>;
  for (const stage of ["plan", "code", "review", "judge"] as const) {
    const result = await router.complete({
      stage,
      messages: [{ role: "user", content: `do the ${stage} step` }],
    });
    if (result.status !== "SUCCESS") throw new Error(`stage ${stage} failed: ${result.reason}`);
    out[stage] = { provider: result.provider, model: result.model };
  }
  return out;
}

describe("per-stage routing policy (WP-104)", () => {
  it("policy A: Anthropic executor / Gemini judge", async () => {
    const policy: RoutingPolicy = defaultPolicy("anthropic"); // judge auto-picked: gemini
    const stages = await runTaskStages(createRouter(policy, routerOptions()));
    expect(stages.plan).toEqual({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });
    expect(stages.code).toEqual({ provider: "anthropic", model: "claude-fable-5" });
    expect(stages.review.provider).toBe("anthropic");
    expect(stages.judge).toEqual({ provider: "gemini", model: "gemini-2.5-pro" });
  });

  it("policy B: OpenAI executor / Anthropic judge — same code, config diff only", async () => {
    const policy: RoutingPolicy = defaultPolicy("openai"); // judge auto-picked: anthropic
    const stages = await runTaskStages(createRouter(policy, routerOptions()));
    expect(stages.plan).toEqual({ provider: "openai", model: "gpt-5.2-mini" });
    expect(stages.code).toEqual({ provider: "openai", model: "gpt-5.2" });
    expect(stages.judge.provider).toBe("anthropic");
  });

  it("each stage hit the wire with the policy's model (provider-side evidence)", async () => {
    hits.length = 0;
    const policy: RoutingPolicy = {
      stages: {
        plan: { provider: "gemini", model: "gemini-2.5-flash" },
        code: { provider: "openai", model: "gpt-5.2" },
        review: { provider: "anthropic", model: "claude-sonnet-4-6" },
        judge: { provider: "gemini", model: "gemini-2.5-pro" },
      },
    };
    await runTaskStages(createRouter(policy, routerOptions()));
    expect(hits.map((h) => `${h.provider}:${h.model}`)).toEqual([
      "gemini:gemini-2.5-flash",
      "openai:gpt-5.2",
      "anthropic:claude-sonnet-4-6",
      "gemini:gemini-2.5-pro",
    ]);
  });
});
