# Oathra v0.1.8 — intake non-answer hardening

v0.1.8 keeps the consent-based optional intake boundary from v0.1.7 and closes an edge case in field capture.

- A field reply that indicates a hold, hesitation, question or missing answer is not saved as a value.
- Optional intake stops immediately after that non-answer, so the agent does not repeat the question or continue collecting information.
- Explicit answers remain limited to contract-declared fields, the configured question cap and the utterance that supplied the answer.
- The decision memo and `intake.json` continue to record the final intake status and auditable answer events.

Verification:

- 146 existing tests pass, including simulator coverage for consent, refusal, ambiguity, hold and hesitation.
- The adversarial 10,000-run check reports zero false completions.
- The packaged CLI smoke test passes on Node.js 22.

This release records explicit answers requested by the contract. It does not infer a callee profile or sensitive traits, and it does not claim production readiness or a measured PSTN success rate.
