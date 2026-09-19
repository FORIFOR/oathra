# Acquisition and adoption loop

## User-approved sequence — 2026-09-14 JST

The user explicitly selected this sequence: (1) focus on developers already building voice/phone agents with LiveKit or similar tools who need to detect false reservation completion; (2) show saved transcripts producing verified fields, missing requirements and JSON, with a direct integration guide; (3) obtain real feedback in relevant public communities; (4) change distribution when visits are absent, explanation/onboarding when visits do not become trials, and functionality when users encounter failures.

Stages 1 and 2 are prepared and public. Stage 3 is the current priority. Do not spend another cycle rebuilding the demo or expanding features without an actual reported need. The existing hourly heartbeat `oathra` now explicitly follows these four steps. It stays quiet when the state is unchanged and no duplicate automation was created.

The local preview path had one concrete parity defect: a fresh `pnpm build:site` did not copy the intake recordings into the ignored `site/media/` directory, even though the Pages deploy job did. `scripts/build-site.mjs` now syncs changed files from `docs/media/`, and CI asserts both language variants. Local and public HTTP checks passed after the fix. This is an onboarding reliability correction, not a new campaign or an adoption signal.

### External distribution checkpoint — 2026-09-18 14:04 JST

The existing [Awesome-AI-Agents #486](https://github.com/Jenqyang/Awesome-AI-Agents/pull/486) was merged at `2026-09-18T05:04:23Z` (merge commit `7cb5da0ea95d95d80d4239aa8178648dfa7f42ae`). Its public entry names the standalone OSS evidence-verification engine and the simulator/Arena evidence surface, while keeping phone adapters and consented follow-up scope explicit. This is confirmed third-party distribution, not proof of stars, external trials, phone success or business demand. The current read-only snapshot is [metrics/2026-09-19-1911-jst.json](metrics/2026-09-19-1911-jst.json); it still reports 0 stars, 0 forks and no external issue or inquiry.

### X distribution checkpoint — 2026-09-19 18:12 JST

The account-wide spacing check was eligible and the active draft was duplicate-free. The first media upload attempt failed because the 6.8 MB MP4 exceeded the simple upload path (`media type unrecognized`). The publication helper now uses X's chunked INIT/APPEND/FINALIZE flow, and the retry published one English Oathra v0.1.18 intake announcement with the Arena simulator video: [status 2101237907260674392](https://x.com/forifori_dev/status/2101237907260674392). This is a distribution event, not evidence of an external trial or phone-call success. Raw read-only snapshot: [metrics/2026-09-19-1812-jst.json](metrics/2026-09-19-1812-jst.json).

### Measurement checkpoint — 2026-09-15 19:06 JST

The fresh read-only snapshot reports **0 stars / 0 forks**, 11 repository views / 11 unique visitors and 2,015 clones / 357 unique cloners in the available 14-day window. The daily buckets and clone totals include maintainer or automation activity and are not confirmed external users. No external issue or business inquiry is observed; Zenn remains 1 like for `oathra-launch` and 0 for `oathra-evidence-rules`. v0.1.16 assets remain at 2 downloads each, matching maintainer verification. No new social post was sent. Raw snapshot: [metrics/2026-09-15-1905-jst.json](metrics/2026-09-15-1905-jst.json).

### 実電話音声再評価チェックポイント — 2026-09-15 21:41 JST

修正版で指定済みの同意対象番号へ21:37 JSTと21:41 JSTに発信したが、いずれも接続後に留守番電話へ転送され、それぞれ34秒・36秒で終了した。したがって、これらの通話では会話音声・検索委譲・同意付き聞き取り・プロファイル保存を実機確認できない。直前の21:23 JST通話は相手の発話を取得した一方、発信音声が無音で、無音PCM先行デルタを割り込み扱いした不具合を再現した。PCM16LE 24kHz↔μ-law 8kHz変換と実音量判定を修正し、全テスト（672 passed / 1 skipped）、型チェック、依存方向チェック、ビルドを通過。ローカル実音量検査はRMS 1,533、ピーク10,876。実電話での修正後会話成功は未確認のまま。詳細は [real-calls.md](real-calls.md)。

### Current product checkpoint — v0.1.16

The scene-aware intake guard and the typed `ActionProof` evidence levels are now packaged in the public GitHub release. `startAfter`, `dependsOn` and `choices` keep follow-up questions tied to settled prerequisites and explicit answers; refusal, hold, ambiguity, time pressure or an unmatched choice stops without saving a guessed profile. `ActionProof` keeps claimed, conversation, confirmation, system and outcome evidence separate and rejects expired, unreferenced or conflicting higher-level observations. Realtime context updates also carry recorded, declined and skipped fields, and decision memos include intake utterance provenance. The release package and Pages command are aligned at v0.1.16. GitHub stars, external replies and business inquiries remain separate measurements.

The latest readback at 13:02 JST is still 0 stars / 0 forks and 9 repository views / 9 unique visitors; no external issue or business inquiry is observed. The v0.1.16 assets show 2 downloads each, but these include maintainer verification and are not external-user evidence. The X v0.1.16 draft is valid and duplicate-free but remains gated until 2026-09-15 20:20:30 JST. The next justified campaign action is one fresh X announcement after that check; do not multiply channel posts while the audience signal is absent. Raw snapshot: [metrics/2026-09-15-1302-jst.json](metrics/2026-09-15-1302-jst.json).

### Facebook announcement checkpoint — 2026-09-15 05:13 JST

The public `foriforapps` Facebook Page has the earlier text announcement ([post 122110079709465551](https://www.facebook.com/permalink.php?story_fbid=122110079709465551&id=61593966556275)) and a separate 49-second Oathra demo Reel. Meta Business Suite lists the Reel as public at 05:08 JST under post ID `122110105899465551`; the [public profile Reels tab](https://www.facebook.com/profile.php?id=61593966556275&sk=reels_tab) lists it, and the [public Reel page](https://www.facebook.com/reel/2065669370975652) opens the video and caption. Initial readback at 05:13 JST is reach 0, views 0, viewers 0, reactions 0, comments 0, shares 0, saves 0 and link clicks 0; these immediate values are not adoption evidence. Do not publish a duplicate Facebook Reel before a fresh response check.

### Superseded product checkpoint — v0.1.11

The user-requested follow-up workflow is now implemented as consent-based, contract-declared intake. After the required call details settle, Oathra states the purpose and asks once for permission, asks at most one declared field per turn (default cap three, hard cap eight), stops on decline, hold or an ambiguous reply, and saves only the next explicit callee answer with its utterance ID and timestamp. `intake.json` and `summary.md` make the collected answers, consent provenance and decisions reviewable, so they can form an operational profile from explicit answers. Scenario YAML now carries the same contract into `oathra call`, so local and phone runs share the rule set. The feature does not infer a callee's attributes, collect undeclared or sensitive information, or continue after refusal. The runtime also enforces this boundary when a model emits an early or undeclared optional question. The v0.1.11 asset carries the provisional-confirmation guard alongside the built-in Arena intake mission and recordings: https://github.com/FORIFOR/oathra/releases/tag/v0.1.11; cloned `main` contains the latest intake hardening.

The latest 2026-09-14 18:40 JST readback remains 0 stars / 0 forks, while GitHub's 14-day window reports 9 views / 9 unique visitors and 530 clones / 199 unique cloners. The new buckets are 3 views on 2026-09-13 and 232 clones / 94 unique cloners on 2026-09-13; their origin is not identifiable from the available API, so they are not counted as confirmed external users. The v0.1.11 assets report one tarball and one checksum download, both matching our public package smoke verification. Zenn likes are 1 for `oathra-launch` and 0 for `oathra-evidence-rules`; GitHub Discussion #14 has two maintainer comments and no external replies, and no business inquiry has been observed. The raw snapshot is [metrics/2026-09-14-1840-jst.json](metrics/2026-09-14-1840-jst.json).

The authenticated X readback at 17:55 JST shows the account at 1 follower (previously 0) and the latest account post at 7 impressions (previously 5), with no like, reply, repost or quote. This is a small distribution signal, not proof that the follower or impressions came from the Oathra audience. The Oathra announcement remains gated until 2026-09-15 15:13:19 JST.

The existing [awesome-voice-agents#42](https://github.com/yzfly/awesome-voice-agents/pull/42) listing was updated in place again after v0.1.11 publication to describe the current release, provisional-confirmation guard and consented intake. It remains open with no maintainer response; this is a distribution experiment for the selected voice-agent audience, not evidence of adoption.

The Japanese and English Pages routes contain the v0.1.11 command, the intake recording, scenario link and private inquiry form. A CORS preflight to the form's leads and events endpoints returned 204 for the Pages origin; no inquiry was submitted during verification.

Current X publication text: [x-transcript-check.txt](x-transcript-check.txt). This is the single active draft; older drafts in the publication history are superseded. The read-only API check succeeds for `@forifori_dev`; the new [publication guard](../../scripts/publish-x-intake.mjs) checks the draft, spacing and duplicates before uploading media. A fresh timeline read at 2026-09-14 17:20 JST found the newest original status `2099380959384899784` at `2026-09-14T06:13:19Z` (`2026-09-14 15:13:19 JST`), so defer the Oathra announcement until **2026-09-15 15:13:19 JST or later** and recheck the live timeline immediately before publication. Do not classify a repost as a new original announcement, or invent outside engagement from the author's own activity.

Start the 48–72 hour audience/entry-point assessment from a successfully published relevant announcement. The filtered Reddit submission is an immediate distribution failure, not the beginning of an external trial observation window. Read early feedback sooner and fix real failures immediately. The checker has no analytics; infer trials from explicit outside reports, not page views or release downloads alone.

The v0.1.4 onboarding fix is now public: [release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.4) and [Japanese setup guide](../SETUP.ja.md). It keeps the v0.1.3 credential collection and additionally continues to guided Twilio number purchase / Japan permission steps instead of stopping at the first failed check. Treat the next external trial report as the test of whether this explanation is sufficient; do not count the maintainer's clean-install smoke test.

## Objective and current diagnosis

The objective remains external GitHub stars and, ideally, real business inquiries. Publishing assets is not completion. First work toward 10 identifiable external trial users and 3 usable feedback reports; these are intermediate operating targets, not achieved results or a promised conversion rate. The previously suggested 1,000 stars in 30 days is not a user-approved success threshold.

On 2026-09-14 JST: 0 stars, 0 forks, 6 views / 6 unique visitors in GitHub's reported 14-day window, and no external issue authors in the retrieved issue list. Zenn launch: 1 like / 0 comments; technical article: 0 / 0. [Raw snapshot](metrics/2026-09-14-before-v012.json). GitHub also reports 298 clones / 121 unique cloners. CI, Zenn deploys and automation contribute; this is not 121 confirmed users. Release downloads likewise include our package checks. Website funnel and X impression accuracy are not established.

Inference: the available reach sample cannot establish whether developers want this. A concrete adoption barrier was identifiable: the existing npm package exposed missing SDK entrypoints and required trying the whole phone runtime. The new v0.1.2 offers a local transcript checker, typed SDK and documented LiveKit adapter, with scope limitations. A clean LiveKit installation also exposed a conflicting optional RTC peer range; the range was expanded and the actual RTC wrapper is type-checked against the installed 0.13.x API. Live gateway behavior remains unverified.


## Latest experiment checkpoint — 2026-09-14 04:20 JST

The no-install [transcript checker](https://forifor.github.io/oathra/en/check.html) and 25-second walkthrough are public. [Details and evidence](transcript-check-experiment.md). The r/voiceagents post was submitted once but **removed by Reddit's automatic filter**. See the exact URL and readback in [posts.md](posts.md). Do not continue Reddit promotion or count the author-visible post as distribution. Native Chrome attachment is unavailable with current file access; LiveKit Slack requires a new join/terms step. GitHub Discussion [#14](https://github.com/FORIFOR/oathra/discussions/14) is now the active feedback prompt; inspect its replies before changing the evidence rules. The next X demo announcement remains eligible only after the account-wide 24-hour spacing and a fresh timeline check. No additional feature expansion is justified before outside feedback or a real bug. Stars remain 0; no external trials established.

## On each scheduled check

1. Read this file, recent publication records and git status. Preserve concurrent changes. Do not repeat completed work or republish an unchanged announcement.
2. Run `node scripts/growth-snapshot.mjs` and write a new timestamped snapshot under `docs/launch/metrics/` only when retaining it helps comparison. A failed source is unknown, never zero. Compare daily buckets; do not add overlapping 14-day totals. Note maintainer activity and data freshness.
3. Inspect actual external issues, comments and accessible responses to the recorded launch posts. Check deployment/install failures first. A new install or correctness report takes priority over redesign or more promotion.
4. Choose one justified next experiment, implement it, verify it and record the result and next checkpoint. At most one campaign-level experiment per 24 hours unless a real defect requires action sooner.

## Decide from the bottleneck

| Evidence | Action | What would change the decision |
| --- | --- | --- |
| Fewer than roughly 50 unique repository visitors, or stale/unavailable traffic | Investigate a relevant voice-agent community and its current showcase rules; show one narrow workflow with a working entry point | Fresh visits, outside questions or confirmed trials. 50 is a triage heuristic, not statistical confidence |
| Meaningful visits but no confirmed trial signals | Inspect download/start friction; improve one concrete entry point, error or transcript integration | Outside report of a first successful run; downloads alone are insufficient |
| Trials reveal wrong/missing outcomes | Reproduce from the user's redacted actual trace, fix, verify and explain the supported scope | Reporter confirms the fix or provides the remaining failure |
| Actual usage but little reason to revisit | Investigate repeat use cases: post-call checking, integration in CI, evaluation reports. Build only what a trace or outside request supports | Evidence of repeated use or integration |
| Business inquiry | Prepare workflow discovery, implementation scope and acceptance criteria tied to L1/L2/L3 readiness | A concrete scoping conversation; no invented lead, contract or revenue |

If a tactic shows no fresh signal after 48–72 hours, research why and change audience, channel or use case. Do not infer product failure from a handful of views. Do not just wait indefinitely, redesign without evidence, or multiply identical posts.

## Distribution

Lead with “add evidence checks to the voice agent you already have,” then the local command or SDK, a real trace and known limitations. Public posts are authorized by the user's launch request. Use existing authenticated accounts, identify project affiliation, obey each community's current rules and keep each post substantive. Record URL, time, audience, what changed and next measurement. Maximum one new announcement per channel per 24 hours; replies may answer actual questions. Avoid mass mentions and unsolicited direct messages. Do not buy stars, coordinate reciprocal stars or present automated interactions as users.

HN prohibits AI-generated/edited submissions and previously restricted this account; do not post there or bypass the restriction. DEV's AI rules prohibit generated content for promotion/clout. Reddit restrictions/removals are recorded in prior launch notes; recheck eligibility before any new community use and never circumvent an account restriction. The LiveKit [events documentation](https://docs.livekit.io/reference/agents/events/) and [transcription documentation](https://docs.livekit.io/agents/multimodality/text/) guide the adapter; neither is evidence of endorsement or live compatibility testing.

## Execution boundaries

Work autonomously within the authorized repository, site, existing articles and public launch accounts. No new mocks, dummy testimonials, fabricated call records or fake feedback. Use existing real recordings and observed bug reports for verification. Do not make paid calls without actual consented recipients and a defined budget. Do not treat simulator success as 100-call PSTN validation. Do not claim L2/L3 readiness or conclude the goal merely because a release shipped.

Use the current task's scheduled follow-up; do not create duplicate recurring tasks. Stay quiet on unchanged, non-actionable checks. Notify for an actual improvement released, meaningful outside feedback, a material failure, or an unavoidable user action. Repeated missing authentication for one channel does not prevent work on another. Stop the follow-up on explicit user cancellation or an agreed, actually achieved goal. If no useful authorized path remains, report the specific blocker instead of pretending the goal is met.
