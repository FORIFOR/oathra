# Oathra Omnichannel Sales

Oathra's product surface is a remote control for evidence-first phone work. LINE, iOS, Web, Slack and API clients submit the same Mission; the existing runtime remains the execution and verification layer.

## Product flow

1. Import a product URL or enter a short product brief.
2. Review extracted facts, allowed claims, forbidden commitments and the call goal.
3. **Test on me**: place a real call to the operator's verified number before contacting anyone else.
4. Edit the brief after hearing the agent.
5. Select one intended recipient and review the exact target, purpose, caller identity, budget and permissions.
6. Explicitly approve that call.
7. Follow live progress from any client.
8. Receive an evidence-backed result: confirmed, incomplete, declined or failed.
9. Optionally execute separately approved follow-ups (calendar/email/CRM). Creating a calendar event must never be represented as the callee accepting it.

## Gateway boundary

```
LINE / iOS / Web / Slack / API
              |
        Oathra Gateway
 identity | intent | policy | approval | idempotency | jobs
              |
         CallContract
              |
       Oathra Runtime
 evidence | permissions | proof | replay
              |
       voice x carrier
```

The gateway MUST NOT accept raw client-generated `CallContract` as trusted authority. It builds a contract from a server-owned product profile and a reviewed mission. Clients can request changes, but server policy is authoritative.

## Required API

- `POST /v1/missions/draft` — natural-language request -> reviewable draft. No dialing.
- `POST /v1/missions/:id/approve` — explicit approval for one target and one bounded execution.
- `POST /v1/missions/:id/calls` — enqueue an approved call using an idempotency key.
- `GET /v1/missions/:id` — canonical state.
- `GET /v1/calls/:id/events` — resumable event stream.
- `POST /v1/calls/:id/cancel` — stop the call.
- `POST /v1/calls/:id/approvals/:approvalId` — approve/deny an in-call action.
- `POST /v1/calls/:id/handoff` — request human handoff; only report success after the media bridge confirms it.
- `POST /v1/channels/line/webhook` — LINE adapter.
- `POST /v1/channels/slack/events` — Slack adapter.

## Mission state machine

`DRAFT -> REVIEWED -> APPROVED -> QUEUED -> DIALING -> ACTIVE -> VERIFYING -> COMPLETED | INCOMPLETE | DECLINED | FAILED | CANCELLED`

Approval is invalidated when target, goal, product facts, permissions, price/offer limits, caller identity or budget changes.

## Sales evidence

Do not add a generic "positive" field. Use explicit facts:

- `presentation_delivered`
- `material_send_allowed`
- `meeting_date`
- `meeting_time`
- `meeting_duration`
- `meeting_confirmed`
- `do_not_contact`

Whether a meeting was agreed is decided by `packages/evidence` (`evaluate()` with `confirmation: "callee_acceptance"`), not by gateway-local rules; `apps/gateway/lib/sales.mjs` only adds the sales-specific facts the engine has no field for and maps the result. A slot needs both sides: the caller's proposal (or restatement) and the callee's clean commitment.

"Maybe next week" is not a meeting. "Send me the deck" is not a meeting. A calendar event created by the caller is not acceptance by the callee. Evidence remains attached to the callee utterance or authenticated external record.

## Safety defaults

- Every external call requires a specific reviewed recipient and explicit approval. No approval-by-typing a phone number.
- No contact-list bulk dial or automatic prospect scraping in the default product.
- A decline or do-not-contact request creates a suppression record before any retry can be scheduled.
- Rate, spend, duration and retry limits are server-side.
- Never expose carrier/model credentials to mobile or messaging clients.
- Disclose AI identity/purpose as required by the deployment policy and jurisdiction.
- Recording is off until the deployment has an appropriate consent flow and policy.
- Sensitive product claims and unsupported facts are not inferred from a URL.
- Follow-up actions have independent permission/proof state.
- Webhook signatures, replay protection, nonce/timestamp checks and idempotency are mandatory.
- Retention is configurable; transcript/audio access is least-privilege and auditable.

## LINE UX

The LINE bot is a command surface, not the runtime.

User:
> 昨日問い合わせがあった田中さんに電話して。製品を説明して、興味があれば15分の商談を取りたい。

Bot:
> 田中さんへの電話を準備しました。目的: 製品説明 -> 15分の商談設定。値引き・契約確定は許可しません。

Buttons: **電話する / 内容を変更 / キャンセル**

Only the signed postback from **電話する** approves the single execution. Free text can edit a draft but never silently approves it.

During the call, LINE receives coarse state updates and actionable approval requests. It should not stream every transcript line into a chat. At completion it returns verified facts and short evidence excerpts.

## iOS

Use SwiftUI as a native remote control. Keep carrier/model execution on the server.

Tabs:
- **Do** — natural-language mission composer, recent templates, Test on me.
- **Live** — active call state, approval cards, cancel, handoff.
- **Results** — verified facts, missing facts, evidence and follow-up status.
- **Settings** — verified operator number, product profiles, limits, privacy/retention.

The app must recover canonical state after suspension/relaunch; a client disconnect never grants permission or converts an incomplete mission into success.

## Delivery gates

P0: gateway contract + durable state + auth + idempotency + approval + Test on me + sales scenario/evidence + LINE webhook.
P1: SwiftUI client + push notifications + handoff + calendar/email adapters.
P2: Slack/API/MCP + CRM + team RBAC + compliant multi-recipient workflows.

Before describing hosted outbound sales as production-ready, run controlled real-line evaluation including voicemail, refusal, hold, transfer, noise, ASR errors, disconnects and ambiguous commitments. Report both task success and false completion.
