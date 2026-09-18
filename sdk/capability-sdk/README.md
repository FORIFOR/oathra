# @oathra/capability-sdk

Dependency-free ESM definitions and TypeScript declarations for Oathra capability protocol v1.
`defineCapability({ preview, execute })` describes separately reviewed follow-up writes.
`defineCallCapability({ execute })` describes a call executor behind the host's durable worker.

A preview cannot dial or grant approval. It must not perform network writes.
Execution receives an immutable reviewed action after host authorization and durable reservation.
Use the supplied fetchImpl and AbortSignal. Never retry an uncertain write; return provider references,
not an AI claim that the mission is complete. The host determines outcome and evidence separately.

Source package only: not yet published to npm. `npm pack ./sdk/capability-sdk` needs no build.
See `docs/PLUGINS.ja.md` in the repository for supported effects and the trusted-code boundary.
