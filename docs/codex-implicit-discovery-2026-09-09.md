# Unprompted remote-skill discovery during a coding task

**Date:** 2026-09-09. **Author:** @changeroa, with Codex-assisted implementation, observation, and reporting.

## Question and result

Does the current Gisul Codex plugin cause a coding agent to discover and read a remote workflow when the user asks only for a code change?

**In this single run, no.** The coding task completed, but the recorded turn contained no remote-skill search or read call and no local Gisul loader-file read. This is a result for this configuration, not a claim that Codex cannot implicitly invoke skills, that MCP failed, or that the task required a remote skill.

## Setup

- Repository: [changeroa/gisul](https://github.com/changeroa/gisul), starting at `99edd68` on `experiment/codex-remote-skills` with a clean worktree.
- Fresh Codex CLI 0.153.4 session in a new Herdr pane, same repository. No previous conversation was sent to this pane.
- Model/effort recorded in the turn: `gpt-6-astra`, `high`. No model override was supplied by the experiment runner.
- macOS, Node v24.18.0; exact OS version: Not documented. Worker dependencies are recorded in `worker/package-lock.json`.
- Installed plugin: `gisul`, version `0.1.0+codex.20260908084946`; baseline adapter source at `81c6e89`. No reinstall or loader change during the experiment.
- One native local loader, backed by an MCP tool adapter over stdio and an upstream skills-extension server over SSH. Remote entries were not materialized as native local skills.
- Existing project instructions and other installed skills remained enabled. The repository itself contains skill-related documentation, so this is not a neutral or blinded environment.
- Coding pane used permissive execution settings. The prompt authorized scoped local work, forbade delegation/deployment/commits/pushes, and explicitly protected `AGENTS.md`.

The initial session's available-skills message included the installed loader description:

> Find and apply personal or team workflow instructions from the connected gisul remote skill library. Use when the user mentions gisul, requests a remote skill, or asks to follow a workflow maintained in that library.

**Important confound:** This is an opt-in-oriented description, not a general instruction to search for workflows on every coding task. Non-invocation is consistent with that declared scope. We intentionally tested the unchanged implementation, not a broadened trigger.

## Exact task prompt

```text
worker/src/index.ts에서 프록시 응답에 CORS 헤더를 붙일 때 upstream의 Vary 헤더가 덮어써지는 문제를 수정해줘. 기존 Vary 값을 보존하면서 Origin을 대소문자 구분 없이 중복 없이 추가하고, Vary: *는 그대로 유지해줘. Origin 요청 헤더가 없을 때는 기존 Vary를 바꾸지 마. 회귀 테스트를 추가하고 테스트와 타입 검사를 실행해줘. 수정 범위는 worker/ 안으로 제한하고 AGENTS.md와 다른 디렉터리는 수정하지 마. 필요한 로컬 코드 수정과 테스트 실행은 승인한다. 다른 에이전트에게 위임하지 말고 직접 수행해줘. 배포, git 커밋·푸시는 하지 마. 완료하면 변경 내용과 검증 결과를 알려줘.
```

In English: fix the Worker's overwritten upstream `Vary` header, preserve existing values, add `Origin` without case-insensitive duplication, preserve `*`, and leave `Vary` unchanged without a request Origin; add regression tests and typecheck. Only modify `worker/`, without delegation or deployment. There is no mention of Gisul, skills, or remote workflows in the task prompt. No follow-up hints were sent.

## Evidence

The complete coding turn had seven `exec` tool-call envelopes. The table is a sanitized inventory from the local JSONL trace, not the model's internal reasoning. Times are UTC.

| Time | Nested tool calls |
| --- | --- |
| 02:17:05 | `exec_command` (file discovery; also inspected LSP/AST tool metadata) |
| 02:17:13 | `exec_command`, `lsp_activate_workspace` |
| 02:17:52 | `apply_patch`, `exec_command` |
| 02:18:12 | `apply_patch`, `exec_command` × 3, `lsp_diagnostics` |
| 02:18:27 | `exec_command` |
| 02:18:33 | `write_stdin` |
| 02:18:39 | `exec_command` × 2 |
| 02:18:50 | `task_complete` event |

Inspection of tool-call inputs found no `search_skills`, `load_skill`, `read_skill_file`, extension `skills/list` or `skills/get` call, or read of the Gisul loader. Source reads were the project instructions and Worker files; no earlier experiment report was read. The remote discovery/read stages were not reached.

Separately, the parent session ran `server/smoke-codex-plugin.mjs` against the same installed plugin configuration. It returned 28 matches and successfully loaded and re-read `skill://gisul/codex/aim/SKILL.md` with verification. This confirms that the configured backend could serve content at experiment time. **It is not a call by the coding agent, nor proof of its in-process MCP readiness.** No remote content from that check was sent to the coding pane.

## Coding outcome and reproduction

Only `worker/src/index.ts`, `worker/package.json`, and new `worker/test/cors.test.mjs` were changed by the coding agent. It reproduced seven failing regression cases before the fix; all 20 cases passed afterward. Typecheck initially failed because Worker dependencies were absent, then passed after `npm ci --ignore-scripts`. The parent independently reran the tests/typecheck and confirmed seven failures against the baseline source in a separate temporary checkout. No deployment occurred.

Use Node v24.18.0 for the test's direct TypeScript import:

```sh
cd worker
npm ci --ignore-scripts
npm test
npm run typecheck
```

To reproduce the regression, copy the new `worker/test/` into a separate checkout of `99edd68` and run `node --test worker/test/cors.test.mjs`: 13 pass, 7 fail. On the corrected code, all 20 pass.

To repeat the model observation, start from `99edd68`, install the plugin following `clients/codex/README.md`, preserve the loader description above, open a fresh Codex session, and send the exact prompt. Record the initial skill metadata and all tool calls through completion. Do not inject an extra request to use skills. Model behavior is nondeterministic; this is a procedure, not an expected universal outcome. Full local transcripts are not published because they contain unrelated personal configuration. The private catalog and its immutable revision are not redistributed/documented; this limits exact interactive reproduction.

## Interpretation for the WG

The relevant boundary is **starting discovery**, before query quality or reading a returned URI. A tool bridge can successfully fetch remote content when called while remaining unused for a plain coding task. For findings about the interim search-tool approach in [ext-skills #99](https://github.com/modelcontextprotocol/ext-skills/issues/99), it is useful to record:

1. What skill/loader metadata the host initially exposes.
2. Whether the user explicitly requested remote workflows.
3. Whether search was invoked, separately from whether returned content was read.

This observation does not justify a new protocol method by itself. A next controlled experiment would vary loader trigger wording or exposure of task-specific metadata while holding task, model, permissions, and repository state fixed. Those variants have **not** been tested here. The previous explicitly prompted pagination experiment used a different task and reasoning effort, so it is not a matched control.

**Limitations:** one task, one run, precise requirements that may make extra guidance unnecessary, no established necessity of a particular remote skill, no native-vs-remote comparison, no quality or causal-benefit measurement, no general success rate, and no permission-enforcement test.

**Sources:** implementation and local execution trace described above; WG [findings template](https://github.com/modelcontextprotocol/ext-skills/blob/main/docs/findings-template.md). [Official OpenAI documentation](https://learn.chatgpt.com/docs/build-skills) describes implicit invocation based on a skill's description; it does not predict selection in this run. No WG endorsement is claimed.
