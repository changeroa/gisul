# Session context

Date: 2026-09-04  
Sensitivity: public-safe summary. Raw tokens, Cloudflare API credentials, bearer tokens, admin tokens, and exact private secret values are intentionally excluded.

## Goal

Build a personal remote skill registry that can serve local `SKILL.md` bundles to Codex CLI, Claude Code, or other MCP clients without copying every skill into every runtime.

## Current implementation

The prototype has two parts:

- A local Node.js MCP server.
- A Cloudflare Worker proxy in front of the local server.

The local server can run in two modes:

- stdio mode for SSH-based MCP usage.
- HTTP mode for persistent Streamable HTTP MCP usage.

The server exposes:

- `skills_list`
- `skills_get`
- `resources_read`

It discovers skill directories from:

- `~/gisul/skills`
- `~/.codex/skills`
- `~/.agents/skills`

The HTTP mode also includes:

- `POST /mcp`
- `GET /auth/request`
- `POST /auth/token-requests`
- `GET /auth/token-requests/:id?claim_token=...`
- `GET /dashboard/login`
- `GET /dashboard`
- approval, denial, and revocation actions for issued bearer tokens

## Deployment shape used in the prototype

The deployed personal setup used this shape:

```text
MCP client
  -> public Worker endpoint
  -> Cloudflare Tunnel origin hostname
  -> local machine process on 127.0.0.1:8788
```

The origin server validates bearer tokens. The Worker requires a bearer-shaped Authorization header before forwarding `/mcp`, but token validity is checked by the local server so newly approved tokens do not require redeploying the Worker.

## Decisions

1. Keep the local host as the source of truth.

   The skill files stay on the personal machine. Cloudflare only provides ingress.

2. Prefer remote MCP reads over local installation.

   The default usage model is to discover and read skills through MCP. Local materialization into `.agents/skills` or `.claude/skills` should be treated as a compatibility bridge.

3. Do not treat remote skills as executable plugins.

   A remote skill is instruction/context. It is not a trusted code execution unit.

4. Use bearer tokens first.

   OAuth or Cloudflare Access can be layered later, but bearer tokens are enough for a personal prototype.

5. Store issued tokens as hashes.

   The server returns an approved token once through the claim endpoint, then stores only the token hash for future validation.

## Working-group alignment

The design follows the apparent direction of MCP Skills-over-MCP discussions:

- expose discoverable skill metadata
- retrieve selected skill instructions through MCP
- read related resources through resource operations
- keep host-side activation separate from raw resource reads
- treat local filesystem materialization as optional host behavior, not the protocol foundation

## Known gaps

- The prototype tool names are pragmatic and not yet the final upstream method shape.
- There is no signed manifest or per-file digest verification yet.
- Token store writes are JSON-file based and do not use a database or lock.
- The Worker does not hide the origin by itself. The origin still needs its own auth, which it currently has.
- There is no first-class CLI yet for `list`, `load`, `mount`, and `unmount`.

## Recommended next work

1. Add REST helper endpoints for simple shell clients:

   - `GET /api/skills`
   - `GET /api/skills/:source/:name`
   - `GET /api/resources?uri=...`

2. Add a `gisul` CLI:

   - `gisul request-token`
   - `gisul list`
   - `gisul load <name>`
   - `gisul mount <name> --target codex|claude`
   - `gisul unmount <name> --target codex|claude`

3. Add digest metadata:

   - skill-level manifest
   - per-resource SHA-256
   - client-side verification before local materialization

4. Add a tiny loader skill for Codex/Claude:

   The loader skill should instruct the agent to search the remote skill registry first, load only the selected skill, and avoid copying broad skill catalogs into the current context.
