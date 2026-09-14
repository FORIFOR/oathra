# Oathra v0.1.14

v0.1.14 makes optional intake consent transparent in the spoken call.

- The runtime now reads the declared collection purpose before asking the consent question when the configured `consentPrompt` does not already contain that purpose.
- Brain-kit, GPT-Live and OpenAI Realtime instructions use the same rendered consent line, so local simulation and phone transports share the wording.
- A prompt that already states its purpose is kept unchanged; callers do not hear duplicate wording.
- The existing boundary remains: required mission details and constraints settle first, consent is asked once, one declared field is asked per turn, and refusal, hold, ambiguity or an unmatched choice stops collection.

The resulting record still contains only explicit answers to contract-declared fields. `intake.json` and `summary.md` keep the consent provenance, answers, utterance IDs and timestamps; no caller attribute is inferred.

## Verification

- `pnpm test -- --runInBand`: 655 passed, 1 skipped credential-gated LiveKit test.
- `pnpm build`, `pnpm typecheck`, and `pnpm lint:deps` pass.
- `oathra play scenarios/restaurant/restaurant-reservation-intake.yaml --fast` speaks the purpose before consent and records both declared answers.

The Arena recordings remain simulator demonstrations, not real phone calls or a PSTN success-rate claim. Real phone providers still require their own credentials and staged testing.
