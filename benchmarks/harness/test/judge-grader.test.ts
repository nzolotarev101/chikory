import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const mockState = {
  value: null as string | null,
};

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mkdtempSync: (prefix: string, options?: any) => {
      if (mockState.value !== null) {
        return mockState.value;
      }
      return original.mkdtempSync(prefix, options);
    },
  };
});

import {
  buildEvidence,
  commandComplete,
  makeJudgeGrader,
  parseJudgeReply,
  referencedPaths,
} from "../src/judge-grader.js";

describe("referencedPaths", () => {
  it("extracts file-shaped backtick refs from a real DevAI criterion", () => {
    expect(
      referencedPaths('The "Fashion-MNIST" dataset is loaded in `src/data_loader.py`.'),
    ).toEqual(["src/data_loader.py"]);
    expect(referencedPaths("saved as `fashionnet.pt` in `models/saved_models/`.")).toEqual([
      "fashionnet.pt",
      "models/saved_models/",
    ]);
    // bare dotted library names are not file-shaped (long "extension") — filtered
    expect(referencedPaths("uses `torchvision.transforms` for augmentation")).toEqual([]);
  });
});

describe("buildEvidence", () => {
  it("includes the tree and the contents of referenced files", () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ev-"));
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src", "data_loader.py"), "import torchvision # augmentation");
    const evidence = buildEvidence("loaded in `src/data_loader.py`", ws);
    expect(evidence).toContain("src/data_loader.py");
    expect(evidence).toContain("import torchvision");
  });

  it("notes referenced files that are absent", () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-ev-"));
    const evidence = buildEvidence("model saved to `models/saved_models/net.pt`", ws);
    expect(evidence).toContain("(not found in workspace)");
  });
});

describe("parseJudgeReply", () => {
  it("parses a clean verdict and one wrapped in prose", () => {
    expect(parseJudgeReply('{"satisfied": true, "rationale": "seen"}')).toEqual({
      satisfied: true,
      rationale: "seen",
    });
    expect(
      parseJudgeReply('Sure! Here is my verdict: {"satisfied": false, "rationale": "absent"} hope that helps'),
    ).toEqual({ satisfied: false, rationale: "absent" });
  });

  it("fails closed on garbage", () => {
    const verdict = parseJudgeReply("I cannot answer that");
    expect(verdict.satisfied).toBe(false);
    expect(verdict.rationale).toMatch(/unparseable/);
  });
});

describe("makeJudgeGrader + commandComplete", () => {
  it("round-trips through a real subprocess judge (cat the prompt, reply via jq-free echo)", async () => {
    const ws = mkdtempSync(join(tmpdir(), "bench-judge-"));
    writeFileSync(join(ws, "impl.py"), "print('hi')");
    // A "judge" that proves the prompt file reached it, then emits a verdict.
    const complete = commandComplete(
      `grep -q "impl.py" {promptFile} && echo '{"satisfied": true, "rationale": "file present in evidence"}'`,
    );
    const judge = makeJudgeGrader(complete);
    const verdict = await judge({ criteria: "code lives in `impl.py`", workspaceDir: ws });
    expect(verdict).toEqual({ satisfied: true, rationale: "file present in evidence" });
  });

  it("rejects when the judge command fails", async () => {
    const complete = commandComplete("exit 3");
    await expect(complete({ system: "s", user: "u" })).rejects.toThrow(/exit 3/);
  });

  it("prevents command injection even if the directory path contains special characters", async () => {
    // Create a real directory that contains spaces, single/double quotes, and semicolons.
    const parentDir = mkdtempSync(join(tmpdir(), "chikory-bench-judge-"));
    const injectionDirName = "evil dir; echo INJECTED_BAD_CMD; '\"";
    const maliciousDir = join(parentDir, injectionDirName);
    mkdirSync(maliciousDir, { recursive: true });

    // Mock mkdtempSync to return this specific malicious directory
    mockState.value = maliciousDir;

    try {
      // If we had command injection, the command execution would fail or be hijacked.
      // With our safe positional parameter solution, the path is correctly passed as a single argument.
      const complete = commandComplete("cat {promptFile}");
      const result = await complete({ system: "SECURE", user: "SYSTEM" });
      expect(result).toContain("SECURE\n\nSYSTEM\n");
    } finally {
      mockState.value = null;
    }
  });

  it("safely substitutes {promptFile} as positional parameter $1 using replacer function", async () => {
    const complete = commandComplete('echo "file is $1" && cat "$1"');
    const result = await complete({ system: "SYS", user: "USR" });
    expect(result).toContain("file is /");
    expect(result).toContain("SYS\n\nUSR\n");
  });
});
