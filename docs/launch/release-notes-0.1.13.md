# Oathra v0.1.13

v0.1.13 is a patch release that aligns the public CLI package with the latest `main` fixes after v0.1.12.

## What changed

- `oathra play --json` now emits machine-readable JSON only, including the verified result, explicit intake answers, metrics and (when enabled) the saved call path.
- Replay remains compatible with calls created before `intake.json` existed.
- Declined or ambiguous follow-up intake is labeled as a follow-up record, never as a consented profile.
- Optional intake waits for every required mission constraint to be known and satisfied before asking for consent.

The scene-aware, consented intake boundary from v0.1.12 remains unchanged: questions are contract-declared, one field is asked per turn, and refusal, hold, ambiguity or an unmatched choice stops collection without saving a guessed value.

Run the public package without an API key:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.13/oathra-0.1.13.tgz oathra demo
```

The Arena recordings are simulator demonstrations, not real phone calls or a PSTN success-rate claim. Real phone providers still require their own credentials and staged testing.

Validation on the tagged source: typecheck, 654 passing tests with one credential-gated LiveKit test skipped, scenario validation, build, site build, dependency lint, package smoke, false-completion evaluation and adversarial evaluation.
