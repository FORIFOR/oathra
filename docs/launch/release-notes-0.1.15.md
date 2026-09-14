# Oathra v0.1.15

v0.1.15 makes consented follow-up intake stop when the callee signals time pressure, and keeps live voice models aware of the profile fields already answered.

- Japanese and English time-pressure phrases such as 「今ちょっと急いでおります」, “I’m busy” and “call me back later” end optional intake without saving a guessed value or repeating the question.
- OpenAI Realtime and GPT-Live context updates now include recorded answers, declined or skipped fields and the field currently awaiting an answer. The runtime remains authoritative and still allows only one declared field per turn.
- Decision memos now include each intake answer’s utterance ID and timestamp alongside the transcript, matching the audit detail in `intake.json`.

The profile remains an explicit operational profile: fields, purpose, question limit and consent are declared in the contract. Oathra does not infer personality, demographics or sensitive traits, and it does not continue after refusal, ambiguity, a hold or a time-pressure signal.

## Verification

- `pnpm test -- --runInBand`: 655 passed, 1 skipped credential-gated LiveKit test.
- `pnpm exec vitest run providers/openai-realtime/src/realtime.test.ts providers/simulator/src/simulator.test.ts`: 25 passed.
- `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm build:site` and `git diff --check` pass.
- `oathra play scenarios/restaurant/restaurant-reservation-intake.yaml --fast --json --no-save` returns `result.status: completed`, `intake.status: complete`, two explicit answers and no declined fields.

The Arena recording remains a simulator demonstration, not a real phone call or a PSTN success-rate claim. Real phone providers still require their own credentials and staged testing.
