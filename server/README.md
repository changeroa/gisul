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
- `~/skillpack/skills`
- `~/.codex/skills`
- `~/.agents/skills`

Resource URIs include the source root to avoid duplicate-name collisions:

```text
skill://gisul/gisul/example/SKILL.md
skill://gisul/skillpack/example/SKILL.md
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
      "args": ["your-host", "skillpack-mcp"]
    }
  }
}
```

## Tools

- `skills_list`: list installed skills.
- `skills_get`: read one skill's `SKILL.md`.
- `resources_read`: read `skill://<host>/<source>/<skill>/<path>` resources under a skill directory.

Set `SKILLPACK_ROOT` or colon-delimited `SKILLPACK_SKILLS_DIRS` on the remote command to override the default roots.

## HTTP mode

The persistent deployment runs Streamable HTTP MCP on `127.0.0.1:8788`.

- `POST /mcp`: MCP endpoint, protected by bearer token.
- `GET /auth/request`: simple request form.
- `POST /auth/token-requests`: create a token request.
- `GET /auth/token-requests/:id?claim_token=...`: poll request status and receive the token once approved.
- `GET /dashboard`: admin approval dashboard.

Secrets live outside the repository:

```text
~/.config/secrets/skillpack-mcp-bearer-token
~/.config/secrets/skillpack-mcp-admin-token
```

The executable and environment variable names still use `skillpack` in this prototype. The public project name is now `gisul`; CLI/package renaming can happen in a later compatibility pass.
