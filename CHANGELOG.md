# Changelog

Release notes live in `docs/launch/release-notes-<version>.md`; this file lists them. Assets are attached to the matching [GitHub Release](https://github.com/FORIFOR/oathra/releases).

## Unreleased

- Gemini Live (`gemini-3.8-live`) as a second speech-to-speech engine, selectable per call (`--engine gemini-live`, the 「音声AI」 select in the Arena and the Gateway). Shared prompts moved to `providers/voice-kit`.
- Evidence engine: a bare 「承りました」 no longer confirms; English "not confirmed yet" / "will be confirmed" never do; 「2万5千円」 parses as 25,000; per-head prices and portions are not party sizes; durations are not times or dates; cancellation policies are not cancellations; 「その時間は難しい」 after a booking takes it back.
- `oathra demo --tunnel / --allow-remote` is token-gated; a tunnel binds loopback only.
- Runtime hangs up on brain/TTS exceptions and ends silent lines at `maxDurationMs`.
- `oathra --version`; `doctor` checks ngrok instead of unused keys.

## Oathra v0.1.18 — 2026-09-19

v0.1.18 makes "a meeting was agreed" an evidence-engine verdict, closes the agreement gaps that made that necessary, and brings the omnichannel gateway under the same rule.
[Release notes](docs/launch/release-notes-0.1.18.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.18)

## Oathra v0.1.17 — 2026-09-18

v0.1.17 adds a local MCP server, fixes a call-ending bug in the permission flow, and gives the call loop and the phone bridge their first dedicated tests.
[Release notes](docs/launch/release-notes-0.1.17.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.17)

## Oathra v0.1.16 — 2026-09-15

v0.1.16 adds `ActionProof`, a typed contract for tracking how a phone-agent action is supported from the conversation through confirmation, system evidence and the observed outcome.
[Release notes](docs/launch/release-notes-0.1.16.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.16)

## Oathra v0.1.15 — 2026-09-14

v0.1.15 makes consented follow-up intake stop when the callee signals time pressure, and keeps live voice models aware of the profile fields already answered.
[Release notes](docs/launch/release-notes-0.1.15.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15)

## Oathra v0.1.14 — 2026-09-14

v0.1.14 makes optional intake consent transparent in the spoken call.
[Release notes](docs/launch/release-notes-0.1.14.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.14)

## Oathra v0.1.13 — 2026-09-14

v0.1.13 is a patch release that aligns the public CLI package with the latest `main` fixes after v0.1.12.
[Release notes](docs/launch/release-notes-0.1.13.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.13)

## Oathra v0.1.12 — 2026-09-14

v0.1.12 makes consented follow-up intake aware of the conversation scene. A phone agent can gather a small, purpose-bound operational profile after the required outcome is settled without repeatedly pressing the callee or guessing unstated traits.
[Release notes](docs/launch/release-notes-0.1.12.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.12)

## Oathra v0.1.11 — 2026-09-14

v0.1.11 carries the provisional-confirmation guard into the public package. Phrases such as 仮押さえ, 未確定, 承認待ち and 確認待ち no longer satisfy a reservation confirmation until the callee gives a later, unambiguous commitment.
[Release notes](docs/launch/release-notes-0.1.11.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.11)

## Oathra v0.1.10 — 2026-09-14

v0.1.10 packages the consent-based follow-up intake demo and the YAML scenario handoff in the public GitHub asset.
[Release notes](docs/launch/release-notes-0.1.10.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.10)

## Oathra v0.1.9 — 2026-09-14

v0.1.9 carries consent-based optional intake from a YAML scenario into the same `CallContract` used by local simulation and real phone calls.
[Release notes](docs/launch/release-notes-0.1.9.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.9)

## Oathra v0.1.8 — intake non-answer hardening — 2026-09-14

v0.1.8 keeps the consent-based optional intake boundary from v0.1.7 and closes an edge case in field capture.
[Release notes](docs/launch/release-notes-0.1.8.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.8)

## Oathra v0.1.7 — non-pushy consent handling — 2026-09-14

v0.1.7 is a safety patch for the consent-based optional intake introduced in v0.1.6.
[Release notes](docs/launch/release-notes-0.1.7.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.7)

## Oathra v0.1.6 — consent-based optional intake — 2026-09-14

v0.1.6 adds a bounded way to collect explicitly requested information during a phone call while keeping the evidence-backed completion rules from v0.1.5.
[Release notes](docs/launch/release-notes-0.1.6.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.6)

## Oathra v0.1.5 — evidence-backed decision memos — 2026-09-14

v0.1.5 keeps the v0.1.4 phone setup path and adds a readable memo to every saved call.
[Release notes](docs/launch/release-notes-0.1.5.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.5)

## Oathra v0.1.4 — setup recovery — 2026-09-14

v0.1.4 keeps the API-key wizard from stopping at the two most common Twilio first-run prerequisites: buying a voice-capable number and enabling calls to Japan.
[Release notes](docs/launch/release-notes-0.1.4.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.4)

## Oathra v0.1.3 — 初心者向け電話セットアップ — 2026-09-14

実電話を試すときに必要な API 設定を、ウィザードの中で確認できるようにしました。音声エンジンを選ぶと必要なキーの取得先が表示され、Plivo / Custom SIP では LiveKit の設定も続けて入力できます。
[Release notes](docs/launch/release-notes-0.1.3.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.3)

## Oathra v0.1.2 — check the transcripts you already have — 2026-09-14

Add completion checks to an existing voice agent without moving your carrier or model. This release adds a local transcript CLI and a standalone TypeScript SDK, and fixes an English time ambiguity that could incorrectly verify `7:30` as `07:30`.
[Release notes](docs/launch/release-notes-0.1.2.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.2)

## oathra 0.1.1 — 2026-09-14

試用中に見つかった 3 件を直しました。評価ゲートはすべて通過（tests 135、`oathra eval` False Completion 0、`--adversarial 10000` 0/10000）。
[Release notes](docs/launch/release-notes-0.1.1.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.1)
