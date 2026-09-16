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
