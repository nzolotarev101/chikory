#!/usr/bin/env node
/**
 * dogfood-docs.mjs — the mechanical half of /dogfood-review phase 4.
 *
 * Every review used to rewrite these four operations as throwaway scripts in a
 * session scratchpad: replace a bounded status block (with verbatim overflow to
 * PLAN-HISTORY.md), append the ledger row, update the README index row, and lay
 * out the report skeleton. The prose stays the reviewer's; the surgery, the
 * caps, and the numbers do not.
 *
 * Usage (always through devbox):
 *   devbox run -- node scripts/dogfood-docs.mjs block    --target <name> --block <file> [--note <text>]
 *   devbox run -- node scripts/dogfood-docs.mjs ledger   <nnn> --facts <json> --wp WP-n [flags]
 *   devbox run -- node scripts/dogfood-docs.mjs index    <nnn> (--outcome <file> | --row <file>)
 *   devbox run -- node scripts/dogfood-docs.mjs scaffold <nnn> --facts <json> [--out <path>]
 *   devbox run -- node scripts/dogfood-docs.mjs check    [<nnn>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const p = (rel) => resolve(REPO, rel);
const today = () => new Date().toISOString().slice(0, 10);

const die = (msg) => {
  console.error(`Error: ${msg}`);
  process.exit(1);
};

// ── arg parsing ─────────────────────────────────────────────────────────────
const [, , sub, ...rest] = process.argv;
const positional = [];
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  } else positional.push(rest[i]);
}

/**
 * The two bounded status blocks the review must keep inside a hard line cap.
 * Presets rather than free-form regexes: there are exactly two, the skill names
 * both, and a mistyped regex silently rewrites the wrong region of a living doc.
 */
const TARGETS = {
  dogfooding: {
    file: "docs/DOGFOODING.md",
    cap: 15,
    from: /^🟢 \*\*dogfood-|^🔴 \*\*dogfood-|^🟡 \*\*dogfood-/,
    to: /^Related docs:/,
    label: "DOGFOODING.md status block",
  },
  "plan-latest": {
    file: "plan.md",
    cap: 30,
    from: /^- \*\*Latest \/ next:\*\*/,
    to: /^- \*\*KPIs/,
    label: "plan.md §status 'Latest / next'",
  },
};

// ── block: replace a bounded block, overflow verbatim to PLAN-HISTORY.md ────
function cmdBlock() {
  const target = TARGETS[flags.target ?? ""];
  if (!target) die(`--target must be one of: ${Object.keys(TARGETS).join(", ")}`);
  if (!flags.block) die("--block <file> required (the replacement text)");
  const blockText = readFileSync(resolve(flags.block), "utf8").replace(/\n+$/, "");
  const blockLines = blockText.split("\n").length;

  if (blockLines > target.cap) {
    die(
      `the new block is ${blockLines} lines but ${target.label} caps at ${target.cap}. ` +
        `Tighten it — do NOT raise the cap (the cap is what keeps the block readable).`,
    );
  }

  const file = p(target.file);
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => target.from.test(l));
  if (start < 0) die(`could not locate the block start in ${target.file} (${target.from})`);
  let end = lines.findIndex((l, i) => i > start && target.to.test(l));
  if (end < 0) die(`could not locate the block end in ${target.file} (${target.to})`);
  // Trailing blank lines belong to the separator, not the block.
  while (end > start && lines[end - 1].trim() === "") end--;

  const displaced = lines.slice(start, end).join("\n");
  lines.splice(start, end - start, ...blockText.split("\n"));
  writeFileSync(file, lines.join("\n"));

  const note = flags.note ? ` (${flags.note})` : "";
  appendFileSync(
    p("docs/PLAN-HISTORY.md"),
    `\n### ${today()} — displaced from ${target.file} status block${note}\n\n${displaced}\n`,
  );

  console.log(`✅ ${target.label}: replaced ${end - start} lines with ${blockLines} (cap ${target.cap}).`);
  console.log(`   displaced prose appended verbatim to docs/PLAN-HISTORY.md`);
}

