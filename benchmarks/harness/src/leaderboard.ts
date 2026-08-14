import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { publishableRepoPath, type ArmComparisonDetail } from "./results.js";

export interface LeaderboardEntry extends Omit<ArmComparisonDetail, "reference"> {
  /** Repo-relative pointer to the publication bundle this arm was read from. */
  bundle: string;
}

export interface PairwiseRecord {
  armA: string;
  armB: string;
  separated: boolean;
  winner: string | null;
  reason: string;
}

export interface LeaderboardData {
  orderedBy: string;
  entries: LeaderboardEntry[];
  pairwise: PairwiseRecord[];
}

export function buildLeaderboard(bundleDirs: string[]): LeaderboardData {
  const entries: LeaderboardEntry[] = [];

  for (const bundleDir of bundleDirs) {
    const compPath = join(resolve(bundleDir), "comparison.json");
    if (!existsSync(compPath)) {
      throw new Error(`Bundle comparison file not found: ${compPath}`);
    }
    const raw = readFileSync(compPath, "utf8");
    const comp = JSON.parse(raw) as {
      arms?: ArmComparisonDetail[];
      armA?: ArmComparisonDetail;
      armB?: ArmComparisonDetail;
    };

    let arms: ArmComparisonDetail[] = [];
    if (Array.isArray(comp.arms)) {
      arms = comp.arms;
    } else if (comp.armA && comp.armB) {
      arms = [comp.armA, comp.armB];
    } else {
      throw new Error(`No arms found in bundle comparison: ${compPath}`);
    }

    // F-267: the bundle pointer is anchored to the repo root, like
    // `rawResultsDir` (WP-588). Storing `bundleDir` verbatim published a
    // path that only resolved from the CWD that happened to run the command.
    const bundle = publishableRepoPath(resolve(bundleDir), "leaderboard bundle directory");

    for (const arm of arms) {
      // `reference` is dropped, not copied: the source bundle writes it
      // relative to the CWD that ran `compare`, so carrying it into an
      // artifact in a different directory publishes a pointer that resolves
      // nowhere. `bundle` + `rawResultsDir` are both repo-anchored.
      const { reference: _reference, ...published } = arm;
      entries.push({ ...published, bundle });
    }
  }

  // Sort best-first by lower bound of 95% interval (iSrRange.low)
  entries.sort((a, b) => b.iSrRange.low - a.iSrRange.low);

  const pairwise: PairwiseRecord[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const armA = entries[i]!;
      const armB = entries[j]!;

      // Arms are separated ONLY when their 95% iSrRange intervals are DISJOINT
      const separated = armA.iSrRange.high < armB.iSrRange.low || armB.iSrRange.high < armA.iSrRange.low;

      let winner: string | null = null;
      let reason: string;

      if (separated) {
        // Higher arm is armA because entries are ordered by iSrRange.low descending
        winner = armA.label;
        reason = `Arm '${armA.label}' [${(armA.iSrRange.low * 100).toFixed(1)}%, ${(armA.iSrRange.high * 100).toFixed(1)}%] and arm '${armB.label}' [${(armB.iSrRange.low * 100).toFixed(1)}%, ${(armB.iSrRange.high * 100).toFixed(1)}%] are disjoint at 95% confidence; '${armA.label}' ranks higher.`;
      } else {
        winner = null;
        reason = `Arm '${armA.label}' [${(armA.iSrRange.low * 100).toFixed(1)}%, ${(armA.iSrRange.high * 100).toFixed(1)}%] and arm '${armB.label}' [${(armB.iSrRange.low * 100).toFixed(1)}%, ${(armB.iSrRange.high * 100).toFixed(1)}%] overlap at 95% confidence; the arms are not separated.`;
      }

      pairwise.push({
        armA: armA.label,
        armB: armB.label,
        separated,
        winner,
        reason,
      });
    }
  }

  return {
    orderedBy: "iSrRange.low",
    entries,
    pairwise,
  };
}

export function generateLeaderboardMarkdown(data: LeaderboardData): string {
  const lines: string[] = [];
  lines.push("# Benchmark Leaderboard");
  lines.push("");
  lines.push(`Ordered by 95% Wilson confidence interval lower bound (\`${data.orderedBy}\`).`);
  lines.push("");
  lines.push("## Rankings");
  lines.push("");
  lines.push("| Rank | Arm | 95% I-SR Interval | Point I-SR | 95% D-SR Interval | Adapter | Bundle |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");

  data.entries.forEach((entry, idx) => {
    const rank = idx + 1;
    const iSrRangeStr = `[${(entry.iSrRange.low * 100).toFixed(1)}%, ${(entry.iSrRange.high * 100).toFixed(1)}%]`;
    const iSrPtStr = `${(entry.iSr * 100).toFixed(1)}%`;
    const dSrRangeStr = entry.dSrRange
      ? `[${(entry.dSrRange.low * 100).toFixed(1)}%, ${(entry.dSrRange.high * 100).toFixed(1)}%]`
      : "N/A";
    lines.push(
      `| ${rank} | ${entry.label} | ${iSrRangeStr} | ${iSrPtStr} | ${dSrRangeStr} | ${entry.adapter} | ${entry.bundle} |`,
    );
  });

  lines.push("");
  lines.push("## Pairwise Statistical Significance (95% Confidence)");
  lines.push("");

  if (data.pairwise.length === 0) {
    lines.push("No pairwise comparisons available.");
  } else {
    for (const pair of data.pairwise) {
      if (pair.separated && pair.winner) {
        lines.push(`- **${pair.armA}** vs **${pair.armB}**: Separated at 95% confidence; **${pair.winner}** ranks higher.`);
      } else {
        lines.push(`- **${pair.armA}** vs **${pair.armB}**: Overlap at 95% confidence; the arms are not separated (no winner).`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function writeLeaderboard(
  bundleDirs: string[],
  outDir: string,
): { jsonPath: string; mdPath: string; data: LeaderboardData } {
  const data = buildLeaderboard(bundleDirs);
  const resolvedOutDir = resolve(outDir);
  mkdirSync(resolvedOutDir, { recursive: true });

  const jsonPath = join(resolvedOutDir, "leaderboard.json");
  const mdPath = join(resolvedOutDir, "leaderboard.md");

  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  writeFileSync(mdPath, generateLeaderboardMarkdown(data));

  return { jsonPath, mdPath, data };
}
