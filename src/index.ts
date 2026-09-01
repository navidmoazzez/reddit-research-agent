#!/usr/bin/env node
/**
 * Entry point: `reddit-research-agent` (stdio) and `reddit-research-agent doctor`.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { RedditClient } from "./client.js";
import { VERSION, loadConfig } from "./config.js";
import * as doctor from "./doctor.js";
import { buildServer } from "./server.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args[0] === "-v" || args[0] === "--version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const config = loadConfig();

  if (args[0] === "doctor") {
    const report = await doctor.run(config, new RedditClient(config));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  // stdout carries the JSON-RPC stream, so nothing else may be written to it.
  await buildServer(config).connect(new StdioServerTransport());
  return 0;
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
