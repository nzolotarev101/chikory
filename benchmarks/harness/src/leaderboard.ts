import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

/**
 * F-337 (dogfood-139): every string this module interpolates into the page comes
 * from a published bundle — arm labels, adapters, bundle paths, pairwise names,
 * `orderedBy`. Interpolating them raw let bundle DATA rewrite the page's markup,
 * which defeats two of the traps this artifact exists to satisfy: a crafted
 * pairwise name injects a winner claim onto an arm pair the data says is NOT
 * separated, and a crafted label injects `<script src="https://…">` into a page
 * whose whole promise is that it renders with no network. A leaderboard is the
 * one artifact that will eventually accept an arm it did not author.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * F-338 (dogfood-139 review): `entry.bundle` is anchored to the REPO ROOT (the
 * F-267/WP-591 rule), but the existence probe below resolved it against
 * `process.cwd()`. So the published page's evidence links depended on the
 * directory the CLI happened to run from: generated from the repo root they
 * resolve and become `<a href>`; generated from `benchmarks/harness` — which is
 * exactly what AC-2 does — every one of them degrades to a bare `<span>` and the
 * evidence silently disappears. Trap G (no dead links) passes either way, because
 * a `<span>` emits no href to be dead. Anchor on the repo root containing the
 * output directory instead, so the same bundle yields the same page from anywhere.
 */
