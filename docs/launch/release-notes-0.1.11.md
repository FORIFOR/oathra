# Oathra v0.1.11

v0.1.11 carries the provisional-confirmation guard into the public package. Phrases such as 仮押さえ, 未確定, 承認待ち and 確認待ち no longer satisfy a reservation confirmation until the callee gives a later, unambiguous commitment.

## What changed

- Expanded conservative hedge detection for provisional, pending-approval and confirmation-needed Japanese phrases.
- Added 500 regression cases covering 25 provisional phrasings across 20 numeric conditions; a later independent confirmation can still complete the call.
- Added the enterprise-readiness evidence record and reproducible validation commands.
- Kept the v0.1.10 consent-based intake flow: consent once, one declared field per turn, stop on decline, hold or ambiguity, and save only explicit answers.

## Scope

The guard is tested against the scripted simulator and does not establish a live PSTN success rate. Oathra still does not infer a callee profile or collect undeclared or sensitive attributes.

Install the public GitHub asset:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.11/oathra-0.1.11.tgz oathra demo
```

Validation on the release source: typecheck, build, 648 passing tests with one credential-gated live test skipped, scenario validation, false-completion evaluation, adversarial evaluation and package smoke. The `main` branch has since added intake provenance hardening and now reports 649 passing tests; the tagged tarball remains immutable for reproducibility.

For first-time setup, see the [Japanese setup guide](https://github.com/FORIFOR/oathra/blob/main/docs/SETUP.ja.md) or [English setup guide](https://github.com/FORIFOR/oathra/blob/main/docs/SETUP.en.md). The current branch also documents [security reporting](https://github.com/FORIFOR/oathra/blob/main/SECURITY.md) and the [integration contract](https://github.com/FORIFOR/oathra/blob/main/docs/INTEGRATION.ja.md).
