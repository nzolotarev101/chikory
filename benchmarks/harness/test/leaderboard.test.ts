import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  buildLeaderboard,
  generateLeaderboardHtml,
  generateLeaderboardMarkdown,
  writeLeaderboard,
} from "../src/leaderboard.js";
import type { ArmComparisonDetail } from "../src/results.js";

function makeArm(
  label: string,
  adapter: string,
  sat: number,
  total: number,
  low: number,
  high: number,
): ArmComparisonDetail {
  return {
    label,
    suite: "test-suite",
    adapter,
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T01:00:00Z",
    tasks: 5,
    tasksVerified: 5,
    requirementsTotal: total,
    requirementsSatisfied: sat,
    dependencySatisfied: sat,
    iSr: sat / total,
    iSrCi: { lower: low, upper: high, low, high },
    iSrRange: { low, high },
    dSr: sat / total,
    dSrCi: { lower: low, upper: high, low, high },
    dSrRange: { low, high },
    reference: `/evidence/${label}/summary.json`,
    rawResultsDir: `benchmarks/results/test/${label}`,
  };
}

function createTestBundle(
  root: string,
  name: string,
  armA: ArmComparisonDetail,
  armB: ArmComparisonDetail,
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "comparison.json"),
    JSON.stringify(
      {
        armA,
        armB,
        arms: [armA, armB],
        taskIds: ["t1", "t2", "t3", "t4", "t5"],
      },
      null,
      2,
    ),
  );
  return dir;
}

