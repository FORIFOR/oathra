# Existing voice-agent developers: transcript check experiment

2026-09-14 JST. This continues the v0.1.2 adoption experiment: a developer can try the same local checker before installing a phone runtime. It is not evidence of acquired users or stars.

## Delivered entry point

- Japanese: https://forifor.github.io/oathra/check.html
- English: https://forifor.github.io/oathra/en/check.html
- 25-second walkthrough: https://forifor.github.io/oathra/en/#transcript-video
- Uses `packages/cli/src/transcript.ts`, the same production schema and checker as the CLI/SDK. No result fixtures or fake API responses.
- Paste check JSON, inspect requirements/current values/evidence history, save result JSON, or clear the tab. No third-party scripts, analytics, automatic persistence or transcript transmission on the checker page. The load button fetches only the existing public recording from the same site. Browser input limit: 1 MB. This page is separate from the homepage's aggregate event instrumentation.
- Source: `site/data/call-gpt4o-mini.json` and `scenarios/hotel/impossible-hotel.yaml`, converted by `node scripts/export-recorded-check.mjs`. The resulting `site/data/recorded-check.json` preserves source utterances and timestamps. This is an actual saved model/simulator run, not PSTN or an external user.
- Homepage, README, integration guides and both existing Zenn articles link to this trial.

## Verification

- Site build and strict TypeScript check pass.
- Existing two transcript regressions pass, using recorded traces.
- Actual browser result JSON equals CLI result JSON byte-for-byte after JSON parsing. Full recorded run returns complete with date 2026-10-03, partySize 2, price 19900, smoking false, breakfast true and confirmed true.
- The actual trace truncated before the first confirmation at 59,574 ms, evaluated as an ended excerpt, returns incomplete. It is a deliberate truncation of the same recording, not a new call.
- Editing invalidates the prior result and disables export. Removing the ending JSON delimiters produces a syntax error and leaves no prior success visible.
- Japanese and English at 390 px viewport have 375 px document width (scrollbar excluded), without horizontal overflow.
- Movie captures real browser actions at approximately 4 fps, encoded at 30 fps. 100 timestamped frames, 25.37 s, 1266×950 H.264, no audio. English UI with Japanese/English WebVTT captions. It is not a live phone recording. Capture timestamps and action notes retained locally in `/tmp/oathra-transcript-video/capture.json`.

## Community selection

Checked on 2026-09-14 JST using the live community UI:

- [r/voiceagents](https://www.reddit.com/r/voiceagents/): rule 2 allows project/launch posts that contribute technical insights, lessons or a custom demo; pure advertising/referral links are removed. Rule 1 welcomes demos and experiments. Rule 4 prohibits customer data/call logs without permission. Use only the already public model/simulator run and explain the limitations. No star solicitation or unsolicited private messages.
- [r/VoiceAutomationAI](https://www.reddit.com/r/VoiceAutomationAI/): rule 2 states no self-promotion and educational posts only. Not used for a launch announcement.
- [LiveKit guidelines](https://community.livekit.io/guidelines): promotion is limited to designated channels such as show-and-tell. [Slack entry](https://livekit.io/join-slack) currently shows a join form whose Continue action accepts terms. No authenticated membership was established. No join or post performed.

## Checkpoint

Record the exact public post URL and publication time in `posts.md` after submission and readback. Inspect its moderation status and actual replies before attempting any further distribution. If removed, do not repost or route around the restriction.

The previous X announcement is still inside the 24-hour spacing window. The next eligible announcement may use this video and working demo after checking recent account activity. The existing 12-hour follow-up reads these files; no duplicate schedule is needed.

At 48–72 hours, compare fresh GitHub traffic buckets and external questions/trial reports against the retained baseline. Do not count our preview visits, tarball checks, CI clones or the new demo capture as outside users. If no reach is observed, change the audience/channel; if visits arrive but no trials, investigate the required JSON mapping and actual reported friction before adding more features.
