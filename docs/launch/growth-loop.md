# Acquisition and adoption loop

## User-approved sequence — 2026-09-14 JST

The user explicitly selected this sequence: (1) focus on developers already building voice/phone agents with LiveKit or similar tools who need to detect false reservation completion; (2) show saved transcripts producing verified fields, missing requirements and JSON, with a direct integration guide; (3) obtain real feedback in relevant public communities; (4) change distribution when visits are absent, explanation/onboarding when visits do not become trials, and functionality when users encounter failures.

Stages 1 and 2 are prepared and public. Stage 3 is the current priority. Do not spend another cycle rebuilding the demo or expanding features without an actual reported need. The existing 12-hour heartbeat `oathra` now explicitly follows these four steps. Its cadence and notification policy are unchanged; no duplicate automation was created.

### Current product checkpoint — v0.1.7

The user-requested follow-up workflow is now implemented as consent-based, contract-declared intake. After the required call details settle, Oathra asks once for permission, asks at most one declared field per turn (default cap three, hard cap eight), stops on decline, hold or an ambiguous reply, and saves only the next explicit callee answer with its utterance ID and timestamp. `intake.json` and `summary.md` make the collected answers and decisions reviewable. The feature does not infer a profile, collect undeclared or sensitive attributes, or continue after refusal. Release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.7.

The latest 2026-09-14 14:10 JST readback remains 0 stars / 0 forks, 6 views / 6 unique visitors and 298 clones / 121 unique cloners in GitHub's 14-day window; v0.1.7 assets had 0 downloads at that snapshot. These are distribution signals, not confirmed users. Zenn likes are 1 for `oathra-launch` and 0 for `oathra-evidence-rules`; no external feedback or business inquiry has been observed.

Current X publication text: [x-transcript-check.txt](x-transcript-check.txt). This is the single active draft; older drafts in the publication history are superseded. A fresh read of the existing account at 2026-09-13 19:28 UTC found the two Oathra demo posts still dated 15:38 UTC, plus other account activity up to 18:01:15 UTC. Account-wide activity can affect spacing: conservatively consider 2026-09-14 18:01:15 UTC (2026-09-15 03:01:15 JST) or later, and recheck the live timeline immediately before publication. Do not classify a repost as a new original announcement, or invent outside engagement from the author's own activity.

Start the 48–72 hour audience/entry-point assessment from a successfully published relevant announcement. The filtered Reddit submission is an immediate distribution failure, not the beginning of an external trial observation window. Read early feedback sooner and fix real failures immediately. The checker has no analytics; infer trials from explicit outside reports, not page views or release downloads alone.

The v0.1.4 onboarding fix is now public: [release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.4) and [Japanese setup guide](../SETUP.ja.md). It keeps the v0.1.3 credential collection and additionally continues to guided Twilio number purchase / Japan permission steps instead of stopping at the first failed check. Treat the next external trial report as the test of whether this explanation is sufficient; do not count the maintainer's clean-install smoke test.

## Objective and current diagnosis

The objective remains external GitHub stars and, ideally, real business inquiries. Publishing assets is not completion. First work toward 10 identifiable external trial users and 3 usable feedback reports; these are intermediate operating targets, not achieved results or a promised conversion rate. The previously suggested 1,000 stars in 30 days is not a user-approved success threshold.

On 2026-09-14 JST: 0 stars, 0 forks, 6 views / 6 unique visitors in GitHub's reported 14-day window, and no external issue authors in the retrieved issue list. Zenn launch: 1 like / 0 comments; technical article: 0 / 0. [Raw snapshot](metrics/2026-09-14-before-v012.json). GitHub also reports 298 clones / 121 unique cloners. CI, Zenn deploys and automation contribute; this is not 121 confirmed users. Release downloads likewise include our package checks. Website funnel and X impression accuracy are not established.

Inference: the available reach sample cannot establish whether developers want this. A concrete adoption barrier was identifiable: the existing npm package exposed missing SDK entrypoints and required trying the whole phone runtime. The new v0.1.2 offers a local transcript checker, typed SDK and documented LiveKit adapter, with scope limitations. A clean LiveKit installation also exposed a conflicting optional RTC peer range; the range was expanded and the actual RTC wrapper is type-checked against the installed 0.13.x API. Live gateway behavior remains unverified.


## Latest experiment checkpoint — 2026-09-14 04:20 JST

The no-install [transcript checker](https://forifor.github.io/oathra/en/check.html) and 25-second walkthrough are public. [Details and evidence](transcript-check-experiment.md). The r/voiceagents post was submitted once but **removed by Reddit's automatic filter**. See the exact URL and readback in [posts.md](posts.md). Do not continue Reddit promotion or count the author-visible post as distribution. Native Chrome attachment is unavailable with current file access; LiveKit Slack requires a new join/terms step. GitHub Discussion [#14](https://github.com/FORIFOR/oathra/discussions/14) is now the active feedback prompt; inspect its replies before changing the evidence rules. The next X demo announcement remains eligible only after the account-wide 24-hour spacing and a fresh timeline check. No additional feature expansion is justified before outside feedback or a real bug. Stars remain 0; no external trials established.

## Every 12 hours

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
