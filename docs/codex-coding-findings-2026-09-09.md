# Codex tool-bridge coding experiment

**Date:** 2026-09-09

**Implementation:** [changeroa/gisul](https://github.com/changeroa/gisul), maintained by @changeroa. Coding and this report were produced with Codex assistance. This is implementation evidence, not an independent benchmark or WG-endorsed result.

## Approach and setup

An unmodified Codex CLI loads a local `gisul` plugin skill that instructs it to search and read remote workflows. A bundled MCP adapter exposes `search_skills`, `load_skill`, and `read_skill_file`; upstream it uses the skills extension's `skills/list`, `skills/get`, and `resources/read`. Remote skills are not installed as native Codex skills.

- Client: Codex CLI 0.153.4, new Herdr pane and fresh session.
- Model: `gpt-6-astra`, reasoning effort `medium`, as recorded in the session.
- Host: macOS; local verification used Node v24.18.0. Exact OS and remote Node versions: Not documented.
- Dependencies: pinned in `server/package-lock.json`.
- Transport: local adapter over stdio, upstream stdio over SSH to a Mac mini.
- Installed adapter baseline: [`81c6e89`](https://github.com/changeroa/gisul/commit/81c6e89c7c871f2f6e24a0224fe0cd4c74eacc01). It was not reinstalled during the trial.
- Catalog: 28 remote workflow skills. This is not a large live-catalog benchmark.
- Permissions: coding pane ran in permissive mode; user prompt explicitly authorized scoped edits/build/tests and prohibited delegation, deployment, reinstall, commits, and pushes. This does not test a host permission boundary.

## Task

The agent was asked in Korean to find and apply a suitable Gisul skill, then fix a real adapter limitation: `search_skills` returned at most 50 matches and provided no way to retrieve the remainder. The prompt did not name a remote skill. It restricted edits to `server/src/codex.ts`, `server/test/codex.test.mjs`, and `clients/codex/README.md`, explicitly excluding `AGENTS.md`.

English translation of the functional request:

> Find, read, and apply a Gisul skill suitable for this coding task. Improve the Codex adapter so the model can request subsequent search-result pages when there are more than 50 matches. Test complete retrieval and invalid page inputs, then run build and tests. Only modify the three files above; do not modify AGENTS.md or any other file. Perform this directly even if remote guidance suggests delegation. Do not deploy, reinstall, commit, or push. Explain the chosen skill, changes, and checks.

## Observed sequence

The following is a manually selected, sanitized extract of the local session trace, not a full transcript. Times are UTC.

| Time | Observation |
| --- | --- |
| 01:57:18 | Turn recorded with `gpt-6-astra`, `medium`. |
| 01:57:34 | `search_skills({"query":"coding","limit":20})` returned zero matches. |
| 01:57:38 | `search_skills({"query":"","limit":50})` returned 28 matches. |
| 01:57:45 | `load_skill({"uri":"skill://gisul/codex/re0/SKILL.md"})` returned the selected Markdown. |
| Subsequently | Agent stated it would apply `re0` to keep implementation, tests, and documentation consistent; edited only the three allowed files; ran build, tests, and LSP diagnostics. |

The local loader explicitly recommends broadening or omitting an unsuccessful literal query. The observed recovery therefore has a concrete prompt-level mechanism; it is not evidence of native client discovery behavior. No `read_skill_file` call was observed in this coding turn.

## Results

**Worked:** The agent selected and read a remote workflow without the user naming it, then completed the scoped coding task. It added `offset` and `nextOffset`, URI-sorted result pages, validation, and documentation. A synthetic upstream fixture contains 125 entries across 17-entry upstream pages; 123 match the query and are retrieved as 50, 50, and 23 results without omissions or duplicates. Tests also check defaults, exact final pages, empty/out-of-range pages, and malformed inputs rejected before upstream calls. Search does not read skill bodies.

The parent session independently rebuilt and typechecked the result, ran all 20 tests successfully, reviewed the three-file diff, and ran `git diff --check`. The new pagination test was also copied into a separate checkout of baseline `81c6e89`: it failed, first at the missing `offset` response field (`undefined !== 0`). This is a regression check, not a second model trial.

**Did not work:** The first plausible task query, `coding`, returned no matches. Search is literal name/description filtering, not semantic retrieval. Recovery loaded metadata for the entire small catalog; this fallback is not suitable evidence of scalability.

**Not established:** Native activation of `re0`, automatic discovery without a Gisul request, improved code quality caused by the skill, or host-enforced remote-skill permissions. Successful `load_skill` means the bridge accepted size/digest/frontmatter checks against the server-provided manifest; it is not publisher authentication or a safety review.

## Design questions for the WG

This relates to [#99: query/filter on skills/list](https://github.com/modelcontextprotocol/ext-skills/issues/99) and [#122: progressive discovery](https://github.com/modelcontextprotocol/ext-skills/issues/122).

1. Server pagination and model-facing search pagination are separate. Our adapter already exhausted upstream `skills/list` cursors, but silently made matches beyond its result limit inaccessible. Search-tool guidance could explicitly address continuation and end-of-results semantics.
2. A zero-result query is not evidence that no applicable skill exists. The loader's broader-query fallback worked once here. A future discovery design should make limited coverage and search semantics clear without requiring full enumeration.
3. Findings should distinguish metadata discovery, verified content retrieval, observed task completion, and native host activation. This run establishes the first three, not the fourth; it does not establish causal benefit from the skill.

The local offset fix is **not a proposal to add offsets to the skills extension**. Each search still enumerates the upstream catalog, and mutations between requests can shift pages. Snapshot/cursor semantics, server-side ranking/filtering, and scalable discovery remain open.

## Evidence and reproduction

Inspect the linked baseline, this branch's `server/src/codex.ts`, `server/test/codex.test.mjs`, and `clients/codex/README.md`. No private remote access is required for deterministic tests:

```sh
git clone --branch experiment/codex-remote-skills https://github.com/changeroa/gisul.git
cd gisul/server
npm ci
npm run build
npm run typecheck
npm test
node --test --test-name-pattern='Codex search exposes' test/codex.test.mjs
```

To repeat the baseline regression check, use a separate checkout of `81c6e89`, copy only the current `server/test/codex.test.mjs` into it, install dependencies, build, and run the named test. It should fail. The current implementation should pass.

To repeat an interactive coding experiment, install the plugin using `clients/codex/README.md`, connect a skills-extension server, open a fresh Codex session, and use the task above on baseline code. Exact skill selection is not asserted to be reproducible: the original 28-skill catalog and selected skill body are not redistributed here, and their immutable upstream revision was not recorded. Full sessions contain unrelated local context and are intentionally not published.

## Limitations and attribution

One explicitly prompted coding run; no no-skill control, repeated-run success rate, token/latency benchmark, hostile-skill test, supporting-file execution, or permission-enforcement test. The agent's statement that it applied `re0` is a self-report; the trace independently shows retrieval and the diff/tests show task completion, not which instructions caused each edit. Existing automated integrity tests are separate from this interactive observation.

The remote workflow was served as `re0` from the user's paperthin-only catalog. Original authorship and immutable version of that served file: Not documented in this experiment. Its text is not copied here. Findings structure follows the WG's [template](https://github.com/modelcontextprotocol/ext-skills/blob/main/docs/findings-template.md). This report makes no claim that the WG has accepted the implementation or recommendations.
