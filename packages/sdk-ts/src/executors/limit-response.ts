import type { ClassifiedLimitSignal } from "../limit-signal.js";
import type { LimitResponseDecision } from "../limit-response.js";
import { createRouter, type RouterOptions } from "../router.js";
import type {
  ArtifactStore,
  ExecutorAdapter,
  ModelChoice,
  Router,
  RoutingPolicy,
  StepInput,
  StepRecord,
  TaskSpec,
  TokenUsage,
} from "../types.js";

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0 };

export type LimitResponseAdapterFactory = (ctx: {
  store: ArtifactStore;
  model?: string;
  modelFamily?: TaskSpec["executor"]["family"];
  createCodeRouter?: () => Router;
}) => ExecutorAdapter;

export interface ApplyLimitResponseInput {
  readonly store: ArtifactStore;
  readonly stepIndex: number;
  readonly planItem: string;
  readonly signal: ClassifiedLimitSignal;
  readonly selected: LimitResponseDecision;
  readonly adapterFactory?: LimitResponseAdapterFactory;
  readonly baseRouting?: RoutingPolicy;
  readonly modelFamily?: TaskSpec["executor"]["family"];
  readonly routerOptions?: RouterOptions;
  readonly stepInput?: StepInput;
  /**
   * F-248 (WP-580): the record the executor ALREADY produced on this step, when
   * the wall was read off its own stderr rather than predicted before it ran.
   * A post-hoc wall does not un-write the files the agent edited — see the
   * deferral branch below for why fabricating an empty record from scratch is a
   * lie the ledger then acts on.
   */
  readonly attemptedRecord?: StepRecord;
}

function describeSelection(selected: LimitResponseDecision): string {
  if (selected.action === "park-until-reset") return "park-until-reset";
  return `${selected.action}:${selected.target.stage}[${selected.target.index}]`;
}

function choiceAtTarget(routing: RoutingPolicy, selected: LimitResponseDecision): ModelChoice {
  if (selected.action === "park-until-reset") {
    throw new Error("park-until-reset has no routing target");
  }
  const target = selected.target;
  if (target.index === 0) return routing.stages[target.stage];
  const choice = routing.failover?.[target.stage]?.[target.index - 1];
  if (choice === undefined) {
    throw new Error(
      `limit response target ${target.stage}[${target.index}] is not present in routing policy`,
    );
  }
  return choice;
}

function routingFromFailoverTarget(
  routing: RoutingPolicy,
  selected: LimitResponseDecision,
): RoutingPolicy {
  const choice = choiceAtTarget(routing, selected);
  if (selected.action !== "declared-failover") return routing;
  const stage = selected.target.stage;
  return {
    stages: { ...routing.stages, [stage]: choice },
    ...(routing.failover === undefined
      ? {}
      : {
          failover: {
            ...routing.failover,
            [stage]: routing.failover[stage]?.slice(selected.target.index) ?? [],
          },
        }),
  };
}

async function applyDeclaredFailover(input: ApplyLimitResponseInput): Promise<StepRecord> {
  if (
    input.adapterFactory === undefined ||
    input.baseRouting === undefined ||
    input.modelFamily === undefined ||
    input.stepInput === undefined
  ) {
    throw new Error("declared failover requires adapterFactory, baseRouting, modelFamily, and stepInput");
  }

  const routing = routingFromFailoverTarget(input.baseRouting, input.selected);
  const targetChoice = choiceAtTarget(input.baseRouting, input.selected);
  const adapter = input.adapterFactory({
    store: input.store,
    model: targetChoice.model,
    modelFamily: input.modelFamily,
    createCodeRouter: () => createRouter(routing, input.routerOptions),
  });
  return adapter.runStep(input.stepInput);
}

function independentPlanItem(input: ApplyLimitResponseInput): string {
  if (input.selected.action !== "limit-independent-work") {
    throw new Error(`limit response action ${input.selected.action} is not limit-independent work`);
  }
  return `limit-independent ${input.selected.target.stage} work before retrying: ${input.planItem}`;
}

