import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const parse = result => { assert.ok(!result.isError, JSON.stringify(result.content)); return JSON.parse(result.content[0].text); };
export async function smokeServer({ root, env = process.env, httpUrl }) {
  const upstream = new Client({ name: "gisul-deploy-smoke", version: "1" });
  const bridge = new Client({ name: "gisul-deploy-bridge-smoke", version: "1" });
  const http = new Client({ name: "gisul-deploy-http-smoke", version: "1" });
  const transports = [];
  const transport = args => {
    const result = new StdioClientTransport({ command: process.execPath, args, env, stderr: "pipe", maxBufferSize: 32 * 1024 * 1024 });
    result.stderr?.on("data", () => {});
    transports.push(result);
    return result;
  };
  try {
    await upstream.connect(transport([join(root, "dist/index.js")]));
    assert.ok(upstream.getServerCapabilities()?.extensions?.["io.modelcontextprotocol/skills"]);
    const schema = z.object({ skills: z.array(z.object({ uri: z.string() })), _meta: z.record(z.string(), z.unknown()).optional() });
    const catalog = await upstream.request({ method: "skills/list", params: {} }, schema);
    assert.ok(catalog.skills.length > 1, "Pagination smoke needs at least two valid skills");
    await bridge.connect(transport([join(root, "dist/codex.js"), "--origin", "deployment", "--", process.execPath, join(root, "dist/index.js")]));
    const first = parse(await bridge.callTool({ name: "search_skills", arguments: { limit: 1 } }));
    assert.equal(first.nextOffset, 1);
    const second = parse(await bridge.callTool({ name: "search_skills", arguments: { limit: 1, offset: first.nextOffset } }));
    assert.equal(second.offset, 1);
    assert.notEqual(first.skills[0].uri, second.skills[0].uri);
    const loaded = parse(await bridge.callTool({ name: "load_skill", arguments: { uri: first.skills[0].uri } }));
    const reread = parse(await bridge.callTool({ name: "read_skill_file", arguments: { skill_uri: loaded.uri, uri: loaded.uri } }));
    assert.equal(loaded.markdown, reread.text);
    if (httpUrl) {
      const token = env.GISUL_BEARER_TOKEN ?? (env.GISUL_BEARER_TOKEN_FILE ? (await readFile(env.GISUL_BEARER_TOKEN_FILE, "utf8")).trim() : undefined);
      await http.connect(new StreamableHTTPClientTransport(new URL(httpUrl), { requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined }));
      const served = await http.request({ method: "skills/list", params: {} }, schema);
      assert.deepEqual(served.skills.map(skill => skill.uri).sort(), catalog.skills.map(skill => skill.uri).sort());
    }
    return { serverVersion: upstream.getServerVersion(), release: catalog._meta?.release ?? null, skills: first.totalMatches, nextOffset: first.nextOffset, verifiedRead: true, http: !!httpUrl };
  } finally {
    await Promise.allSettled([http.close(), bridge.close(), upstream.close(), ...transports.map(item => item.close())]);
  }
}
