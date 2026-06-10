/**
 * Boots one ephemeral Temporal dev server (the devbox-pinned `temporal`
 * CLI) and pre-bundles the workflow code once for all runner suites.
 * When the binary is missing (running outside devbox) the suites skip —
 * same convention as the provider integration tests.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TestProject } from "vitest/node";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      srv.close(() => resolve(addr.port));
    });
  });
}

async function waitForServer(address: string): Promise<void> {
  const { Connection } = await import("@temporalio/client");
  for (let i = 0; i < 120; i++) {
    try {
      const conn = await Connection.connect({ address, connectTimeout: "2 seconds" });
      await conn.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Temporal dev server at ${address} never became healthy`);
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const probe = spawnSync("temporal", ["--version"], { stdio: "ignore" });
  if (probe.error) {
    console.warn(
      "runner tests: `temporal` CLI not found — skipping (run via devbox: `devbox run test`)",
    );
    project.provide("temporalAddress", null);
    project.provide("workflowBundlePath", null);
    return async () => {};
  }

  const port = await freePort();
  const address = `127.0.0.1:${port}`;
  const server: ChildProcess = spawn(
    "temporal",
    ["server", "start-dev", "--headless", "--port", String(port), "--log-level", "error"],
    { stdio: "ignore" },
  );
  await waitForServer(address);

  const { bundleWorkflowCode } = await import("@temporalio/worker");
  const bundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(new URL("../../src/workflow/agent-loop.ts", import.meta.url)),
  });
  const bundleDir = mkdtempSync(join(tmpdir(), "chikory-wf-bundle-"));
  const bundlePath = join(bundleDir, "workflow-bundle.js");
  writeFileSync(bundlePath, bundle.code);

  project.provide("temporalAddress", address);
  project.provide("workflowBundlePath", bundlePath);

  return async () => {
    server.kill("SIGKILL");
    rmSync(bundleDir, { recursive: true, force: true });
  };
}
