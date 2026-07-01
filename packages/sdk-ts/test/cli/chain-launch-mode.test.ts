import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cmdChain } from "../../src/cli/chain.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env["CHIKORY_ALLOW_LAUNCH_MODE_MISMATCH"];
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function writeSpec(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "chikory-chain-launch-mode-"));
  tempDirs.push(dir);
  const file = join(dir, "task.yaml");
  await writeFile(file, text);
  return file;
}

describe("cmdChain launch-mode guard", () => {
  it("refuses a single-run-authored spec launched as a chain", async () => {
    const file = await writeSpec("# Launch with `chikory run`, NOT a chain.\nnot: parsed\n");
    const out: string[] = [];
    const err: string[] = [];

    const code = await cmdChain(
      {
        file,
        watch: false,
        json: false,
        dataDir: join(tempDirs[0]!, "data"),
        address: "127.0.0.1:7233",
      },
      {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      },
    );

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("WARNING");
    expect(err[0]).toContain("launch mode mismatch");
    expect(err[0]).toContain("single `chikory run`");
    expect(err[0]).toContain("chikory chain");
  });
});
