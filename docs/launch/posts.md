# Launch posts and publication record

## Old release path redirected — 2026-09-14 18:00 JST

- GitHub's popular-path API showed a visit to the older `v0.1.2` release page. Its existing body was preserved and a superseded-release notice was added at the top, linking to the current [v0.1.10 release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.10).
- The old asset remains available for reproducibility; new visitors are directed to the current setup and intake demo. This is a navigation fix based on an observed path, not an adoption claim.

## External signal checkpoint — 2026-09-14 17:55 JST

- The authenticated X readback shows `@forifori_dev` at **1 follower** (previously 0) and the newest original post at **7 impressions** (previously 5), with 0 likes, replies, reposts and quotes. No identity or source is inferred from these aggregate values.
- GitHub's latest 14-day API snapshot reports **0 stars / 0 forks**, 9 views / 9 unique visitors and 530 clones / 199 unique cloners. The new 2026-09-13 buckets are not attributable to external users, so they are recorded as signals only.
- Raw GitHub snapshot: [2026-09-14-1756-jst.json](metrics/2026-09-14-1756-jst.json). No new announcement was sent; X remains eligible after **2026-09-15 15:13:19 JST**.

## Repository trust metadata — 2026-09-14 17:58 JST

- Added [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) with bilingual behavior and reporting guidance, including the existing privacy boundary for public issues.
- GitHub Community Profile now reports **85%** health after the code of conduct and pull request template were published. This is a repository-quality signal, not adoption or star growth.
- Commit `31bfcda` is public; its CI check is pending at the time of this record.

## Contributor and support funnel — 2026-09-14 17:49 JST

- Added [`SUPPORT.md`](../../SUPPORT.md) and linked it from both READMEs so evidence reports, startup problems, integration questions and private business inquiries have separate paths.
- Added [`.github/pull_request_template.md`](../../.github/pull_request_template.md) to require verification scope, simulator-versus-real-call labels and a privacy check before contributions are submitted.
- GitHub Community Profile readback improved from 57% to 71% after the PR template was published. This is a repository-health signal, not evidence of external adoption.
- Commits `6bcb43f`, `0ca3de6` and `c85b7b5` passed the full CI workflow. No new announcement or direct message was sent.

## Homepage Star CTA clarity — 2026-09-14 17:53 JST

