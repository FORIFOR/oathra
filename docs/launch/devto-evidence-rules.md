---
title: "Four regexes and a staleness rule: how my phone agent refuses to call 'probably fine' a booking"
published: false
tags: ai, typescript, opensource, showdev
canonical_url:
---

In [the launch post](https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484) I said Oathra decides whether a call succeeded from what the *callee* said, not from the model. This is the part that does it. It lives in [packages/evidence](https://github.com/FORIFOR/oathra/tree/main/packages/evidence) and uses no LLM.

## The three lines that fooled the model

1. "Probably fine, but it's not confirmed yet" — a hedge
2. "7 pm is full. 7:30 is open" — a refusal and an offer in one breath
3. "Got it. But the price will be 23,500 yen" — acceptance, then a change of terms

Asked "was the reservation made?", an LLM would say yes to 1 and 3 often enough to matter. The conversation *flows* like a yes. So completion moved out of the model into four rules.

## Rule 1: split into clauses before reading values

"7 pm is full but 7:30 works" as one sentence yields two candidate times. The clause is split right after a contrast word (Japanese ですが/ますが/けど, English *but*), and a clause carrying a negative (full, unavailable, can't…) never produces an offer.

```ts
const sub = c.text.split(/(?<=ですが|ますが|けど|けれど|but\s)/);
```

7:00 drops out. 7:30 survives as a *callee offer*, which stays pending until the agent accepts it.

## Rule 2: one hedge word disqualifies the whole utterance

```ts
export const HEDGE_RE =
  /と思います|たぶん|多分|おそらく|かもしれません|確認します|調べてみ|probably|maybe|perhaps|I think|let me check|not sure|I'll check|might be/i;
```

Agreement is `AGREEMENT_RE && !REFUSAL_RE && !HEDGE_RE`, so "probably fine" is not an agreement even though "fine" matches. The same guard sits in front of the confirmation check: "I think… you're booked" never sets `confirmed`.

The calling side follows the same rule. The scripted agent used to restate its request after a hedge until it gave up. Since v0.1.1 it asks, at most twice, "can you confirm the reservation for the 12th, 7 pm, two people, or is it still tentative?"

## Rule 3: `confirmed` has exactly two entry points

- The callee says an explicit confirmation ("your table is booked", 「ご予約承りました」) — `CONFIRMATION_RE`.
- The agent asks a yes/no confirmation question ("can you confirm the booking?") and the callee's reply *starts* with an affirmative — `CONFIRM_REQUEST_RE` then `AFFIRMATIVE_RE`.

A reply containing a question mark is not an answer. A re-quote ("a non-smoking room would be 19,900 a night") is not an answer. And nothing the agent says counts: only nodes whose speaker is `callee` are read.

## Rule 4: a confirmation is bound to the terms at the moment it was spoken

When "you're booked" is followed by "the rate is 23,500", the earlier confirmation goes stale. The engine snapshots the settled values at the time of the confirmation plus whatever the callee restated in that utterance, and drops `confirmed` if any of them differs from the final state.

```ts
const stale = Object.entries(snapshot).some(([field, v]) => v !== undefined && out[field] !== v);
if (!stale) out.confirmed = true;
```

The agent then asks for the confirmation again.

## What it does with the three lines

Fed straight into the engine ([log](https://github.com/FORIFOR/oathra/blob/main/docs/launch/miscompletion-cases.md)):

| Callee line | Result |
|--|--|
| "Probably fine, but it's not confirmed yet" | incomplete, no `confirmed` |
| "7 pm is full. 7:30 is open" | incomplete, 7:00 never taken, 7:30 pending |
| …then "7:30 it is" / "booked for two at 7:30" | complete, time=19:30 |
| "Got it. But the price will be 23,500" | incomplete |
| "Booked at 18,000" then "sorry, 23,500" | incomplete, confirmation stale |

You can try them in the browser: `npx oathra demo`, pick Play (you answer the phone), and the lines are one-click buttons under the input.

## The honest limit

This depends on phrase coverage. CI requires 0 false completions over 10,000 mutated callees, but that is "zero within the mutations I wrote", not a real-call number. If you find a phrasing that slips through, [open an issue](https://github.com/FORIFOR/oathra/issues). It is usually one more alternation in a regex, and it is the most useful contribution.
