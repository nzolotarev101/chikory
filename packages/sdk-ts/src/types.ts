export type LLMProvider = "anthropic" | "openai" | "gemini";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMCallResult {
  content: string;
  provider: LLMProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

export interface ToolResult {
  toolName: string;
  output: unknown;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string;
}

export interface RouterConfig {
  providers: Partial<Record<LLMProvider, ProviderConfig>>;
  defaultProvider: LLMProvider;
  retries?: number;
}

export interface ProviderConfig {
  apiKey: string;
  defaultModel: string;
  baseUrl?: string;
}

export interface JudgeConfig {
  provider: LLMProvider;
  model: string;
  evaluateEveryNSteps?: number;
  scoringMethod?: "pointwise" | "pairwise";
}

export interface AgentRunConfig {
  router: RouterConfig;
  judge: JudgeConfig;
  maxSteps?: number;
  budgetUsd?: number;
  checkpointDir?: string;
}

export interface StepTrace {
  stepIndex: number;
  timestamp: string;
  type: "llm_call" | "tool_call" | "judge_eval" | "checkpoint";
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  judgeScore?: number;
  judgeVerdict?: "continue" | "halt" | "rollback" | "escalate";
}
