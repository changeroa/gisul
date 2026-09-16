import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pluginSource, verifyInstalled } from "../../clients/codex/install-plugin.mjs";

test("plugin updates require one confirmed local marketplace source", () => {
  const local = { pluginId: "gisul@personal", source: { source: "local", path: "/plugins/gisul" } };
  assert.equal(pluginSource({ installed: [local] }, "personal"), "/plugins/gisul");
  for (const entries of [[], [{ ...local, source: { source: "github", path: "/plugins/gisul" } }], [local, { ...local, source: { source: "local", path: "/another/gisul" } }]]) {
    assert.throws(() => pluginSource({ installed: entries }, "personal"), /one confirmed local/);
  }
});

test("installed verification detects stale versions, disabled plugins, and stale cache bytes", async t => {
  const root = await mkdtemp(join(tmpdir(), "gisul-plugin-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const cache = join(root, "plugins/cache/personal/gisul/1.0.0");
  for (const base of [source, cache]) for (const file of [".codex-plugin/plugin.json", ".mcp.json", "runtime/codex.mjs", "skills/gisul/SKILL.md"]) {
    await mkdir(dirname(join(base, file)), { recursive: true });
    await writeFile(join(base, file), file);
  }
  const entry = { pluginId: "gisul@personal", enabled: true, version: "1.0.0" };
  const verify = installed => verifyInstalled({ installed }, "personal", "1.0.0", source, root);
  assert.equal(await verify([entry]), cache);
  await assert.rejects(verify([{ ...entry, version: "0.0.1" }]), /new plugin version/);
  await assert.rejects(verify([{ ...entry, enabled: false }]), /disabled/);
  await writeFile(join(cache, "runtime/codex.mjs"), "stale bundle");
  await assert.rejects(verify([entry]), /differs from the built plugin/);
});
