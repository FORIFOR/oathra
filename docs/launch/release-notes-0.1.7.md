# Oathra v0.1.7 — non-pushy consent handling

v0.1.7 is a safety patch for the consent-based optional intake introduced in v0.1.6.

## What changed

- An ambiguous, hesitant or non-yes/no reply to the consent prompt is treated as no consent.
- Optional intake stops immediately after that reply; the consent prompt is not repeated and no field answer is recorded.
- The outcome still records the stop as `intake.consent` with `granted: false`, so the decision is auditable without storing a guessed profile.

## Verification

- `pnpm build:site`
- `pnpm typecheck`
- `pnpm test` — 145 passed, 1 live test skipped
- Simulator coverage verifies that an ambiguous response produces one consent prompt and zero follow-up field questions.

The patch preserves the v0.1.6 boundary: only contract-declared fields after clear consent can be saved, with a per-call question cap and stop-on-decline behavior. It does not infer a callee profile or sensitive traits.
