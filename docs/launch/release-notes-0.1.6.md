# Oathra v0.1.6 — consent-based optional intake

v0.1.6 adds a bounded way to collect explicitly requested information during a phone call while keeping the evidence-backed completion rules from v0.1.5.

## What changed

- `CallContract.intake` requires a collection purpose, consent prompt, declared field keys/questions, a maximum question count and stop-on-decline behavior.
- The runtime asks for consent only after the required call details are complete, asks at most one declared question per turn, and records only the callee's explicit next-turn answer.
- Intake state and answers are emitted as auditable events and saved to `intake.json`; the human-readable `summary.md` includes the purpose, status, answers, timestamps and utterance IDs.
- Scripted, chat-completion and speech-to-speech instructions share the same boundary: no inferred profile, no undeclared questions, and no continuation after a decline.

## Verification

- `pnpm typecheck`
- `pnpm test` — 144 passed, 1 live test skipped
- Intake simulator coverage includes consent granted with two bounded answers and immediate stop after consent decline.

This release records explicit answers requested by the contract. It does not infer a callee profile or sensitive traits, and it does not claim production readiness or a measured PSTN success rate.