- The Japanese and English site headers now label the repository link `GitHubでStar` / `Star on GitHub`, while keeping the existing evidence demo and private inquiry links unchanged.
- Pages deployment [34824977452](https://github.com/FORIFOR/oathra/actions/runs/34824977452) and CI [34824977511](https://github.com/FORIFOR/oathra/actions/runs/34824977511) passed. Public readback confirmed the new labels, intake video and private inquiry form.
- This is a conversion-path change, not evidence of additional visitors or stars. Current GitHub stars remain 0.

## X API publication guard — 2026-09-14 17:20 JST

- Added [`scripts/publish-x-intake.mjs`](../../scripts/publish-x-intake.mjs), which reads the single current draft, checks the 280-character limit, verifies the authenticated account timeline, enforces a 24-hour spacing window and refuses duplicate text before any upload. With `--publish`, it uploads `docs/media/oathra-intake.mp4`, waits for media processing, publishes once and writes a URL/ID record without exposing credentials.
- A read-only check succeeded for `@forifori_dev` (X API v2 HTTP 200). The newest original post is `2099380959384899784` at `2026-09-14T06:13:19Z`; the calculated earliest eligible time is **2026-09-15 15:13:19 JST**. The active draft is now 275 Unicode characters (and shorter under X URL weighting).
- The publish guard was exercised before eligibility; it stopped before media upload with the expected 24-hour error. No X post or media upload was made.

## Distribution PR metadata refresh — 2026-09-14 17:10 JST

- Updated the existing [awesome-voice-agents#42](https://github.com/yzfly/awesome-voice-agents/pull/42) description in place, because it was still describing the older v0.1.0 scope.
- The description now points to v0.1.10, the consented follow-up intake behavior, the utterance-linked `intake.json` / `summary.md` artifacts, the no-profile boundary and the 48-second demo.
- This was an update to one relevant existing listing, not a new PR or a duplicate announcement. No maintainer response or adoption is claimed yet.

## X timeline recheck — 2026-09-14 16:54 JST

- The public `@forifori_dev` timeline now shows newer account activity than the earlier checkpoint: the newest post is displayed as **1h** (status `2099380959384899784`), followed by posts displayed as 2h and 14h. The Oathra post remains the older 9月12日 entry.
- No X post was published in this check. The public status metadata for the newest post reports `2026-09-14T06:13:19Z` (`2026-09-14 15:13:19 JST`), so defer the Oathra announcement until **2026-09-15 15:13:19 JST or later**, then recheck the live timeline immediately before posting. This supersedes the earlier 16:54 JST estimate and the older 03:01 JST estimate.
- The public profile shows an X login prompt for posting. No login, credential entry or post was attempted; an authenticated existing-account session is required before the draft can be transmitted.
- The active text and attachment remain [x-transcript-check.txt](x-transcript-check.txt) and `docs/media/oathra-intake.mp4`; do not reuse an old publication state or post a duplicate.

## TikTok upload check — 2026-09-14 JST

- TikTok Studio for `@foriforapps` is reachable and the video upload page opens. The existing Oathra 00:59 reel remains at 0 views / 0 likes / 0 comments; the next eligible Oathra announcement is the 48-second intake recording after 20:10 JST.
- Choosing the local `docs/media/oathra-intake-ja.mp4` was blocked before transmission by the Chrome extension's file-URL permission. No file was uploaded and no TikTok post was published.
- The prepared caption and publication checklist are in [tiktok-intake-ja.txt](tiktok-intake-ja.txt); it matches the attached intake recording and states that the run is an Arena simulator, not a real phone call.
- To resume, Chrome must allow file URLs for the ChatGPT extension: open `chrome://extensions`, choose the extension's **Details**, and enable **Allow access to file URLs**. After that setting is enabled, recheck the timing and publish one intake video, then record the processed media, post URL/ID and time here. Do not duplicate the existing reel.
- A direct attempt to open `chrome://extensions` from this browser session was rejected by its URL policy at 17:15 JST. No workaround or indirect browser control was attempted; the setting must be changed through the normal Chrome UI.

## LiveKit community channel research — 2026-09-14 JST

- LiveKit's official community guide lists its Developer Community as a technical forum for asking questions, sharing knowledge and getting feedback: https://docs.livekit.io/intro/community/
- This is a better audience fit than another generic launch feed because Oathra targets developers already building voice or phone agents. The guidelines prohibit unsolicited self-promotion except in channels explicitly designed for promotion (for example `#show-and-tell`), while allowing launch and demo sharing when it stays on-topic: https://community.livekit.io/guidelines
- The next experiment is one substantive `#show-and-tell` post after account access is available and the current channel rules are rechecked. The prepared text is [livekit-show-and-tell-draft.md](livekit-show-and-tell-draft.md). Slack remains a separate join/terms step. No LiveKit forum or Slack post was made during this check. Do not count the documentation page as distribution or endorsement.

## Facebook distribution check — 2026-09-14 JST

- Existing `foriforapps` Facebook page was read back at 16:29 JST (1 follower). The Reels composer opens, but the current browser extension did not expose a file chooser for the public `docs/media/oathra-intake-ja.mp4` asset.
- No file was uploaded and no Facebook post was published. Do not count this as reach; retry only when a supported upload path is available.

## GitHub metadata clarity update — 2026-09-14 JST

- Repository description now leads with the discoverable problem and entry point: "Prevent false completion in voice agents: evidence-anchored phone outcomes, consented follow-up intake, TypeScript SDK + CLI, no API key for local checks."
- Homepage URL and existing topic tags were preserved. This is a metadata conversion experiment; measure fresh repository visitors, stars and external trial reports rather than treating the edit itself as reach.

## v0.1.10 public intake demo package — 2026-09-14 JST

- Source: `4798017` (`release: prepare v0.1.10 intake demo package`), including the Arena intake panel, built-in scenario and bilingual recordings.
- Published GitHub Release: [v0.1.10](https://github.com/FORIFOR/oathra/releases/tag/v0.1.10), targeting `479801793feefd1102bea1e3f66255f672d40d98`.
- Assets: [oathra-0.1.10.tgz](https://github.com/FORIFOR/oathra/releases/download/v0.1.10/oathra-0.1.10.tgz) and [SHA-256 file](https://github.com/FORIFOR/oathra/releases/download/v0.1.10/oathra-0.1.10.tgz.sha256). SHA-256: `ef44225def641386238b118f76354ec72fcd5a09ac5d417632fd89bc8531ea2d`; downloaded asset and checksum verification passed.
- Clean package smoke passed: the tarball exposes `oathra demo`, `scenario validate`, the intake scenario and the localized Arena title. CI `34815087930` and Pages `34815087897` passed for the v0.1.10 source commit.
- GitHub Discussion #14 comment `18428933` now points to v0.1.10 and asks voice-agent teams for one or two contract-declared follow-up fields. It requests only redacted or synthetic transcripts; no external feedback or adoption is claimed.
- GitHub Discussion #14 body was aligned to v0.1.10 at 2026-09-14 16:13 JST: it now leads with the 48-second intake recording, release/setup and integration links, while preserving the technical feedback questions and no-profile boundary.
- Growth snapshot at 2026-09-14 16:06 JST: 0 stars / 0 forks, 6 views / 6 unique visitors, 298 clones / 121 unique cloners, v0.1.10 assets 1 tarball + 1 checksum download (our verification), Zenn 1 / 0 likes, and no external issue or business inquiry. [Raw snapshot](metrics/2026-09-14-1605-jst.json).
- TikTok Studio readback at 2026-09-14 16:10 JST: the existing Oathra 00:59 reel (published 2026-09-13 20:10 JST) shows 0 views / 0 likes / 0 comments. The next eligible Oathra post is the 48-second intake recording after 2026-09-14 20:10 JST; do not duplicate the existing reel.
- No X post was made in that release check because the account-wide spacing checkpoint was later recalculated from the live API timeline. The current guard reports **2026-09-15 15:13:19 JST** as the earliest eligible time. TikTok's next eligible time remains 20:10 JST; follow the existing heartbeat and recheck live activity before publishing.

## v0.1.9 scenario intake handoff — 2026-09-14 JST

- Source: `826226c` (`feat(scenario): carry consented intake into phone calls`), pushed to `main` after the v0.1.8 package was already public.
- `mission.intake` is now accepted in scenario YAML and carried into the `CallContract` used by both `oathra play` and `oathra call --scenario ./my-scenario.yaml`.
- Local validation passed: build, typecheck, 148 tests with one credential-gated live test skipped, and `git diff --check`.
- Main CI `34811155009` passed: dependency check, build, tests, scenario validation, false-completion eval, 10,000-run adversarial eval and package smoke.
- Published GitHub Release: [v0.1.9](https://github.com/FORIFOR/oathra/releases/tag/v0.1.9), targeting `ecc43eec`. Assets: [oathra-0.1.9.tgz](https://github.com/FORIFOR/oathra/releases/download/v0.1.9/oathra-0.1.9.tgz) and [SHA-256 file](https://github.com/FORIFOR/oathra/releases/download/v0.1.9/oathra-0.1.9.tgz.sha256). SHA-256: `f9085ce1aa7be04eee6c4ed03ea222f9e882a90e871f3dc6935386a45408eaf5`; downloaded asset and checksum verification passed.
- Release notes: [v0.1.9](release-notes-0.1.9.md). npm remains at 0.1.0 until the real `NPM_TOKEN` is configured.
- Commit `991c284` adds the built-in `restaurant-reservation-intake` Arena mission, an intake panel, and Japanese/English simulator recordings. CI `34814443009` and Pages `34814442926` passed; the public routes serve both MP4 files and captions.
- GitHub Discussion #14 comment `18428933` was edited at 2026-09-14 15:42 JST to link the intake recording and ask for contract-declared follow-up fields. It remains a maintainer prompt; no external feedback or adoption is claimed.

## v0.1.8 intake non-answer hardening — 2026-09-14 JST

- Source: `779d764` (`fix(intake): stop on non-answer field replies`) and `8e12bdf` (`test(intake): cover hold and hedge replies`), pushed to `main`.
- A field response such as 「少々お待ちください」 or 「少し考えます」 is now treated as a non-answer: the field is not saved and optional intake stops without repeating the question.
- CI `34809944711` passed (build, 147 tests with one credential-gated live test skipped, scenarios, eval, adversarial 10,000-run check and package smoke).
- Prepared package and release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.8
- Assets: [oathra-0.1.8.tgz](https://github.com/FORIFOR/oathra/releases/download/v0.1.8/oathra-0.1.8.tgz) and [SHA-256 file](https://github.com/FORIFOR/oathra/releases/download/v0.1.8/oathra-0.1.8.tgz.sha256). The tarball SHA-256 is `b776ae20583b99bde2e9c5b395e8f28aee57a20aa4220c7a94aae2c8bbbacc6a`.
- Release tag target is `05a79ed`; CI `34810513829` and Pages `34810513995` passed. The public Japanese/English routes expose the v0.1.8 command. The downloaded asset reproduced the local checksum.

## v0.1.7 non-pushy consent hotfix — 2026-09-14 JST

- Release notes: `docs/launch/release-notes-0.1.7.md`.
- The optional intake now stops on an ambiguous or hesitant consent reply instead of repeating the prompt.
- Published release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.7
- Assets: [oathra-0.1.7.tgz](https://github.com/FORIFOR/oathra/releases/download/v0.1.7/oathra-0.1.7.tgz) and [SHA-256 file](https://github.com/FORIFOR/oathra/releases/download/v0.1.7/oathra-0.1.7.tgz.sha256). The tarball SHA-256 is `1aa87068614034d9dd9c80628374726f606c6a2c0529a756097df314c03dfeb4`.
- Source: `679da95` (`fix(intake): stop on ambiguous consent`). CI `34808573894` and Pages `34808573878` passed. Initial v0.1.7 asset downloads were 0 at 2026-09-14 14:10 JST.
- The homepage intake callout and CSS polish were added in `64625d7`; CI `34809435895` and Pages redeploy `34809435892` passed. The public Japanese and English routes now expose the consent flow before the video section.
- Feedback prompt updated once in GitHub Discussion #14 at 2026-09-14 14:16 JST and edited again to v0.1.9 after release at 2026-09-14 15:00 JST: https://github.com/FORIFOR/oathra/discussions/14#discussioncomment-18428933. It asks voice-agent teams for one or two useful contract-declared follow-up fields and requests only redacted or synthetic transcripts. This is a maintainer post, not external feedback.

## v0.1.6 consent-based intake release — 2026-09-14 JST

- Release notes: `docs/launch/release-notes-0.1.6.md`.
- Published release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.6
- Assets: [oathra-0.1.6.tgz](https://github.com/FORIFOR/oathra/releases/download/v0.1.6/oathra-0.1.6.tgz) and [SHA-256 file](https://github.com/FORIFOR/oathra/releases/download/v0.1.6/oathra-0.1.6.tgz.sha256). The tarball SHA-256 is `efc2d3efac764ff97d4743bc3f2487fa1482a7b514e4726aa56c887019b9579d`.
- Source: `cbc465b` (`feat(intake): add consent-based bounded caller information`) with runtime, brain prompts, speech-to-speech instructions, replay artifacts, docs and site updates.
- The public docs and site are prepared for v0.1.6. npm still serves 0.1.0 until its publish credential is configured.
- CI `34807789748` and Pages `34807789761` passed. Initial v0.1.6 asset downloads were 0 at 13:57 JST.

## v0.1.5 decision memo release — 2026-09-14 JST

- Published release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.5
- Assets: [oathra-0.1.5.tgz](https://github.com/FORIFOR/oathra/releases/download/v0.1.5/oathra-0.1.5.tgz) and [SHA-256 file](https://github.com/FORIFOR/oathra/releases/download/v0.1.5/oathra-0.1.5.tgz.sha256). The tarball SHA-256 is `ec49b221ac231b6ef512d2c37bad3fdf214e8ebc5fda34d2cdf997881c7d219f`.
- Release notes: `docs/launch/release-notes-0.1.5.md`.
- Source: `b4c7365` (`feat(release): prepare v0.1.5 decision memo package`) with the decision memo and current site/Zenn scope updates.
- The public commands and setup guides now target the v0.1.5 GitHub asset. npm still serves 0.1.0 until its publish credential is configured.
- CI `34806329638` and Pages `34806329657` passed. Release asset readback returned HTTP 302 to the signed download URLs; initial asset downloads were 0 at 13:32 JST.

## Decision memo update — 2026-09-14 JST

- Source: `51c1e37` (`feat(replay): add human-readable decision memo`), pushed to `main`.
- `saveCall()` now writes `summary.md` next to the machine-readable result, evidence and transcript files. The memo lists verified decisions, missing fields, utterance evidence, confidence, turn count and end reason.
- Public README now states that Oathra does not infer callee attributes or collect information outside the declared call purpose.
- Both published Zenn source articles now explain the same privacy boundary; the launch article also documents the new `summary.md` decision memo.
- Japanese and English Pages now expose the same `summary.md` and no-profile boundary in a dedicated scope section; Pages deployment `34805586104` passed and both public routes were read back successfully.
- GitHub Discussion #14 follow-up posted once at 2026-09-14 04:13:31 UTC: https://github.com/FORIFOR/oathra/discussions/14#discussioncomment-18428510. It requests feedback on a consent-based, contract-declared intake extension and asks for redacted or synthetic transcripts only.
- CI: https://github.com/FORIFOR/oathra/actions/runs/34805074437 — success. This update has not yet been packaged as a new tagged release.

## v0.1.4 setup recovery — 2026-09-14 JST

- Released: https://github.com/FORIFOR/oathra/releases/tag/v0.1.4
- `oathra setup phone` now waits on a guided Twilio number purchase / verification step and Japan outbound permission instead of aborting after the automatic check reports a missing prerequisite.
- Piped setup input now fails explicitly when stdin closes before a value, avoiding a successful exit with an incomplete setup.
- Added `docs/SETUP.en.md` and linked it from the English README and website so the public release has a copy-paste credential guide for international users (`ea7ecd0` → `256d589`).
- Added a manual, version-checked npm publish workflow and maintainer runbook (`.github/workflows/npm-publish.yml`, `docs/launch/npm-publish.md`). It requires the real `NPM_TOKEN` Actions secret and does not publish without it.
- Validation: typecheck, Twilio provider tests (including no-number recovery), full test suite, build, and clean public package smoke test.
- This fixes first-run friction; it is not evidence of external adoption. Stars and business inquiries remain unmeasured beyond the existing snapshots.
- Both Zenn source articles now point to v0.1.4 and the current setup guide; the connected Zenn repository will deploy these revisions on push.
- Current readback at 2026-09-14 03:10 UTC: GitHub 0 stars / 0 forks; X profile shows the latest account post about 9 hours old, so the next Oathra announcement remains deferred until the account-wide 24-hour spacing has elapsed (recheck before publishing).
- GitHub Discussion #14 (Show and tell), published 2026-09-14 03:14:58 UTC and updated 03:21:34 UTC: https://github.com/FORIFOR/oathra/discussions/14. It asks voice-agent developers which utterances and events they use as booking evidence, links the no-install checker and 25-second walkthrough, and requests only redacted or synthetic transcripts. Public API readback shows 0 comments; treat later replies as feedback, not as adoption by themselves.
- Latest readback at 2026-09-14 03:24–03:27 UTC: v0.1.4 assets show 2 tarball downloads and 1 checksum download (including our verification); GitHub still shows 0 stars / 0 forks. CI `34802645340` and Pages `34802645353` passed for the English setup rollout; CI `34802739948` passed for the metrics record.
- 2026-09-14 03:48 UTC: posted one factual follow-up on [e2b-dev/awesome-ai-sdks#364](https://github.com/e2b-dev/awesome-ai-sdks/pull/364) with the v0.1.4 setup link and verification status. No review request or mass mention; read back as a public comment. Do not repeat on the other three PRs unless a maintainer responds.

## v0.1.3 beginner setup — 2026-09-14 JST

- Released: https://github.com/FORIFOR/oathra/releases/tag/v0.1.3
- Source: `b3b5819` (`feat(cli): guide API credentials during phone setup`)
- `oathra setup phone` now asks for the selected engine's keys, adds LiveKit credentials for Plivo / Custom SIP, masks secrets in a TTY, and prints provider key URLs.
- Twilio's auto-selected voice number is persisted as the configured `from`, so leaving the number prompt blank no longer makes the route unusable.
- `.env.example`, `oathra doctor`, `phone list`, and the Japanese setup guide now describe the complete first-run path and staged costs.
- Validation: 138 tests passed (1 live test skipped), typecheck, dependency check, site build, source CLI smoke test, and a clean install from the v0.1.3 tarball.
- This is an onboarding improvement, not evidence of external adoption. Stars and business inquiries remain unmeasured beyond the existing snapshots.

## Transcript browser trial — 2026-09-14 JST

- Source: `aed1fe9df4af2e1edc727b8b47df69e4abba7307`; caption fix: `6c72d07ae83420e6ab2614dcb26e86201ba8b860`.
- Public trial: https://forifor.github.io/oathra/check.html · https://forifor.github.io/oathra/en/check.html
- Public video: https://forifor.github.io/oathra/en/#transcript-video (25 seconds, real browser capture, saved model/simulator record, no PSTN).
- CI: https://github.com/FORIFOR/oathra/actions/runs/34777360143 — success. Pages: https://github.com/FORIFOR/oathra/actions/runs/34777360095 — success.
- Public checker loaded its recording and returned complete. Chrome played the public movie past 12 seconds with readyState 4 and no media error. Both Zenn source articles were updated; the technical article's public API includes the checker URL.
- [Implementation, test evidence and channel research](transcript-check-experiment.md).

### Reddit attempt — filtered, not distributed

On 2026-09-13 around 19:19 UTC (2026-09-14 04:19 JST), submitted once as the existing account `Important-Rip-1205`:

https://www.reddit.com/r/voiceagents/comments/1wfgy3u/i_separated_reservation_evidence_from_the_voice/

Title: **I separated reservation evidence from the voice agent’s summary (TypeScript + browser demo)**

The live rules permit project demos that include technical lessons. The post explains the am/pm bug, the local checker workflow and limitations, and links to the playable walkthrough. It identifies the maintainer. No private call data or star request.

**Outcome:** the permalink explicitly shows “この投稿は Reddit のフィルターによって削除されました。” The initial appearance in the author's feed was not evidence of public distribution. Do not count this as reach, repeat it, use another account, or send promotional replies to evade the filter. No outside comments observed; the default self-vote is not outside support. Treat Reddit as unavailable for further launch distribution until a legitimate eligibility change occurs.

Native video attachment failed because the Chrome extension lacks file URL access. No permission was expanded; the submitted text links to the page containing the video. LiveKit Slack also remains unused: the entry screen requires joining and accepting terms.

### Next eligible X announcement — draft only, not posted

**Active draft:** [x-transcript-check.txt](x-transcript-check.txt), updated after the user confirmed the audience and four-step sequence. Use that file instead of the historical text below. The fresh account timeline includes other original activity through 2026-09-13 18:01:15 UTC; conservatively defer until at least the next day at that time and recheck before publishing.

Use **one** version of this concrete demo after the previous announcement is at least 24 hours old (earliest from the currently recorded history: 2026-09-14 15:38:16 UTC / 2026-09-15 00:38:16 JST). Check actual recent account activity first. The existing 12-hour follow-up should do this; do not create a duplicate scheduler.

> Collect follow-up info without a pushy phone agent. Oathra v0.1.10 asks consent once, asks one declared field per turn, and stops on decline, hold or ambiguity. Explicit answers go to intake.json + summary.md.
>
> The 48-second Arena video is a simulator run, not a phone call.
>
> I'm the maintainer. See: https://forifor.github.io/oathra/en/#intake-video

Attach `docs/media/oathra-intake.mp4` using the existing authenticated X API flow when eligible. Do not reuse the old helper's `x-en.json` publication state or its hardcoded evidence-lab movie. Use a separate persistent state record for this campaign, verify media processing, publish once and record the returned post ID. Upload near publication so media does not expire first.

At 2026-09-13 19:20:43 UTC, GitHub still reports **0 stars / 0 forks**. Goal unachieved. The immediate bottleneck remains distribution; this new trial has no measured external adoption yet. Inspect actual responses and fresh traffic at 48–72 hours, without counting our verifications.

---

## v0.1.2 standalone checks — 2026-09-14 JST

- Released: https://github.com/FORIFOR/oathra/releases/tag/v0.1.2
- Source: `1f056cbe3bacba469df10a3c6455782109599d33`
- CI passed: https://github.com/FORIFOR/oathra/actions/runs/34775716591
- Pages deployed: https://github.com/FORIFOR/oathra/actions/runs/34775716575
- Public tarball checksum matched the release record; the public URL's `npx` command reproduced the existing saved negotiation result.
- Both existing Zenn articles show the v0.1.2 integration section on public API readback.
- Issue #8 closed with the conservative ambiguity behavior, not a claim of conversational meridiem inference.
- Star count at verification: 0. Acquisition remains unachieved. The 12-hour task follow-up `oathra` is active; see [decision rules](growth-loop.md).

### Next X experiment: existing voice-agent developers

Draft only, **not posted**. The two previous video posts were published on 2026-09-13 around 15:38 UTC. Respect the 24-hour announcement spacing and check newer account activity before publishing. Recheck this release's availability and link before sending. Publish one version aimed at the selected audience; do not send simultaneous language duplicates automatically.

> Add local evidence checks to the voice agent you already have. Oathra v0.1.2 includes a transcript CLI + typed TS SDK.
>
> No API key. LiveKit example is type-checked; live calls remain unverified.
>
> I maintain the project. Install/schema: https://github.com/FORIFOR/oathra/releases/tag/v0.1.2

Measure fresh repository traffic, actual outside questions and trial reports after 48–72 hours. A star change alone cannot identify the cause. Do not mistake our public-package verification downloads for outside users.

Research supporting the audience hypothesis: [LiveKit's test framework](https://docs.livekit.io/agents/start/testing/test-framework/) already offers conversation assertions and LLM judgment. Position this release as a small local evidence check for supported fields, not as a replacement for all voice evaluation. A [practitioner discussion](https://www.reddit.com/r/VoiceAutomationAI/comments/1um91gq/those_of_you_running_voice_agents_in_prod_what/) describes users confusing confirmation of details with a confirmed appointment; this is anecdotal evidence of a relevant problem, not validation of Oathra. Community posting eligibility is still unverified; this is not permission to post there.

---

All numbers below are from our own runs (see README). No superlatives, no claims we did not measure.

## Hacker News — Show HN

> 注意（2026-09-13）: HN の規則は AI 生成・AI 編集の文章の投稿を禁止している。下の本文は下書きの参考にとどめ、投稿する場合は本人の言葉で書き直すこと。投票・コメントの依頼や代理投稿もしない。

> 2026-09-12: HN refused the submission from this new account: "We're temporarily restricting Show HNs because of a massive influx, mostly by users who aren't yet familiar with the site or its culture." Plain link submissions from a fresh account tend to get flagged, so HN is parked until the account has some comment history. The English article for dev.to is in `devto-oathra-launch.md` (publish via the dev.to API with DEVTO_API_KEY in .env, or paste it in the editor).

**Title**: Show HN: Oathra – give AI agents a phone, and proof of what happened

**Text**:

Oathra is an open-source (Apache-2.0) runtime for AI agents that make phone calls: call a restaurant, negotiate, book, and return a result you can trust.

The part we care most about is the "trust" part. The result is not an LLM summary. Every field (date, time, party size, price, "confirmed") is anchored to an utterance from the *other* party, and completion is decided by code — never by asking the model whether it succeeded. Refusals ("19:00 is full, but 19:30 works") never become offers; corrections supersede; hedges ("probably fine") do not confirm; a confirmation goes stale if the deal changes after it was spoken. We fuzz this with 10,000 mutated simulated callees (never-confirm, wrong restate, negate-then-offer, silent hangup, echo trap) and the count of false completions is 0.

`npx oathra demo` opens a small "arena" where two agents negotiate in your browser with no API key (there is a play mode where you answer the phone yourself). The same runtime drives real calls: Twilio direct media streams, or any SIP trunk (Plivo, custom) through a LiveKit gateway. The voice engine is separate: GPT-Live (full-duplex) was the most natural on our test calls, so it is the default; there is also an OpenAI Realtime engine and a Deepgram + LLM + TTS pipeline.

What is verified today: Twilio calls to a Japanese mobile, a 6-minute GPT-Live call, the evidence engine (0/10,000). What is not: Plivo/custom SIP over PSTN (implemented from provider docs), Telnyx/others, MCP.

Repo: https://github.com/FORIFOR/oathra · Site: https://forifor.github.io/oathra/

Happy to answer anything about the evidence rules, the phone layer, or the latency numbers.

## X / Twitter (EN)

1/ We gave AI agents a phone — and made them prove what happened.

Oathra: open-source runtime for agents that call, negotiate, book. The result is evidence, not a summary.

npx oathra demo → two agents haggle in your browser, no API key.

https://github.com/FORIFOR/oathra

2/ "予約できました" is not evidence.

Every field is anchored to the other party's words. Completion is decided by code. 10,000 mutated callees, 0 false completions.

3/ Bring your own carrier. Bring your own model.

Twilio direct · Plivo / custom SIP via LiveKit
GPT-Live (recommended) · OpenAI Realtime · Deepgram+LLM+TTS

`oathra setup phone` — 2–3 questions, guided steps for anything a human must do. `oathra phone doctor` tells you which layer is broken.

4/ Battle your models on "Impossible Hotel". Both GPT-4o-mini and Gemini Flash walked away above budget — and neither claimed success. That's the point.

[attach docs/media/battle-impossible-hotel.png]

## X / Twitter (JA)

AIエージェントに電話を持たせて、しかも「本当に予約できたか」を証明させる OSS を公開しました。

Oathra — 結果は LLM の要約ではなく、相手の発言に紐づいた証拠付きの構造化データです。完了判定はコードが行い、10,000 通りの意地悪な店員シミュレーションで False Completion は 0。

npx oathra demo で API キー無しに AI 同士の交渉を見られます。
Twilio / Plivo / 自前 SIP × GPT-Live / Realtime / パイプライン、好きに組み合わせられます。

https://github.com/FORIFOR/oathra

## Reddit — r/LocalLLaMA, r/artificial, r/programming

**Title**: Oathra: open-source runtime for AI agents that make phone calls — with verified results (0/10,000 false completions in adversarial sim)

Body: (use the HN text; add) Ollama brains are supported in the pipeline engine; the simulator and the evidence engine run fully offline.

## Product Hunt / dev.to (later)

Headline: Give AI agents a phone — and proof of what happened.
Tagline: Playable simulator · real calls · verified outcomes · bring your own carrier & model.

## Battle 動画（投稿済み 2026-09-12）

- X（日本語、動画付き）: https://x.com/i/status/2098496503493136600
- 素材: `docs/media/oathra-battle-ja.mp4`（英語版 `oathra-battle-en.mp4`、GIF・ポスター・1:1 も同名で同梱）
- 再生成: `node scripts/render-scene.mjs --template video/battle.html --data video/.work/battle.json --lang ja --name oathra-battle-ja`

### v2（2026-09-12 05:50 JST、音声付きの画面録画に差し替え）

- X（日本語、動画付き）: https://x.com/i/status/2098513364314095620 （旧 2098496503493136600 は削除）
- 再生成: `node packages/cli/dist/bin.js demo --no-open --port 4242 &` → `node scripts/battle-to-calls.mjs`（再現通話の保存、¥0）→ `node scripts/render-battle2.mjs --name oathra-battle-ja`
- 声は `video/.work/tts/*-ft.wav`（OpenAI gpt-4o-mini-tts、数円）。効果音は `sox` で合成（`video/.work/sfx`）
- X（英語字幕版、動画付き）: https://x.com/i/status/2098517001547436180 — `node scripts/render-battle2.mjs --lang en`

## npm（2026-09-12 16:05 JST）

- `oathra@0.1.0` を公開: https://www.npmjs.com/package/oathra — `npx oathra demo` が動くようになった。レジストリからの `npx -y oathra@0.1.0 play restaurant-reservation-en --fast` で completed を確認
- X（npm 公開の告知）: 日本語 https://x.com/i/status/2098671529647366272 ／ 英語 https://x.com/i/status/2098671635201220831

## BGM（2026-09-12 22:40 JST）

- ユーザー提供の AI 生成 BGM 群（~/Downloads/bgm）からまず「I11 Quiet Momentum」で作成し、`scripts/add-bgm.sh ja|en` でナレーション付きミックスの下に敷いた（サイドチェインで会話中は −12〜18 dB 下げ、切電後のカードで持ち上げ）。曲は `video/bgm/quiet-momentum.m4a` に保存。ユーザーが試聴して「I02 Soft Circuit」を選択（22:55 JST 差し替え、`video/bgm/soft-circuit.m4a`）。フレームの再レンダリングは不要で、mp4 の映像ストリームをそのまま流用している。

## Zenn（2026-09-12 23:45 JST）

- 記事が公開: https://zenn.dev/forifori/articles/oathra-launch
- 反映しなかった原因は Zenn 側ではなく、公開履歴に残っていた `video/.work` の作業ファイル（813 MB）で clone が肥大化していたこと。`git filter-repo` で履歴から除去して force-push（071dd5b → 7a88aa0）した直後の push でデプロイが通った。書き換え前の完全バックアップは作業ディレクトリ外の bundle に保存。
- X（Zenn 公開の告知、23:46 JST）: https://x.com/i/status/2098785294816583984

## 2026-09-13 00:30 JST — 露出の追加手

- GitHub Release v0.1.0（stable、npm 0.1.0 と同一 tarball）: https://github.com/FORIFOR/oathra/releases/tag/v0.1.0
- good first issue #2 薬局シナリオ / #3 Telnyx / #4 ElevenLabs TTS
- GitHub topics を 16 個に拡張、npm keywords を 15 個に拡張（次回 publish で反映）
- awesome リスト PR 追加: caramaschiHG/awesome-ai-agents-2026#570（Open-Source Voice）、Jenqyang/Awesome-AI-Agents#486（Tools）。既存: yzfly/awesome-voice-agents#42（未反応）、e2b-dev/awesome-ai-sdks#364（CLA 署名待ち＝ユーザー操作）
- X（v0.1.0 英語告知）: https://x.com/i/status/2098794398595297406
- 未実施（アカウントが必要）: dev.to 投稿、Show HN（新規アカウント制限）、Reddit
- 2026-09-13 01:xx JST: e2b-dev/awesome-ai-sdks#364 の CLA をユーザーが署名、チェック pass、mergeState CLEAN（メンテナのレビュー待ち）

## dev.to（2026-09-13 00:39 JST）

- 英語記事を API で投稿（下書き → 内容確認 → 公開）: https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484
- README.en とサイト英語版フッターにリンク追加

## Reddit（2026-09-13 01:2x JST）

- r/LLMDevs に投稿（フレア Tools、アカウント Important-Rip-1205 はこの日に作成）: https://www.reddit.com/r/LLMDevs/comments/1wektiw/i_built_an_opensource_runtime_for_ai_agents_that/
- 投稿直後に「Reddit のフィルターによって削除されました」表示。新規アカウントの自動フィルター。モデレーターへの承認依頼（modmail）が必要。
- 01:5x JST: r/LLMDevs のモデレーターに承認依頼を送信（ユーザーの「送って」で実行、「メッセージが送信されました」を確認）。返答待ち。

## 縦型動画（2026-09-13 02:2x JST、TikTok / Reels / Shorts 用）

- `docs/media/oathra-battle-{ja,en}-vertical.mp4`（1080x1920、59 秒）。横動画を 9:16 に配置し、見出し（JA: 「AIがホテルに電話して、値切る。／「予約できた」は店が言った時だけ。」）とコマンド、URL を重ねた。見出しは HTML を headless Chrome で透過 PNG に描画（ffmpeg に drawtext が無いため）。冒頭のタイピング 3.2 秒をカット。
- 投稿は未実施。TikTok / Facebook は API 投稿に審査が要るため Chrome 拡張経由で行う（ユーザーのログインと「投稿して」が必要）。

## v0.1.1 の準備（2026-09-13 05:40 JST、publish はユーザー操作）

修正内容（試用で見つかった 3 件）:
- エージェントが曖昧な返答（たぶん・確認します）に確認を求めず諦めていた（#5）
- Play モードで AI の挨拶後も通話が終わらなかった（#6）
- 証拠パネルに同じ未確定値が重複表示されていた（#7）

publish 手順（2FA コードは npm が求めたときに入力）:
```
cd packages/cli && npm publish --access public
```
publish 後にこちらで行うこと: README/サイトの「npm: oathra 0.1.0」を 0.1.1 に更新、GitHub Release v0.1.1 の作成、`npx -y oathra@0.1.1 demo` の起動確認。

## Zenn 2 本目の下書き（2026-09-13 05:50 JST、未公開）

`articles/oathra-evidence-rules.md`（`published: false`）。判定ルール 4 本（節分割・曖昧語・確定経路 2 つ・確定の失効）を実コードの引用で説明し、検証 5 ケースの表と Play モードのボタンを案内。公開するには `published: true` にして push するだけ。公開の可否は本人の判断。

## dev.to 2 本目の下書き（2026-09-13 05:53 JST、未投稿・ローカルのみ）

`docs/launch/devto-evidence-rules.md`。Zenn 2 本目の英語版。dev.to には送っていない（下書き作成も含めて未操作）。投稿は本人の指示があってから API で行う。

## X「試して騙してみて」投稿（2026-09-13 05:59 JST）

- JA: https://x.com/forio1998/status/2098879131987615895
- EN: https://x.com/forio1998/status/2098879133606727871

内容: Play モードで店員役として「たぶん大丈夫です」「承りました。ただ料金は…」を言っても確定に✓が付かないか試してもらう招待。既に使っている自分の X アカウントからの投稿で、告知の一斉送信ではなく「誤完了を誘ってみる」入口の案内として 1 本ずつ。インプレッションは API で取得できないため「未取得」。

## サイト改版 v6（2026-09-13 13:31 JST）

ファーストビューを「発言→証拠」のサンプル（店員役の返事 3 つ、証拠エンジンの実出力）に変更。見出し「AIが電話する。結果は、相手の言葉で確かめる。」、主 CTA「予約シミュレーションを試す」。実通話の再生機は 2 番目の節へ。導入相談（Discussions）を GitHub と分離。設計文書は docs/design/{PRODUCT,DESIGN,CONTENT,ACCEPTANCE}.md、比較は HERO_VARIANTS_V2.md。

## 記事 2 本目を公開（2026-09-14 00:39 JST、ユーザーの「トライアル依頼と実電話検証以外を対応して」による）

- Zenn: https://zenn.dev/forifori/articles/oathra-evidence-rules （判定ルール 4 本と失効ルール）
- dev.to: https://dev.to/forifor/four-regexes-and-a-staleness-rule-how-my-phone-agent-refuses-to-call-probably-fine-a-booking-3ech （canonical は Zenn）
- npm 0.1.1: `npm publish` は E401（ログインセッション切れ）で失敗。ユーザーの `npm login` と 2FA が必要。

## TikTok / Facebook（2026-09-14 00:45 JST）

- TikTok: Oathra の縦動画は既に 9/13 20:10 に公開されていた（別セッション、キャプション「AIに電話をかけさせたら、取れてない予約を「取れた」と言い切った…」）。私が 9/14 00:40 に投稿した同じ動画は重複になるため削除した（30 日以内なら復元可）。公開中の 1 本を残す。
- Facebook: ページ foriforapps でリール投稿を 2 回試行（動画アップロード → 次へ → 説明入力 → 投稿）。投稿後にページのタイムラインとリール一覧に表示されず、処理中か失敗かは未確認。

## 2026-09-14 — 既存の試用案内へ修正版の導入方法を追記

以前の `npx oathra demo` の告知はnpm 0.1.0を取得するため、元の投稿への返信としてGitHub Release 0.1.1の起動手順を案内した。

- 日本語: https://x.com/forifori_dev/status/2099164321620340968 （返信先2098879131987615895）
- 英語: https://x.com/forifori_dev/status/2099164351789965643 （返信先2098879133606727871）
- 両投稿をX APIで読み返し、`replied_to` とRelease URLを確認済み。新規の独立投稿や個別の試用依頼ではない。
- 新しい動画投稿2本の公開指標は取得時点で0。impression_countの精度は確認できないため、露出ゼロとは断定しない。
- GitHubの公開、サイト、日英実操作動画、Zenn改稿、GitHub配布版、相談・報告導線は公開済み。スターの大量獲得や商談成立は未確認。npm公開は認証待ち、実電話100件は未実施。
# Public v0.1.11 package — 2026-09-14 JST

- Integrated PR #12 (`27b7383`) into `main`, adding conservative detection for provisional, pending-approval and confirmation-needed reservation language plus 500 regression cases.
- Updated the active README, integration/setup guides, Japanese and English Pages copy, Zenn source articles and outreach drafts to use the v0.1.11 GitHub asset.
- The GitHub Release and asset upload are the next publication step; no download, star or business-inquiry result is counted until the public asset and checksum are read back.
