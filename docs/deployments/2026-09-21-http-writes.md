# Authenticated HTTP skill writes — 2026-09-21

Production Worker source: `bc6ba43045fb6303c3b1a631e28a40381be63ad2`.
Worker version at 100%: `baef02cb-a827-4cf3-98d4-cdc79dac9a92`.
Endpoint: https://gisul-mcp.changeroa.workers.dev/mcp
Canonical runtime source: `/Users/victor/dev-tools/gisul` (main).
Permanent deployment checkout: `/Users/iyen/dev-tools/gisul-cloudflare-production` on macmini, detached at the runtime commit.

The user explicitly removed mandatory model evaluation and human rating requirements for skill publication. Policy commit: `fca099f1e61b42c04802d76356eb05582832b072` in `changeroa/gisul-skills`; [publication run](https://github.com/changeroa/gisul-skills/actions/runs/35562959323) succeeded and produced release `20260921.18`. Validation, Git ancestry/latest-main, byte/manifest integrity, immutable releases, conditional promotion, and sequence fencing remain intact. Optional evaluations are not represented as completed.

HTTP writer authentication is separate from reader and publication credentials. The Worker uses a server-side GitHub credential for the fixed `changeroa/gisul-skills` repository. Create commits SKILL.md and supporting text together; update checks the loaded digest and preserves supporting files. Neither operation writes R2 directly. The publication workflow remains the sole content activation path. Responses distinguish accepted, pending, failed, and published states.

Runtime verification: 43 Worker tests, 48 server/bridge tests, and 37 skills-repository tests passed. The actual workerd test covers successful outbound Git create/update, not only a mocked writer function. It also rejects redirects without forwarding credentials, tests reader/writer separation, and verifies no direct R2 mutation. The initial live write failed before its first Git request because workerd rejects `redirect: error`; the deployed revision uses `manual` and rejects redirect responses. Main was checked before retrying, and no duplicate write occurred.

Installed plugin: `0.1.0+codex.20260921050413`, source `/Users/victor/plugins/gisul`, cache `/Users/victor/.codex/plugins/cache/personal/gisul/0.1.0+codex.20260921050413`. It uses a private writer token file; no credentials are in source. Fresh process tool discovery shows search/load/read plus create/update/write-status. Existing sessions need a new thread to refresh their registered tools.

The HTTP create request saved `ux-state-review` and three supporting files in content commit `981b9a3de8b9d9a094d3e2cbfe041999258d375a`. [Content publication run](https://github.com/changeroa/gisul-skills/actions/runs/35563526640). Final publication and file-parity evidence is recorded below after readback.

The canonical content repository is `/Users/victor/dev-tools/gisul-skills`; its local main tracks the published commits. Its existing working branch `codex/preserve-decisions` was preserved without checking out or merging over that unrelated work. Both temporary task worktrees were removed after their commits were retained in main.

## Final verification

Content publication succeeded as release `20260921.19`, commit `981b9a3de8b9d9a094d3e2cbfe041999258d375a`. The installed plugin searched and loaded the new skill, then read both references and UI metadata through the pinned manifest. All four files matched the local authored bytes. Published SKILL.md digest: `sha256:8d927540ffe14802804d080b8cb0910c9103a6e886cdbab7a2f40e8e042a35ac`. An HTTP update with the loaded digest and identical Markdown returned `unchanged`, with no additional commit. Actual content-changing update behavior passed the workerd integration test; no unnecessary live content edit was made for testing.

The successful publication run took approximately 6.5 minutes for upload, verification, staged reads and activation of the full catalog. Evidence: `.deployment-evidence/http-ux-state-review.json` in the canonical runtime checkout. The original 33-skill catalog now includes ux-state-review as the 34th skill.
