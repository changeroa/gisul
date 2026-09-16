# Codex plugin

Gisul's Codex adapter exposes `search_skills`, `load_skill`, `read_skill_file`,
`create_skill`, and `update_skill`. A small local `$gisul` skill teaches Codex when and how to use
them. Remote skills stay remote; the catalog is not copied into local skill folders.

## Plugin setup

The plugin source is `plugin/gisul/`. Its manifest bundles the local loader and
an MCP server configuration; the adapter and its npm dependencies are bundled
into a single JavaScript file. The installed plugin does not depend on this
checkout or its `node_modules`. It requires Node 22+ and working SSH access to
the configured `macmini` alias.

Build the distributable plugin:

```bash
cd server
npm ci
npm run build:codex-plugin
```

Publish the built `clients/codex/plugin/gisul/` directory through a Codex local
marketplace. In this personal setup, the source is `~/plugins/gisul` and the
marketplace is `~/.agents/plugins/marketplace.json`. Install using:

```bash
codex plugin add gisul@personal
```

Start a new Codex thread and select the Gisul skill or ask:

```text
Gisul에서 코드 리뷰에 맞는 스킬을 찾아 적용해줘.
```

For another SSH host, edit both the origin label and SSH host in the plugin's
`.mcp.json` before publishing. Its `cwd: "."` resolves to the installed plugin
directory. On machines outside the Homebrew/Linux standard paths, adjust PATH.

For updates to an existing personal-marketplace installation:

```bash
node clients/codex/install.mjs --plugin --dry-run macmini
node clients/codex/install.mjs --plugin macmini
```

The installer discovers the source through `codex plugin list`, rebuilds the
bundle, uses the plugin-creator helpers to validate the marketplace and update
the version cachebuster, and runs `codex plugin add gisul@<marketplace>`. It keeps
a source backup beside the existing plugin. It then checks the selected version,
enabled state, exact cache file bytes, and fresh MCP discovery/pagination/reads.
Cache, `config.toml`, and marketplace files are managed by Codex's CLI. New
threads pick up the updated tools and skills; a running thread keeps its existing
MCP connection. `codex plugin list --json` reports plugin versions; `codex mcp list`
is not the plugin-version registry.

This update path requires an existing local source in the default personal
marketplace and the plugin-creator skill at
`${CODEX_HOME:-~/.codex}/skills/.system/plugin-creator`. Set `GISUL_PLUGIN_CREATOR`
if that skill is elsewhere. It refuses a competing standalone MCP registration.
After an ambiguous install failure it re-queries the selected version before
reporting an error; inspect that result and the printed backup before retrying.

Check the actual installed bundle and upstream together:

```bash
cd server
node smoke-codex-plugin.mjs /absolute/path/to/installed/gisul
```

This checks discovery, selected-skill loading, and digest-verified reads without
printing skill bodies. It does not test a model's skill-selection decisions.

## Standalone compatibility installer

The earlier `install.mjs` remains available for setups that do not use plugins.
Use either the plugin or standalone registration, not both.

Build on the machine running Codex:

```bash
cd server
npm ci
npm run build
cd ..
node clients/codex/install.mjs --dry-run macmini
node clients/codex/install.mjs macmini
```

The installer registers a local adapter with `codex mcp add` and installs only the
loader in `${CODEX_HOME:-$HOME/.codex}/skills/gisul`. It uses the absolute paths of
the current Node executable and checkout: keep both available after installation.
An existing `gisul` registration or different local skill is never overwritten.
The user-level `.codex/skills` path keeps this loader scoped to Codex's existing
skill setup rather than the cross-client `.agents/skills` directory.

The upstream host must already support noninteractive `ssh macmini gisul` and run
the current server build with the `io.modelcontextprotocol/skills` capability.
Older tool-only gisul deployments fail with an upgrade message. This installer
does not deploy the remote server or restart its services. To use another SSH
alias, replace `macmini` in the install command. SSH uses BatchMode, so configure
the SSH key and known-host entry before starting Codex.

Start a new Codex session, check `/mcp`, and try:

```text
$gisul 찾아서 코드 리뷰에 맞는 스킬을 적용해줘.
```

For a known URI:

```text
$gisul skill://gisul/agents/my-workflow/SKILL.md를 읽고 이 작업에 적용해줘.
```

Only `$gisul` appears as a local skill. Selection of remote guidance is model-driven;
this does not modify Codex itself or guarantee automatic selection for every task.

## Behavior and boundaries

- Search returns compact names, descriptions and exact URIs. Same-named skills remain separate. Search uses all literal query words, reads all upstream catalog pages, and sorts matches by URI before applying `offset` (default 0) and `limit` (default 10, maximum 50).
- Search responses include `totalMatches`, `offset`, and `limit`. When `nextOffset` is present, pass it as `offset` with the same `query` and `limit` to continue; its absence marks the last page. For example, start with `{"query":"review","limit":50}`, then use `{"query":"review","limit":50,"offset":50}` if `nextOffset` is 50. Each call rereads the live catalog, so additions or removals between calls can shift pages; restart from offset 0 if the catalog changes.
- `offset` must be a nonnegative safe integer and `limit` an integer from 1 to 50; invalid values return an MCP tool error. An offset at or beyond `totalMatches` returns an empty page without `nextOffset`, as does a search with no matches.
- Load fetches the current manifest and only `SKILL.md`. Every file read checks
  SHA-256 and size. Frontmatter must match the manifest.
- Supporting files are read lazily against the manifest held for this connection.
  Files outside it and changed bytes fail. Reload explicitly to inspect an update.
- Each response names the configured upstream origin. The adapter has exactly one
  upstream and provides no cross-server reads, disk cache, or script execution.
- Dynamic manifests and binary assets are unsupported in this instruction-only
  adapter. The remote server must supply a complete static manifest.
- The loader preserves user authorization and remote origin. This compatibility
  adapter cannot intercept Codex's other execution tools or implement native
  host-wide consent enforcement. Digest verification establishes consistency,
  not trust in the author. An execution approval is never granted by a tool response.

## Test

```bash
cd server
npm run build
npm test
```

To run the adapter directly against an alternative stdio server:

```bash
node server/dist/codex.js --origin my-server -- /absolute/path/to/server arg1
```

To remove the plugin: `codex plugin remove gisul@personal`.
For the standalone setup, remove the MCP registration with `codex mcp remove gisul`. Remove the installed
`skills/gisul/SKILL.md` separately if you no longer want the loader.
