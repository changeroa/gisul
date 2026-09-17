# Deployment

## Worker and private R2

The Worker in this checkout serves `/mcp` directly from `SKILLS_BUCKET`. It has no origin URL, tunnel, SSH connection, or filesystem dependency. `GISUL_BEARER_TOKEN` authenticates MCP readers; `GISUL_PUBLISH_TOKEN` authenticates publication. These secrets are separate from the Cloudflare account credentials used by Wrangler. Keep the bucket's public access disabled.

The runtime and local integration tests are implemented here. Production activation still requires the skill repository's existing builder and behavioral evaluation gate to be connected, a real release published by GitHub Actions, actual installed-plugin reads, and matching Langfuse evidence. Local fixture tests do not establish those production results.

### Release contract

An immutable prefix `releases/<full Git commit>/` contains the builder's `release.json`, skill files, `inventory.json`, and a Worker-generated `complete.json`. Inventory schema version 1 contains `commit`, `release`, verbatim skill entries (`uri`, `frontmatter`, `resources`), `aliases`, and `files`. Each file has a relative `path`, `digest` in `sha256:<hex>` form, byte `size`, and an optional canonical resource `uri`. Resource digests must agree with the skill manifests. `inventory.json` and `complete.json` are reserved and do not appear in `files`.

Upload `inventory.json` first. It fixes the allowed paths and their bytes for that commit. Subsequent uploads must match it. Existing objects accept identical retries and reject replacement bytes. Supporting resources are served only through verified manifests.

| Publication endpoint | Method | Purpose |
| --- | --- | --- |
| `/admin/current` | GET | Read current identity and its ETag |
| `/admin/releases/<commit>/<path>` | PUT | Upload an immutable object |
| `/admin/promote` | POST | Verify and activate a release |
| `/admin/rollback` | POST | Verify and reactivate a retained release |

Promotion and rollback accept `commit`, `release`, `inventory_digest`, `expected_etag` (null only for the first publication), and a positive integer `sequence`. The inventory digest hashes its exact uploaded bytes. Verification checks the builder's per-skill manifest digests, SKILL.md frontmatter, every stored object's size and digest, and the complete object inventory before creating the completion marker. Rollback requires an existing completion marker from a previously verified promotion and rechecks the retained bytes. Only then does a conditional write replace `current.json`. R2's [conditional writes and consistency guarantees](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations) provide the storage primitive; tests exercise its concurrent behavior in the local Worker runtime.

The pointer records a revision and the highest promotion sequence/commit. Rollback preserves that high-water mark. A delayed lower-sequence publication cannot undo a newer release or a rollback. Retrying a verified release that is already current returns its existing revision. After any uncertain write outcome, reread `/admin/current` before retrying.

The GitHub Actions publisher must use one fixed production concurrency group with `cancel-in-progress: false`, retain the existing validation/evaluation gates, and check the current high-water commit is an ancestor of the candidate on main before promotion. Use a sequence from that fixed workflow and do not reset it. R2's ETag check is the final concurrency guard; the authenticated publisher is responsible for establishing Git ancestry and successful evaluation. No real-content publication is authorized by a local fixture pass alone.

`skills/get` returns the selected release and commit. The bridge sends `params._meta["io.gisul/commit"]` on subsequent body and directory reads. Those requests use the completed immutable prefix; discovery and new loads read the latest pointer. Retain completed releases while existing connections may use them. Search evidence, load evidence, and file-read evidence carry release/commit for the trace exporter.

### Initial activation

Verify `wrangler whoami`, the configured account, the existing Worker deployment, and the private bucket. Build and test both packages from the repository root before compiling the Worker:

```sh
npm --prefix server ci
npm --prefix server run build
npm --prefix server test
npm --prefix worker ci
npm --prefix worker run typecheck
npm --prefix worker test
cd worker
npx wrangler versions upload --dry-run
```

For migration, upload a candidate Worker version and use its preview URL to validate authentication and publish the first gated release. Keep production traffic on the existing version until the actual plugin can search, load, and read verified files from the candidate and release/commit is present in Langfuse. Then activate the tested version and record its source commit, Cloudflare version ID, content commit, inventory digest, and permanent checkout paths. [Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) separate uploading a candidate from activating it.

## Mac mini server

Run from a clean, committed checkout:

```sh
scripts/deploy-macmini.sh macmini
```

The host is an SSH alias with BatchMode access. The defaults are the remote user's
`~/gisul` and launchd label `com.iyendev.gisul-mcp`; override them with
`GISUL_DEPLOY_ROOT` and `GISUL_DEPLOY_LABEL`. The target must already have the HTTP
LaunchAgent, its secret files, and the `gisul` executable configured. The script
checks that launchd's working directory matches the target before changing it.

The script runs `npm ci`, build, and the complete server test suite locally. It
rsyncs only tracked server files and the compiled `dist/` to a unique staging
directory, including `package-lock.json`. The remote host installs production
dependencies in staging before replacing the current server. The previous server,
including its dependencies and any extra files, remains in
`~/gisul/.deploy/server.bak-<deployment-id>`.

Only `~/gisul/server` is replaced. Skill content, token stores, LaunchAgents, and
the Cloudflare tunnel are outside the deployment. Existing stdio sessions retain
their running process; fresh sessions use the new build. The HTTP LaunchAgent is
restarted with `launchctl kickstart`.

The launcher must have its executable bit committed. Deployment checks it before
activation. `kickstart` has a 15-second timeout; on failure the script re-queries
the service and reloads the same LaunchAgent with `bootout`/`bootstrap` to clear
macOS spawn throttling. Other LaunchAgents are not restarted.

Smoke checks initialize the actual server over stdio, verify the skills extension,
exercise bridge pagination (`nextOffset`), load and verify a skill, and compare the
authenticated HTTP catalog with stdio. At least two valid skills are required.
Credentials are read from the existing LaunchAgent environment and remain on the
remote host. A failed restart or smoke check restores the previous server and
checks HTTP health. Failed candidates remain available for diagnosis.

`server/deployment.json` records the actual source commit, canonical checkout path,
and hashes and modes of the payload files. Each run also records its state in
`~/gisul/.deploy/<deployment-id>.json`. Repeating an unchanged commit verifies file
hashes and runs the smoke checks without replacing or restarting the server.

## Interrupted deployments

A lost SSH response is not evidence that the write failed. Inspect the journal
and `.deploy/lock/owner.json` before retrying. A concurrent deployment cannot acquire
the same lock. If the journal says `deployed` or `unchanged`, the operation finished.

If a process was interrupted during activation or recovery, confirm its PID is no
longer active before touching the lock. Use the journal's exact `current`, `backup`,
and `stage` paths. Preserve an activated candidate under a new failed-candidate
path, restore the backup to `server`, restart the same LaunchAgent, and verify
`/healthz` and stdio. Only then remove the stale lock and rerun. The two directory
renames have a short interruption window; the journal and retained backup make
that state recoverable. Never discard a backup to make a retry succeed.

Plugin installation is a separate step; see [the Codex client](../clients/codex/README.md).
