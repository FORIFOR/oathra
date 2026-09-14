# Oathra v0.1.10

v0.1.10 packages the consent-based follow-up intake demo and the YAML scenario handoff in the public GitHub asset.

## What changed

- Added the built-in `restaurant-reservation-intake` Arena mission and an intake panel that shows consent, question count and explicit answers.
- Added Japanese and English simulator recordings with captions, plus the scenario and local command in the README.
- Hardened the video renderer's Chrome startup wait and made its capture/render ports configurable.

## Safety and scope

Intake starts only after required mission fields settle. It asks one declared field per turn, records explicit answers with utterance IDs and timestamps, and stops on decline, hold or ambiguity. Oathra does not infer a callee profile or collect undeclared or sensitive attributes.

The public package is distributed as the GitHub Release asset until npm publishing credentials are configured:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.10/oathra-0.1.10.tgz oathra demo
```

Validation: local typecheck, build, 148 passing tests with one credential-gated live test skipped, scenario validation, false-completion eval, 10,000-run adversarial eval and package smoke are required in CI.