describe("leaderboard", () => {
  it("ranks arms by interval lower bound (iSrRange.low), not point estimate", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-1-"));
    const wide = makeArm("wide", "chikory", 5, 5, 0.5655, 1.0);
    const narrow = makeArm("narrow", "command", 90, 100, 0.8256, 0.9448);
    const bundleDir = createTestBundle(root, "bundle1", wide, narrow);

    const data = buildLeaderboard([bundleDir]);

    expect(data.orderedBy).toBe("iSrRange.low");
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0]?.label).toBe("narrow");
    expect(data.entries[1]?.label).toBe("wide");
    expect(data.entries[0]?.iSr).toBe(0.9);
    expect(data.entries[1]?.iSr).toBe(1.0);
  });

  it("refuses to separate overlapping intervals and names no winner", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-2-"));
    const wide = makeArm("wide", "chikory", 5, 5, 0.5655, 1.0);
    const narrow = makeArm("narrow", "command", 90, 100, 0.8256, 0.9448);
    const bundleDir = createTestBundle(root, "bundle1", wide, narrow);

    const data = buildLeaderboard([bundleDir]);

    expect(data.pairwise).toHaveLength(1);
    const pair = data.pairwise[0]!;
    expect(pair.separated).toBe(false);
    expect(pair.winner).toBeNull();
    expect(pair.reason).toMatch(/overlap/i);

    const md = generateLeaderboardMarkdown(data);
    expect(md).toMatch(/not separated/i);
    expect(md).toMatch(/no winner/i);
  });

  it("separates disjoint intervals and names the higher arm", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-3-"));
    const top = makeArm("top", "chikory", 19, 19, 0.8318, 1.0);
    const bottom = makeArm("bottom", "command", 2, 19, 0.0294, 0.3139);
    const bundleDir = createTestBundle(root, "bundle2", top, bottom);

    const data = buildLeaderboard([bundleDir]);

    expect(data.pairwise).toHaveLength(1);
    const pair = data.pairwise[0]!;
    expect(pair.separated).toBe(true);
    expect(pair.winner).toBe("top");
    expect(pair.reason).toMatch(/disjoint/i);

    const md = generateLeaderboardMarkdown(data);
    expect(md).toContain("top");
  });

  it("combines arms from multiple bundles and writes leaderboard artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-4-"));
    const wide = makeArm("wide", "chikory", 5, 5, 0.5655, 1.0);
    const narrow = makeArm("narrow", "command", 90, 100, 0.8256, 0.9448);
    const top = makeArm("top", "chikory", 19, 19, 0.8318, 1.0);
    const bottom = makeArm("bottom", "command", 2, 19, 0.0294, 0.3139);

    const b1 = createTestBundle(root, "b1", wide, narrow);
    const b2 = createTestBundle(root, "b2", top, bottom);
    const outDir = join(root, "out");

    const { jsonPath, mdPath, htmlPath, data } = writeLeaderboard([b1, b2], outDir);

    expect(data.entries).toHaveLength(4);
    expect(data.entries.map((e) => e.label)).toEqual(["top", "narrow", "wide", "bottom"]);
    expect(data.pairwise).toHaveLength(6);

    const jsonContent = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(jsonContent.orderedBy).toBe("iSrRange.low");
    expect(jsonContent.entries).toHaveLength(4);

    const mdContent = readFileSync(mdPath, "utf8");
    expect(mdContent).toContain("# Benchmark Leaderboard");
    expect(mdContent).not.toMatch(/<html/i);

    expect(existsSync(htmlPath)).toBe(true);
    const htmlContent = readFileSync(htmlPath, "utf8");
    expect(htmlContent).toMatch(/<html|<!doctype html/i);
  });

  it("generates self-contained HTML page with range-first methodology and no remote assets", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-html-"));
    const wide = makeArm("wide", "chikory", 5, 5, 0.5655, 1.0);
    const narrow = makeArm("narrow", "command", 90, 100, 0.8256, 0.9448);
    const bundleDir = createTestBundle(root, "bundle1", wide, narrow);

    const data = buildLeaderboard([bundleDir]);
    const html = generateLeaderboardHtml(data, root);

    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/56\.5%/);
    expect(html).toMatch(/82\.6%/);
    expect(html).toMatch(/wilson/i);
    expect(html).toMatch(/I-SR/i);
    expect(html).toMatch(/D-SR/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import\s+url\(\s*["']?(?:https?:)?\/\//i);
  });

  // F-337 (dogfood-139 review): bundle-derived strings were interpolated raw, so
  // published DATA could rewrite the page's markup. Both traps this artifact
  // exists to satisfy were defeatable by a crafted bundle — a winner claim on an
  // unseparated pair (trap A) and a network asset on a page that promises none
  // (trap E). The delivery's own tests used benign fixtures only, so they passed.
  it("escapes bundle-derived strings so published data cannot inject markup or claims", () => {
    const hostileLabel = 'evil"><script src="https://attacker.example/x.js"></script><span class="';
    const wide = makeArm(hostileLabel, "chikory", 5, 5, 0.5655, 1.0);
    const narrow = makeArm("beta", "command", 90, 100, 0.8256, 0.9448);

    const html = generateLeaderboardHtml({
      orderedBy: "iSrRange.low",
      entries: [wide, narrow].map((a) => ({ ...a, bundle: "." })),
      pairwise: [{ armA: "alpha <em>outperforms</em> beta", armB: "beta", separated: false }],
    } as unknown as Parameters<typeof generateLeaderboardHtml>[0]);

    // trap E: no injected remote asset survives.
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
    expect(html).not.toContain("<script");
    // no injected element of any kind — the hostile label cannot close its cell.
    expect(html).not.toContain('<span class="">');
    // the hostile text still SHOWS — escaped, not dropped.
    expect(html).toContain("&lt;script");
    // trap A: the page's OWN claim still follows the data, not the label. (A label
    // that merely reads like a claim renders as escaped text and is not a claim by
    // the page; the page states separation only from `pairwise[].separated`.)
    expect(html).toMatch(/not separated/i);
    expect(html).not.toMatch(/Separated at 95% confidence/);
  });

  // F-338 (dogfood-139 review): evidence links resolved `entry.bundle` against
  // `process.cwd()`, though the field is anchored to the repo root (F-267/WP-591).
  // Generating the page from `benchmarks/harness` — what AC-2 itself does — turned
  // every evidence link into a bare `<span>`, and trap G still passed because a
  // `<span>` has no href to be dead. The page must not depend on the caller's cwd.
  it("emits the same evidence links no matter which directory the generator runs from", () => {
    const outDir = join(process.cwd(), "..", "publications", "leaderboard");
    const data = {
      orderedBy: "iSrRange.low",
      entries: [
        {
          ...makeArm("chikory", "chikory", 19, 19, 0.832, 1.0),
          bundle: "benchmarks/publications/p3-rung-4",
        },
      ],
      pairwise: [],
    } as unknown as Parameters<typeof generateLeaderboardHtml>[0];

    const cwd = process.cwd();
    try {
      process.chdir(resolve(cwd, "..", ".."));
      const fromRepoRoot = generateLeaderboardHtml(data, outDir);
      process.chdir(cwd);
      const fromHarness = generateLeaderboardHtml(data, outDir);

      expect(fromHarness).toBe(fromRepoRoot);
      // …and it is the LINK that survives, not the degraded span.
      expect(fromHarness).toContain('<a href="../p3-rung-4"');
      expect(fromHarness).not.toContain("<span>benchmarks/publications/p3-rung-4</span>");
    } finally {
      process.chdir(cwd);
    }
  });

  // F-336 (dogfood-139 review): the methodology fell back to `5` tasks and `19`
  // requirements — today's real corpus — whenever `entries` was empty, so a page
  // with no data published a measurement nobody took.
  it("states that it has no corpus rather than fabricating counts when there are no entries", () => {
    const html = generateLeaderboardHtml({
      orderedBy: "iSrRange.low",
      entries: [],
      pairwise: [],
    } as unknown as Parameters<typeof generateLeaderboardHtml>[0]);

    expect(html).not.toMatch(/<strong>5<\/strong>\s*repository tasks/i);
    expect(html).not.toMatch(/<strong>19<\/strong>\s*total requirements/i);
    expect(html).toMatch(/no measured corpus|no arms were evaluated/i);
  });

  // F-267 (WP-591): the published bundle pointer must RESOLVE, not merely be a
  // non-empty string. dogfood-124 stored `--bundle` verbatim, so the published
  // leaderboard cited `../publications/p3-rung-4` — resolvable only from the
  // CWD that happened to run the command, from nowhere else.
  it("anchors the bundle pointer to the repo root so it resolves from there", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-anchor-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    const a = makeArm("a", "chikory", 5, 5, 0.5655, 1.0);
    const b = makeArm("b", "command", 90, 100, 0.8256, 0.9448);
    createTestBundle(root, join("benchmarks", "publications", "run-x"), a, b);

    const data = buildLeaderboard([join(root, "benchmarks", "publications", "run-x")]);

    for (const entry of data.entries) {
      expect(entry.bundle).toBe(join("benchmarks", "publications", "run-x"));
      expect(isAbsolute(entry.bundle)).toBe(false);
      expect(existsSync(resolve(root, entry.bundle, "comparison.json"))).toBe(true);
    }
  });

  it("refuses to publish a bundle that lives in an ephemeral run workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-ephemeral-"));
    const a = makeArm("a", "chikory", 5, 5, 0.5655, 1.0);
    const b = makeArm("b", "command", 90, 100, 0.8256, 0.9448);
    const dir = createTestBundle(root, join(".chikory", "runs", "run-1", "workspace", "pub"), a, b);

    expect(() => buildLeaderboard([dir])).toThrow(/ephemeral Chikory run workspace/);
  });

  it("drops the CWD-relative `reference` instead of republishing a dead pointer", () => {
    const root = mkdtempSync(join(tmpdir(), "lb-test-ref-"));
    const a = makeArm("a", "chikory", 5, 5, 0.5655, 1.0);
    const b = makeArm("b", "command", 90, 100, 0.8256, 0.9448);
    const dir = createTestBundle(root, "bundle1", a, b);

    const data = buildLeaderboard([dir]);

    for (const entry of data.entries) {
      expect(entry).not.toHaveProperty("reference");
      expect(entry.rawResultsDir).toBeDefined();
    }
  });
});

