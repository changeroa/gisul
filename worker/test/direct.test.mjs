import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { Client } from "../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StreamableHTTPClientTransport } from "../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";
import { InMemoryTransport } from "../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { createCodexBridge } from "../../server/dist/codex.js";

const hash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const token = "direct-worker-fixture-token";
const publishToken = "release-publisher-fixture-token";
const uri = "skill://gisul/gisul/flow/SKILL.md";
const root = uri.slice(0, -8);
const bundle = build({ entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });

async function fixture(t, bearer = token) {
  const modules = { "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text } };
  const runtime = new Miniflare({ telemetry: { enabled: false }, logRequests: false, workers: [{ config: {
    type: "worker", name: "direct-test", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules },
    env: { SKILLS_BUCKET: { type: "r2", name: "SKILLS_BUCKET" }, GISUL_BEARER_TOKEN: { type: "text", value: bearer }, GISUL_PUBLISH_TOKEN: { type: "text", value: publishToken } }, exports: {},
  } }] });
  t.after(() => runtime.dispose());
  const bucket = await runtime.getR2Bucket("SKILLS_BUCKET");
  const endpoint = new URL("/mcp", await runtime.ready);
  const rpc = async (method, params = {}, headers = {}) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const publish = async (path, body, method = "POST", auth = publishToken) => {
    const response = await fetch(new URL(path, endpoint), { method, headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { runtime, bucket, endpoint, rpc, publish };
}

async function release(bucket, letter, complete = true) {
  const commit = letter.repeat(40);
  const version = `20260917.${letter === "a" ? 3 : 4}`;
  const markdown = `---\nname: flow\ndescription: R2 workflow\n---\nRelease ${letter}. Read references only when needed.\n`;
  const bodies = new Map([["SKILL.md", markdown], ...Array.from({ length: letter === "a" ? 21 : 22 }, (_, i) => [`references/guide-${i}.md`, `Supporting ${letter}-${i}`])]);
  const resources = [...bodies].map(([path, body]) => ({ uri: `${root}${path}`, digest: hash(body), size: Buffer.byteLength(body) }));
  const files = [];
  for (const [path, body] of bodies) {
    const file = { path: `skills/flow/${path}`, uri: `${root}${path}`, digest: hash(body), size: Buffer.byteLength(body) };
    files.push(file);
    await bucket.put(`releases/${commit}/${file.path}`, body);
  }
  const metadata = JSON.stringify({ release: version, commit, skills: [{ uri, manifest_digest: hash(JSON.stringify(resources.slice().sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))) }] });
  files.push({ path: "release.json", digest: hash(metadata), size: Buffer.byteLength(metadata) });
  await bucket.put(`releases/${commit}/release.json`, metadata);
  const inventory = { schema_version: 1, commit, release: version, skills: [{ uri, frontmatter: { name: "flow", description: "R2 workflow" }, resources }], files, aliases: { "skill://gisul/codex/flow/SKILL.md": uri } };
  const inventoryBody = JSON.stringify(inventory);
  const identity = { commit, release: version, inventory_digest: hash(inventoryBody) };
  await bucket.put(`releases/${commit}/inventory.json`, inventoryBody);
  if (complete) await bucket.put(`releases/${commit}/complete.json`, JSON.stringify(identity));
  return { identity, inventory, markdown };
}

async function activate(bucket, identity, revision) {
  await bucket.put("current.json", JSON.stringify({ ...identity, revision, high_water: { commit: identity.commit, sequence: revision }, previous: null, operation: "promote", activated_at: "2026-09-17T00:00:00.000Z" }));
}

test("direct Worker authenticates locally, initializes without origin, and exposes no raw R2 paths", async t => {
  const { rpc, endpoint } = await fixture(t);
  const init = await rpc("initialize", { protocolVersion: "2025-11-25" });
  assert.equal(init.body.result.capabilities.extensions["io.modelcontextprotocol/skills"].directoryRead, true);
  assert.equal((await rpc("skills/list", {}, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await rpc("skills/list", {}, { authorization: "" })).status, 401);
  assert.equal((await rpc("skills/list")).body.error.code, -32603);
  assert.equal((await fetch(new URL("/releases/secret/inventory.json", endpoint))).status, 404);
  assert.equal((await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } })).status, 405);
  const preflight = await fetch(endpoint, { method: "OPTIONS", headers: { origin: "https://client.example" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://client.example");
  const unconfigured = await fixture(t, "");
  assert.equal((await unconfigured.rpc("initialize")).status, 503);
});

test("real HTTP bridge keeps old bodies and directories pinned while a new connection reads the new R2 release", async t => {
  const { bucket, endpoint } = await fixture(t);
  const a = await release(bucket, "a"), b = await release(bucket, "b");
  await activate(bucket, a.identity, 1);
  const wireReads = [], evidence = [];
  let promoteDuringLoad = true;
  const connect = async () => {
    const upstream = new Client({ name: "bridge-upstream", version: "1" });
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: async (input, init) => {
      const message = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (message?.method === "resources/read" || message?.method === "resources/directory/read") wireReads.push(message);
      const response = await fetch(input, init);
      if (message?.method === "skills/get" && promoteDuringLoad) { promoteDuringLoad = false; await activate(bucket, b.identity, 2); }
      return response;
    } });
    await upstream.connect(transport);
    const bridge = createCodexBridge(upstream, "r2-worker-fixture", { connectionId: `connection-${evidence.length}`, emit: event => evidence.push(event), flush: async () => {} }, true);
    const client = new Client({ name: "plugin-fixture", version: "1" });
    const [front, back] = InMemoryTransport.createLinkedPair();
    await bridge.connect(back); await client.connect(front);
    t.after(async () => { await client.close(); await bridge.close(); await upstream.close(); });
    return async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
  };
  const first = await connect();
  const found = await first("search_skills", { query: "R2 workflow" });
  assert.equal(found.commit, a.identity.commit);
  assert.ok(!JSON.stringify(found).includes("Supporting a"));
  assert.equal(wireReads.length, 0, "discovery must not fetch skill bodies");
  const loaded = await first("load_skill", { uri });
  assert.equal(loaded.markdown, a.markdown);
  assert.equal(loaded.commit, a.identity.commit);
  assert.equal(wireReads.length, 1, "load fetches only SKILL.md");
  assert.equal(wireReads[0].params._meta["io.gisul/commit"], a.identity.commit);
  const second = await connect();
  assert.equal((await second("search_skills", {})).commit, b.identity.commit);
  assert.equal((await second("load_skill", { uri })).markdown, b.markdown);
  const directory = await first("read_skill_file", { skill_uri: uri, uri: `${root}references` });
  assert.equal(directory.files.length, 21);
  assert.equal(directory.commit, a.identity.commit);
  const guide = await first("read_skill_file", { skill_uri: uri, uri: `${root}references/guide-0.md` });
  assert.equal(guide.text, "Supporting a-0");
  assert.equal(guide.release, "20260917.3");
  assert.equal((await second("read_skill_file", { skill_uri: uri, uri: `${root}references/guide-0.md` })).text, "Supporting b-0");
  assert.ok(evidence.some(e => e.event === "load_skill" && e.commit === a.identity.commit && e.release === "20260917.3"));
  assert.ok(evidence.some(e => e.event === "read_skill_file" && e.commit === a.identity.commit));
  assert.ok(evidence.some(e => e.event === "search" && e.commit === b.identity.commit));
});

test("direct reads reject corrupt bytes, incomplete pins, aliases outside the release, and traversal", async t => {
  const { bucket, rpc } = await fixture(t);
  const a = await release(bucket, "a");
  await activate(bucket, a.identity, 1);
  const alias = await rpc("skills/get", { uri: "skill://gisul/codex/flow/SKILL.md" });
  assert.equal(alias.body.result.skill.uri, uri);
  assert.equal(alias.body.result._meta.movedFrom, "skill://gisul/codex/flow/SKILL.md");
  for (const target of ["skill://gisul/gisul/../private", "skill://gisul/gisul/%2e%2e/private", "skill://other/gisul/flow/SKILL.md", `${uri}?secret=1`]) {
    assert.equal((await rpc("resources/read", { uri: target })).body.error.code, -32602);
  }
  assert.equal((await rpc("skills/get", { uri, _meta: { "io.gisul/commit": "b".repeat(40) } })).body.error.code, -32602);
  await bucket.put(`releases/${a.identity.commit}/skills/flow/references/guide-0.md`, "changed bytes");
  assert.equal((await rpc("resources/read", { uri: `${root}references/guide-0.md` })).body.error.code, -32603);
  await bucket.put(`releases/${a.identity.commit}/inventory.json`, JSON.stringify({ ...a.inventory, release: "made-up" }));
  assert.equal((await rpc("skills/list")).body.error.code, -32603);
});

test("publisher authentication is separate from MCP and uploads cannot forge a completion marker", async t => {
  const { publish, rpc, bucket } = await fixture(t);
  assert.equal((await publish("/admin/current", undefined, "GET", token)).status, 401);
  assert.equal((await rpc("initialize", {}, { authorization: `Bearer ${publishToken}` })).status, 401);
  const staged = await release(bucket, "c", false);
  const objects = await bucket.list({ prefix: `releases/${staged.identity.commit}/` });
  await bucket.delete(objects.objects.map(object => object.key));
  const path = `/admin/releases/${"c".repeat(40)}/skills/flow/references/guide-0.md`;
  assert.equal((await publish(path, "Supporting c-0", "PUT")).status, 409, "inventory must be uploaded first");
  assert.equal((await publish(`/admin/releases/${staged.identity.commit}/inventory.json`, staged.inventory, "PUT")).status, 201);
  assert.equal((await publish(path, "Supporting c-0", "PUT")).status, 201);
  assert.equal((await publish(path, "Supporting c-0", "PUT")).status, 200);
  assert.equal((await publish(path, "other", "PUT")).status, 409);
  assert.equal((await publish(`/admin/releases/${staged.identity.commit}/extra.txt`, "unlisted", "PUT")).status, 409);
  assert.equal(await (await bucket.get(`releases/${"c".repeat(40)}/skills/flow/references/guide-0.md`)).text(), "Supporting c-0");
  assert.equal((await publish(`/admin/releases/${"c".repeat(40)}/complete.json`, "forged", "PUT")).status, 400);
  assert.equal(await bucket.get(`releases/${"c".repeat(40)}/complete.json`), null);
  assert.equal((await publish("/admin/current", undefined, "GET")).body.current, null);
});

test("publication verifies the whole release before switching and rollback preserves the deployment high-water mark", async t => {
  const { bucket, publish, rpc } = await fixture(t);
  const a = await release(bucket, "a", false), b = await release(bucket, "b", false);
  assert.equal((await rpc("skills/get", { uri, _meta: { "io.gisul/commit": a.identity.commit } })).body.error.code, -32602);
  assert.equal((await publish(`/admin/releases/${a.identity.commit}`, undefined, "GET")).status, 404);
  const firstInput = { ...a.identity, expected_etag: null, sequence: 1 };
  const initial = await publish("/admin/promote", firstInput);
  assert.equal(initial.status, 200, JSON.stringify(initial));
  const first = (await publish("/admin/current", undefined, "GET")).body;
  assert.equal(first.current.commit, a.identity.commit);
  assert.deepEqual((await publish(`/admin/releases/${a.identity.commit}`, undefined, "GET")).body, a.identity);
  const unverifiedRollback = await publish("/admin/rollback", { ...b.identity, expected_etag: first.etag, sequence: 2 });
  assert.equal(unverifiedRollback.status, 404, JSON.stringify(unverifiedRollback));
  assert.equal(await bucket.get(`releases/${b.identity.commit}/complete.json`), null);
  assert.deepEqual((await publish("/admin/current", undefined, "GET")).body, first);
  const retry = await publish("/admin/promote", firstInput);
  assert.equal(retry.status, 200, "a lost successful response can be retried without another pointer revision");
  assert.equal(retry.body.revision, 1);
  const guideKey = `releases/${b.identity.commit}/skills/flow/references/guide-0.md`;
  await bucket.put(guideKey, "tampered");
  const nextInput = { ...b.identity, expected_etag: first.etag, sequence: 4 };
  const failed = await publish("/admin/promote", nextInput);
  assert.equal(failed.status, 409, JSON.stringify(failed));
  assert.deepEqual((await publish("/admin/current", undefined, "GET")).body, first);
  assert.equal(await bucket.get(`releases/${b.identity.commit}/complete.json`), null, "failed validation never creates a completed release");
  await bucket.put(guideKey, "Supporting b-0");
  const promoted = await publish("/admin/promote", nextInput);
  assert.equal(promoted.status, 200, JSON.stringify(promoted));
  const latest = (await publish("/admin/current", undefined, "GET")).body;
  assert.equal(latest.current.commit, b.identity.commit);
  assert.equal(latest.current.high_water.sequence, 4);
  assert.equal((await rpc("skills/list")).body.result._meta.commit, b.identity.commit);
  const rollback = await publish("/admin/rollback", { ...a.identity, expected_etag: latest.etag, sequence: 4 });
  assert.equal(rollback.status, 200, JSON.stringify(rollback));
  assert.equal(rollback.body.high_water.commit, b.identity.commit);
  const rolledBack = (await publish("/admin/current", undefined, "GET")).body;
  const stale = await publish("/admin/promote", { ...b.identity, expected_etag: rolledBack.etag, sequence: 3 });
  assert.equal(stale.status, 409, JSON.stringify(stale));
  assert.deepEqual((await publish("/admin/current", undefined, "GET")).body, rolledBack);
});

test("simultaneous verified HTTP publications cannot both switch current", async t => {
  const { bucket, publish } = await fixture(t);
  const a = await release(bucket, "a", false), b = await release(bucket, "b", false);
  const results = await Promise.all([
    publish("/admin/promote", { ...a.identity, expected_etag: null, sequence: 1 }),
    publish("/admin/promote", { ...b.identity, expected_etag: null, sequence: 2 }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409], JSON.stringify(results));
  const current = (await publish("/admin/current", undefined, "GET")).body.current;
  assert.equal(current.revision, 1);
  assert.equal(current.commit, results.find(result => result.status === 200).body.commit);
});

test("verified candidates can be read by pin before any current-pointer change", async t => {
  const { bucket, publish, rpc } = await fixture(t);
  const candidate = await release(bucket, "a", false);
  const input = { ...candidate.identity, expected_etag: null, sequence: 1 };
  const checked = await publish("/admin/verify", input);
  assert.equal(checked.status, 200, JSON.stringify(checked));
  assert.deepEqual(checked.body, candidate.identity);
  assert.equal((await publish("/admin/current", undefined, "GET")).body.current, null);
  const pinned = await rpc("resources/read", { uri, _meta: { "io.gisul/commit": candidate.identity.commit } });
  assert.equal(pinned.body.result.contents[0].text, candidate.markdown);
  assert.equal((await rpc("skills/list")).body.error.code, -32603);
  assert.equal((await publish("/admin/promote", input)).status, 200);
});

test("publication rejects misleading frontmatter even when all file digests match", async t => {
  const { bucket, publish } = await fixture(t);
  const a = await release(bucket, "a", false);
  a.inventory.skills[0].frontmatter.description = "Metadata absent from the actual SKILL.md";
  const bytes = JSON.stringify(a.inventory);
  await bucket.put(`releases/${a.identity.commit}/inventory.json`, bytes);
  const result = await publish("/admin/promote", { ...a.identity, inventory_digest: hash(bytes), expected_etag: null, sequence: 1 });
  assert.equal(result.status, 409, JSON.stringify(result));
  assert.match(result.body.error, /frontmatter/);
  assert.equal(await bucket.get(`releases/${a.identity.commit}/complete.json`), null);
  assert.equal((await publish("/admin/current", undefined, "GET")).body.current, null);
});

test("oversized publication and upload requests return 413 before mutation", async t => {
  const { bucket, publish } = await fixture(t);
  for (const path of ["/admin/promote", "/admin/rollback"]) {
    assert.equal((await publish(path, " ".repeat(64 * 1024 + 1))).status, 413);
  }
  const path = `/admin/releases/${"a".repeat(40)}/inventory.json`;
  assert.equal((await publish(path, " ".repeat(16 * 1024 * 1024 + 1), "PUT")).status, 413);
  assert.deepEqual((await bucket.list()).objects, []);
});
