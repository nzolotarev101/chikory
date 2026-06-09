import type { JudgeConfig, StepTrace, LLMProvider } from "./types.js";
import { Router } from "./router.js";

export interface JudgeEvalInput {
  executorProvider: LLMProvider;
  stepTraces: StepTrace[];
  artifacts?: Record<string, unknown>;
  rubric?: string;
}

export interface JudgeEvalResult {
  verdict: "continue" | "halt" | "rollback" | "escalate";
  score: number;
  reasoning: string;
  stepIndex: number;
}

export class Judge {
  private readonly router: Router;

  constructor(
    private readonly config: JudgeConfig,
    routerConfig: ConstructorParameters<typeof Router>[0],
  ) {
    if (config.provider === routerConfig.defaultProvider) {
      // Warn but allow — user may be running single-provider mode explicitly
      console.warn(
        "[chikory/judge] Judge and executor use the same provider. " +
          "Bias mitigation is reduced. Set judge.provider to a different family for best results.",
      );
    }
    this.router = new Router(routerConfig);
  }

  async evaluate(input: JudgeEvalInput): Promise<JudgeEvalResult> {
    // TODO: implement judge evaluation logic
    // - Build rubric prompt from input.rubric or default software-native rubric
    // - Call router with judge provider/model (structurally different from executor)
    // - Parse pointwise score (binary/low-precision to resist reward hacking)
    // - Return verdict
    throw new Error("Judge evaluation not yet implemented");
  }
}
