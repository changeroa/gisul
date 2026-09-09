import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] ?? "../clients/codex/plugin/gisul");
const config = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")).mcpServers.gisul;
const client = new Client({ name: "gisul-plugin-smoke", version: "1" });
try {
  await client.connect(new StdioClientTransport({ ...config, cwd: root, stderr: "pipe" }));
  const parseResult = result => {
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
  };
  const found = parseResult(await client.callTool({ name: "search_skills", arguments: { limit: 1 } }));
  if (!found.skills.length) throw new Error("No skills returned from upstream");
  const loaded = parseResult(await client.callTool({ name: "load_skill", arguments: { uri: found.skills[0].uri } }));
  const reread = parseResult(await client.callTool({ name: "read_skill_file", arguments: { skill_uri: loaded.uri, uri: loaded.uri } }));
  if (loaded.markdown !== reread.text) throw new Error("Read mismatch");
  console.log(JSON.stringify({ origin: found.origin, matches: found.totalMatches, loaded: loaded.uri, verifiedRead: true }));
} finally { await client.close(); }
