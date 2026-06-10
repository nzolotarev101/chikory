/**
 * Anthropic Messages API adapter (WP-101) — raw HTTP per router.md.
 * Structured output uses the native `output_config.format` JSON-schema mode.
 */
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  postJson,
  ProviderCallError,
  requireEnv,
  splitSystem,
  type AdapterOptions,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider.js";

const API_VERSION = "2023-06-01";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createAnthropicAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  const env = opts.env ?? process.env;
  const apiKey = requireEnv(env, "ANTHROPIC_API_KEY", "anthropic");
  const baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    provider: "anthropic",
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      const { system, turns } = splitSystem(req.messages);
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: turns.map((m) => ({ role: m.role, content: m.content })),
      };
      if (system !== undefined) body.system = system;
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.responseSchema !== undefined) {
        body.output_config = {
          format: { type: "json_schema", schema: req.responseSchema },
        };
      }

      const raw = (await postJson(
        `${baseUrl}/v1/messages`,
        { "x-api-key": apiKey, "anthropic-version": API_VERSION },
        body,
        timeoutMs,
      )) as AnthropicResponse;

      const content = (raw.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      if (!raw.usage) {
        throw new ProviderCallError("anthropic response missing usage", false);
      }
      return {
        content,
        tokens: {
          input: raw.usage.input_tokens ?? 0,
          output: raw.usage.output_tokens ?? 0,
        },
      };
    },
  };
}
