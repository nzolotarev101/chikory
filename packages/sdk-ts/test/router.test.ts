/**
 * Router chaos + routing tests (WP-103/WP-104).
 *
 * Faking the transport, not the LLM (router.md Testing): the unit under test
 * is the retry/failover/normalization logic, exercised against local HTTP
 * servers speaking the real provider wire formats.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createRouter } from "../src/router.js";
import type { CompletionRequest, RoutingPolicy } from "../src/types.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: string, hit: number) => void;

interface FakeServer {
  url: string;
  hits: number;
  setHandler(handler: Handler): void;
  close(): Promise<void>;
}

const servers: FakeServer[] = [];

async function startFakeServer(): Promise<FakeServer> {
  let handler: Handler = (_req, res) => res.end();
  let hits = 0;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      hits++;
      fake.hits = hits;
      handler(req, res, body, hits);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeServer = {
    url: `http://127.0.0.1:${port}`,
    hits: 0,
    setHandler: (h) => (handler = h),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(fake);
  return fake;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** Minimal OpenAI-compat chat completion body. */
function chatCompletion(content: string): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

/** Minimal Anthropic messages body. */
function anthropicMessage(content: string): string {
  return JSON.stringify({
    content: [{ type: "text", text: content }],
    usage: { input_tokens: 12, output_tokens: 7 },
  });
}

function compatPolicy(model = "test-model"): RoutingPolicy {
  const choice = { provider: "openai-compat" as const, model };
  return { stages: { plan: choice, code: choice, review: choice, judge: choice } };
}

const ENV = {
  OPENAI_COMPAT_BASE_URL: "http://unused.invalid",
  ANTHROPIC_API_KEY: "test-key",
};

const FAST_RETRY = { baseDelayMs: 1, maxDelayMs: 5, jitter: false };

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return { stage: "code", messages: [{ role: "user", content: "hi" }], ...overrides };
}

