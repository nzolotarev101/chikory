#!/usr/bin/env node
/**
 * `chikory` bin entry (WP-141) — thin shell around main(); everything
 * testable lives in main.ts/commands.ts.
 */

// Suppress SQLite experimental warning
const originalEmitWarning = process.emitWarning;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.emitWarning = function (warning: string | Error, ...args: any[]) {
  if (typeof warning === "string" && warning.includes("SQLite is an experimental feature")) {
    return;
  }
  if (warning instanceof Error && warning.message.includes("SQLite is an experimental feature")) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return originalEmitWarning.apply(process, [warning, ...args] as any);
};

import { main } from "./main.js";

process.exitCode = await main(process.argv.slice(2));
