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

test("Codex search exposes every filtered match across upstream and result pages", async () => {
  const entries = Array.from({ length: 125 }, (_, index) => {
    const uri = `skill://gisul/root${String(index).padStart(3, "0")}/review/SKILL.md`;
    return {
      uri,
      frontmatter: { name: "review", description: index < 123 ? "Team review" : "Other workflow" },
      resources: [{ uri, size: 0, digest: `sha256:${createHash("sha256").update("").digest("hex")}` }],
    };
  });
  const requests = [];
  const upstream = {
    request: async ({ method, params }) => {
      assert.equal(method, "skills/list");
      requests.push(params);
      const offset = params.cursor ? Number(params.cursor) : 0;
      const end = offset + 17;
      return { skills: entries.slice().reverse().slice(offset, end), ...(end < entries.length ? { nextCursor: String(end) } : {}) };
    },
    readResource: async () => { assert.fail("search must not read skill bodies"); },
  };
  const server = createCodexBridge(upstream, "fixture-host");
  const client = new Client({ name: "pagination-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back);
  await client.connect(front);
  const search = async args => {
    const result = await client.callTool({ name: "search_skills", arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  try {
    const query = " TEAM   review ";
    const defaults = await search({ query });
    assert.equal(defaults.offset, 0);
    assert.equal(defaults.limit, 5);
    assert.equal(defaults.skills.length, 5);
    assert.equal(defaults.nextOffset, 5);
    assert.deepEqual(requests, [{}, ...[17, 34, 51, 68, 85, 102, 119].map(cursor => ({ cursor: String(cursor) }))]);

    const collected = [];
    let offset = 0;
    for (const size of [50, 50, 23]) {
      const page = await search({ query, limit: 50, offset });
      assert.equal(page.origin, "fixture-host");
      assert.equal(page.totalMatches, 123);
      assert.equal(page.offset, offset);
      assert.equal(page.limit, 50);
      assert.equal(page.skills.length, size);
      collected.push(...page.skills.map(skill => skill.uri));
      if (size === 50) assert.equal(page.nextOffset, offset + size);
      else assert.ok(!Object.hasOwn(page, "nextOffset"));
      offset = page.nextOffset;
    }
    assert.deepEqual(collected, entries.slice(0, 123).map(entry => entry.uri));
    assert.equal(new Set(collected).size, 123, "same-named skills are neither skipped nor duplicated");
    assert.equal((await search({ limit: 50 })).totalMatches, 125);
    assert.equal((await search({ query, offset: 73, limit: 50 })).nextOffset, undefined, "an exactly full final page terminates");
    for (const args of [{ query, offset: 123 }, { query, offset: 124 }, { query, offset: Number.MAX_SAFE_INTEGER }, { query: "missing" }]) {
      const page = await search(args);
      assert.deepEqual(page.skills, []);
      assert.equal(page.totalMatches, args.query === "missing" ? 0 : 123);
      assert.ok(!Object.hasOwn(page, "nextOffset"));
    }

    const requestCount = requests.length;
    for (const args of [
      ...[-1, 0.5, "50", null, true, Number.MAX_SAFE_INTEGER + 1].map(offset => ({ offset })),
      ...[0, -1, 51, 1.5, "10", null].map(limit => ({ limit })),
    ]) {
      const result = await client.callTool({ name: "search_skills", arguments: args });
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.match(result.content[0].text, /Input validation error/);
    }
    assert.equal(requests.length, requestCount, "invalid pagination is rejected before upstream requests");
  } finally { await client.close(); await server.close(); }
});

test("Codex search ranks across upstream pages and bounds model-facing descriptions", async t => {
  const metadata = [
    ["root0", "a-guide", `${"📚 Background context. ".repeat(80)}Review C++ changes before release. ${"More context. ".repeat(40)}`],
    ["root0", "b-process", "Team review with a checklist."],
    ["root0", "c-process", "Review after deployment."],
    ["root0", "review-checklist", "Team checklist."],
    ["root1", "review", "Review product decisions."],
    ["root0", "review", "Review code changes."],
    ["root0", "release", "Publish a package."],
    ["root0", "한국어", `${"설명 📚 ".repeat(120)}문서 검토 워크플로입니다. ${"후속 안내 ".repeat(50)}`],
  ];
  const entries = metadata.map(([root, name, description]) => {
    const uri = `skill://gisul/${root}/${name}/SKILL.md`;
    return { uri, frontmatter: { name, description }, resources: [{ uri, size: 0, digest: `sha256:${createHash("sha256").update("").digest("hex")}` }] };
  });
  const upstream = {
    request: async ({ method, params }) => {
      assert.equal(method, "skills/list");
      // The best matches are on the second upstream page.
      return params.cursor ? { skills: entries.slice(4) } : { skills: entries.slice(0, 4), nextCursor: "second" };
    },
    readResource: async () => { assert.fail("search must not read skill bodies"); },
  };
  const server = createCodexBridge(upstream, "fixture-host");
  const client = new Client({ name: "ranked-search-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back);
  await client.connect(front);
  const search = async args => {
    const result = await client.callTool({ name: "search_skills", arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  try {
    const found = await search({ query: "  REVIEW  " });
    assert.equal(found.totalMatches, 6);
    assert.equal(found.nextOffset, 5);
    assert.deepEqual(found.skills.map(skill => skill.uri), [5, 4, 3, 0, 1].map(index => entries[index].uri));
    const guide = found.skills[3];
    assert.equal(guide.descriptionTruncated, true);
    assert.match(guide.description, /Review C\+\+ changes/);
    assert.ok(guide.description.startsWith("…"), "late matches stay visible in excerpts");
    assert.equal(found.skills[0].description, entries[5].frontmatter.description);
    assert.ok(!Object.hasOwn(found.skills[0], "descriptionTruncated"));
    for (const skill of found.skills) {
      assert.ok(Array.from(skill.description).length <= 240);
      assert.equal(skill.description.isWellFormed(), true);
      assert.ok(!Object.hasOwn(skill, "resources"));
      assert.ok(!Object.hasOwn(skill, "score"));
    }
    const next = await search({ query: "  REVIEW  ", offset: found.nextOffset });
    assert.deepEqual(next.skills.map(skill => skill.uri), [entries[2].uri]);
    assert.ok(!Object.hasOwn(next, "nextOffset"));
    assert.deepEqual((await search({ query: "team review" })).skills.map(skill => skill.name), ["review-checklist", "b-process"]);
    assert.deepEqual((await search({ query: "review release" })).skills.map(skill => skill.name), ["a-guide"]);
    assert.deepEqual((await search({ query: "C++" })).skills.map(skill => skill.name), ["a-guide"], "query punctuation stays literal");
    assert.deepEqual((await search({ query: "review missing" })).skills, [], "all terms must match");

    const korean = (await search({ query: "문서 검토" })).skills[0];
    assert.equal(korean.name, "한국어");
    assert.match(korean.description, /문서 검토/);
    assert.ok(Array.from(korean.description).length <= 240);
    assert.equal(korean.description.isWellFormed(), true);

    const catalog = await search({ limit: 50 });
    assert.deepEqual(catalog.skills.map(skill => skill.uri), entries.map(entry => entry.uri).sort());
    assert.deepEqual(await search({ query: " \t\n ", limit: 50 }), catalog, "blank queries preserve explicit browsing");

    const previous = {
      ...found,
      limit: 10,
      skills: entries.filter(entry => `${entry.frontmatter.name} ${entry.frontmatter.description}`.toLowerCase().includes("review"))
        .sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)
        .slice(0, 10).map(entry => ({ uri: entry.uri, ...entry.frontmatter })),
      nextOffset: undefined,
      note: "A partial or empty catalog does not exclude skills available by URI.",
    };
    const before = Buffer.byteLength(JSON.stringify(previous));
    const after = Buffer.byteLength(JSON.stringify(found));
    assert.ok(after < before / 2, "long descriptions must not dominate discovery context");
    t.diagnostic(`Synthetic review fixture: search JSON ${before} -> ${after} UTF-8 bytes (not a token measurement)`);
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
