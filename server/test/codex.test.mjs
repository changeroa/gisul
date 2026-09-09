import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexBridge } from "../dist/codex.js";

test("Codex bridge searches metadata, loads exact identity and pins supporting files", async () => {
  const uri = "skill://gisul/root0/review/SKILL.md";
  const otherUri = "skill://gisul/root1/review/SKILL.md";
  const file = "skill://gisul/root0/review/references/guide.md";
  const markdown = "---\nname: review\ndescription: Team review\n---\nRead references/guide.md.\n";
  const bodies = new Map([[uri, markdown], [file, "Original guide"]]);
  const manifest = () => [...bodies].map(([uri, text]) => ({ uri, size: Buffer.byteLength(text), digest: `sha256:${createHash("sha256").update(text).digest("hex")}` }));
  let entry = { uri, frontmatter: { name: "review", description: "Team review" }, resources: manifest() };
  const reads = [];
  const upstream = {
    request: async ({ method, params }) => {
      if (method === "skills/list") return { skills: [entry, { ...entry, uri: otherUri, resources: [{ ...entry.resources[0], uri: otherUri }] }] };
      assert.equal(params.uri, uri);
      return { skill: entry };
    },
    readResource: async ({ uri }) => { reads.push(uri); return { contents: [{ uri, text: bodies.get(uri) }] }; },
  };
  const server = createCodexBridge(upstream, "macmini");
  const client = new Client({ name: "test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back);
  await client.connect(front);
  const call = (name, args) => client.callTool({ name, arguments: args });
  const data = result => JSON.parse(result.content[0].text);
  try {
    const found = data(await call("search_skills", { query: "review" }));
    assert.equal(found.skills.length, 2);
    assert.notEqual(found.skills[0].uri, found.skills[1].uri);
    assert.equal(reads.length, 0, "discovery must not read file bodies");
    assert.equal((await call("read_skill_file", { skill_uri: uri, uri: file })).isError, true);
    const loaded = data(await call("load_skill", { uri }));
    assert.equal(loaded.origin, "macmini");
    assert.equal(loaded.markdown, markdown);
    assert.deepEqual(reads, [uri], "load does not prefetch supporting files");
    assert.equal(data(await call("read_skill_file", { skill_uri: uri, uri: file })).text, "Original guide");
    const readCount = reads.length;
    assert.equal((await call("read_skill_file", { skill_uri: uri, uri: otherUri })).isError, true);
    assert.equal(reads.length, readCount, "off-manifest URI is rejected before fetching");
    bodies.set(file, "Changed guide!");
    assert.equal((await call("read_skill_file", { skill_uri: uri, uri: file })).isError, true);
    entry = { ...entry, resources: manifest() };
    assert.equal(data(await call("load_skill", { uri })).changed, true);
    assert.equal(data(await call("read_skill_file", { skill_uri: uri, uri: file })).text, "Changed guide!");
    entry = { ...entry, frontmatter: { name: "review", description: "Misleading description" } };
    assert.equal((await call("load_skill", { uri })).isError, true);
  } finally { await client.close(); await server.close(); }
});

test("Codex stdio adapter interoperates with the real gisul server", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "gisul-codex-test-"));
  const client = new Client({ name: "codex-smoke", version: "1" });
  try {
    await mkdir(join(root, "example"));
    await writeFile(join(root, "example/SKILL.md"), "---\nname: example\ndescription: Test workflow\n---\nFollow the test workflow.\n");
    const adapter = fileURLToPath(new URL("../dist/codex.js", import.meta.url));
    const upstream = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [adapter, "--origin", "fixture-host", "--", "env", `GISUL_SKILLS_DIRS=${root}`, process.execPath, upstream] }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["load_skill", "read_skill_file", "search_skills"]);
    const result = await client.callTool({ name: "search_skills", arguments: { query: "workflow" } });
    assert.ok(!result.isError, JSON.stringify(result));
    const found = JSON.parse(result.content[0].text);
    assert.equal(found.skills.length, 1);
    const loaded = await client.callTool({ name: "load_skill", arguments: { uri: found.skills[0].uri } });
    assert.ok(!loaded.isError, JSON.stringify(loaded));
    assert.equal(JSON.parse(loaded.content[0].text).origin, "fixture-host");
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});
