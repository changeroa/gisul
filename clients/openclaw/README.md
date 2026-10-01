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

OAuth sign-in, a live remote MCP call through OpenClaw, and model compliance with
discovery guidance have not been verified by these offline checks. The runtime
smoke uses private exports only in its test adapter; the distributed plugin has
no dependency on OpenClaw's internal module paths. Run the smoke again after an
OpenClaw upgrade. Format changes may require updating the test adapter.
