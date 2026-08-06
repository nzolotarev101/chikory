/**
 * `chikory-bench` — WP-301 harness CLI (entry: `bin.ts`). Runs inside devbox
 * (`devbox run bench -- <command>`), never against host toolchains.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { chikoryAdapter, commandAdapter, type RunnerAdapter } from "./adapter.js";
import { fetchDevAIInstances } from "./devai.js";
import {
  checkBenchFamilyDirective,
  formatResolvedFamilies,
  resolveBenchFamilies,
} from "./family-preflight.js";
import { commandComplete, makeJudgeGrader } from "./judge-grader.js";
import { compareSummaries, writeSuiteSummary, type SuiteSummary } from "./results.js";
import { acquireSuiteLock, SuiteAlreadyRunningError } from "./suite-lock.js";
import { loadTaskDir, runSuite } from "./suite.js";
import { isRunnable } from "./task.js";

const USAGE = `usage: chikory-bench <command> [options]

commands:
  validate <task-dir>...   validate every task file (authored YAML + DevAI JSON);
                           exit 1 if any file is invalid
  list <task-dir>...       list loaded tasks (id, class, status, requirements)
  fetch-devai              download the 55 DevAI instance JSONs
      [--ref <git-ref>]      upstream ref (default main)
      [--out <dir>]          default benchmarks/devai/instances
  run --tasks <dir>        run a suite through one adapter and grade it
      --adapter <name>       chikory | command
      [--executor <name>]    chikory executor: gemini | claude-code | codex
                             (default gemini; also CHIKORY_BENCH_EXECUTOR)
      [--agent-classes <f>]  agent-classes.yaml declaring peer members, so a
                             quota wall rotates instead of parking (WP-585)
      [--cmd <template>]     command adapter template; placeholders
                             {workspace} {goalFile} {taskId}
      [--judge-cmd <tmpl>]   grade judge-kind requirements via a CLI judge;
                             {promptFile} is replaced with the prompt path
                             (keyless CLI-subscription judge, e.g.
                             'claude -p "$(cat {promptFile})"')
      [--out <dir>]          results root (default benchmarks/results)
      [--filter <substr>]    only tasks whose id contains substr
      [--suite <name>]       summary label (default the tasks dir)
      [--base-verify-minutes <n>]
                             cap for each task's base verification: install +
                             the target's FULL suite (default 45)
  compare <summary-a.json> <summary-b.json>
                           compare two 5-task run summaries with 95% Wilson CIs
      [--arm-a <file>] / [--left <file>]    path to summary A
      [--arm-b <file>] / [--right <file>]   path to summary B
      [--left-label <str>]                  label for left arm
      [--right-label <str>]                 label for right arm
      [--out <file>]                        output path to save comparison JSON

exit codes: 0 ok · 1 invalid input or failed run
`;

interface Flags {
  values: Record<string, string>;
  positionals: string[];
}

/** Map a friendly `--executor` name to a Chikory `{adapter, family}` pair. */
function resolveExecutor(name: string): { adapter: string; family: string } | undefined {
  switch (name) {
    case "gemini":
    case "gemini-cli":
      return { adapter: "gemini-cli", family: "gemini" };
    case "claude":
    case "claude-code":
      return { adapter: "claude-code", family: "anthropic" };
    case "codex":
      return { adapter: "codex", family: "openai" };
    default:
      return undefined;
  }
}

/**
 * F-253 (WP-585): a registry file → the `{executor, judge}` class-id references
 * a task spec carries. The spec names classes by id; the registry itself is
 * resolved separately by the runner.
 *
 * Exactly one class per role, or nothing: a bench arm that could start on
 * either of two executor classes is not one measurement, and picking silently
 * would hide that from the published number.
 */
export function pickClassRefs(
  registry: unknown,
): { executor: string; judge: string } | undefined {
  if (!registry || typeof registry !== "object") return undefined;
  const classes = (registry as { classes?: unknown }).classes;
  if (!classes || typeof classes !== "object") return undefined;

  const byRole: Record<string, string[]> = { executor: [], judge: [] };
  for (const [classId, declared] of Object.entries(classes as Record<string, unknown>)) {
    const role = (declared as { role?: unknown } | null)?.role;
    if (typeof role === "string" && byRole[role]) byRole[role].push(classId);
  }
  if (byRole.executor.length !== 1 || byRole.judge.length !== 1) return undefined;
  return { executor: byRole.executor[0]!, judge: byRole.judge[0]! };
}