async function applyLimitIndependentWork(input: ApplyLimitResponseInput): Promise<StepRecord> {
  if (input.selected.action !== "limit-independent-work") {
    throw new Error(`limit response action ${input.selected.action} is not limit-independent work`);
  }
  const selected = input.selected;
  if (
    input.adapterFactory === undefined ||
    input.baseRouting === undefined ||
    input.modelFamily === undefined ||
    input.stepInput === undefined
  ) {
    throw new Error(
      "limit-independent work requires adapterFactory, baseRouting, modelFamily, and stepInput",
    );
  }

  const targetChoice = choiceAtTarget(input.baseRouting, input.selected);
  const routing: RoutingPolicy = {
    stages: {
      plan: targetChoice,
      code: targetChoice,
      review: targetChoice,
      judge: targetChoice,
    },
  };
  const executedPlanItem = independentPlanItem(input);
  const adapter = input.adapterFactory({
    store: input.store,
    model: targetChoice.model,
    modelFamily: input.modelFamily,
    createCodeRouter: () => createRouter(routing, input.routerOptions),
  });
  const record = await adapter.runStep({
    ...input.stepInput,
    instruction: executedPlanItem,
    context: {
      ...input.stepInput.context,
      goal: executedPlanItem,
      planItem: executedPlanItem,
      notes: {
        ...input.stepInput.context.notes,
        "limit.deferredPlanItem": input.planItem,
        "limit.targetStage": selected.target.stage,
      },
    },
  });
  const withoutCompletionClaim = { ...record };
  delete withoutCompletionClaim.claimsComplete;
  return {
    ...withoutCompletionClaim,
    summary:
      `${record.summary}; limit-independent ${selected.target.stage} work completed; ` +
      `deferred throttled plan item: ${input.planItem}`,
  };
}

export async function applyLimitResponse(input: ApplyLimitResponseInput): Promise<StepRecord> {
  if (input.selected.action === "declared-failover") {
    return applyDeclaredFailover(input);
  }
  if (input.selected.action === "limit-independent-work") {
    return applyLimitIndependentWork(input);
  }

  const selected = describeSelection(input.selected);
  const summary = `limit response deferred: ${input.selected.action} after ${input.signal.reason}`;

  // F-248 (WP-580): a wall read off the executor's OWN stderr arrives AFTER the
  // executor ran. On p3-rung-4's `brownfield-005` that executor had already
  // spent ~3 minutes and written a real 3-file fix (`5ac47158c`) — the
  // checkpoint 100 ms later committed it — while this branch journaled the step
  // as an empty diff with ZERO_TOKENS and the words "no executor work was
  // performed". Two things went wrong downstream: the trace denied work that
  // exists, and `appendStepConsumption` wrote zero tokens into the very ledger
  // `decideLimitPacing` reads to predict the NEXT wall.
  //
  // So: derive from the attempt when there was one (the same shape
  // `rotationHandoffRecord` uses for a wall-triggered agent swap), and only
  // claim "no work" when the deferral genuinely pre-empted the executor.
  const attempted = input.attemptedRecord;
  const reason =
    `limit response deferred throttled plan item "${input.planItem}" via ${selected}; ` +
    (attempted === undefined
      ? "no executor work was performed"
      : "the executor's work up to the wall is preserved in this step's diff");

  const transcriptRef = await input.store.put(
    [
      input.signal.reason,
      `scheduler selected ${selected}`,
      `deferred plan item: ${input.planItem}`,
      ...(attempted === undefined
        ? []
        : [`executor attempt before the wall: ${attempted.summary}`]),
    ].join("\n"),
    {
      kind: "transcript",
      summary: `limit response deferred step ${input.stepIndex}`,
    },
  );

  // `infraFailed`: a quota wall is never the agent's doing, so this step spends
  // no CG-1 strike (`advanceStrikeCount`, F-246) and no rule-3 verdict strike.
  const infraFailure = { infraFailed: true, failure: { reason, retriable: true } } as const;

  if (attempted !== undefined) {
    return {
      ...attempted,
      ...infraFailure,
      status: "FAILED",
      summary,
      transcriptRef,
    };
  }

  const diffRef = await input.store.put("", {
    kind: "diff",
    summary: `limit response deferred step ${input.stepIndex} produced no diff`,
  });

  return {
    ...infraFailure,
    status: "FAILED",
    diffRef,
    summary,
    toolCalls: 0,
    tokens: ZERO_TOKENS,
    costUsd: 0,
    costEstimated: false,
    durationMs: 0,
    transcriptRef,
  };
}
