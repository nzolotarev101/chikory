import type { EndpointCapability, ResolvedEndpointCapabilities } from "./endpoint-capability.js";
import type { ClassifiedLimitSignal, LimitCapabilityDescriptor } from "./limit-signal.js";
import type { Stage } from "./types.js";

export type LimitResponseAction =
  | "declared-failover"
  | "limit-independent-work"
  | "park-until-reset";

export type HeadroomBlockReason =
  | "throttled-capability"
  | "unknown-headroom"
  | "invariant-2-same-family";

export interface LegalHeadroomTarget {
  readonly stage: Stage;
  readonly index: number;
  readonly capability: LimitCapabilityDescriptor;
}

export interface BlockedHeadroomTarget {
  readonly stage: Stage;
  readonly index: number;
  readonly capability: LimitCapabilityDescriptor;
  readonly reason: HeadroomBlockReason;
}

export type LimitResponseDecision =
  | {
      readonly action: "declared-failover";
      readonly target: LegalHeadroomTarget;
    }
  | {
      readonly action: "limit-independent-work";
      readonly target: LegalHeadroomTarget;
    }
  | {
      readonly action: "park-until-reset";
      readonly reason: "no-legal-headroom";
      readonly retryAfterMs?: number;
      readonly retryAtMs?: number;
    };

export interface LimitResponsePlan {
  readonly stage: Stage;
  readonly throttled: LimitCapabilityDescriptor;
  readonly steps: readonly LimitResponseDecision[];
  readonly blocked: readonly BlockedHeadroomTarget[];
}

export interface DecideLimitResponseInput {
  readonly stage: Stage;
  readonly signal: ClassifiedLimitSignal;
  readonly capabilities: ResolvedEndpointCapabilities;
}

function capabilityTarget(capability: EndpointCapability): string {
  switch (capability.kind) {
    case "provider":
      return capability.provider;
    case "executor":
      return capability.adapter;
    case "unknown":
      return capability.target;
  }
}

function describeCapability(capability: EndpointCapability): LimitCapabilityDescriptor {
  return {
    endpointKind: capability.kind,
    target: capabilityTarget(capability),
    family: capability.family,
    limits: capability.limits,
  };
}

function sameCapability(left: LimitCapabilityDescriptor, right: LimitCapabilityDescriptor): boolean {
  return (
    left.endpointKind === right.endpointKind &&
    left.target === right.target &&
    left.family === right.family
  );
}

function peerFamily(
  stage: Stage,
  capabilities: ResolvedEndpointCapabilities,
): EndpointCapability["family"] | undefined {
  if (stage === "code") return capabilities.judge[0]?.family;
  if (stage === "judge") return capabilities.code[0]?.family;
  return undefined;
}

function stagesAfter(stage: Stage): readonly Stage[] {
  switch (stage) {
    case "plan":
      return ["code", "review", "judge"];
    case "code":
      return ["review", "judge"];
    case "review":
      return ["judge"];
    case "judge":
      return [];
  }
}

function blockReason(
  candidate: LimitCapabilityDescriptor,
  throttled: LimitCapabilityDescriptor,
  oppositeFamily: EndpointCapability["family"] | undefined,
): HeadroomBlockReason | undefined {
  if (sameCapability(candidate, throttled)) return "throttled-capability";
  if (candidate.endpointKind === "unknown" || candidate.family === "unknown") return "unknown-headroom";
  if (oppositeFamily !== undefined && candidate.family === oppositeFamily) return "invariant-2-same-family";
  return undefined;
}

function timingStep(signal: ClassifiedLimitSignal): LimitResponseDecision {
  return {
    action: "park-until-reset",
    reason: "no-legal-headroom",
    ...(signal.retryAfterMs === undefined ? {} : { retryAfterMs: signal.retryAfterMs }),
    ...(signal.retryAtMs === undefined ? {} : { retryAtMs: signal.retryAtMs }),
  };
}

export function decideLimitResponse(input: DecideLimitResponseInput): LimitResponsePlan {
  const throttled = input.signal.capability;
  const failoverTargets: LegalHeadroomTarget[] = [];
  const independentTargets: LegalHeadroomTarget[] = [];
  const blocked: BlockedHeadroomTarget[] = [];

  input.capabilities[input.stage].forEach((capability, index) => {
    const candidate = describeCapability(capability);
    const reason = blockReason(candidate, throttled, peerFamily(input.stage, input.capabilities));
    if (reason === undefined) {
      failoverTargets.push({ stage: input.stage, index, capability: candidate });
    } else {
      blocked.push({ stage: input.stage, index, capability: candidate, reason });
    }
  });

  for (const stage of stagesAfter(input.stage)) {
    input.capabilities[stage].forEach((capability, index) => {
      const candidate = describeCapability(capability);
      const reason = blockReason(candidate, throttled, peerFamily(stage, input.capabilities));
      if (reason === undefined) {
        independentTargets.push({ stage, index, capability: candidate });
      } else {
        blocked.push({ stage, index, capability: candidate, reason });
      }
    });
  }

  return {
    stage: input.stage,
    throttled,
    blocked,
    steps: [
      ...failoverTargets.map((target) => ({ action: "declared-failover" as const, target })),
      ...independentTargets.map((target) => ({ action: "limit-independent-work" as const, target })),
      timingStep(input.signal),
    ],
  };
}
