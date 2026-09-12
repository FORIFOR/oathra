---
title: I let an AI make phone calls, then took the word "booked" away from it
published: false
tags: ai, opensource, typescript, voice
canonical_url: https://github.com/FORIFOR/oathra
---

Getting an AI to place a phone call takes an evening. The trouble starts after that.

- It said "your table is booked" when the restaurant had said no such thing.
- It talked to a voicemail greeting for two minutes, politely asking for a reservation.
- It accepted a price above the budget because the conversation had a nice flow.

All three happened on real calls to my own phone. So I built a runtime that **takes the completion decision away from the model and gives it to code**.

https://github.com/FORIFOR/oathra

## What it does

```bash
npx oathra demo
```

Two AIs start a phone call in your browser, no API key. One plays a restaurant, the other wants a table. 7 pm is full, the restaurant offers 7:30, the caller takes it, gives a name, and only when the restaurant says "you're all set" does the run become MISSION COMPLETE.

The result is not a summary. Every field is anchored to something the *other party* said.

```json
{
  "field": "time",
  "value": "19:30",
  "source": "callee",
  "transcript": "7 is fully booked, but we do have 7:30.",
  "span": "7:30",
  "explicit": true,
  "verified": true
}
```

Completion is a formula, not an opinion:

```text
complete = connected ∧ date.verified ∧ time.verified ∧ partySize.verified ∧ confirmed.verified ∧ constraints hold
```

If the caller says "great, that's confirmed", it is recorded and ignored. Only the callee's "you're booked" fills `confirmed`.

## The evidence rules

This part is deterministic parsers and rules. No LLM.

- "7 is full, but 7:30 works" → no evidence for 7:00 (negated clause)
- "the 13th, sorry, the 14th" → the 14th survives, with a supersede trail
- "probably fine" → neither agreement nor confirmation
- price changes after "you're booked" → the confirmation goes stale and must be re-obtained
- "OK, I'll look elsewhere" → not an acceptance

There is a command that generates ten thousand hostile clerks to break this:

```bash
oathra eval --adversarial 10000
# never-confirm / wrong-restate / negate-then-offer / silent-hangup / caller-echo-trap
# False Completion: 0 / 10000 adversarial runs
```

The fuzzer caught real bugs. The first one: "¥21,100" was split at the comma, became "¥100", and the agent happily accepted. More recently I let GPT-4o mini and Gemini *play the clerk* (`oathra eval --callee openai`), which found refusals that quoted a number being read as offers, and product names being parsed as serial numbers.

## Real phone calls

The same runtime drives real calls.

```bash
oathra setup phone      # pick a voice engine and a carrier
oathra phone doctor     # which layer is broken
oathra call --to +81…   # dial
```

Carriers (Twilio direct, or Plivo / your own SIP through a LiveKit gateway) and voice engines (GPT-Live, OpenAI Realtime, Deepgram + LLM + TTS) are chosen independently.

Calls to my own phone:

| # | Stack | What happened |
|--|--|--|
| 1 | Deepgram + GPT-4o-mini + TTS | 11.8 s to first reply. It kept asking "can you hear me?" |
| 2 | Same, streaming TTS | 2.2 s. Talked to voicemail for 2 minutes; noise interrupted it 13 times |
| 3 | GPT-Live (full duplex) | ~0.4 s. A 6 min 25 s chat with no errors |

Call three was when it felt usable. GPT-Live is $0.05/min for the session; Twilio to a Japanese mobile is ¥28.78/min.

## Where it honestly stands

- Twilio direct and GPT-Live are verified on real calls
- Plivo and custom SIP are implemented from provider docs; PSTN not yet verified
- MCP server is v0.2

Every number above was measured by me and can be reproduced with the commands in the README. Scenarios are YAML and welcome as PRs.

https://forifor.github.io/oathra/en/
