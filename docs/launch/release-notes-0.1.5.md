# Oathra v0.1.5 — evidence-backed decision memos

v0.1.5 keeps the v0.1.4 phone setup path and adds a readable memo to every saved call.

## What changed

- `saveCall()` writes `summary.md` beside `result.json`, `metrics.json`, `transcript.json` and `events.jsonl`.
- The memo lists verified decisions, missing fields, supporting utterances, confidence, turn count and end reason.
- The summary is rendered only from contract fields and verified evidence. Oathra does not infer a callee profile.
- The README, integration guides, website and published Zenn articles describe the same scope and consent boundary.

## Verification

- `pnpm typecheck`
- `pnpm test` — 139 passed, 1 live test skipped
- CI — all jobs passed, including the 10,000-run adversarial evaluation and package smoke test

The release does not claim production readiness, a measured PSTN success rate or automatic profiling. Extra intake still requires an explicit contract extension with purpose, fields, question limit, consent and stop-on-decline behavior.
