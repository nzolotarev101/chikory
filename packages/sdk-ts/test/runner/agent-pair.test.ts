import { describe, expect, it } from "vitest";

import { isJudgeMember, type AgentClassRegistry } from "../../src/agents/classes.js";
import { AgentClassValidationError } from "../../src/agents/registry.js";
import {
  judgeFailoverChoices,
  runAgentClasses,
  selectRunAgentPair,
} from "../../src/runner/agent-pair.js";
import type { TaskSpec } from "../../src/types.js";

const TEST_REGISTRY: AgentClassRegistry = {
  version: 1,
  classes: {
    "exec-class-1": {
      id: "exec-class-1",
      role: "executor",
      primary: {
        id: "exec-primary",
        role: "executor",
        adapter: "gemini-cli",
        family: "gemini",
        backend: "gemini",
        model: "gemini-3.7-flash-high",
      },
      adjacent: [
        {
          id: "exec-peer",
          role: "executor",
          adapter: "codex",
          family: "openai",
          backend: "openai",
          model: "gpt-5.6-terra",
        },
      ],
    },
    "judge-class-1": {
      id: "judge-class-1",
      role: "judge",
      primary: {
        id: "judge-primary",
        role: "judge",
        transport: "openai-compat",
        backend: "openai",
        model: "gpt-5.6-sol xhigh",
      },
      adjacent: [
        {
          id: "judge-peer-1",
          role: "judge",
          transport: "openai-compat",
          backend: "anthropic",
          model: "claude-opus-5",
        },
        {
          id: "judge-peer-2",
          role: "judge",
          transport: "openai-compat",
          backend: "gemini",
          model: "gemini-2.5-pro",
        },
        {
          id: "judge-native",
          role: "judge",
          transport: "anthropic",
          backend: "anthropic",
          model: "claude-sonnet-4",
        },
      ],
    },
  },
};

const BASE_SPEC: TaskSpec = {
  name: "test-task",
  goal: "test agent pair resolution",
  repos: [{ url: "/tmp/repo", writable: true }],
  acceptanceCriteria: [{ id: "AC-1", description: "passes" }],
  budgetUsd: 10,
  maxSteps: 3,
  executor: { adapter: "gemini-cli", family: "gemini" },
  judge: { family: "openai-compat", model: "gpt-5.6-sol xhigh", cadence: 1 },
  routing: {
    stages: {
      plan: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
      code: { provider: "gemini", model: "gemini-3.7-flash-high" },
      review: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
      judge: { provider: "openai-compat", model: "gpt-5.6-sol xhigh" },
    },
  },
};

describe("runAgentClasses", () => {
  it("resolves declared executor and judge classes when both are specified", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        executor: "exec-class-1",
        judge: "judge-class-1",
      },
    };

    const res = runAgentClasses(spec, TEST_REGISTRY);

    expect(res.declared).toBe(true);
    expect(res.executorClass.id).toBe("exec-class-1");
    expect(res.judgeClass.id).toBe("judge-class-1");
  });

  it("handles partial class declaration (executor only) with singleton fallback for judge", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        executor: "exec-class-1",
      },
    };

    const res = runAgentClasses(spec, TEST_REGISTRY);

    expect(res.declared).toBe(true);
    expect(res.executorClass.id).toBe("exec-class-1");
    expect(res.judgeClass.id).toBe("inline-judge:openai-compat");

    const primary = res.judgeClass.primary;
    expect(isJudgeMember(primary)).toBe(true);
    if (isJudgeMember(primary)) {
      expect(primary.transport).toBe("openai-compat");
      expect(primary.backend).toBe("openai");
      expect(primary.model).toBe("gpt-5.6-sol xhigh");
    }
  });

  it("handles partial class declaration (judge only) with singleton fallback for executor", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        judge: "judge-class-1",
      },
    };

    const res = runAgentClasses(spec, TEST_REGISTRY);

    expect(res.declared).toBe(true);
    expect(res.executorClass.id).toBe("inline-executor:gemini-cli");
    expect(res.judgeClass.id).toBe("judge-class-1");
  });

  it("resolves singletons and sets declared=false for legacy specs with no agentClasses", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: undefined,
    };

    const res = runAgentClasses(spec, TEST_REGISTRY);

    expect(res.declared).toBe(false);
    expect(res.executorClass.id).toBe("inline-executor:gemini-cli");
    expect(res.judgeClass.id).toBe("inline-judge:openai-compat");
  });

  it("falls back to spec.routing.stages.judge.model when spec.judge.model is undefined", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: undefined,
      judge: { family: "openai-compat", cadence: 1 },
      routing: {
        stages: {
          plan: { provider: "openai-compat", model: "claude-3-5-sonnet" },
          code: { provider: "gemini", model: "gemini-2.5-flash" },
          review: { provider: "openai-compat", model: "claude-3-5-sonnet" },
          judge: { provider: "openai-compat", model: "claude-3-5-sonnet" },
        },
      },
    };

    const res = runAgentClasses(spec, TEST_REGISTRY);

    expect(res.declared).toBe(false);
    expect(res.judgeClass.primary.model).toBe("claude-3-5-sonnet");
    expect(res.judgeClass.primary.backend).toBe("anthropic");
  });

  it("uses loadAgentClassRegistry() when registry parameter is omitted", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        executor: "executor-default",
        judge: "judge-default",
      },
    };

    const res = runAgentClasses(spec);

    expect(res.declared).toBe(true);
    expect(res.executorClass.id).toBe("executor-default");
    expect(res.judgeClass.id).toBe("judge-default");
  });

  it("throws when naming an unknown agent class", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        executor: "non-existent-class",
      },
    };

    expect(() => runAgentClasses(spec, TEST_REGISTRY)).toThrow(AgentClassValidationError);
    expect(() => runAgentClasses(spec, TEST_REGISTRY)).toThrow(
      /no agent class named 'non-existent-class'/,
    );
  });
});

