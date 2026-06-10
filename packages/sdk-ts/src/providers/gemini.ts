/**
 * Gemini generateContent adapter (WP-101) — raw HTTP per router.md.
 * Structured output: JSON response mime type + prompt-embedded schema
 * (router.md fallback path; Gemini's native schema dialect is an OpenAPI
 * subset that rejects many valid JSON Schemas, so the embedded form is the
 * portable choice).
 */
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  postJson,
  ProviderCallError,
  requireEnv,
  schemaInstruction,
  splitSystem,
  type AdapterOptions,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider.js";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function createGeminiAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  const env = opts.env ?? process.env;
  const apiKey = requireEnv(env, "GEMINI_API_KEY", "gemini");
  const baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    provider: "gemini",
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      const { system, turns } = splitSystem(req.messages);
      const systemParts: string[] = [];
      if (system !== undefined) systemParts.push(system);
      if (req.responseSchema !== undefined) {
        systemParts.push(schemaInstruction(req.responseSchema));
      }

      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      };
      if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
      if (req.responseSchema !== undefined) {
        generationConfig.responseMimeType = "application/json";
      }

      const body: Record<string, unknown> = {
        contents: turns.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig,
      };
      if (systemParts.length > 0) {
        body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
      }

      const raw = (await postJson(
        `${baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
        { "x-goog-api-key": apiKey },
        body,
        timeoutMs,
      )) as GeminiResponse;

      const parts = raw.candidates?.[0]?.content?.parts;
      if (!parts) {
        throw new ProviderCallError("gemini response missing candidates content", false);
      }
      if (!raw.usageMetadata) {
        throw new ProviderCallError("gemini response missing usageMetadata", false);
      }
      return {
        content: parts.map((p) => p.text ?? "").join(""),
        tokens: {
          input: raw.usageMetadata.promptTokenCount ?? 0,
          output: raw.usageMetadata.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}
