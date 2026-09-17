import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export function pluginSource(list, marketplace) {
  const entries = [...list.installed ?? [], ...list.available ?? []].filter(item => item.pluginId === `gisul@${marketplace}`);
  const paths = new Set(entries.map(item => item.source?.source === "local" ? item.source.path : undefined));
  if (paths.size !== 1 || ![...paths][0] || !isAbsolute([...paths][0]) || basename([...paths][0]) !== "gisul") throw new Error("Expected one confirmed local gisul source in this marketplace; inspect codex plugin list --available --json");
  return [...paths][0];
}

export async function verifyInstalled(list, marketplace, version, source, codexHome) {
  const matches = list.installed.filter(item => item.pluginId === `gisul@${marketplace}`);
  assert.equal(matches.length, 1, "Expected exactly one installed gisul plugin");
  assert.equal(matches[0].version, version, "Codex did not select the new plugin version");
  assert.equal(matches[0].enabled, true, "Gisul plugin is disabled");
  const cache = join(codexHome, "plugins/cache", marketplace, "gisul", version);
  for (const file of [".codex-plugin/plugin.json", ".mcp.json", "runtime/codex.mjs", "skills/gisul/SKILL.md"]) {
    assert.ok((await readFile(join(source, file))).equals(await readFile(join(cache, file))), `Installed ${file} differs from the built plugin`);
  }
  return cache;
}

export function isPluginTransport(registration, installed, marketplace, codexHome) {
  const plugin = installed.find(item => item.pluginId === `gisul@${marketplace}`);
  const cwd = registration.transport?.cwd;
  return !!plugin?.version && typeof cwd === "string" && resolve(cwd) === resolve(codexHome, "plugins/cache", marketplace, "gisul", plugin.version);
}

export function pluginConnection(args) {
  if (args[0] === "--http-url") {
    if (args.length !== 4 || args[2] !== "--bearer-token-file" || !isAbsolute(args[3])) throw new Error("HTTPS installation requires --http-url <https-url> --bearer-token-file <absolute-path>");
    const url = new URL(args[1]);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Expected a credential-free HTTPS endpoint");
    return { mode: "http", endpoint: url.href, tokenFile: args[3], args: ["runtime/codex.mjs", "--origin", url.origin, "--http-url", url.href, "--bearer-token-file", args[3]] };
  }
  const host = args[0] ?? "macmini";
  if (args.length > 1 || !/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(host)) throw new Error("Expected one SSH host or --http-url <https-url> --bearer-token-file <absolute-path>");
  return { mode: "stdio", host, args: ["runtime/codex.mjs", "--origin", host, "--", "ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "gisul"] };
}

export async function installPlugin(args) {
  const dryRun = args.includes("--dry-run");
  const positional = args.filter(arg => arg !== "--dry-run");
  const connection = pluginConnection(positional);
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const helpers = process.env.GISUL_PLUGIN_CREATOR ?? join(codexHome, "skills/.system/plugin-creator");
  const run = (command, commandArgs, options = {}) => {
    const result = spawnSync(command, commandArgs, { cwd: repo, encoding: "utf8", stdio: "pipe", timeout: 120000, ...options });
    if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.error ?? result.stderr ?? "see command output"}`);
    return result.stdout?.trim();
  };
  const helper = (name, ...values) => run("python3", [join(helpers, "scripts", name), ...values]);
  const marketplace = helper("read_marketplace_name.py");
  const list = () => JSON.parse(run("codex", ["plugin", "list", "--marketplace", marketplace, "--available", "--json"]));
  const before = list();
  const source = await realpath(pluginSource(before, marketplace));
  if (basename(source) !== "gisul") throw new Error("The resolved plugin directory must be named gisul");
  const previous = JSON.parse(await readFile(join(source, ".codex-plugin/plugin.json"), "utf8"));
  if (previous.name !== "gisul") throw new Error("The source manifest must identify gisul");
  helper("validate_plugin.py", source);
  if (dryRun) {
    console.log(JSON.stringify({ marketplace, source, connection, command: ["codex", "plugin", "add", `gisul@${marketplace}`, "--json"], verification: "selected version, installed file hashes, fresh MCP smoke" }, null, 2));
    return;
  }
  const standalone = spawnSync("codex", ["mcp", "get", "gisul", "--json"], { encoding: "utf8" });
  if (standalone.error) throw standalone.error;
  // Recent Codex versions also return plugin-provided servers from `mcp get`.
  if (standalone.status === 0 && !isPluginTransport(JSON.parse(standalone.stdout), before.installed, marketplace, codexHome)) throw new Error("A standalone gisul MCP registration exists; resolve the duplicate before installing the plugin");
  const work = await mkdtemp(join(tmpdir(), "gisul-plugin-build-"));
  const stage = join(work, "gisul");
  let backup;
  let promoted = false;
  try {
    run("npm", ["run", "build:codex-plugin"], { cwd: join(repo, "server"), stdio: "inherit" });
    await cp(join(repo, "clients/codex/plugin/gisul"), stage, { recursive: true, filter: path => ![".gitignore", ".DS_Store"].includes(basename(path)) });
    // Preserve machine-specific MCP environment settings while updating the command.
    const configuration = JSON.parse(await readFile(join(stage, ".mcp.json"), "utf8"));
    const existingConfig = JSON.parse(await readFile(join(source, ".mcp.json"), "utf8"));
    configuration.mcpServers.gisul.env = { ...configuration.mcpServers.gisul.env, ...existingConfig.mcpServers?.gisul?.env };
    configuration.mcpServers.gisul.args = connection.args;
    await writeFile(join(stage, ".mcp.json"), JSON.stringify(configuration, null, 2) + "\n");
    helper("update_plugin_cachebuster.py", stage);
    helper("validate_plugin.py", stage);
    const version = JSON.parse(await readFile(join(stage, ".codex-plugin/plugin.json"), "utf8")).version;
    if (version === previous.version) throw new Error("Cachebuster collision; wait until the next second before rerunning");
    run(process.execPath, [join(repo, "server/smoke-codex-plugin.mjs"), stage], { stdio: "inherit" });
    const backupRoot = await mkdtemp(join(dirname(source), ".gisul-backup-"));
    backup = join(backupRoot, "gisul");
    await cp(source, backup, { recursive: true });
    // Keep the marketplace source path stable. Do not edit cache, TOML, or marketplace files.
    for (const file of [".codex-plugin", ".mcp.json", "runtime", "skills", "LICENSE"]) {
      await rm(join(source, file), { recursive: true, force: true });
      await cp(join(stage, file), join(source, file), { recursive: true });
    }
    promoted = true;
    let installError;
    try { run("codex", ["plugin", "add", `gisul@${marketplace}`, "--json"]); } catch (error) { installError = error; }
    // Re-query before doing anything else after a failed/ambiguous write.
    let cache;
    try { cache = await verifyInstalled(list(), marketplace, version, source, codexHome); }
    catch (error) { throw new Error(`${installError ?? error}; source backup: ${backup}. Inspect the installed version before retrying.`); }
    run(process.execPath, [join(repo, "server/smoke-codex-plugin.mjs"), cache], { stdio: "inherit" });
    console.log(JSON.stringify({ plugin: `gisul@${marketplace}`, version, source, cache, backup, verified: true, next: "Start a new Codex thread to pick up the updated tools" }));
  } catch (error) {
    if (backup && !promoted) {
      for (const file of [".codex-plugin", ".mcp.json", "runtime", "skills", "LICENSE"]) {
        await rm(join(source, file), { recursive: true, force: true });
        await cp(join(backup, file), join(source, file), { recursive: true });
      }
    }
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}
