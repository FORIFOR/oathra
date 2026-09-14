# Oathra v0.1.12

v0.1.12 makes consented follow-up intake aware of the conversation scene. A phone agent can gather a small, purpose-bound operational profile after the required outcome is settled without repeatedly pressing the callee or guessing unstated traits.

## What changed

- Added `startAfter` prerequisites so optional intake begins only after the declared mission conditions are verified.
- Added `dependsOn` branching so a later question is asked only after its prerequisite field has an explicit answer.
- Added `choices` for canonical answers; unmatched or ambiguous choices are treated as non-answers.
- Refusal, hold, hedge, question, ambiguity or any other non-answer ends optional intake immediately, even when an older contract sets `stopOnDecline: false`.
- Decision memos include explicit operational-profile answers, skipped dependency branches, utterance IDs and timestamps.
- The Arena, simulator and provider prompts use the same boundaries, so local demonstrations and phone integrations share the contract.

## Scope

The profile is built only from answers the callee explicitly gives to declared questions. Oathra does not infer attributes or sensitive traits, ask undeclared questions, or continue after refusal. `maxQuestions` defaults to three and is hard-capped at eight.

Run the public package without an API key:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.12/oathra-0.1.12.tgz oathra demo
```

The 48-second intake recording at https://forifor.github.io/oathra/#intake-video uses the built-in Arena simulator; it is not a real phone call or a PSTN success-rate claim. Real phone providers still require their own credentials and staged testing.

Validation: typecheck, 652 passing tests with one credential-gated LiveKit test skipped, scenario validation, build, site build, dependency lint, package smoke, false-completion evaluation and adversarial evaluation all passed before publication.
