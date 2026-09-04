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
- `~/skillpack/skills`
- `~/.codex/skills`
- `~/.agents/skills`

`~/skillpack/skills` is kept as a legacy fallback while the prototype is being renamed.

### Worker

```bash
cd worker
npm install
npx wrangler deploy
```

Set `ORIGIN_BASE_URL` in `worker/wrangler.jsonc` to the Cloudflare Tunnel hostname that points at the local server.

## Authentication

The HTTP server supports:

- bearer token validation for `/mcp`
- a public token request endpoint
- an admin dashboard for approving token requests
- hashed storage for issued tokens

No real secrets are included in this repository. The files in `server/ops/` are templates and must be adjusted before use.

## Current status

This is a personal prototype, not a stable MCP extension implementation. It tracks the current direction of the MCP Skills working-group discussion, but uses pragmatic tool names (`skills_list`, `skills_get`, `resources_read`) until the upstream extension shape settles.

See [docs/SESSION_CONTEXT.md](docs/SESSION_CONTEXT.md) for the session handoff context behind this version.
