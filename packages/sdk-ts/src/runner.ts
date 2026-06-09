import type { AgentRunConfig, StepTrace, ToolResult } from "./types.js";
import { Router } from "./router.js";
import { Judge } from "./judge.js";

export interface AgentStep {
  execute(): Promise<ToolResult[]>;
}

export interface RunResult {
  status: "SUCCESS" | "FAILED" | "HALTED_BY_JUDGE" | "BUDGET_EXCEEDED";
  stepTraces: StepTrace[];
  totalCostUsd: number;
  checkpointPath?: string;
}

export class AgentRunner {
  private readonly router: Router;
  private readonly judge: Judge;
  private stepTraces: StepTrace[] = [];
  private totalCostUsd = 0;

  constructor(private readonly config: AgentRunConfig) {
    this.router = new Router(config.router);
    this.judge = new Judge(config.judge, config.router);
  }

  async run(steps: AgentStep[]): Promise<RunResult> {
    const judgeInterval = this.config.judge.evaluateEveryNSteps ?? 5;

    for (let i = 0; i < steps.length; i++) {
      if (this.config.budgetUsd != null && this.totalCostUsd >= this.config.budgetUsd) {
        return this._buildResult("BUDGET_EXCEEDED");
      }

      const toolResults = await steps[i].execute();
      this._recordStep(i, toolResults);

      // Check for terminal FAILED state — breaks infinite retry loops
      const failed = toolResults.some((r) => r.status === "FAILED");
      if (failed) {
        return this._buildResult("FAILED");
      }

      // Run judge at interval
      if ((i + 1) % judgeInterval === 0) {
        const eval_ = await this.judge.evaluate({
          executorProvider: this.config.router.defaultProvider,
          stepTraces: this.stepTraces,
        });

        if (eval_.verdict === "halt" || eval_.verdict === "rollback") {
          return this._buildResult("HALTED_BY_JUDGE");
        }
      }
    }

    return this._buildResult("SUCCESS");
  }

  private _recordStep(index: number, _toolResults: ToolResult[]): void {
    this.stepTraces.push({
      stepIndex: index,
      timestamp: new Date().toISOString(),
      type: "tool_call",
    });
  }

  private _buildResult(status: RunResult["status"]): RunResult {
    return {
      status,
      stepTraces: this.stepTraces,
      totalCostUsd: this.totalCostUsd,
    };
  }
}
