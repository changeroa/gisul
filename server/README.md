# skillpack-mcp

Tiny stdio MCP server for serving personal `SKILL.md` directories from a Mac mini over SSH.

## Layout

```text
~/skillpack/
  skills/
    example/
      SKILL.md
      references/
      scripts/
```

By default, the server reads these roots in order:

- `~/skillpack/skills`
- `~/.codex/skills`
- `~/.agents/skills`

Resource URIs include the source root to avoid duplicate-name collisions:

```text
skill://macmini/skillpack/example/SKILL.md
skill://macmini/codex/re0/SKILL.md
skill://macmini/agents/korean-spell-check/SKILL.md
```

## Client command

Use the Mac mini as an on-demand MCP server:

```json
{
  "mcpServers": {
    "macmini-skills": {
      "command": "ssh",
      "args": ["macmini", "skillpack-mcp"]
    }
  }
}
```

## Tools

- `skills_list`: list installed skills.
- `skills_get`: read one skill's `SKILL.md`.
- `resources_read`: read `skill://macmini/<source>/<skill>/<path>` resources under a skill directory.

Set `SKILLPACK_ROOT` or colon-delimited `SKILLPACK_SKILLS_DIRS` on the remote command to override the default roots.

## HTTP mode

The Mac mini deployment runs persistent Streamable HTTP MCP on `127.0.0.1:8788`.

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
