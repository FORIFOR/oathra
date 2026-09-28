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
The app opens in practice mode with only the built-in, offline scripted agent. In **練習**, choose a practice and **AIの電話を見る**: the other party's words settle each field (the ring closes, the words are marked), and the run is saved to `.oathra/calls/`, listed under **記録**. Choose **自分が相手役** to answer the AI's call yourself.

Only explicitly run `pnpm oathra demo --allow-models` when you intend to enable external model providers and their data transmission/API costs. No real telephone call is made in practice. See the [source compatibility contract](quality/arena-contract.md) and [verification record](quality/verification.md).
