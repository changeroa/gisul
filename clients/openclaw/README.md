# Gisul for OpenClaw

Install the [OpenClaw bundle and follow its login instructions](plugin/README.md).
The bundle contains a small skill loader, an in-memory discovery hook and a
read-only OAuth MCP bridge. Team workflow skills remain on Gisul.

From the repository root, for the default profile:

```sh
openclaw plugins install ./clients/openclaw/plugin
node "$HOME/.openclaw/extensions/gisul-openclaw/scripts/bridge.mjs" --login
```

Use the same profile for installation, login and the Gateway. No existing user
configuration changes merely by checking out this client.

Verification:

```sh
node --test server/test/openclaw-client.test.mjs
node scripts/check-openclaw-client.mjs --openclaw-root /path/to/installed/openclaw
```

On 2026-10-01 both passed against OpenClaw `2026.7.1-2` (`0790d9f`). The native
smoke creates and removes an isolated OpenClaw home/state/config, installs a
copied bundle, checks the model-visible skill and plugin hook, resolves the MCP
script through OpenClaw's own loader, and dispatches a real `agent:bootstrap`
hook without modifying the workspace file. Unit tests also cover credential
profile selection, repeat injection, no-write dry runs, protocol-clean stdout
and propagation of child failure status.

Live verification on 2026-10-01 also completed OAuth sign-in and an actual local
OpenClaw agent turn: search → pinned skill load → supporting-file read, with
three tool calls and no tool errors. That profile uses the Codex harness, so a
separate native MCP test loaded **only the installed OpenClaw bundle** in an
empty workspace to exclude inherited Codex connections. It exposed exactly the
three read tools and verified both returned bodies against their SHA-256 digests.
The observed release was `20261001.19` at commit
`054052e608b6ea35eea59480917121a8ee30f3e0`.

After installing and signing in, reproduce the bundle-only live test:

```sh
node scripts/check-openclaw-live.mjs \
  --openclaw-root /path/to/installed/openclaw \
  --plugin-root "$HOME/.openclaw/extensions/gisul-openclaw"
```

Use your actual profile path. This makes read-only network calls and prints
metadata/digests, never credentials or remote workflow bodies. It uses the
already installed bundle and its OAuth cache; it does not sign in, rewrite
OpenClaw configuration, restart a Gateway, or send channel messages.

Sanitized evidence: [native bundle calls](../../docs/evidence/openclaw-20261001/native-mcp.json)
and [agent tool calls](../../docs/evidence/openclaw-20261001/agent-calls.json).
The agent reported an unrelated unresolved Slack secret during message-tool
catalog discovery; no Slack action was requested and all three Gisul calls
succeeded. General model compliance on future tasks is not established by one
explicit smoke. Existing Gateway sessions were not restarted or validated.

Compatibility scripts use private exports only in their test adapters; the
plugin has no dependency on OpenClaw's internal module paths. Run the checks
after an OpenClaw upgrade; format changes may require updating the adapters.