describe("judgeFailoverChoices", () => {
  it("filters judge members by transport, model, and executor backend", () => {
    const judgeClass = TEST_REGISTRY.classes["judge-class-1"]!;

    // currentModel = "gpt-5.6-sol xhigh" (primary model)
    // transport = "openai-compat"
    // executorBackend = "openai"
    const choices = judgeFailoverChoices(
      judgeClass,
      "gpt-5.6-sol xhigh",
      "openai-compat",
      "openai",
    );

    // Should include judge-peer-1 (anthropic) and judge-peer-2 (gemini)
    // Should EXCLUDE:
    // - primary (model matches currentModel)
    // - judge-native (transport is anthropic, not openai-compat)
    expect(choices).toEqual([
      { provider: "openai-compat", model: "claude-opus-5" },
      { provider: "openai-compat", model: "gemini-2.5-pro" },
    ]);
  });

  it("excludes members that share the executor backend", () => {
    const judgeClass = TEST_REGISTRY.classes["judge-class-1"]!;

    // executorBackend = "anthropic" -> judge-peer-1 (anthropic) should be excluded
    const choices = judgeFailoverChoices(
      judgeClass,
      "gpt-5.6-sol xhigh",
      "openai-compat",
      "anthropic",
    );

    expect(choices).toEqual([
      { provider: "openai-compat", model: "gemini-2.5-pro" },
    ]);
  });
});

describe("selectRunAgentPair", () => {
  it("selects agent pair with default allowSameFamily when omitted in spec", () => {
    const spec: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        executor: "exec-class-1",
        judge: "judge-class-1",
      },
    };

    const res = selectRunAgentPair({
      spec,
      cooldowns: [],
      nowMs: 1000,
      registry: TEST_REGISTRY,
    });

    expect(res.declared).toBe(true);
    expect(res.executorClass.id).toBe("exec-class-1");
    expect(res.judgeClass.id).toBe("judge-class-1");

    expect(res.selection.action).toBe("selected");
    if (res.selection.action === "selected") {
      expect(res.selection.pair.executor.id).toBe("exec-primary");
      expect(res.selection.pair.judge.id).toBe("judge-primary");
    }
  });

  it("passes allowSameFamily option when set on spec.judge", () => {
    const specWithSameFamily: TaskSpec = {
      ...BASE_SPEC,
      agentClasses: {
        executor: "exec-class-1",
        judge: "judge-class-1",
      },
      judge: {
        ...BASE_SPEC.judge,
        allowSameFamily: true,
      },
    };

    const res = selectRunAgentPair({
      spec: specWithSameFamily,
      cooldowns: [],
      nowMs: 1000,
      registry: TEST_REGISTRY,
    });

    expect(res.selection.action).toBe("selected");
    if (res.selection.action === "selected") {
      expect(res.selection.pair.executor.id).toBe("exec-primary");
      expect(res.selection.pair.judge.id).toBe("judge-primary");
    }
  });
});
