/**
 * DevAI original-55 loader (WP-301) — parses the upstream instance JSON
 * (metauto-ai/agent-as-a-judge `benchmark/devai/instances/*.json`) into the
 * unified `BenchmarkTask` shape. 55 tasks / 365 requirements; requirements
 * are natural-language criteria graded by an LLM judge (grading kind `judge`).
 */
import { z } from "zod";

import type { BenchmarkTask } from "./task.js";

const DevAIRequirement = z.object({
  requirement_id: z.number().int().nonnegative(),
  prerequisites: z.array(z.number().int().nonnegative()),
  criteria: z.string().min(1),
  category: z.string().optional(),
  satisfied: z.unknown().optional(),
});

const DevAIPreference = z.object({
  preference_id: z.number().int().nonnegative(),
  criteria: z.string().min(1),
  satisfied: z.unknown().optional(),
});

/** Upstream shape; unknown extra keys tolerated (dataset is not ours). */
export const DevAITaskSchema = z
  .object({
    name: z.string().min(1),
    query: z.string().min(1),
    tags: z.array(z.string()).default([]),
    requirements: z.array(DevAIRequirement).min(1),
    preferences: z.array(DevAIPreference).default([]),
  })
  .passthrough();

export class DevAIParseError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid DevAI instance ${file}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "DevAIParseError";
  }
}

export function parseDevAITask(jsonText: string, file: string): BenchmarkTask {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new DevAIParseError(file, [`JSON parse error: ${(err as Error).message}`]);
  }
  const parsed = DevAITaskSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DevAIParseError(
      file,
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const t = parsed.data;

  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(t)) {
    if (key.startsWith("is_") && typeof value === "boolean") flags[key] = value;
  }

  return {
    id: t.name,
    source: "devai",
    class: "greenfield",
    status: "pinned",
    goal: t.query,
    requirements: t.requirements.map((r) => ({
      id: `R${r.requirement_id}`,
      description: r.criteria,
      prerequisites: r.prerequisites.map((p) => `R${p}`),
      grading: { kind: "judge", criteria: r.criteria },
      category: r.category,
    })),
    preferences: t.preferences.map((p) => ({ id: `P${p.preference_id}`, description: p.criteria })),
    tags: t.tags,
    flags,
  };
}

export interface FetchDevAIDeps {
  fetchImpl?: typeof fetch;
}

export interface FetchedInstance {
  name: string;
  sha: string;
  content: string;
}

const DEVAI_REPO = "metauto-ai/agent-as-a-judge";
const DEVAI_PATH = "benchmark/devai/instances";

/**
 * Download the 55 upstream instance JSONs at `ref`. Returns file contents +
 * upstream blob shas so the caller can write a reproducibility manifest.
 */
export async function fetchDevAIInstances(
  ref = "main",
  deps: FetchDevAIDeps = {},
): Promise<FetchedInstance[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listUrl = `https://api.github.com/repos/${DEVAI_REPO}/contents/${DEVAI_PATH}?ref=${ref}`;
  const listRes = await fetchImpl(listUrl, { headers: { accept: "application/vnd.github+json" } });
  if (!listRes.ok) throw new Error(`DevAI list failed: ${listRes.status} ${listUrl}`);
  const listing = (await listRes.json()) as { name: string; sha: string; download_url: string }[];
  const files = listing.filter((f) => f.name.endsWith(".json"));

  const out: FetchedInstance[] = [];
  for (const f of files) {
    const res = await fetchImpl(f.download_url);
    if (!res.ok) throw new Error(`DevAI fetch failed: ${res.status} ${f.download_url}`);
    out.push({ name: f.name, sha: f.sha, content: await res.text() });
  }
  return out;
}
