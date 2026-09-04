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

The canonical surface is the SEP-2640 Skills Extension (`io.modelcontextprotocol/skills`):

- `skills/list`: enumerate served skills with verbatim frontmatter and per-file digest manifests
- `skills/get`: fetch one skill's entry by URI, listed or not
- `resources/read`: read any skill file as a standard MCP resource
- `resources/directory/read`: list a directory's direct children (declared via `directoryRead: true`)

Resource URIs include the source root id and the explicit file path:

```text
skill://gisul/gisul/example/SKILL.md
skill://gisul/codex/re0/SKILL.md
skill://gisul/agents/korean-spell-check/references/GUIDE.md
```

To be listed, a skill needs `SKILL.md` frontmatter with `name` and `description`, and `name` equal to the directory name (nested skills publish their own entries). Skills exceeding 512 files or 16 MiB total are skipped and logged to stderr.

The `skills_list`, `skills_get`, and `resources_read` tools are kept as a compatibility layer for older clients.

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
