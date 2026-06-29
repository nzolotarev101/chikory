#!/usr/bin/env node
/**
 * `chikory` bin entry (WP-141) — thin shell around main(); everything
 * testable lives in main.ts/commands.ts.
 */

import { main } from "./main.js";

process.exitCode = await main(process.argv.slice(2));