describe("router normalization & retry (WP-103)", () => {
  it("returns SUCCESS with tokens and cost on a clean call", async () => {
    const fake = await startFakeServer();
    fake.setHandler((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(chatCompletion("hello"));
    });
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: FAST_RETRY,
    });
    const result = await router.complete(request());
    expect(result).toMatchObject({
      status: "SUCCESS",
      content: "hello",
      provider: "openai-compat",
      model: "test-model",
      tokens: { input: 10, output: 5 },
      costUsd: 0,
    });
  });

  it("retries 429 with backoff then succeeds", async () => {
    const fake = await startFakeServer();
    fake.setHandler((_req, res, _body, hit) => {
      if (hit < 3) {
        res.statusCode = 429;
        res.end("rate limited");
      } else {
        res.end(chatCompletion("recovered"));
      }
    });
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: FAST_RETRY,
    });
    const result = await router.complete(request());
    expect(result.status).toBe("SUCCESS");
    expect(fake.hits).toBe(3);
  });

  it("persistent 500s exhaust retries → FAILED with attempts", async () => {
    const fake = await startFakeServer();
    fake.setHandler((_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: { ...FAST_RETRY, maxAttempts: 3 },
    });
    const result = await router.complete(request());
    expect(result).toMatchObject({ status: "FAILED", retriable: true, attempts: 3 });
    expect(fake.hits).toBe(3);
  });

  it("timeout is retriable", async () => {
    const fake = await startFakeServer();
    fake.setHandler(() => {
      /* hang — never respond */
    });
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: { ...FAST_RETRY, maxAttempts: 2 },
      timeoutMs: 100,
    });
    const result = await router.complete(request());
    expect(result).toMatchObject({ status: "FAILED", retriable: true, attempts: 2 });
    expect(fake.hits).toBe(2);
  });

  it("4xx fails immediately — no retry, no failover (router.md)", async () => {
    const primary = await startFakeServer();
    primary.setHandler((_req, res) => {
      res.statusCode = 401;
      res.end("bad key");
    });
    const failover = await startFakeServer();
    failover.setHandler((_req, res) => res.end(anthropicMessage("should not be reached")));

    const policy = compatPolicy();
    policy.failover = { code: [{ provider: "anthropic", model: "claude-haiku-4-5" }] };
    const router = createRouter(policy, {
      env: ENV,
      baseUrls: { "openai-compat": primary.url, anthropic: failover.url },
      retry: FAST_RETRY,
    });
    const result = await router.complete(request());
    expect(result).toMatchObject({
      status: "FAILED",
      retriable: false,
      attempts: 1,
      provider: "openai-compat",
    });
    expect(result.status === "FAILED" && result.reason).toMatch(/401/);
    expect(primary.hits).toBe(1);
    expect(failover.hits).toBe(0);
  });

  it("retries exhausted → failover provider succeeds (RT-6)", async () => {
    const primary = await startFakeServer();
    primary.setHandler((_req, res) => {
      res.statusCode = 503;
      res.end("down");
    });
    const failover = await startFakeServer();
    failover.setHandler((_req, res) => res.end(anthropicMessage("rescued")));

    const policy = compatPolicy();
    policy.failover = { code: [{ provider: "anthropic", model: "claude-haiku-4-5" }] };
    const router = createRouter(policy, {
      env: ENV,
      baseUrls: { "openai-compat": primary.url, anthropic: failover.url },
      retry: { ...FAST_RETRY, maxAttempts: 2 },
    });
    const result = await router.complete(request());
    expect(result).toMatchObject({
      status: "SUCCESS",
      content: "rescued",
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
    // Anthropic pricing row exists → cost computed from real table.
    expect(result.status === "SUCCESS" && result.costUsd).toBeGreaterThan(0);
    expect(primary.hits).toBe(2);
    expect(failover.hits).toBe(1);
  });

  it("schema-parse failure → one re-ask with error appended → SUCCESS", async () => {
    const fake = await startFakeServer();
    fake.setHandler((_req, res, body, hit) => {
      if (hit === 1) {
        res.end(chatCompletion("not json at all"));
      } else {
        // Re-ask must carry the previous answer + the parse error.
        expect(body).toContain("not valid JSON");
        expect(body).toContain("not json at all");
        res.end(chatCompletion('{"answer": 42}'));
      }
    });
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: FAST_RETRY,
    });
    const result = await router.complete(
      request({ responseSchema: { type: "object", properties: { answer: { type: "integer" } } } }),
    );
    expect(result).toMatchObject({ status: "SUCCESS", content: '{"answer": 42}' });
    // Both calls' tokens are accounted.
    expect(result.status === "SUCCESS" && result.tokens).toEqual({ input: 20, output: 10 });
    expect(fake.hits).toBe(2);
  });

  it("schema-parse failure twice → FAILED, not retriable", async () => {
    const fake = await startFakeServer();
    fake.setHandler((_req, res) => res.end(chatCompletion("still not json")));
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: FAST_RETRY,
    });
    const result = await router.complete(request({ responseSchema: { type: "object" } }));
    expect(result).toMatchObject({ status: "FAILED", retriable: false, attempts: 2 });
    expect(result.status === "FAILED" && result.reason).toMatch(/not valid JSON after re-ask/);
  });

  it("strips markdown fences from structured output", async () => {
    const fake = await startFakeServer();
    fake.setHandler((_req, res) => res.end(chatCompletion('```json\n{"ok": true}\n```')));
    const router = createRouter(compatPolicy(), {
      env: ENV,
      baseUrls: { "openai-compat": fake.url },
      retry: FAST_RETRY,
    });
    const result = await router.complete(request({ responseSchema: { type: "object" } }));
    expect(result).toMatchObject({ status: "SUCCESS", content: '{"ok": true}' });
  });

  it("missing provider key fails at construction, naming the env var", () => {
    expect(() => createRouter(compatPolicy(), { env: {} })).toThrow(/OPENAI_COMPAT_BASE_URL/);
  });
});
