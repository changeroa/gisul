# Gisul connection diagnostics

Run the diagnostic against the exact installed plugin:

```sh
cd server
node diagnose-codex-connection.mjs /path/to/installed/gisul upstream-close 2 /path/to/close.jsonl
node diagnose-codex-connection.mjs /path/to/installed/gisul idle 1800 /path/to/idle.jsonl
```

Each JSONL file contains connection metadata, timestamped bridge stderr, and
before/after `search_skills` and `load_skill` results. It records counts, URI, error,
and duration, without skill bodies. Existing output files are never overwritten.

To observe an actual MacBook sleep/resume without triggering power changes:

```sh
node diagnose-sleep-wake.mjs /path/to/installed/gisul 86400 /path/to/sleep-wake.jsonl
```

The probe first verifies search/load and remains connected. It accepts only a
`pmset` system Sleep followed by a full Wake after arming; sleep-prevention
assertions, process pauses and maintenance DarkWake do not count. It records
post-wake calls on the existing bridge and a fresh bridge, then exits. A timeout
leaves the scenario unexecuted. Schedule a real sleep with the machine's user;
the probe itself only reads power logs and never suspends the computer.

`upstream-close` terminates exactly one SSH child of the newly created diagnostic
bridge. It does not restart shared sshd or terminate other clients. `idle` performs
no MCP calls during the interval. The same idle command can bracket a separately
scheduled laptop sleep/resume or sshd restart; record the actual operation and
timestamps alongside the log. These are distinct scenarios, not interchangeable
proof of a root cause.

## 2026-09-16 observations

- Plugin `0.1.0+codex.20260916075355`, Mac mini server commit `aebeca48afff`.
- A fresh Codex app-server ephemeral thread connects and reads 32 skills with
  verified content. The earlier running conversation's MCP connection returned
  `Not connected`.
- Closing only the diagnostic bridge's SSH child reproduces `Not connected` for
  both subsequent search and load calls. The bridge process stays alive and does
  not reconnect. The before calls succeeded against the same server.
- This establishes a missing reconnection path after upstream closure. It does
  **not** establish why the earlier conversation lost its connection.
- The 30-minute idle run is recorded separately. Actual machine sleep/resume and
  shared sshd restart need a coordinated maintenance interval; they have not been
  executed by the isolated-connection test.

Evidence lives with the PRD implementation record:
`langfuse-review-20260915/implementation/{fresh-codex-smoke.json,upstream-close.jsonl,idle-30min.jsonl}`.

## 2026-09-17 observations

An isolated OpenSSH 10.3p1 daemon on Mac mini loopback was stopped and restarted
while the installed bridge retained its authenticated SSH session. Search/load
before and after succeeded with the same connection ID and release `20260917.2`;
a fresh connection also succeeded. Restarting this listener alone did not close
established sessions. This does not cover restarting macOS's shared launchd SSH
service or terminating its child sessions. The test listener and its ephemeral
private keys were removed afterward; public port 22 was unchanged.

The MacBook power log contains no system sleep/full-wake transition for Sep 16–17
as of 10:46 KST, so it cannot establish sleep/resume behavior. A dedicated
observer is available for the actual sleep. The original connection-loss cause
remains unknown; neither successful listener restart nor synthetic child closure
proves that cause. Evidence: `implementation/mvp-closure/isolated-sshd.jsonl`.

At 11:15 KST, a separate diagnostic attempted to restart the default macOS
`system/com.openssh.sshd` service. An independent launchd rescue job was armed
before the attempt. Even under sudo, `launchctl bootout` returned exit 1,
`Operation not permitted`. The service remained loaded; the rescue job found
no restoration necessary. Existing and fresh bridge calls both succeeded, but
this was **not an executed shared-service restart**. The task-owned restart and
rescue jobs were removed after their journals were saved. No OS protection was
changed. Evidence: `implementation/mvp-closure/default-sshd.jsonl` and
`implementation/mvp-closure/default-sshd-journals.json`.

The sleep observer was stopped before that SSH attempt to keep the scenarios
separate, then armed again at 11:21 KST with a fresh connection and a new log,
`implementation/mvp-closure/sleep-wake-20260917-rearmed.jsonl`. Initial search
and load succeeded. Its deadline is September 18 at 11:21 KST; until a real
system Sleep/full-Wake pair is recorded, sleep/resume remains untested.
