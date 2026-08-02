#!/usr/bin/env node
/**
 * Agent class liveness probe (WP-575) — the $0 guard.
 *
 * Every other check in this repo validates the agent classes on PAPER: the
 * registry loader proves the shape, the price table, the adapter/vendor
 * pairing. None of that proves the thing that actually strands an 18-hour
 * chain: a model id the CLI rejects, or a CLI that is logged out. Those only
 * surface when the rotation fires — six hours in, at the exact moment the run
 * needed a peer.
 *
 * So before a launch spends anything, this spawns EVERY member's real binary
 * with a trivial prompt and requires exit 0. A member that cannot answer "reply
 * OK" cannot take over a run.
 *
 * Usage:
 *   node scripts/probe-agent-classes.mjs [spec.yaml]
 *
 * With a spec, probes only the classes that spec names; with none, probes every
 * class in the registry. Exits 0 when all members answer, 4 when any does not
 * (naming it), 2 on a configuration error.
 *
 * Env:
 *   CHIKORY_PROBE_TIMEOUT_MS   per-member timeout (default 90000)
 *   CHIKORY_AGENT_CLASSES      registry path (default agent-classes.yaml)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { dispatchFor, mapAgyModel, splitCodexModel } from "./cli-judge-proxy.mjs";

// pnpm keeps a strict node_modules tree, so `yaml` is not hoisted to the repo
// root — resolve it out of the SDK's own dependencies rather than adding a
// root-level dependency just for this script.
const { parse: parseYaml } = createRequire(
  new URL("../packages/sdk-ts/package.json", import.meta.url),
)("yaml");

const PROMPT = "reply with exactly: OK";
const TIMEOUT_MS = Number(process.env["CHIKORY_PROBE_TIMEOUT_MS"] ?? 90_000);
const REGISTRY_PATH = process.env["CHIKORY_AGENT_CLASSES"] ?? "agent-classes.yaml";

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function loadRegistry() {
  let text;
  try {
    text = readFileSync(REGISTRY_PATH, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseYaml(text);
  if (!parsed || typeof parsed !== "object" || typeof parsed.classes !== "object") {
    fail(2, `[probe] ${REGISTRY_PATH} has no \`classes:\` map`);
  }
  return parsed.classes;
}

function membersOf(agentClass) {
  return [agentClass.primary, ...(agentClass.adjacent ?? [])].filter(Boolean);
}

/**
 * The binary + argv that exercises this member the same way a real run would.
 * Executor members are pinned by their ADAPTER; judge members ride one
 * transport, so the CLI is chosen by model name exactly as the proxy does it.
 */
function probeCommand(member, role) {
  const cli =
    role === "executor"
      ? { "gemini-cli": "agy", codex: "codex", "claude-code": "claude" }[member.adapter]
      : dispatchFor(member.model, "codex");

  switch (cli) {
    case "agy":
      return { bin: "agy", args: ["--print", PROMPT, "--model", mapAgyModel(member.model)] };
    case "codex": {
      // Same argv shape the judge proxy builds, including the effort split —
      // `-m "gpt-5.6-sol xhigh"` is rejected by codex, so probing the joined
      // form would fail a member that actually works.
      const { model: modelName, effort } = splitCodexModel(member.model);
      return {
        bin: "codex",
        args: [
          "exec",
          "--skip-git-repo-check",
          "-s",
          "read-only",
          "-c",
          'approval_policy="never"',
          "-m",
          modelName,
          ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
          PROMPT,
        ],
      };
    }
    case "claude":
      return {
        bin: "claude",
        args: ["-p", PROMPT, "--max-turns", "1", "--model", member.model],
      };
    default:
      return undefined;
  }
}

function run(bin, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, detail: `spawn failed: ${err.message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, detail: `no answer within ${TIMEOUT_MS}ms` });
    }, TIMEOUT_MS);

    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, detail: `cannot run \`${bin}\`: ${err.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      const tail = (stderr.trim() || stdout.trim()).slice(-300).replace(/\s+/g, " ");
      resolve(
        code === 0
          ? { ok: true, detail: stdout.trim().slice(0, 60).replace(/\s+/g, " ") }
          : { ok: false, detail: `exit ${code}: ${tail}` },
      );
    });
  });
}

async function main() {
  const specPath = process.argv[2];
  const classes = loadRegistry();
  if (classes === undefined) {
    console.log(`[probe] no ${REGISTRY_PATH} — nothing declared, nothing to probe`);
    return;
  }

  // Which classes does this launch actually use? Probing the whole registry
  // when a spec names two of its classes would spend turns on agents this run
  // will never touch.
  let wanted = Object.keys(classes);
  if (specPath !== undefined) {
    let spec;
    try {
      spec = parseYaml(readFileSync(specPath, "utf8"));
    } catch (err) {
      fail(2, `[probe] cannot read spec ${specPath}: ${err.message}`);
    }
    const named = Object.values(spec?.agent_classes ?? {}).filter(
      (v) => typeof v === "string",
    );
    if (named.length === 0) {
      console.log(`[probe] ${specPath} names no agent_classes — nothing to probe`);
      return;
    }
    wanted = named;
  }

  const failures = [];
  let probed = 0;
  for (const classId of wanted) {
    const agentClass = classes[classId];
    if (agentClass === undefined) {
      failures.push(`class '${classId}' is referenced but not declared in ${REGISTRY_PATH}`);
      continue;
    }
    for (const member of membersOf(agentClass)) {
      const command = probeCommand(member, agentClass.role);
      if (command === undefined) {
        // `native` and caller-registered adapters have no binary to probe.
        console.log(`[probe] ${classId}/${member.id}: SKIP (no CLI binary)`);
        continue;
      }
      probed++;
      // Sequential on purpose: three CLIs starting at once race each other's
      // config and make a timeout ambiguous.
      const result = await run(command.bin, command.args);
      if (result.ok) {
        console.log(`[probe] ✅ ${classId}/${member.id} (${command.bin} ${member.model})`);
      } else {
        console.log(`[probe] ❌ ${classId}/${member.id} (${command.bin} ${member.model})`);
        failures.push(
          `${classId}/${member.id}: \`${command.bin}\` with model '${member.model}' — ${result.detail}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("");
    console.error(`[probe] ${failures.length} of ${probed} agent class members are NOT usable:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("");
    console.error(
      "A member that cannot answer a trivial prompt cannot take over when the primary is\n" +
        "walled — the run would rotate INTO a second failure hours from now. Fix the model id,\n" +
        "log the CLI in, or remove the member from agent-classes.yaml.\n" +
        "Override (accepts the risk): CHIKORY_ALLOW_UNPROBED_MEMBERS=1",
    );
    process.exit(4);
  }

  console.log(`[probe] all ${probed} agent class member(s) answered`);
}

await main();
