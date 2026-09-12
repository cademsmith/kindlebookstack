// Runs the Hardcover -> Shelfarr bridge for EVERY user, one process each.
//
// It runs:
//   - the base .env user (data/state.json), if a base .env exists, and
//   - every profiles/*.env user (data/state.<name>.json).
//
// Each user runs in its own child process with its own state file, so a big shelf or a bad
// token for one user never affects the others. Any flags you pass are forwarded to each run.
//
// Usage:
//   node scripts/run-all.mjs                 # live run for all users
//   node scripts/run-all.mjs --dry-run       # dry run for all users
//   node scripts/run-all.mjs --reset         # reset ALL users' state (rarely what you want;
//                                            # to reset one user: node scripts/bridge.mjs --profile <name> --reset)
import { readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ENV } from "../lib/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, "..", "profiles");
const BRIDGE = path.join(__dirname, "bridge.mjs");
const passthrough = process.argv.slice(2).filter((a) => a.startsWith("--"));

const profiles = existsSync(PROFILES_DIR)
  ? readdirSync(PROFILES_DIR)
      .filter((f) => f.endsWith(".env"))
      .map((f) => f.replace(/\.env$/, ""))
      .sort()
  : [];

// Each entry is the argv passed to bridge.mjs. [] == the base .env user.
const runs = [];
if (existsSync(BASE_ENV)) runs.push([]);
for (const p of profiles) runs.push(["--profile", p]);

if (!runs.length) {
  console.error("No users configured: create a base .env or add profiles/<name>.env files.");
  process.exit(1);
}

function run(bridgeArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BRIDGE, ...bridgeArgs, ...passthrough], { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

let failures = 0;
for (const bridgeArgs of runs) {
  const label = bridgeArgs[0] === "--profile" ? bridgeArgs[1] : "(base .env)";
  console.log(`\n==== user: ${label} ====`);
  const code = await run(bridgeArgs);
  if (code !== 0) failures++;
}

console.log(`\nAll users done. ${runs.length - failures}/${runs.length} succeeded.`);
process.exit(failures ? 1 : 0);
