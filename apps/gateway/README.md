# @oathra/gateway

The hosted gateway is the product boundary between remote clients and Oathra's runtime.

This directory intentionally starts with the protocol before a carrier-backed deployment is enabled. See [../../docs/OMNICHANNEL_SALES.md](../../docs/OMNICHANNEL_SALES.md).

## Non-negotiable invariants

- A draft cannot dial.
- Approval is scoped to exactly one reviewed target and bounded mission.
- Material changes revoke approval.
- Every enqueue requires an idempotency key.
- Channel adapters cannot bypass server policy.
- LINE/Slack/iOS never receive provider secrets.
- A recipient suppression record blocks retries before dialing.
- "completed" can only come from Oathra evidence evaluation, never from a channel adapter or LLM summary.

## Suggested package split

```
apps/gateway/
  src/domain/       Mission, Approval, Suppression, CallJob
  src/http/         REST/SSE endpoints
  src/channels/     LINE, Slack adapters
  src/auth/         user/team/channel identity
  src/policy/       rate/spend/contact/retention policy
  src/store/        durable repository interfaces
  src/worker/       runtime execution
```

Do not put Twilio, LiveKit, OpenAI or LINE credentials in this package's client-facing responses.