function repoRootFrom(startDir: string): string | undefined {
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function linkOrText(pathStr: string, label?: string, outDir?: string): string {
  if (!pathStr) return escapeHtml(label || "");
  const displayLabel = escapeHtml(label || pathStr);

  const repoRoot = outDir ? repoRootFrom(outDir) : undefined;
  const absPath = resolve(pathStr);
  const repoPath = repoRoot ? resolve(repoRoot, pathStr.replace(/^\//, "")) : "";
  const cwdPath = resolve(process.cwd(), pathStr.replace(/^\//, ""));
  const outDirRelPath = outDir ? resolve(outDir, pathStr) : "";

  const targetAbs = existsSync(absPath)
    ? absPath
    : repoPath !== "" && existsSync(repoPath)
      ? repoPath
      : existsSync(cwdPath)
        ? cwdPath
        : outDirRelPath !== "" && existsSync(outDirRelPath)
          ? outDirRelPath
          : undefined;

  if (!targetAbs) {
    return `<span>${displayLabel}</span>`;
  }

  let href = pathStr;
  if (outDir) {
    href = relative(outDir, targetAbs);
    if (!href) href = ".";
  }

  return `<a href="${escapeHtml(href)}">${displayLabel}</a>`;
}

export function generateLeaderboardHtml(data: LeaderboardData, outDir?: string): string {
  const isSeparated = data.pairwise.length > 0 && data.pairwise.some((p) => p.separated);

  // Pairwise items
  const pairwiseHtmlLines: string[] = [];
  if (data.pairwise.length === 0) {
    pairwiseHtmlLines.push("<p>No pairwise comparisons available.</p>");
  } else {
    for (const pair of data.pairwise) {
      if (pair.separated && pair.winner) {
        pairwiseHtmlLines.push(
          `<div class="pair-card separated">` +
            `<strong>${escapeHtml(pair.armA)}</strong> vs <strong>${escapeHtml(pair.armB)}</strong>: ` +
            `Separated at 95% confidence; <strong>${escapeHtml(pair.winner)}</strong> leads.` +
            `</div>`,
        );
      } else {
        pairwiseHtmlLines.push(
          `<div class="pair-card unseparated">` +
            `<strong>${escapeHtml(pair.armA)}</strong> vs <strong>${escapeHtml(pair.armB)}</strong>: ` +
            `Overlap at 95% confidence; the arms are not separated.` +
            `</div>`,
        );
      }
    }
  }

  // Rankings table rows
  const tableRows: string[] = [];
  data.entries.forEach((entry, idx) => {
    const rank = idx + 1;
    const iSrLow = (entry.iSrRange.low * 100).toFixed(1);
    const iSrHigh = (entry.iSrRange.high * 100).toFixed(1);
    const iSrRangeStr = `[${iSrLow}%, ${iSrHigh}%]`;
    const iSrPtStr = `${(entry.iSr * 100).toFixed(1)}%`;

    const dSrLow = entry.dSrRange ? (entry.dSrRange.low * 100).toFixed(1) : undefined;
    const dSrHigh = entry.dSrRange ? (entry.dSrRange.high * 100).toFixed(1) : undefined;
    const dSrRangeStr = entry.dSrRange ? `[${dSrLow}%, ${dSrHigh}%]` : "N/A";
    const dSrPtStr = entry.dSr !== undefined ? `${(entry.dSr * 100).toFixed(1)}%` : "N/A";

    const bundleLink = linkOrText(entry.bundle, entry.bundle, outDir);
    const summaryFile = join(entry.bundle, `${entry.label}-summary.json`);
    const summaryLink = linkOrText(summaryFile, `${entry.label}-summary.json`, outDir);
    const compFile = join(entry.bundle, "comparison.json");
    const compLink = linkOrText(compFile, "comparison.json", outDir);

    tableRows.push(`
          <tr>
            <td class="rank-col">${rank}</td>
            <td class="arm-col">
              <strong>${escapeHtml(entry.label)}</strong>
              <span class="adapter-tag">${escapeHtml(entry.adapter)}</span>
            </td>
            <td class="range-col highlight">
              <span class="range-val">${iSrRangeStr}</span>
            </td>
            <td class="point-col">${iSrPtStr}</td>
            <td class="range-col">
              <span class="range-val">${dSrRangeStr}</span>
            </td>
            <td class="point-col">${dSrPtStr}</td>
            <td class="counts-col">${entry.requirementsSatisfied}/${entry.requirementsTotal} reqs (${entry.tasks} tasks)</td>
            <td class="evidence-col">${bundleLink} (${summaryLink}, ${compLink})</td>
          </tr>`);
  });

  // Methodology info.
  //
  // F-336 (dogfood-139): these fell back to `5` tasks and `19` requirements when
  // `entries` was empty — today's real corpus, hardcoded. An empty leaderboard
  // rendered "Evaluation conducted across 5 repository tasks comprising 19 total
  // requirements", publishing a measurement nobody took. That is trap D (today's
  // result baked into the template) at the counts altitude, which the acceptance
  // criteria guarded only at the interval altitude. A page with no data must say
  // it has no data.
  const sampleEntry = data.entries[0];
  const scopeSentence = sampleEntry
    ? `Evaluation conducted across <strong>${sampleEntry.tasks}</strong> repository tasks ` +
      `comprising <strong>${sampleEntry.requirementsTotal}</strong> total requirements.`
    : "No arms were evaluated — this leaderboard carries no measured corpus.";
  const adaptersList = data.entries
    .map((e) => `<strong>${escapeHtml(e.label)}</strong> (${escapeHtml(e.adapter)})`)
    .join(", ");

  const statusHeader = isSeparated
    ? `<div class="status-banner status-separated">
        <h2>Statistical Finding: Separation Reported</h2>
        <p>Disjoint 95% confidence intervals observed between evaluated arms.</p>
       </div>`
    : `<div class="status-banner status-unseparated">
        <h2>Statistical Finding: Arms Overlap (Not Separated)</h2>
        <p>The 95% Wilson confidence intervals overlap across evaluated arms. The arms are not separated at 95% confidence.</p>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Benchmark Leaderboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-heading: #f0f6fc;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --warning-bg: rgba(210, 153, 34, 0.15);
      --warning-border: rgba(210, 153, 34, 0.4);
      --success-bg: rgba(46, 160, 67, 0.15);
      --success-border: rgba(46, 160, 67, 0.4);
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    h1 {
      color: var(--text-heading);
      font-size: 2.2rem;
      margin: 0 0 0.5rem 0;
      letter-spacing: -0.02em;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 1rem;
      margin: 0;
    }
    .status-banner {
      padding: 1.25rem 1.5rem;
      border-radius: 8px;
      margin-bottom: 2rem;
      border: 1px solid var(--border);
    }
    .status-banner h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.3rem;
    }
    .status-banner p {
      margin: 0;
      font-size: 0.95rem;
    }
    .status-unseparated {
      background-color: var(--warning-bg);
      border-color: var(--warning-border);
      color: #f0e6d2;
    }
    .status-unseparated h2 {
      color: #f2cc60;
    }
    .status-separated {
      background-color: var(--success-bg);
      border-color: var(--success-border);
      color: #e6f7ed;
    }
    .status-separated h2 {
      color: #56d364;
    }
    .section-title {
      color: var(--text-heading);
      font-size: 1.5rem;
      margin: 2rem 0 1rem 0;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.95rem;
    }
    th, td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    th {
      background-color: rgba(255, 255, 255, 0.03);
      color: var(--text-heading);
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .rank-col {
      font-weight: bold;
      color: var(--text-muted);
      width: 3rem;
    }
    .arm-col {
      color: var(--text-heading);
    }
    .adapter-tag {
      display: inline-block;
      font-size: 0.75rem;
      padding: 0.1rem 0.5rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-muted);
      margin-left: 0.5rem;
    }
    .range-col {
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      font-weight: 600;
    }
    .range-col.highlight {
      color: var(--accent);
    }
    .point-col {
      color: var(--text-muted);
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      font-size: 0.85rem;
    }
    .counts-col {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .evidence-col {
      font-size: 0.85rem;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .pair-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      font-size: 0.95rem;
    }
    .pair-card.unseparated {
      border-left: 4px solid #f2cc60;
    }
    .pair-card.separated {
      border-left: 4px solid #56d364;
    }
    .methodology-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
      margin-top: 1rem;
    }
    .method-item {
      background-color: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
    }
    .method-item h4 {
      margin: 0 0 0.5rem 0;
      color: var(--text-heading);
      font-size: 1rem;
    }
    .method-item p {
      margin: 0;
      font-size: 0.88rem;
      color: var(--text-muted);
    }
    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Benchmark Leaderboard</h1>
      <p class="subtitle">Ordered by 95% Wilson confidence interval lower bound (<code>${escapeHtml(data.orderedBy)}</code>)</p>
    </header>

    ${statusHeader}

    <h2 class="section-title">Rankings (Interval-First)</h2>
    <div class="card" style="padding: 0; overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Arm</th>
            <th>95% I-SR Interval</th>
            <th>Point I-SR</th>
            <th>95% D-SR Interval</th>
            <th>Point D-SR</th>
            <th>Counts</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>${tableRows.join("")}
        </tbody>
      </table>
    </div>

    <h2 class="section-title">Pairwise Statistical Significance</h2>
    <div class="pairwise-section">
      ${pairwiseHtmlLines.join("")}
    </div>

    <h2 class="section-title">Methodology &amp; Evaluation Setup</h2>
    <div class="card">
      <p>This leaderboard reports software engineering agent performance using range-first statistical evaluation on benchmark task suites.</p>
      
      <div class="methodology-grid">
        <div class="method-item">
          <h4>Evaluated Corpus &amp; Scope</h4>
          <p>${scopeSentence}</p>
        </div>
        <div class="method-item">
          <h4>Statistical Range (95% Wilson Score)</h4>
          <p>Every score is presented as a <strong>95% Wilson score interval</strong> calculated over requirement counts. Point estimates are secondary indicators.</p>
        </div>
        <div class="method-item">
          <h4>Metric Definitions (I-SR &amp; D-SR)</h4>
          <p><strong>I-SR</strong> (Immediate / Initial Requirement Satisfaction Rate) measures direct requirement pass rate. <strong>D-SR</strong> (Dependency-Adjusted Satisfaction Rate) requires all prerequisite requirements to pass.</p>
        </div>
        <div class="method-item">
          <h4>Arm Adapters</h4>
          <p>Evaluated arms run under dedicated test harness adapters: ${adaptersList}.</p>
        </div>
      </div>
    </div>

    <footer>
      <p>Chikory Benchmark Control Plane &bull; Published Data Artifact</p>
    </footer>
  </div>
</body>
</html>`;
}

export function writeLeaderboard(
  bundleDirs: string[],
  outDir: string,
): { jsonPath: string; mdPath: string; htmlPath: string; data: LeaderboardData } {
  const data = buildLeaderboard(bundleDirs);
  const resolvedOutDir = resolve(outDir);
  mkdirSync(resolvedOutDir, { recursive: true });

  const jsonPath = join(resolvedOutDir, "leaderboard.json");
  const mdPath = join(resolvedOutDir, "leaderboard.md");
  const htmlPath = join(resolvedOutDir, "index.html");

  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  writeFileSync(mdPath, generateLeaderboardMarkdown(data));
  writeFileSync(htmlPath, generateLeaderboardHtml(data, resolvedOutDir));

  return { jsonPath, mdPath, htmlPath, data };
}
