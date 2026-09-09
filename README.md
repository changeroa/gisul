# gisul

`gisul` is a personal MCP skill registry for serving `SKILL.md`-style instruction bundles from a local machine.

The name comes from 기술, Korean for "skill", "craft", or "technique".

This repo contains two small packages:

- `server/`: a Node.js MCP server that exposes local skill directories over stdio or Streamable HTTP.
- `worker/`: a Cloudflare Worker proxy that exposes the HTTP MCP endpoint publicly while forwarding validation to the origin server.

The intended deployment is:

```text
Codex / Claude / MCP client
  -> Cloudflare Worker
  -> Cloudflare Tunnel
  -> local Mac/Linux host running the gisul MCP server
  -> local skill directories
```

## Why

This project is an experiment around "skills over MCP": instead of copying every skill into every agent runtime, a client can discover and load task-specific instruction bundles from a personal MCP server.

The design keeps the local machine as the source of truth and uses Cloudflare only as a thin authenticated ingress path.

## Packages

### Server

```bash
cd server
npm install
npm run build
node dist/index.js --http
```

Default HTTP endpoint:

```text
POST http://127.0.0.1:8788/mcp
```

Default skill roots:

- `~/gisul/skills`
- `~/.codex/skills`
- `~/.agents/skills`

### Worker

```bash
cd worker
npm install
npx wrangler deploy
```

Set `ORIGIN_BASE_URL` in `worker/wrangler.jsonc` to the Cloudflare Tunnel hostname that points at the local server.

## Skills extension (SEP-2640)

The server implements the accepted [SEP-2640 Skills Extension](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640) (`io.modelcontextprotocol/skills`):

- `skills/list` and `skills/get` extension methods with per-file `{uri, digest, size}` resource manifests
- every skill file readable through the standard `resources/read` resource primitive
- `resources/directory/read` for scoped directory navigation (declared via `directoryRead: true`)
- URIs carry the file path explicitly: `skill://<authority>/<source>/<skill-name>/SKILL.md`
- skills need `name` and `description` frontmatter with `name` matching the directory name; nested skills get their own entries; skills over 512 files or 16 MiB total are skipped and logged

The older `skills_list` / `skills_get` / `resources_read` tools remain as a compatibility layer.

## Codex integration

The [Codex plugin](clients/codex/README.md) lets Codex search remote
skills, load a selected skill, and read supporting files with per-file integrity
checks. Build the plugin with `cd server && npm run build:codex-plugin` and install
it from a Codex marketplace. It bundles the MCP adapter and the small Gisul loader;
remote skills stay on the server.

## Authentication

The HTTP server supports:

- bearer token validation for `/mcp`
- a public token request endpoint
- an admin dashboard for approving token requests
- hashed storage for issued tokens

No real secrets are included in this repository. The files in `server/ops/` are templates and must be adjusted before use.

## Current status

This is a personal prototype, not a stable MCP extension implementation. The upstream Skills extension shape has settled (SEP-2640, accepted) and this server implements it; the pragmatic tool names (`skills_list`, `skills_get`, `resources_read`) remain as a compatibility layer for older clients.

See [docs/SESSION_CONTEXT.md](docs/SESSION_CONTEXT.md) for the session handoff context behind this version.
