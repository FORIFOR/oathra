# Oathra for iOS

Native SwiftUI remote control for the hosted Oathra gateway. The phone/voice runtime stays server-side.

## MVP screens

1. **Do** — "どんな電話を任せますか？", product selector, target selector, Test on me.
2. **Review** — exact recipient, caller identity, goal, claims, forbidden commitments, permissions, budget and estimated cost.
3. **Live** — dialing/connected/current objective, approval card, cancel and verified handoff state.
4. **Result** — confirmed facts, missing facts and evidence. Separate telephone agreement from calendar/email delivery and acceptance.
5. **Settings** — verified operator number, product profiles, limits, recording/retention policy.

## Client rules

- Never store carrier/model API keys.
- Never infer approval from text entry or navigation.
- Use a server-issued approval token scoped to the immutable mission revision.
- Use an idempotency key for every call start.
- Restore state from the gateway after app relaunch.
- Push notifications are hints; fetch canonical state before showing a call as complete.
- Do not claim that the user's cellular caller ID is used unless the configured carrier has verified it.
