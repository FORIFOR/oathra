# Oathra v0.1.4 — setup recovery

v0.1.4 keeps the API-key wizard from stopping at the two most common Twilio first-run prerequisites: buying a voice-capable number and enabling calls to Japan.

## Changes

- `oathra setup phone` continues after a missing Twilio number and opens a guided browser step that polls until a voice-capable number is available.
- `oathra setup phone` continues after Japan outbound permission is disabled and waits for the user to enable it in Twilio.
- Closed piped input now returns an error instead of exiting successfully with an incomplete setup.
- The setup guide and public site point to the v0.1.4 package.

## Start here

- [Beginner setup (English)](https://github.com/FORIFOR/oathra/blob/main/docs/SETUP.en.md)
- [初心者向けセットアップ（日本語）](https://github.com/FORIFOR/oathra/blob/main/docs/SETUP.ja.md)
- [Share a redacted or synthetic transcript example in Discussion #14](https://github.com/FORIFOR/oathra/discussions/14)

## Verification

- `pnpm typecheck`
- `pnpm test` (139 passed, 1 live test skipped)
- `pnpm build`
- Clean release-package smoke test and public Pages check.

The simulator, browser evidence lab and transcript verification still need no API key. Real PSTN calls still require a carrier number, provider permissions and paid voice/model usage.
