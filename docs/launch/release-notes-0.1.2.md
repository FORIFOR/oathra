# Oathra v0.1.2 — check the transcripts you already have

Add completion checks to an existing voice agent without moving your carrier or model. This release adds a local transcript CLI and a standalone TypeScript SDK, and fixes an English time ambiguity that could incorrectly verify `7:30` as `07:30`.

## Install

Node.js 22+:

```bash
npm install https://github.com/FORIFOR/oathra/releases/download/v0.1.2/oathra-0.1.2.tgz
npx oathra verify ./transcript-check.json
```

For the browser simulator:

```bash
npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.2/oathra-0.1.2.tgz oathra demo
```

The npm registry still serves 0.1.0; use the asset above for this release. [English integration guide](https://github.com/FORIFOR/oathra/blob/main/docs/INTEGRATION.md) · [日本語の導入手順](https://github.com/FORIFOR/oathra/blob/main/docs/INTEGRATION.ja.md).

## What changed

- `oathra verify <json | ->` checks final transcripts locally, returns JSON evidence and uses exit codes 0 (complete), 2 (not complete) and 1 (invalid input/error). It rejects empty requirements, duplicate IDs, reversed timestamps and invalid reference dates.
- `oathra` and `oathra/evidence` now export `EvidenceEngine`, `defineCall`, `evaluate` and `verifyTranscript` with bundled TypeScript declarations. Prior package metadata pointed to SDK files absent from the tarball.
- English bare clock times such as `7:30` remain unresolved. Explicit am/pm or an unambiguous 24-hour time and renewed agreement are required. We deliberately do not infer meridiem from earlier conversation.
- A LiveKit integration function observes committed conversation items. It treats interrupted speech as requiring review. An optional RTC peer conflict with current LiveKit Agents is resolved.
- Japanese/English site and Zenn articles now link directly to using your own transcripts, alongside the browser demo.

## Validation and limits

- 138 tests passed; 1 live connection test skipped. New regression coverage uses the observed issue #8 and the existing public GPT-4o mini/simulator recording, not invented call data.
- The installed tarball reproduces the saved record's fields. The actual prefix before the first verified confirmation returns incomplete (exit 2); empty stdin returns exit 1. Root and subpath SDK results match the CLI.
- Clean installation alongside `@livekit/agents@1.8.1` succeeds without `--force` or `--legacy-peer-deps`. The integration example and existing RTC wrapper type-check with installed `@livekit/rtc-node@0.13.35`.
- Dependency checks, site TypeScript/build and scenario validation pass. Existing scenario evaluation: 0 false completions. Existing adversarial simulator: 0 / 10,000 false completions; this is not a real-call benchmark.
- Real browser: the reported English sequence stays incomplete and explains the missing meridiem. Japanese mobile integration section is readable without horizontal overflow.

LiveKit session behavior, interruptions over a live connection and PSTN are not verified by this release. The checker implements supported Japanese/English rules; it does not inspect a venue's booking database or prove general semantic correctness. No new paid phone calls were placed, and the 100-call readiness evaluation remains outstanding.

Asset: `oathra-0.1.2.tgz`, 173,992 bytes, 28 files including Apache-2.0 license and SDK declarations. SHA256: `8a406f39a3ce2ce95b50463060cdc9bf8b942ee2ddab3ab367640da751bf312e`.

## Acquisition follow-up

[The measured bottleneck and next experiments](growth-loop.md) are recorded separately. Stars are still 0 at the starting snapshot. A 12-hour follow-up is active to inspect external signals, fix reported friction and change ineffective tactics. Shipping this release does not establish external adoption or business demand.
