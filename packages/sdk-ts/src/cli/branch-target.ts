export interface BranchTarget {
  runId: string;
  step: number | "base";
  checkpointId: string;
}

const EXPECTED_BRANCH_TARGET = "<run-id>@<step|base>";

function branchTargetError(input: string, detail: string): Error {
  return new Error(
    `Invalid branch target '${input}': ${detail}. Expected ${EXPECTED_BRANCH_TARGET}.`,
  );
}

export function parseBranchTarget(input: string): BranchTarget {
  const parts = input.split("@");

  if (parts.length !== 2) {
    throw branchTargetError(input, "use exactly one @ separator");
  }

  const [runId, rawStep] = parts;

  if (runId === "") {
    throw branchTargetError(input, "run id must not be empty");
  }

  if (rawStep === "") {
    throw branchTargetError(input, "step must not be empty");
  }

  if (rawStep === "base") {
    return {
      runId,
      step: "base",
      checkpointId: `${runId}@base`,
    };
  }

  if (!/^[0-9]+$/.test(rawStep)) {
    throw branchTargetError(input, "step must be a positive integer or base");
  }

  const step = Number(rawStep);
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw branchTargetError(input, "step must be a positive integer or base");
  }

  return {
    runId,
    step,
    checkpointId: `${runId}@${step}`,
  };
}

export function branchNameForTarget(target: BranchTarget): string {
  const sanitizedRunId = target.runId
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (sanitizedRunId === "") {
    throw branchTargetError(
      target.checkpointId,
      "run id must contain branch-safe characters",
    );
  }

  const stepSegment = target.step === "base" ? "base" : `step-${target.step}`;
  return `branch-${sanitizedRunId}-${stepSegment}`;
}