function parseFlags(argv: string[]): Flags {
  const values: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        values[key] = "true";
      } else {
        values[key] = next;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { values, positionals };
}

export async function main(argv: string[], io = { out: console.log, err: console.error }): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return command === undefined ? 1 : 0;
  }
  const { values, positionals } = parseFlags(rest);

  if (command === "validate" || command === "list") {
    if (positionals.length === 0) {
      io.err("chikory-bench: at least one task dir required");
      return 1;
    }
    let bad = 0;
    for (const dir of positionals) {
      const { tasks, invalid } = loadTaskDir(resolve(dir));
      for (const [file, issues] of Object.entries(invalid)) {
        bad++;
        io.err(`INVALID ${join(dir, file)}`);
        for (const issue of issues) io.err(`  - ${issue}`);
      }
      if (command === "list") {
        for (const t of tasks) {
          io.out(
            `${t.id}  ${t.class}/${t.source}  ${t.status}${isRunnable(t) ? "" : " (not runnable)"}  ` +
              `${t.requirements.length} requirements`,
          );
        }
      } else {
        io.out(`${dir}: ${tasks.length} valid, ${Object.keys(invalid).length} invalid`);
      }
    }
    return bad > 0 ? 1 : 0;
  }

  if (command === "fetch-devai") {
    const ref = values["ref"] ?? "main";
    const out = resolve(values["out"] ?? "benchmarks/devai/instances");
    io.out(`fetching DevAI instances @ ${ref} → ${out}`);
    const instances = await fetchDevAIInstances(ref);
    mkdirSync(out, { recursive: true });
    for (const inst of instances) writeFileSync(join(out, inst.name), inst.content);
    writeFileSync(
      join(out, "manifest.json"),
      JSON.stringify(
        {
          source: "metauto-ai/agent-as-a-judge",
          ref,
          fetchedAt: new Date().toISOString(),
          files: instances.map((i) => ({ name: i.name, sha: i.sha })),
        },
        null,
        2,
      ),
    );
    io.out(`${instances.length} instances written`);
    return instances.length > 0 ? 0 : 1;
  }

  if (command === "run") {
    const tasksDir = values["tasks"];
    const adapterName = values["adapter"];
    if (!tasksDir || !adapterName) {
      io.err("chikory-bench run: --tasks and --adapter are required");
      return 1;
    }
    let adapter: RunnerAdapter;
    if (adapterName === "chikory") {
      // Executor override (directive: Gemini executes / Codex judges). Absent =
      // the adapter's own default. Also readable from CHIKORY_BENCH_EXECUTOR.
      const executorName = values["executor"] ?? process.env.CHIKORY_BENCH_EXECUTOR;
      const executor = executorName ? resolveExecutor(executorName) : undefined;
      if (executorName && !executor) {
        io.err(`chikory-bench run: unknown --executor '${executorName}' (gemini | claude-code | codex)`);
        return 1;
      }
      // F-253 (WP-585): declared agent classes are what let a quota wall rotate
      // to a peer instead of parking. Without them `recordWallAndCheckPeer` is
      // skipped entirely and the WP-566…WP-576 rotation system is inert —
      // p3-rung-4 hit 5 walls and logged zero `agent_rotation` entries.
      const agentClassesPath = values["agent-classes"];
      let registry: unknown;
      let agentClasses: { executor?: string; judge?: string } | undefined;
      if (agentClassesPath !== undefined) {
        const resolved = resolve(agentClassesPath);
        if (!existsSync(resolved)) {
          io.err(`chikory-bench run: --agent-classes file not found: ${resolved}`);
          return 1;
        }
        registry = parseYaml(readFileSync(resolved, "utf8"));
        agentClasses = pickClassRefs(registry);
        if (agentClasses === undefined) {
          io.err(
            `chikory-bench run: ${resolved} must declare exactly one executor class and one judge class`,
          );
          return 1;
        }
        // The runner resolves the registry from CWD, and it runs with CWD set to
        // the task workspace — so an absolute path here is what makes the
        // operator's file the one the run actually loads, instead of silently
        // falling back to the shipped defaults (which carry Claude members).
        process.env.CHIKORY_AGENT_CLASSES = resolved;
        io.out(
          `bench preflight: agent classes ${agentClasses.executor} / ${agentClasses.judge} from ${resolved}`,
        );
      }
      adapter = chikoryAdapter({
        ...(executor ? { executor } : {}),
        ...(agentClasses !== undefined ? { agentClasses } : {}),
      });

      // Family preflight (WP-536, F-165/F-170): echo the resolved arm and refuse
      // to spend when the executor/judge/code-routing families violate the
      // standing directive (Gemini executes / Codex judges, never Claude). Twice
      // in one day a suite burned real Anthropic budget on a wrong-family arm
      // because nothing asserted the family before launch. Override with
      // CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE=1.
      const resolvedFamilies = resolveBenchFamilies(
        {
          ...(executor ? { executor } : {}),
          ...(registry !== undefined ? { agentClasses: registry } : {}),
        },
        process.env,
      );
      io.out(`bench preflight: ${formatResolvedFamilies(resolvedFamilies)}`);
      const violations = checkBenchFamilyDirective(resolvedFamilies);
      if (violations.length > 0 && process.env.CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE !== "1") {
        io.err(
          "chikory-bench run: REFUSING to launch — resolved families violate the standing directive (Gemini executes / Codex judges, never Claude):",
        );
        for (const v of violations) io.err(`  - ${v.message}`);
        io.err("Override (you accept a non-standard arm): CHIKORY_BENCH_ALLOW_FAMILY_OVERRIDE=1");
        return 1;
      }
    } else if (adapterName === "command") {
      const template = values["cmd"];
      if (!template) {
        io.err("chikory-bench run: --adapter command requires --cmd");
        return 1;
      }
      adapter = commandAdapter("command", template);
    } else {
      io.err(`chikory-bench run: unknown adapter '${adapterName}'`);
      return 1;
    }

    const { tasks, invalid } = loadTaskDir(resolve(tasksDir));
    if (Object.keys(invalid).length > 0) {
      for (const [file, issues] of Object.entries(invalid)) {
        io.err(`INVALID ${file}: ${issues.join("; ")}`);
      }
      return 1;
    }
    const filter = values["filter"];
    const selected = filter ? tasks.filter((t) => t.id.includes(filter)) : tasks;
    if (selected.length === 0) {
      io.err("chikory-bench run: no tasks selected");
      return 1;
    }

    const judgeCmd = values["judge-cmd"];
    const judge = judgeCmd ? makeJudgeGrader(commandComplete(judgeCmd)) : undefined;
    const resultsDir = resolve(values["out"] ?? "benchmarks/results");
    const suiteName = values["suite"] ?? tasksDir;
    // F-241: base verification installs a real target and runs its whole suite;
    // it must never inherit the 120 s judge-check cap.
    const baseVerifyMinutes = values["base-verify-minutes"];
    if (baseVerifyMinutes !== undefined && !/^\d+$/.test(baseVerifyMinutes)) {
      io.err(`chikory-bench run: --base-verify-minutes must be a whole number of minutes`);
      return 1;
    }

    // F-239: one suite at a time per results root. dogfood-122's node ran four
    // concurrently against the same root; none finished, and every wall-clock
    // they reported was contended.
    let releaseLock: () => void;
    try {
      releaseLock = acquireSuiteLock(resultsDir, { suite: suiteName, adapter: adapterName });
    } catch (err) {
      if (err instanceof SuiteAlreadyRunningError) {
        io.err(`chikory-bench run: REFUSING to launch — ${err.message}`);
        return 1;
      }
      throw err;
    }

    let summary: SuiteSummary;
    let outDir: string;
    try {
      ({ summary, outDir } = await runSuite({
        suite: suiteName,
        tasks: selected,
        adapter,
        resultsDir,
        judge,
        log: io.out,
        ...(baseVerifyMinutes !== undefined
          ? { baseVerifyTimeoutMs: Number(baseVerifyMinutes) * 60_000 }
          : {}),
      }));
    } finally {
      releaseLock();
    }
    io.out(
      `suite ${summary.suite}: ${summary.tasks} tasks, ` +
        `${summary.requirementsSatisfied}/${summary.requirementsTotal} requirements satisfied ` +
        `(I-SR ${(summary.iSr * 100).toFixed(1)}%, D-SR ${(summary.dSr * 100).toFixed(1)}%)`,
    );
    io.out(`artifacts: ${outDir}`);

    // F-259: promote the canonical `<out>/summary.json` here, so nobody has to
    // pick it out of a glob afterwards. The runbook's hand-promote step was
    // `ls -d <out>/*-chikory | tail -1`, which is "newest directory" — and the
    // newest directory after a diagnostic re-run of ONE task is that one-task
    // summary, silently published as the five-task arm.
    //
    // Guarded on a full-corpus selection for exactly that reason: `--filter
    // brownfield-001` can never clobber the canonical file, while
    // `bench-run.sh`'s standing `--filter brownfield` (5 of 5) still promotes.
    // Byte-identical to the run's own summary.json — both go through
    // `writeSuiteSummary`, and dogfood-123 diffs the published copies against
    // this path.
    if (selected.length === tasks.length) {
      const canonical = writeSuiteSummary(resultsDir, summary);
      io.out(`promoted canonical summary: ${canonical}`);
    } else {
      io.out(
        `NOT promoting a canonical summary: ${selected.length} of ${tasks.length} tasks selected ` +
          `(a filtered subset is a diagnostic, not an arm)`,
      );
    }
    return 0;
  }

  if (command === "compare") {
    const fileA = values["arm-a"] ?? values["left"] ?? positionals[0];
    const fileB = values["arm-b"] ?? values["right"] ?? positionals[1];
    const labelA = values["left-label"] ?? values["arm-a-label"];
    const labelB = values["right-label"] ?? values["arm-b-label"];
    const outFile = values["out"];

    if (!fileA || !fileB) {
      io.err("chikory-bench compare: two summary.json inputs required");
      return 1;
    }
    let summaryA: SuiteSummary;
    let summaryB: SuiteSummary;
    try {
      summaryA = JSON.parse(readFileSync(resolve(fileA), "utf8")) as SuiteSummary;
      summaryB = JSON.parse(readFileSync(resolve(fileB), "utf8")) as SuiteSummary;
    } catch (err) {
      io.err(`chikory-bench compare: failed to read summary inputs: ${(err as Error).message}`);
      return 1;
    }

    try {
      const res = compareSummaries(summaryA, summaryB, {
        refA: fileA,
        refB: fileB,
        labelA,
        labelB,
      });

      if (outFile) {
        mkdirSync(dirname(resolve(outFile)), { recursive: true });
        writeFileSync(resolve(outFile), JSON.stringify(res, null, 2));
      }

      io.out(`Arm A (${res.armA.label}): ${fileA}`);
      io.out(
        `  I-SR: ${(res.armA.iSr * 100).toFixed(1)}% ` +
          `[95% CI: ${(res.armA.iSrCi.lower * 100).toFixed(1)}%, ${(res.armA.iSrCi.upper * 100).toFixed(1)}%] ` +
          `(${res.armA.requirementsSatisfied}/${res.armA.requirementsTotal})`,
      );
      io.out(
        `  D-SR: ${(res.armA.dSr * 100).toFixed(1)}% ` +
          `[95% CI: ${(res.armA.dSrCi.lower * 100).toFixed(1)}%, ${(res.armA.dSrCi.upper * 100).toFixed(1)}%] ` +
          `(${res.armA.dependencySatisfied}/${res.armA.requirementsTotal})`,
      );

      io.out(`Arm B (${res.armB.label}): ${fileB}`);
      io.out(
        `  I-SR: ${(res.armB.iSr * 100).toFixed(1)}% ` +
          `[95% CI: ${(res.armB.iSrCi.lower * 100).toFixed(1)}%, ${(res.armB.iSrCi.upper * 100).toFixed(1)}%] ` +
          `(${res.armB.requirementsSatisfied}/${res.armB.requirementsTotal})`,
      );
      io.out(
        `  D-SR: ${(res.armB.dSr * 100).toFixed(1)}% ` +
          `[95% CI: ${(res.armB.dSrCi.lower * 100).toFixed(1)}%, ${(res.armB.dSrCi.upper * 100).toFixed(1)}%] ` +
          `(${res.armB.dependencySatisfied}/${res.armB.requirementsTotal})`,
      );

      io.out(`Tasks (${res.taskIds.length}): ${res.taskIds.join(", ")}`);
      return 0;
    } catch (err) {
      io.err(`chikory-bench compare: ${(err as Error).message}`);
      return 1;
    }
  }

  io.err(`chikory-bench: unknown command '${command}'`);
  io.err(USAGE);
  return 1;
}
