import { describe, expect, it } from "vitest";

import { createNativeAdapter } from "../../src/executors/native.js";
import { StepRecordSchema } from "../../src/schemas.js";
import type { Router } from "../../src/types.js";
import { makeStepInput, makeWorkspace } from "./conformance.js";

describe("Benchmark native adapter tool call execution", () => {
  it("measures execution time for a batch of tool calls", async () => {
    const ws = await makeWorkspace();
    const toolCallCount = 20;

    const calls: Array<{
      id: string;
      name: "write_file";
      arguments: Record<string, unknown>;
    }> = [];
    for (let i = 0; i < toolCallCount; i++) {
      const fileName = `file-${i}.txt`;
      calls.push({
        id: `call-${i}`,
        name: "write_file",
        arguments: { path: fileName, content: `data ${i}\n` },
      });
    }

    const router: Router = {
      async complete(req) {
        if (req.messages.some((m) => m.role === "assistant")) {
          return {
            status: "SUCCESS",
            content: JSON.stringify({ summary: "done", final: true }),
            provider: "openai-compat",
            model: "scripted-native",
            tokens: { input: 10, output: 10 },
            costUsd: 0.001,
          };
        }
        return {
          status: "SUCCESS",
          content: JSON.stringify({
            summary: "executing tool batch",
            tool_calls: calls,
          }),
          provider: "openai-compat",
          model: "scripted-native",
          tokens: { input: 10, output: 10 },
          costUsd: 0.001,
        };
      },
    };

    const adapter = createNativeAdapter({
      store: ws.store,
      router,
      modelFamily: "openai-compat",
    });

    const start = performance.now();
    const record = await adapter.runStep(makeStepInput(ws, "batch tools", 30));
    const duration = performance.now() - start;

    StepRecordSchema.parse(record);
    expect(record.status).toBe("SUCCESS");
    expect(record.toolCalls).toBe(toolCallCount);

    console.log("-----------------------------------------");
    console.log(`Native adapter batch execution of ${toolCallCount} tool calls took: ${duration.toFixed(2)} ms`);
    console.log("-----------------------------------------");
  });
});
