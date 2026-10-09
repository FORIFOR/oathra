# LiveKit `show-and-tell` draft

Prepared 2026-09-14; destination rechecked 2026-10-01. This is an unpublished draft for a promotion-specific LiveKit community channel whose existence, rules and account access still need confirmation. The public Developer Community category list does not show `show-and-tell`; do not assume the forum has the Slack channel mentioned in its general guidelines. `Announcements` is for the LiveKit team.

## Title

Oathra: verify phone-agent outcomes from the callee's evidence

## Body

When a voice agent calls a business, its own “booked” message is not proof that the other party agreed. Oathra is an Apache-2.0 TypeScript runtime and SDK that keeps each decision tied to an utterance from the callee. Completion is decided by deterministic checks, so an offer, hedge or self-assertion does not become a completed booking.

The v0.1.19 release includes ActionProof, a 48-second Arena recording and a runnable scenario:

- Demo: https://forifor.github.io/oathra/#intake-video
- Release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.19
- Local run (no provider key): `npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.19/oathra-0.1.19.tgz oathra demo`

The same contract can optionally ask for a small amount of follow-up information after the required booking details settle. Oathra asks consent once, asks one contract-declared field per turn, stops on decline, hold or ambiguity, and saves only explicit answers to `intake.json` and `summary.md`. It does not infer a callee profile or collect undeclared or sensitive attributes.

For teams already building LiveKit or other phone agents: would an utterance-linked post-call verifier for reservations and consented follow-up be useful? Which event or trace format would make it easiest to add without moving your carrier or model? Please describe an actual failure with identifying details removed; do not share keys, private URLs or customer data.

This is a local simulator and evidence-engine demonstration. It is not a claim of LiveKit endorsement or of measured PSTN success rates; the LiveKit gateway path remains unverified.

## Posting checklist

- The general guidelines at https://community.livekit.io/guidelines were readable on 2026-10-01 and restrict unsolicited promotion to designated channels. Confirm an actual permitted channel and its current rules; https://community.livekit.io/categories did not list `show-and-tell`. Do not post this announcement in a general support category or in the team-only `Announcements` category.
- The official Slack entry is https://livekit.io/join-slack; its workspace access and channel-specific rules remain unverified. The invite page alone is not posting eligibility.
- Confirm the account is logged in and the post is still relevant to the current discussion.
- Publish once, without unsolicited DMs or staff mentions, then record the public URL, time and replies in `docs/launch/posts.md`.
