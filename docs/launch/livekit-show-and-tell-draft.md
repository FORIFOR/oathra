# LiveKit `show-and-tell` draft

Prepared 2026-09-14 for one substantive post in the LiveKit Developer Community, only after account access and the current channel rules are checked again. This is a draft, not a published post.

## Title

Oathra: verify phone-agent outcomes from the callee's evidence

## Body

When a voice agent calls a business, its own “booked” message is not proof that the other party agreed. Oathra is an Apache-2.0 TypeScript runtime and SDK that keeps each decision tied to an utterance from the callee. Completion is decided by deterministic checks, so an offer, hedge or self-assertion does not become a completed booking.

The v0.1.12 release includes a 48-second Arena recording and a runnable scenario:

- Demo: https://forifor.github.io/oathra/#intake-video
- Release: https://github.com/FORIFOR/oathra/releases/tag/v0.1.12
- Local run (no provider key): `npx --yes --package=https://github.com/FORIFOR/oathra/releases/download/v0.1.12/oathra-0.1.12.tgz oathra demo`

The same contract can optionally ask for a small amount of follow-up information after the required booking details settle. Oathra asks consent once, asks one contract-declared field per turn, stops on decline, hold or ambiguity, and saves only explicit answers to `intake.json` and `summary.md`. It does not infer a callee profile or collect undeclared or sensitive attributes.

For teams already building LiveKit or other phone agents: would an utterance-linked post-call verifier for reservations and consented follow-up be useful? Which event or trace format would make it easiest to add without moving your carrier or model? Redacted or synthetic traces are enough; please do not share keys, private URLs or customer data.

This is a local simulator and evidence-engine demonstration. It is not a claim of LiveKit endorsement or of measured PSTN success rates; the LiveKit gateway path remains unverified.

## Posting checklist

- Re-read https://community.livekit.io/guidelines and confirm the target is a promotion-specific channel such as `show-and-tell`.
- Confirm the account is logged in and the post is still relevant to the current discussion.
- Publish once, without unsolicited DMs or staff mentions, then record the public URL, time and replies in `docs/launch/posts.md`.
