import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseUpstreamOptions } from '../dist/codex.js';
import { pluginConnection } from '../../clients/codex/install-plugin.mjs';
import worker from '../../worker/src/index.ts';

test('HTTP configuration rejects insecure endpoints, embedded credentials and ambiguous modes', () => {
  const args = ['--origin', 'worker', '--http-url', 'https://skills.example/mcp', '--bearer-token-file', '/secrets/gisul'];
  assert.equal(parseUpstreamOptions(args).mode, 'http');
  assert.equal(pluginConnection(args.slice(2)).mode, 'http');
  assert.equal(parseUpstreamOptions(['--origin', 'macmini', '--', 'ssh', 'macmini', 'gisul']).mode, 'stdio');
  assert.equal(pluginConnection(['macmini']).mode, 'stdio');
  for (const url of ['http://skills.example/mcp', 'https://token@skills.example/mcp', 'https://skills.example/mcp?token=secret', 'https://skills.example/mcp#secret']) {
    const bad = args.slice(); bad[3] = url;
    assert.throws(() => parseUpstreamOptions(bad)); assert.throws(() => pluginConnection(bad.slice(2)));
  }
  assert.throws(() => parseUpstreamOptions([...args, '--', 'ssh', 'macmini']));
  assert.throws(() => pluginConnection(['--http-url', 'https://skills.example/mcp', '--bearer-token-file', 'relative']));
});

test('bridge uses authenticated Worker HTTP, preserves release evidence, and recovers after an origin restart', { timeout: 30000 }, async t => {
  // Node requires duplex for streamed bodies; Cloudflare's fetch accepts them directly.
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => nativeFetch(input, init?.body instanceof ReadableStream ? { ...init, duplex: 'half' } : init));
  const root = await mkdtemp(join(tmpdir(), 'gisul-http-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'skills/example'); await mkdir(dir, { recursive: true });
  const markdown = '---\nname: example\ndescription: HTTP release fixture\n---\nRead guide.md\n';
  const contents = { 'SKILL.md': markdown, 'guide.md': 'Verified supporting content' };
  const uri = 'skill://gisul/gisul/example/SKILL.md';
  const resources = [];
  for (const [name, body] of Object.entries(contents)) {
    await writeFile(join(dir, name), body);
    resources.push({ uri: uri.replace('SKILL.md', name), digest: `sha256:${createHash('sha256').update(body).digest('hex')}`, size: Buffer.byteLength(body) });
  }
  resources.sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0);
  const manifestDigest = `sha256:${createHash('sha256').update(JSON.stringify(resources)).digest('hex')}`;
  await writeFile(join(root, 'release.json'), JSON.stringify({ release: 'http-fixture.1', commit: 'a'.repeat(40), skills: [{ uri, manifest_digest: manifestDigest }] }));
  const token = randomUUID(), tokenFile = join(root, 'bearer'); await writeFile(tokenFile, token, { mode: 0o600 });
  const executable = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  let child, port, stderr = '';
  const startOrigin = async () => {
    child = spawn(process.execPath, [executable, '--http'], { env: { ...process.env, GISUL_ROOT: root, GISUL_SKILL_ROOTS: `gisul=${root}/skills`, GISUL_BEARER_TOKEN: token, GISUL_ADMIN_TOKEN: 'fixture-admin', GISUL_STATE_DIR: join(root, 'state'), HOST: '127.0.0.1', PORT: String(port ?? 0) }, stdio: ['ignore', 'ignore', 'pipe'] });
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Origin startup timed out')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.on('data', data => { stderr += data; const match = String(data).match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    });
  };
  const stopOrigin = async () => { if (child?.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } };
  t.after(stopOrigin); await startOrigin();
  let seenRequests = 0;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      seenRequests++;
      const result = await worker.fetch(new Request(`http://127.0.0.1:${proxy.address().port}${request.url}`, { method: request.method, headers: request.headers, ...(body.length ? { body } : {}) }), { ORIGIN_BASE_URL: `http://127.0.0.1:${port}` });
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502); response.end('Origin unavailable'); }
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
  const endpoint = `http://127.0.0.1:${proxy.address().port}/mcp`;
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
  const client = new Client({ name: 'http-bridge-test', version: '1' }); t.after(() => client.close());
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/codex.js', import.meta.url)), '--origin', 'worker-fixture', '--http-url', endpoint, '--bearer-token-file', tokenFile], env: { ...process.env, GISUL_EVENT_LOG_DIR: join(root, 'events') }, stderr: 'pipe' });
  transport.stderr.on('data', data => stderr += data);
  try { await client.connect(transport); } catch (error) { throw new Error(`${error}; diagnostic stderr: ${stderr}`); }
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['load_skill', 'read_skill_file', 'search_skills']);
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
  const found = await call('search_skills', { query: 'HTTP' }); assert.equal(found.totalMatches, 1);
  const loaded = await call('load_skill', { uri }); assert.equal(loaded.release, 'http-fixture.1'); assert.equal(loaded.manifest_digest, manifestDigest);
  assert.equal((await call('read_skill_file', { skill_uri: uri, uri: uri.replace('SKILL.md', 'guide.md') })).text, contents['guide.md']);
  await stopOrigin();
  assert.equal((await client.callTool({ name: 'search_skills', arguments: {} })).isError, true);
  await startOrigin();
  assert.equal((await call('search_skills', {})).totalMatches, 1);
  assert.equal((await call('read_skill_file', { skill_uri: uri, uri })).manifest_digest, loaded.manifest_digest);
  await client.close();
  const logs = (await Promise.all((await readdir(join(root, 'events'))).map(file => readFile(join(root, 'events', file), 'utf8')))).join('');
  assert.match(logs, /"transport":"http"/); assert.match(logs, /"release":"http-fixture.1"/); assert.ok(!logs.includes(token) && !stderr.includes(token));
  assert.ok(seenRequests > 5);
});
