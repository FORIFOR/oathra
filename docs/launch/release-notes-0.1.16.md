# Oathra v0.1.16

v0.1.16 adds `ActionProof`, a typed contract for tracking how a phone-agent action is supported from the conversation through confirmation, system evidence and the observed outcome.

- `claimed` (V0) is kept separate from independently observed proof.
- `conversation` (V1) adapts the existing callee-utterance evidence without changing the current verifier.
- `confirmation` (V2), `system` (V3) and `outcome` (V4) observations require an explicit source, stable reference and valid timestamps; no provider-specific credentials or adapters are bundled.
- A higher-level observation never replaces a valid lower-level result when it is unverified, expired or conflicting.
- The SDK exports the proof types, evaluator and source contracts from `oathra/evidence`.

This release does not claim that a provider account, reservation system or PSTN call was verified. Real email, SMS, webhook, reservation API, browser, calendar and POS adapters still require the target system's authentication and contract.

## Verification

- `pnpm test`: 664 passed, 1 skipped credential-gated LiveKit test.
- `pnpm typecheck`, `pnpm lint:deps`, `pnpm build`, `pnpm build:site` and `git diff --check` pass.
- The packed `oathra@0.1.16` tarball exports `PROOF_LEVELS` and includes `types/evidence/proof.d.ts`.
- The Arena recording remains a simulator demonstration, not a real phone call or a PSTN success-rate claim.