// ── ledger: append THIS run's row, numbers derived not retyped ──────────────
const LEDGER = "docs/reports/dogfood-ledger.csv";
const LEDGER_COLUMNS = [
  "run", "wp", "mode", "outcome", "steps", "cost_usd",
  "spec_format", "class", "resumes", "judge_catches", "rung", "rollbacks",
];
const ENUMS = {
  mode: ["run", "chain"],
  outcome: ["SUCCESS", "FAILED", "PARKED", "HALTED"],
  spec_format: ["loose", "prescribed"],
  class: ["product", "meta"],
};

function cmdLedger() {
  const nnn = String(positional[0] ?? "").padStart(3, "0");
  if (!/^\d{3}$/.test(nnn)) die("usage: ledger <nnn> --facts <json> --wp WP-n [flags]");
  if (!flags.facts) die("--facts <json> required (produced by dogfood-verify.sh --facts)");
  const facts = JSON.parse(readFileSync(resolve(flags.facts), "utf8"));
  if (!flags.wp) die("--wp WP-n required (which work package this run delivered)");

  const row = {
    run: nnn,
    wp: flags.wp,
    // A chain run-id is `chain-…`; anything else is a single `run`.
    mode: flags.mode ?? (facts.runId?.startsWith("chain-") ? "chain" : "run"),
    outcome: flags.outcome ?? facts.terminal,
    steps: flags.steps ?? facts.steps,
    cost_usd: flags["cost-usd"] ?? facts.cost?.exact,
    spec_format: flags.format ?? "loose",
    class: flags.class ?? "product",
    resumes: flags.resumes ?? facts.totals?.resumes ?? 0,
    // Judgment: genuine true-positives only, never seam drills. No default.
    judge_catches: flags.catches,
    rung: flags.rung,
    rollbacks: flags.rollbacks ?? facts.totals?.rollbacks ?? 0,
  };
  for (const k of ["judge_catches", "rung"]) {
    if (row[k] === undefined) die(`--${k.replace("judge_", "")} required — it is a judgment call, not derivable`);
  }
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(String(row[k]))) die(`${k}='${row[k]}' is not one of ${allowed.join("|")}`);
  }
  for (const k of ["steps", "resumes", "judge_catches", "rung", "rollbacks"]) {
    if (!/^\d+$/.test(String(row[k]))) die(`${k}='${row[k]}' must be a non-negative integer`);
  }
  if (!/^\d+(\.\d+)?$/.test(String(row.cost_usd))) die(`cost_usd='${row.cost_usd}' must be numeric`);

  const file = p(LEDGER);
  const text = readFileSync(file, "utf8");
  const header = text.split("\n")[0];
  if (header !== LEDGER_COLUMNS.join(",")) {
    die(`ledger header changed — expected:\n  ${LEDGER_COLUMNS.join(",")}\ngot:\n  ${header}`);
  }
  if (text.split("\n").some((l) => l.startsWith(`${nnn},`))) {
    die(`ledger already has a row for run ${nnn} — one row per terminal run, refusing to duplicate`);
  }

  const line = LEDGER_COLUMNS.map((c) => row[c]).join(",");
  writeFileSync(file, text.replace(/\n*$/, "\n") + line + "\n");
  console.log(`✅ ledger row appended: ${line}`);
}

