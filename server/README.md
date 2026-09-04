# gisul MCP server

Tiny MCP server for serving personal `SKILL.md` directories from a local machine over stdio, SSH, or Streamable HTTP.

## Layout

```text
~/gisul/
  skills/
    example/
      SKILL.md
      references/
      scripts/
```

By default, the server reads these roots in order:

- `~/gisul/skills`
- `~/.codex/skills`
- `~/.agents/skills`

Resource URIs include the source root to avoid duplicate-name collisions:

```text
skill://gisul/gisul/example/SKILL.md
skill://gisul/codex/re0/SKILL.md
skill://gisul/agents/korean-spell-check/SKILL.md
```

## Client command

Use a local machine as an on-demand MCP server over SSH:

```json
{
  "mcpServers": {
    "gisul": {
      "command": "ssh",
      "args": ["your-host", "gisul"]
    }
  }
}
```

## Tools

- `skills_list`: list installed skills.
- `skills_get`: read one skill's `SKILL.md`.
- `resources_read`: read `skill://<host>/<source>/<skill>/<path>` resources under a skill directory.

Set `GISUL_ROOT` or colon-delimited `GISUL_SKILLS_DIRS` on the remote command to override the default roots.

When serving through a public tunnel, set `GISUL_ALLOWED_HOSTS` to include the tunnel hostname:

```text
GISUL_ALLOWED_HOSTS=127.0.0.1,localhost,gisul-origin.example.com
```

## HTTP mode

The persistent deployment runs Streamable HTTP MCP on `127.0.0.1:8788`.

- `POST /mcp`: MCP endpoint, protected by bearer token.
- `GET /auth/request`: simple request form.
- `POST /auth/token-requests`: create a token request.
- `GET /auth/token-requests/:id?claim_token=...`: poll request status and receive the token once approved.
- `GET /dashboard`: admin approval dashboard.

Secrets live outside the repository:

```text
~/.config/secrets/gisul-mcp-bearer-token
~/.config/secrets/gisul-mcp-admin-token
```
