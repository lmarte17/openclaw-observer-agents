// One-off test runner — invoke directly with Node.js
// Usage: node run-test.mjs [optional-session-file-path]
import path from "node:path";
import os from "node:os";
import { runObserverPipeline } from "./lib/runner.js";

const homeDir = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const apiKey = process.env.GEMINI_API_KEY;
const sessionFile = process.argv[2] || null;

if (!apiKey) {
  console.error("Error: GEMINI_API_KEY environment variable is not set");
  process.exit(1);
}

console.log(`Home:  ${homeDir}`);
console.log(`Model: gemini-3.1-flash-lite-preview`);
console.log(`File:  ${sessionFile || "(scan all unprocessed)"}\n`);

const result = await runObserverPipeline({
  homeDir,
  agentId: "main",
  model: "gemini-3.1-flash-lite-preview",
  apiKey,
  logger: (level, msg) => console.log(`[${level}] ${msg}`),
  sessionFile
});

console.log("\n--- Result ---");
console.log(`Processed:  ${result.processed}`);
console.log(`Skipped:    ${result.skipped}`);
console.log(`Candidates: ${result.candidates}`);
if (result.errors.length) {
  console.log(`Errors:`);
  result.errors.forEach(e => console.log(`  [${e.stage}] ${e.file}: ${e.error}`));
}
