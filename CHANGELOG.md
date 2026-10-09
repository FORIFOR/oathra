# Changelog

Release notes live in `docs/launch/release-notes-<version>.md`; this file lists them. Assets are attached to the matching [GitHub Release](https://github.com/FORIFOR/oathra/releases).

## Unreleased — front-line use: care, sales lists, a business line

- **Safety on every call.** No diagnosis or medicine advice, 119/110 and nearby people named, and never a claim that help was summoned. Words that mean someone may need help are detected from what the other person said; staff are alerted during the call (signed webhook, no speech in it unless opted in) and the call is not cut.
- **Care calls.** `pace: "gentle"` (slow, plain, patient; longer waits before a turn or the line is treated as silent), wellbeing and medication templates, a check-in report of what the person said about condition, meals, medicine, sleep and worries with their own words beside it (hedged or contradicted answers are "unclear"; 10,000 seeded dialogues, 0 false yes), standing requests that repeat on a schedule with retries, and an alert when nobody answers. A voicemail greeting is not an answer.
- **Sales and trade.** Calling hours for real sales calls (default 09:00–20:00 JST), list calling with one approval for up to 100 saved contacts, contact CSV import, CSV export, the required opening of a sales call, delivery-date and quote templates. A refusal in an ordinary request no longer suppresses the number; a mistaken suppression can be released with a recorded reason.
- **A business line.** Answers as the business, only from the operator's own short answers, within set hours, puts a caller through to a person on request, tells the staff a call was taken, and can carry several calls at once (`OATHRA_MAX_CONCURRENT_CALLS`, default 1).
- **Teams and operations.** A `manager` role that sees its own team's calls (no numbers or speech in the list), a team summary with the answer rate, a deploy that waits for the call in progress, a restore command, one opening notice on every carrier path, and a call that ends when speech recognition dies.
- 176 tests for modules that had none (accounts, purchases, prerelease limits, delegation, MCP, backup) and six fixes they found. **None of this has been verified on real calls**: how the gentle pace sounds, whether the model keeps to the business's answers, transfer, and concurrent lines are all unverified. [Guide](docs/FRONTLINE.ja.md) · [Record](docs/quality/frontline.md).

## Unreleased — application flow and account clarity

- Reorganized the signed-in home around reports, improved narrow-screen navigation and forms, and made paused calling and incomplete outcomes explicit. Late asynchronous navigation can no longer replace the screen the user just selected.
- Separated available and reserved credits, purchase history and usage history; kept dialog closing and recovery from network failures within reach. Detailed settings inherit the app's browser session, with account-bound requests to prevent stale forms from crossing accounts.
- Preserved call approval, purchase reconciliation and prerelease limits. Actual paid-call and production-payment acceptance remain separate from this interface work. [Application quality record](docs/quality/app-craft.md).

## Unreleased — evidence-led website and clearer service entry

- Reworked the Japanese and English entry pages around the saved negotiation's utterances and real completion checks. The transcript checker shows the source evidence beside current values; the existing interactive lab and recording remain reachable.
- Unified the Gateway sign-in entry and moved AI connection setup ahead of login. Client-specific instructions, keyboard navigation, clear pause notices and review-focused consent screens preserve the existing call approval and billing boundaries.
- Reviewed actual desktop and narrow-screen behavior in isolated browsers. These changes do not launch the hosted phone service or certify an award outcome. [Quality record](docs/quality/award-craft.md).

## Unreleased — sales drafts through Claude Code and ChatGPT

- Added an opt-in HTTP MCP endpoint with browser OAuth consent, scoped read/draft access, expiring tokens and connection revocation. AI can read owned facts, prepare an idempotent sales draft, and retrieve evidence; the human reviews and approves paid calls on Oathra.
- Added `/connect` with client setup instructions, connection management and draft review. Existing call consent, credit checks and prerelease limits remain required. Public hosting, official-client interoperability and the real sales-call flow are not yet verified. [Setup](docs/integrations/claude-chatgpt.md) · [Evidence](docs/quality/sales-mcp.md).

## Unreleased — public service setup

- Added email-verified registration and recovery, persistent customer identities, shared sign-in/purchase screens, and Stripe Checkout with payment reconciliation and idempotent credit grants.
- Added restricted prerelease enrollment, per-account/shared rolling call budgets, maximum duration and admission pause; inbound answering is disabled during prerelease. Checkout reconfirms credit quantity, ambiguous callbacks cannot select another customer, and monthly approval totals survive call deletion.
- Added read-only launch diagnostics, worker readiness checks, and native SQLite backup with integrity verification. Existing operator login and balances remain supported.
- Production mail, prices/payment credentials, fixed hosting, and actual signup-to-call acceptance remain unconfigured or unverified. This is not a public service launch. [Readiness and evidence](docs/quality/public-service.md).

## Unreleased — delegated phone actions

- Added server-owned trial defaults (10 calls, up to five minutes per call, 24-hour expiry), atomic credential/grant provisioning, private connection files, and a scoped stdio MCP phone adapter. Genie-specific interoperability remains unverified.

- Added bounded, revocable phone delegation for external agents, persistent dispatch idempotency, status and cancellation APIs, and Gateway SDK methods.
- Added optional structured `PhoneRequest.success` conditions, checked by the existing evidence engine and passed to the voice engine.
- Added Multibot phone-bot setup and non-dialing verification using real recorded requests. Real cross-project PSTN completion remains unverified until a recipient and delegation are authorized. [Integration guide](docs/integrations/multibot.md).

## Oathra v0.1.19 — 2026-09-29

v0.1.19 replaces the Arena with the Oathra app: `oathra demo` opens it in practice mode on your computer (watch the AI call, or answer it yourself), with records, sign-in links for other devices, other practice AIs and real calls behind flags.
[Release notes](docs/launch/release-notes-0.1.19.md) · [GitHub Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.19)

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
