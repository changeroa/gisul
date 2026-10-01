# IYEN Gisul OAuth

The IYEN Worker can serve read-only MCP clients through GitHub OAuth at
`https://gisul.iyendev.com/mcp`. OAuth is enabled only when `GISUL_PUBLIC_URL`
is set. The ordinary Wrangler config retains the existing token-only behavior.

OAuth uses Cloudflare's pinned provider, S256 PKCE, explicit browser consent,
cookie-bound expiring login state, single-use authorization flow, short-lived
access tokens and refresh tokens. Only `skills:read` is accepted. GitHub login
requests no organization or repository scope. `GISUL_GITHUB_USER_IDS` is a
comma-separated allowlist of stable numeric GitHub IDs; account access is
checked at login, MCP requests and refresh. The initial deployment permits
`changeroa` (`65930387`). Changing a username does not transfer access.

The OAuth entrypoint and native read tools were adapted from the existing
ARKPOINT implementation at `a64e376`. IYEN uses its own OAuth app, KV namespace,
Cloudflare account and existing skill bucket. It does not use ARKPOINT grants,
credentials, membership rules or skill releases.

## Compatibility

Existing reader/writer bearer credentials retain their original MCP behavior
on both the custom domain and workers.dev route. Publication still requires its
separate publisher token. OAuth grants cannot write skills or publish releases.
Native search/load/read tools are enabled for authenticated OAuth connections;
they preserve immutable commit and load identity across release changes.

## Configuration and deployment

`worker/wrangler.oauth.jsonc` explicitly targets account
`8277c1acc712e4a9d00479255015c200`, Worker `gisul-mcp`, the existing
`gisul-skills-releases` bucket and dedicated `gisul-iyen-oauth` KV namespace.
The personal GitHub OAuth app is
[IYEN Gisul](https://github.com/settings/applications/3896163), with homepage
`https://gisul.iyendev.com` and callback `https://gisul.iyendev.com/callback`.
Provision `GITHUB_CLIENT_SECRET` as a Worker secret through stdin or a private
file. Never commit it or print the secret/config contents during verification.

Build and test from a clean, committed checkout:

```sh
npm --prefix server ci
npm --prefix worker ci
npm --prefix server run build
npm --prefix server test
npm --prefix worker run typecheck
npm --prefix worker test
cd worker
npx wrangler deploy --config wrangler.oauth.jsonc --dry-run
```

Push the verified commit and check its PR/CI before deployment. Deploy that
exact source using `--config wrangler.oauth.jsonc` and
`--var GISUL_SERVER_VERSION:<commit>`. Keep the old deployment version and
machine connection until the new OAuth client completes a live search, pinned
load and supporting read. A health response or metadata endpoint alone does
not verify login or tool calls.

The OpenClaw loader in [PR #8](https://github.com/changeroa/gisul/pull/8)
supports preparing a full OAuth bundle with this endpoint. Authenticate the
OpenClaw profile, then remove only the superseded standalone Gisul MCP entry,
refresh the Gateway and test a fresh agent session. Other servers and settings
remain unchanged.

## Verification state

Local server tests: 49 passed. Worker tests: 59 passed, including 14 OAuth
integration tests and the existing reader/writer/publication compatibility
tests. Type checking, search benchmark and OAuth deployment dry run passed.
GitHub app creation and dedicated KV provisioning are complete. Secret
provisioning and production OAuth login require completing GitHub's current
account reauthentication prompt; deployment and OpenClaw migration are pending.
