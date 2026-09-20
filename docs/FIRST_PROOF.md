# Oathra first proof

The fastest trustworthy path is the simulator, not a real phone call.

```bash
pnpm first-proof
```

This is the existing Oathra demo path exposed as an explicit product-evaluation entry point. It is meant to show the core contract — **claim → transcript evidence → verification state** — before telephony/model credentials are introduced.

Before moving from simulator evidence to a provider-backed path, run:

```bash
pnpm doctor
```

The doctor is a prerequisite check. Passing it does not prove that a booking, purchase, or other external system action occurred.

## What counts as proof

- The transcript/evidence record can support what the callee said.
- A verified transcript statement is not automatically proof that an external restaurant/CRM/reservation system committed the action.
- Real telephony/provider configuration is a separate opt-in step.
- A simulator run must stay visibly distinguishable from a real call.

The first-proof path should remain useful with no paid telephony account and should never silently fall through to a real call.

## Source checkout: first success and recovery

Node 22+ and pnpm 10.12.2. Run `pnpm install`, then `pnpm first-proof`.
The default demo exposes only the built-in, offline scripted agent. Choose a mission, read the other party's transcript beside its evidence, then choose **Download evidence JSON**. This file includes the result, contract, transcript, evidence events, and decision memo. The simulator is a product feature, not a real booking or a live model quality benchmark.

On the first screen, open **Edit a practice response**, edit the restaurant response, and open practice. The text is copied into the reply box; review it and press Send. Choose **Play** to answer yourself; the suggested response chips populate an editable input. Confirmed statements and tentative statements should produce different evidence. A failed/incomplete result is a valid outcome, not a broken application.

A saved result says **Saved locally** and is available under **Past calls**. If saving fails, keep the page open, download the artifact, fix the directory's write access and choose **Retry saving**. This retries the write, not the call. Reloading a call URL resumes the same call; after server restart, it opens its saved recording if available. An unsaved result is lost when the server exits. When disconnected, choose **Check this call again**; do not blindly start a new call.

Only explicitly run `pnpm oathra demo --allow-models` when you intend to enable external model providers and their data transmission/API costs. No real telephone call is made by Arena. See the [source compatibility contract](quality/arena-contract.md) and [verification record](quality/verification.md).
