import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createNativeAdapter } from "../../src/executors/native.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../../src/providers/provider.js";
import { StepRecordSchema } from "../../src/schemas.js";
import type { LLMCallResult, Router } from "../../src/types.js";
import { makeStepInput, makeWorkspace } from "./conformance.js";

type ScriptTurn = (req: ProviderRequest) => ProviderResponse;

class ScriptedProvider implements ProviderAdapter {
  readonly provider = "openai-compat";
  readonly requests: ProviderRequest[] = [];
  sawFailedToolObservation = false;
  private index = 0;

  constructor(private readonly script: ScriptTurn[]) {}

  complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(req);
    this.sawFailedToolObservation ||= req.messages.some(
      (message) =>
        message.role === "user" &&
        message.content.includes('"type":"tool_observation"') &&
        message.content.includes('"status":"FAILED"'),
    );
    const turn = this.script[this.index];
    this.index += 1;
    if (!turn) throw new Error(`script exhausted at request ${this.index}`);
    return Promise.resolve(turn(req));
  }
}

function nativeJson(value: unknown, input = 10, output = 5): ProviderResponse {
  return { content: JSON.stringify(value), tokens: { input, output } };
}

function routerFromProvider(provider: ProviderAdapter): Router {
  return {
    async complete(req): Promise<LLMCallResult> {
      const response = await provider.complete({
        model: "scripted-native",
        messages: req.messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        responseSchema: req.responseSchema,
      });
      return {
        status: "SUCCESS",
        content: response.content,
        provider: provider.provider,
        model: "scripted-native",
        tokens: response.tokens,
        costUsd: 0.001,
      };
    },
  };
}

describe("createNativeAdapter", () => {
  it("drives a tool loop through a ProviderAdapter-backed router and captures a real diff", async () => {
    const provider = new ScriptedProvider([
      () =>
        nativeJson({
          summary: "checking workspace",
          tool_calls: [
            { id: "missing-read", name: "read_file", arguments: { path: "does-not-exist.txt" } },
          ],
        }),
      () =>
        nativeJson({
          summary: "writing result after observing the tool error",
          tool_calls: [
            {
              id: "write-result",
              name: "write_file",
              arguments: { path: "native-output.txt", content: "native loop wrote this\n" },
            },
          ],
        }),
      () => nativeJson({ summary: "native executor finished", final: true }),
    ]);
    const ws = await makeWorkspace();
    const adapter = createNativeAdapter({
      store: ws.store,
      router: routerFromProvider(provider),
      modelFamily: "openai-compat",
    });

    const record = await adapter.runStep(
      makeStepInput(ws, "Create native-output.txt containing the requested content.", 30),
    );

    StepRecordSchema.parse(record);
    expect(record.status).toBe("SUCCESS");
    expect(record.summary).toBe("native executor finished");
    expect(record.toolCalls).toBe(2);
    expect(record.tokens).toEqual({ input: 30, output: 15 });
    expect(record.costUsd).toBeCloseTo(0.003, 10);
    expect(record.diffRef.bytes).toBeGreaterThan(0);
    expect(record.transcriptRef.bytes).toBeGreaterThan(0);
    expect(provider.requests).toHaveLength(3);
    expect(provider.sawFailedToolObservation).toBe(true);

    const output = await readFile(join(ws.workspaceDir, "native-output.txt"), "utf8");
    expect(output).toBe("native loop wrote this\n");
    const diff = new TextDecoder().decode(await ws.store.get(record.diffRef));
    expect(diff).toContain("native-output.txt");
    expect(diff.trim().length).toBeGreaterThan(0);
    const transcript = new TextDecoder().decode(await ws.store.get(record.transcriptRef));
    expect(transcript).toContain('"status": "FAILED"');
    expect(transcript).toContain("does-not-exist.txt");
  });
});
