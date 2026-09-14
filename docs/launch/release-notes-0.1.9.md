# Oathra v0.1.9

v0.1.9 carries consent-based optional intake from a YAML scenario into the same `CallContract` used by local simulation and real phone calls.

## What changed

- Added `mission.intake` to the scenario YAML schema.
- `contractFromScenario()` now preserves the declared purpose, consent prompt, fields, question cap and stop-on-decline rule.
- `oathra play ./scenario.yaml` and `oathra call --scenario ./scenario.yaml --to +81...` therefore exercise the same bounded intake contract.
- Added a scenario conversion test and updated the beginner setup and integration guides.

## Safety and scope

Intake starts only after required mission fields settle. It asks one declared field per turn, records explicit answers with utterance IDs and timestamps, and stops on decline, hold or ambiguity. Oathra does not infer a callee profile or collect undeclared attributes.

The public package is distributed as the GitHub Release asset until npm publishing credentials are configured:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.9/oathra-0.1.9.tgz oathra demo
```

Validation: local typecheck, build, 148 passing tests with one credential-gated live test skipped, scenario validation, false-completion eval, 10,000-run adversarial eval and package smoke are required in CI.