// ── index: the examples/dogfood/README.md campaign row ──────────────────────
function cmdIndex() {
  const nnn = String(positional[0] ?? "").padStart(3, "0");
  if (!/^\d{3}$/.test(nnn)) die("usage: index <nnn> (--outcome <file> | --row <file>)");
  const file = p("examples/dogfood/README.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const rowIdx = lines.findIndex((l) => l.startsWith(`| [\`dogfood-${nnn}-`));

  if (flags.row) {
    if (rowIdx >= 0) die(`README already has a row for dogfood-${nnn} — use --outcome to update it`);
    const prev = String(Number(nnn) - 1).padStart(3, "0");
    const prevIdx = lines.findIndex((l) => l.startsWith(`| [\`dogfood-${prev}-`));
    if (prevIdx < 0) die(`cannot find the dogfood-${prev} row to insert after`);
    const row = readFileSync(resolve(flags.row), "utf8").trim();
    // F-308: a --row file holding only the description cell is inserted verbatim
    // and is NOT a table row — the campaign index silently loses the entry AND the
    // next review's --outcome lookup cannot find it (dogfood-132 landed this way).
    if (!row.startsWith(`| [\`dogfood-${nnn}-`)) {
      die(
        `--row content is not a dogfood-${nnn} table row: it must start with ` +
          "'| [`dogfood-" +
          nnn +
          "-<slug>.yaml`](<slug>.yaml) | ' — got: " +
          row.slice(0, 60),
      );
    }
    if (row.split(" | ").length < 4) {
      die(`--row content has ${row.split(" | ").length} columns; the index table needs 4`);
    }
    lines.splice(prevIdx + 1, 0, row);
    writeFileSync(file, lines.join("\n"));
    console.log(`✅ README: inserted the dogfood-${nnn} row after dogfood-${prev}`);
    return;
  }

  if (!flags.outcome) die("--outcome <file> required (the outcome cell text)");
  if (rowIdx < 0) die(`no README row for dogfood-${nnn} — use --row to insert one`);
  const cols = lines[rowIdx].split(" | ");
  if (cols.length < 4) die(`unexpected README column count (${cols.length}) on the dogfood-${nnn} row`);
  cols[2] = readFileSync(resolve(flags.outcome), "utf8").trim();
  cols[3] = `[dogfood-${nnn}.md](../../docs/reports/dogfood-${nnn}.md) |`;
  lines[rowIdx] = cols.join(" | ");
  writeFileSync(file, lines.join("\n"));
  console.log(`✅ README: updated the dogfood-${nnn} outcome + report link`);
}

// ── scaffold: the report skeleton, trace tables pre-filled ──────────────────
function cmdScaffold() {
  const nnn = String(positional[0] ?? "").padStart(3, "0");
  if (!/^\d{3}$/.test(nnn)) die("usage: scaffold <nnn> --facts <json> [--out <path>]");
  if (!flags.facts) die("--facts <json> required");
  const f = JSON.parse(readFileSync(resolve(flags.facts), "utf8"));
  const out = flags.out ? resolve(flags.out) : p(`docs/reports/dogfood-${nnn}.md`);
  if (existsSync(out) && !flags.force) die(`${out} exists — pass --force to overwrite`);

  const differs = (f.harvest ?? []).filter((h) => h.status === "DIFFERS").map((h) => h.path);
  const harvest =
    (f.harvest ?? []).length === 0
      ? "n/a — already committed, nothing uncommitted to byte-diff"
      : differs.length === 0
        ? `${f.harvest.length}/${f.harvest.length} files byte-**IDENTICAL** to the run workspace`
        : `⚠ DIFFERS: ${differs.join(", ")}`;
  const acLine = (f.acceptanceChecks ?? []).map((a) => `${a.id} ${a.status}`).join(" · ") || "(none)";
  const stepRows =
    (f.perStep ?? [])
      .map((s) => `| ${s.step} | ${s.tokens || "?"} | $${s.costUsd} | ${s.wallClock} | ${s.verdict} |`)
      .join("\n") || "| TODO | | | | |";

  const md = `# dogfood-${nnn} — TODO: plain-English title (TODO: WP-n)

**WP:** TODO: WP-n (gloss) · **Date:** ${today()} ·
**Spec:** \`examples/dogfood/TODO.yaml\` ·
**Run:** \`${f.runId}\` · **Landed:** ${f.harvestCommit ? `\`${f.harvestCommit.split(" ")[0]}\`` : "this review's commit"} ·
**Ladder:** TODO: rung vs the phase exit gate

## Plain lead

TODO: 1–2 jargon-free sentences on what is now true that was not true before,
then the one thing that matters most about how it went.

## Trace

| field | value |
|---|---|
| terminal | ${f.terminal === "SUCCESS" ? "🟢" : "🔴"} ${f.terminal} · ${f.steps} step${f.steps === 1 ? "" : "s"} · ${f.wallClock} |
| cost | **$${f.cost.exact}** of $${f.cost.budget} budget (**${f.cost.budgetPct}%**) — judge share **${f.cost.judgeShare}** |
| executor | \`${f.executor}\` — TODO: note if unpriced (cost meter blind) |
| judge | \`${f.judge}\` · ${f.totals.judgePasses} pass${f.totals.judgePasses === 1 ? "" : "es"} |
| verdicts | rollbacks ${f.totals.rollbacks} · escalations ${f.totals.escalations} · resumes ${f.totals.resumes} |
| checkpoints | ${f.totals.checkpoints} · injections ${f.totals.injections} |
| acceptance | ${acLine} (re-run in the ${f.acCwdLabel}) |
| harvest | ${harvest} |

**Per-step:**

| # | tokens in/out | cost | wall | verdict |
|---|---|---|---|---|
${stepRows}

${f.probeStep ? `⚠️ Empty-diff probe step ${f.probeStep.step} — $${f.probeStep.costUsd} (F-11 recurrence).` : "No empty-diff probe step — **F-11 (wasted probe step) did not recur**."}

## Delivery quality (human review, post-landing)

TODO: landed files table; the goal line by line; independent verification of
anything the ACs took on trust; the designed traps and whether each was rejected;
scope discipline.

## New friction

TODO: one subsection per item, continuing the GLOBAL F-n sequence. Each states
the evidence and names the WP it spawns (or why none).

## Friction disposition

| F-n | severity | defect | disposition |
|---|---|---|---|
| TODO | 🟡 | TODO | HAND-FIXED THIS SITTING / → WP-n (queued) / track-B note |

## Verdict on the thesis

TODO: what this run says about durable execution + real-time judging, and the
standing caution if any.

## KPI (DOGFOODING §1.4)

| KPI | this run | trailing window |
|---|---|---|
| max horizon survived | ${f.steps} step${f.steps === 1 ? "" : "s"} / ${f.wallClock} | TODO |
| kill → resume count | ${f.totals.resumes} | TODO |
| judge true-positives pre-land | TODO | TODO |
| meta:product headline ratio | TODO | TODO |
| per-step reliability (runs ≥5 steps) | ${f.steps >= 5 ? "TODO" : "n/a (<5 steps)"} | TODO (dogfood-progression) |
| ladder rung vs exit gate | TODO | TODO |
`;
  writeFileSync(out, md);
  console.log(`✅ scaffold written: ${out}`);
  console.log(`   trace + per-step tables pre-filled from ${flags.facts}; every TODO is prose you owe.`);
}

