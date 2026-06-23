/**
 * WP-247 / F-48 deterministic pre-flight report for whether the bad-diff
 * judge-catch seam is armed before launch completion.
 */
export interface SeamArmingReport {
  armed: boolean;
  path?: string;
  atStep: number;
  nodeIndex?: number;
  warnings: string[];
  lines: string[];
}

/**
 * Describes the pure bad-diff seam arming state from an already-collected
 * environment record.
 */
export function describeSeamArming(env: Record<string, string | undefined>): SeamArmingReport {
  const path = env["CHIKORY_SEED_BAD_DIFF_PATH"];

  if (path === undefined || path === "") {
    return {
      armed: false,
      atStep: 0,
      warnings: [],
      lines: ["no seam armed"],
    };
  }

  const atStep = Number(env["CHIKORY_SEED_BAD_DIFF_AT_STEP"] ?? 0);
  const nodeIndexValue = env["CHIKORY_SEED_BAD_DIFF_NODE_INDEX"];
  const nodeIndex = nodeIndexValue === undefined ? undefined : Number(nodeIndexValue);
  const content = env["CHIKORY_SEED_BAD_DIFF_CONTENT"];
  const warnings =
    content === undefined || content === ""
      ? ["CHIKORY_SEED_BAD_DIFF_CONTENT is empty; seam will seed an empty file"]
      : [];
  const nodeIndexSuffix = nodeIndex === undefined ? "" : ` at node index ${nodeIndex}`;

  return {
    armed: true,
    path,
    atStep,
    ...(nodeIndex === undefined ? {} : { nodeIndex }),
    warnings,
    lines: [`🧪 seam armed for ${path}${nodeIndexSuffix}`],
  };
}
