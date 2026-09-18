# Oathra v0.1.17

v0.1.17 adds a local MCP server, fixes a call-ending bug in the permission flow, and gives the call loop and the phone bridge their first dedicated tests.

## `oathra mcp`

An MCP server over stdio. From Claude Code, Claude Desktop or any MCP client, one tool call runs a simulated phone call and returns a result backed by evidence from the callee's own words.

```json
{ "mcpServers": { "oathra": { "command": "npx", "args": ["--yes", "--package=https://github.com/FORIFOR/oathra/releases/download/v0.1.17/oathra-0.1.17.tgz", "oathra", "mcp"] } } }
```

- `simulate_call` — built-in agent against a scripted callee. Same seed, same result. Returns fields, the evidence behind each one with utterance ids, the callee's ground truth and `falseCompletion`.
- `verify_transcript` — the same check as `oathra verify`, for your own transcripts.
- `inspect_call` — result and evidence of a saved call; `at: "00:12"` shows what was verified at that moment.
- `list_calls`, `list_scenarios`.

Everything runs locally with no API key and no cost. There is deliberately no tool that dials a real phone and no argument that selects a paid LLM; `call`, `intervene` and `cancel_call` wait until the real-call path has been re-verified. `inspect_call` accepts call ids only, never paths. It does hand the contents of `.oathra/calls/` to the MCP client, so keep that in mind where real-call recordings are stored.

## Fix: a permission request no longer ends the call

When a brain asked for an action the contract had not pre-authorised (for example `payment`), the runtime moved `VERIFYING -> AWAITING_PERMISSION`, a transition the state table did not allow. The exception ended the whole call as `error` before the `PermissionGate` was asked. LLM brains are instructed to make such requests and the built-in agent does so for `share_name`, so this was reachable. It failed safe — it could not produce a false completion — but the call was lost. The transition is now allowed and covered by tests for deny, human approval and policy approval.

## Tests

`packages/runtime` and `packages/phone` had no test files. They now cover evidence-only completion, an agent's self-claim not completing, voicemail, turn budget, hangup and error paths, `cancel()`, utterance coalescing, the repeat guard, permissions, speech-to-speech transports, consent-gated intake, bridge audio conversion (PCM 24 kHz to μ-law 8 kHz keeps signal energy), idempotent close, carrier and engine failures, routing and list prices.

## Verification

- `pnpm test`: 731 passed, 1 skipped credential-gated LiveKit test (676 before this work).
- `pnpm build`, `pnpm lint:deps`, `oathra eval` (False Completion 0) and `oathra eval --adversarial 10000` (0 / 10000) pass.
- The MCP server was driven end to end over stdio against the bundled binary: stdout carries JSON only.
- Not verified: a real MCP client UI, and real telephony. No phone call was placed for this release; the post-fix live-call path from 2026-09-15 still has no successful verified conversation (`docs/launch/real-calls.md`).

Readiness=USER_APPROVED_RELEASE · ManualSmoke=NOT_RUN_BY_ASSISTANT · UserOverride=YES · ReleaseRisk=ACCEPTED_BY_USER
