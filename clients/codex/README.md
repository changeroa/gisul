# Codex plugin

Gisul's Codex adapter exposes three tools: `search_skills`, `load_skill`, and
`read_skill_file`. A small local `$gisul` skill teaches Codex when and how to use
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

For local plugin updates, rebuild, copy the built tree to the personal plugin
source, update its version cachebuster, and run `codex plugin add gisul@personal`
again. New threads pick up the new tools and skills. The plugin-creator skill's
cachebuster helper can perform the version update.

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

- Search with a few literal task keywords, for example `{"query":"code review"}`. All words must match the name or description, ignoring case. Exact skill names rank first, then matches in names, with URI order breaking ties. Same-named skills remain separate. Search is lexical: it does not translate queries, infer synonyms, or search skill bodies.
- The default page contains at most 5 results. Each result has a name, exact URI, and description excerpt of at most 240 Unicode code points, with `descriptionTruncated: true` when shortened. Long descriptions show context around a matched term. `load_skill` still returns the full verified instructions, including the original frontmatter.
- Search responses include `totalMatches`, `offset` (default 0), and `limit` (default 5, maximum 50). Prefer refining the query or loading a suitable result over fetching every page. If more candidates are useful, pass `nextOffset` as `offset` with the same query and limit; its absence marks the last page. For example, `{"query":"review"}` can be followed by `{"query":"review","offset":5}`. Omitting the query (or passing whitespace) browses in URI order; reserve this for catalog requests or a connection check with `{"limit":1}`.
- The bridge still reads all upstream metadata/manifest pages internally on each search, but only the selected result page reaches the model. This saves model-facing catalog context, not upstream traffic or the cost of reading a selected skill's body. Catalog or relevance changes between calls can shift pages; restart from offset 0 if the catalog changes.
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
