# Mac mini server deployment

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