// ── check: the close-out gates that do not need a full suite run ────────────
function cmdCheck() {
  const nnn = positional[0] ? String(positional[0]).padStart(3, "0") : null;
  let failures = 0;
  const fail = (m) => {
    console.log(`⛔ ${m}`);
    failures++;
  };
  const ok = (m) => console.log(`✅ ${m}`);

  // 1. bounded blocks within cap
  for (const [name, t] of Object.entries(TARGETS)) {
    const lines = readFileSync(p(t.file), "utf8").split("\n");
    const start = lines.findIndex((l) => t.from.test(l));
    if (start < 0) {
      fail(`${name}: block start not found in ${t.file}`);
      continue;
    }
    let end = lines.findIndex((l, i) => i > start && t.to.test(l));
    if (end < 0) end = lines.length;
    while (end > start && lines[end - 1].trim() === "") end--;
    const n = end - start;
    if (n > t.cap) fail(`${t.label}: ${n} lines, cap ${t.cap} — move the overflow to PLAN-HISTORY.md`);
    else ok(`${t.label}: ${n} lines (cap ${t.cap})`);
  }

  // 2. plan.md §6/§7 table header must keep its schema (F-81)
  const planText = readFileSync(p("plan.md"), "utf8");
  if (planText.includes("| WP | Title | Tag | Status |")) {
    fail("plan.md WP table gained a `Status` column — F-81: this activates the staleness gate with inverted semantics");
  } else ok("plan.md WP table header schema intact (F-81)");

  if (!nnn) {
    console.log(`\n${failures === 0 ? "✅ all structural checks pass" : `⛔ ${failures} failure(s)`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // 3. report citations resolve — `path:line` / `path:line-line`
  const reportPath = p(`docs/reports/dogfood-${nnn}.md`);
  if (!existsSync(reportPath)) {
    fail(`docs/reports/dogfood-${nnn}.md does not exist`);
  } else {
    const report = readFileSync(reportPath, "utf8");
    // Only inside backticks, and only paths that look like real source files.
    const cites = [...report.matchAll(/`([A-Za-z0-9._\-/]+\.(?:ts|tsx|js|mjs|py|sh|yaml|yml|md|json)):(\d+)(?:[-,](\d+))?`/g)];
    let resolved = 0;
    for (const [, rel, a, b] of cites) {
      // Reports routinely cite a bare basename once the prose has named the
      // directory (`main.ts:141`). Resolve against tracked paths; when several
      // files share the basename the citation still holds if ANY of them is long
      // enough — skipping ambiguous ones would blind the check to its main case.
      const candidates = existsSync(p(rel))
        ? [rel]
        : planTextFiles().filter((f) => f.endsWith(`/${rel}`) || f === rel);
      if (candidates.length === 0) {
        fail(`report cites \`${rel}:${a}\` but no such file is tracked`);
        continue;
      }
      const hi = Number(b ?? a);
      // Trailing newline must not count as a line, or a citation one past EOF passes.
      const lengths = candidates.map(
        (c) => readFileSync(p(c), "utf8").replace(/\n$/, "").split("\n").length,
      );
      if (Math.max(...lengths) < hi) {
        fail(
          `report cites \`${rel}:${a}${b ? `-${b}` : ""}\` but ` +
            candidates.map((c, i) => `${c} has ${lengths[i]} lines`).join(", "),
        );
      } else resolved++;
    }
    const line = `report citations: ${resolved}/${cites.length} resolve`;
    if (resolved === cites.length) ok(line);
    else console.log(`   ${line}`);
  }

  // 4. living-doc coverage — every surface the skill mandates mentions this run
  const surfaces = {
    "plan.md": p("plan.md"),
    "docs/REQUIREMENTS.md": p("docs/REQUIREMENTS.md"),
    "docs/DOGFOODING.md": p("docs/DOGFOODING.md"),
    "examples/dogfood/README.md": p("examples/dogfood/README.md"),
  };
  for (const [label, f] of Object.entries(surfaces)) {
    if (readFileSync(f, "utf8").includes(`dogfood-${nnn}`)) ok(`${label} mentions dogfood-${nnn}`);
    else fail(`${label} never mentions dogfood-${nnn}`);
  }
  const ledger = readFileSync(p(LEDGER), "utf8");
  if (ledger.split("\n").some((l) => l.startsWith(`${nnn},`))) ok(`ledger has a row for ${nnn}`);
  else fail(`ledger has NO row for ${nnn} — one row per terminal run is mandatory`);

  console.log(`\n${failures === 0 ? "✅ all checks pass" : `⛔ ${failures} failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

let _files = null;
/** Tracked paths, so a report citing a bare basename still resolves. */
function planTextFiles() {
  if (_files) return _files;
  _files = execFileSync("git", ["-C", REPO, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  return _files;
}

const COMMANDS = { block: cmdBlock, ledger: cmdLedger, index: cmdIndex, scaffold: cmdScaffold, check: cmdCheck };
if (!COMMANDS[sub]) {
  console.error(`Usage: dogfood-docs.mjs <${Object.keys(COMMANDS).join("|")}> [...]`);
  process.exit(2);
}
COMMANDS[sub]();
