# @oathra/channel-sdk

Dependency-free ESM definitions and TypeScript declarations for Oathra channel protocol v1.
Use `defineChannel({ verify, decode, send, ... })`; see `index.d.mts` for exact signatures.

Adapters verify original webhook bytes, normalize private user events, and deliver host-authored messages.
They receive no mission service, database, or approval issuer. The host performs identity linking,
explicit approval, durable ingress, suppression and idempotency. SDK permissions are not a sandbox.

Source package only: not yet published to npm. `npm pack ./sdk/channel-sdk` creates a tarball without a build.
The author's plugin manifest is `oathra.plugin.json`, not OpenClaw's manifest.
See `docs/PLUGINS.ja.md` in the repository and `plugins/line`, `plugins/slack`, `plugins/telegram` for examples.
