#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args[0] === "--dry-run";
if (dryRun) args.shift();
const host = args.shift() ?? "macmini";
if (args.length || !/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(host)) throw new Error("Usage: node clients/codex/install.mjs [--dry-run] [ssh-host]");
const adapter = resolve(here, "../../server/dist/codex.js");
await access(adapter);
const source = await readFile(join(here, "gisul/SKILL.md"), "utf8");
const skillDir = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills/gisul");
const target = join(skillDir, "SKILL.md");
let exists = false;
try {
  const previous = await readFile(target, "utf8");
  if (previous !== source) throw new Error(`A different skill exists at ${target}; refusing to overwrite it`);
  exists = true;
} catch (error) { if (error.code !== "ENOENT") throw error; }
const command = ["mcp", "add", "gisul", "--", process.execPath, adapter, "--origin", host, "--", "ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "gisul"];
if (dryRun) {
  console.log(JSON.stringify({ skill: target, command: ["codex", ...command] }, null, 2));
} else {
  const existing = spawnSync("codex", ["mcp", "get", "gisul", "--json"], { encoding: "utf8" });
  if (existing.error) throw existing.error;
  let registered = false;
  if (existing.status === 0) {
    const registration = JSON.parse(existing.stdout);
    const desired = command.slice(4);
    registered = registration.transport?.command === desired[0] && JSON.stringify(registration.transport?.args) === JSON.stringify(desired.slice(1));
    if (!registered) throw new Error("A different gisul MCP registration already exists; inspect it with codex mcp get gisul before replacing it");
  }
  await mkdir(skillDir, { recursive: true });
  if (!exists) await writeFile(target, source, { flag: "wx" });
  if (!registered) {
    const result = spawnSync("codex", command, { stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error(`MCP registration failed; loader remains at ${target}. ${result.error ?? "Retry registration after correcting the CLI error."}`);
  }
  console.log(`Installed ${target}. Start a new Codex session and invoke $gisul.`);
}
