/**
 * OpenAI Chat Completions adapter (WP-101) — raw HTTP per router.md.
 * Structured output uses the native `response_format` json_schema mode.
 */
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  postJson,
  ProviderCallError,
  requireEnv,
  type AdapterOptions,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider.js";

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAIAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  const env = opts.env ?? process.env;
  const apiKey = requireEnv(env, "OPENAI_API_KEY", "openai");
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    provider: "openai",
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        max_completion_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.responseSchema !== undefined) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "response", schema: req.responseSchema, strict: true },
        };
      }

      const raw = (await postJson(
        `${baseUrl}/v1/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        body,
        timeoutMs,
      )) as OpenAIResponse;

      const content = raw.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ProviderCallError("openai response missing message content", false);
      }
      if (!raw.usage) {
        throw new ProviderCallError("openai response missing usage", false);
      }
      return {
        content,
        tokens: {
          input: raw.usage.prompt_tokens ?? 0,
          output: raw.usage.completion_tokens ?? 0,
        },
      };
    },
  };
}
