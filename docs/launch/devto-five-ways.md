---
title: "Five ways a voice agent tells you it booked a table when it didn't"
published: false
description: "The failure is never that the model lies about the transcript. It is that a clerk said something that is not a yes, and the model read it as one."
tags: voice, ai, testing, typescript
canonical_url: https://github.com/FORIFOR/oathra
---

I maintain [Oathra](https://github.com/FORIFOR/oathra), an open-source runtime for AI agents that make
phone calls. Its one opinion is that the model does not get to decide whether the call succeeded. A
separate piece of code reads the other party's words and decides.

That sounds like belt and braces until you look at what clerks actually say. Here are five replies to
the same request. Only one of them is a booking. A model asked "did this succeed?" says yes to at least
four, because all five *sound* like a yes.

The request, every time:

```
AI: Could I book a table for two at 7:30 pm on September 25? The name is Tanaka.
```

## 1. The pencil

```
Them: Sure, I will pencil you in for September 25 at 7:30 pm and call you back to confirm.
```

Verdict: **incomplete**, `{ date, time, partySize }` extracted, `confirmed` missing.

"Sure" is agreement. The date, the time and the party size are all there, and they are all correct.
The only thing missing is the thing you called about. A completion check that counts filled fields
passes this. A check that requires the callee to have committed does not.

## 2. The explicit hold

```
Them: We can hold September 25 at 7:30 pm for now, but it is not confirmed yet.
```

Verdict: **incomplete**, nothing extracted at all.

This one is interesting because the clerk is being maximally clear, and a naive extractor still walks
away with `time = 19:30`. The clause carrying the time is the one being negated. If you extract values
per-utterance instead of per-clause, "not confirmed yet" and "7:30 pm" end up in different variables and
the negation is lost on the way.

## 3. The counter-offer

```
Them: The only thing left that evening is 9 pm. Would that do?
```

Verdict: **incomplete**, nothing extracted.

A number was said. It was not offered as your booking; it was offered as a question. The trap here is
that the agent's *next* turn is usually "9 pm works, thank you" — and if your extractor took `21:00`
from the clerk's turn and your agent then says something agreeable, you have a fully populated booking
that nobody ever agreed to. The clerk's turn has to stay a proposal until the caller accepts it and the
clerk acknowledges the acceptance.

## 4. The retraction

```
Them: Yes, we have you down for two at 7:30 pm on September 25.
Them: Sorry, that day is fully booked after all.
```

Verdict: **incomplete**, `{ date, time, partySize }` extracted, `confirmed` gone.

This is the one I got wrong. Until yesterday, Oathra reported this as **completed**.

My retraction pattern required the refusal to name the booking — "we cannot take the reservation",
"the booking is cancelled". A clerk who simply says the slot is gone does not phrase it that way. They
say the table is taken, the day is private-hire, they are closed that day. The booking is equally dead
and my code called it a success.

The fix is narrow on purpose: an *availability* word from the callee (full, private hire, closed,
"fully booked") revokes a confirmation spoken strictly earlier. Not any refusal — "we can't take cards"
after a booking is a payment remark, not a cancellation. And only *earlier*, so the ordinary "7 pm is
full but 7:30 is free" that happens **before** a booking is untouched.

It went out as [PR #37](https://github.com/FORIFOR/oathra/pull/37) with tests in both directions.

## 5. The actual yes

```
Them: You are all set for September 25 at 7:30 pm, party of two.
```

Verdict: **completed**, `{ date: 2026-09-25, time: 19:30, partySize: 2, confirmed: true }`.

This one also failed until today, in a way I find more embarrassing than #4: it returned **nothing at
all**. Not "unconfirmed" — empty.

The engine had two separate ideas, "the callee agreed to a value the caller proposed" and "the callee
confirmed the booking", and "you are all set" was in the second list but not the first. So nothing the
caller had proposed was ever verified; and because a confirmation is bound to the values that were
settled when it was spoken, a confirmation with no settled values behind it is stale and gets dropped.
Two lists that should have overlapped, and the result is a blank screen for a perfectly normal sentence.

I only found it because I pasted an English log into my own public checker while writing a comment on
someone else's thread. Three of five natural English confirmations worked. The Japanese side, which I
use daily, was fine. The lesson is not about regexes; it is that the language you don't test in is the
language that's broken.

## How this is kept honest

Every release runs 10,000 seeded adversarial dialogues — the five shapes above plus voicemail,
transfers, hold-then-reply, dialect confirmations, wrong restatements — against a hard gate:

```
False Completion: 0 / 10000 adversarial runs
```

A false completion is when the runtime reports "completed" and the callee's own ground truth says they
never committed. Zero is the only passing number. It does not prove the checker is right about
everything; it proves the specific ways I know a call can lie are all covered, and it fails loudly the
moment a change reopens one.

The inverse error — reporting "incomplete" when the table really was booked — is allowed to happen. It
is a phone call you make again. The other direction is a customer standing outside a restaurant.

## Try it on your own log

If you run a voice agent, the fastest version of this is to paste one of your own transcripts into the
checker. No install, no key, nothing leaves the tab:

**https://forifor.github.io/oathra/en/check.html**

One turn per line, with a speaker:

```
AI: Could I book a table for two at 7:30 pm on September 25? The name is Tanaka.
Them: Sure, I will pencil you in and call you back to confirm.
```

If it reads your clerk's yes as a no, that is a bug I want — the supported phrasings are a list, and
lists are always short somewhere. The repo is Apache-2.0:
[FORIFOR/oathra](https://github.com/FORIFOR/oathra).
