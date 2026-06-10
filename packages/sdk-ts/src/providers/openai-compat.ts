/**
 * OpenAI-compatible adapter (WP-102) — open models via Ollama/vLLM/etc.
 *
 * Same Chat Completions wire format as openai.ts, with the differences that
 * matter for compat servers: baseUrl is required config (OPENAI_COMPAT_BASE_URL),
 * the API key is optional (OPENAI_COMPAT_API_KEY), `max_tokens` instead of
 * `max_completion_tokens`, and structured output uses the prompt-embedded
 * schema fallback (native json_schema support varies across servers).
 */
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  postJson,
  ProviderCallError,
  requireEnv,
  schemaInstruction,
  type AdapterOptions,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider.js";

interface OpenAICompatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAICompatAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  const env = opts.env ?? process.env;
  const baseUrl = (opts.baseUrl ?? requireEnv(env, "OPENAI_COMPAT_BASE_URL", "openai-compat"))
    .replace(/\/$/, "");
  const apiKey = env.OPENAI_COMPAT_API_KEY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    provider: "openai-compat",
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
      if (req.responseSchema !== undefined) {
        messages.unshift({ role: "system", content: schemaInstruction(req.responseSchema) });
      }
      const body: Record<string, unknown> = {
        model: req.model,
        messages,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;

      const headers: Record<string, string> = {};
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;

      const raw = (await postJson(
        `${baseUrl}/v1/chat/completions`,
        headers,
        body,
        timeoutMs,
      )) as OpenAICompatResponse;

      const content = raw.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ProviderCallError("openai-compat response missing message content", false);
      }
      return {
        content,
        tokens: {
          input: raw.usage?.prompt_tokens ?? 0,
          output: raw.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
