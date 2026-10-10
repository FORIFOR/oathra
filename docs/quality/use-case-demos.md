# Oathra / Ring Zero: three interactive concept demos

## Scope and design decision

This change adds `/demos/` to the public website, not a replacement for the Gateway app. The implementation uses the existing Ring Zero Mist/ink/Jade language and the approved input → review → approval → call → report sequence. The existing `ui-craft` workflow was read; the separately referenced `frontend-design` skill was unavailable. No plugin was installed. The new synthetic fixtures are explicitly authorized for this concept demonstration and do not alter earlier recorded-evidence examples.

The design follows the existing application layout: a working main column and a quiet authorization summary at the side. An all-in-one chat was rejected because it hides the exact terms of approval; a marketing card carousel was rejected because it obscures state and back/cancel controls. The new screen extends the existing app language rather than redesigning it. The optional Gateway-specific evidence gate does not cover this standalone site entry; dedicated browser assertions and an independent review are used instead.

## What is implemented

- Restaurant: synthetic nearby candidates → date/time/party size/total meal budget → target, disclosure and reservation scope approval → scripted conversation → evidence-based result.
- Stock: exact synthetic model → product price ceiling and pickup deadline → free hold/no purchase obligation approval → scripted conversation → result.
- Change: synthetic reservation `DEMO-RSV-001`, 19:00 → approval for 20:00 only, no fee or cancellation → conversation → update the demo ledger only on verified success. Every unsuccessful outcome leaves the demo ledger at 19:00.
- Each has normal, no answer, refusal, out-of-scope fee, ambiguous confirmation, and later correction branches. Back clears approval. Cancel terminates progression. Approval is one-shot and binds the exact terms. Expected-step tokens and UI click debouncing prevent duplicate progression.
- Every page and every video frame says **構想デモ・実際の発信/予約は行いません**.

## Reused and simulated capabilities

`site/src/use-case-model.ts` imports production `defineCall`, `EvidenceEngine`, and `evaluate` directly. `scripts/build-site.mjs` bundles source so a fresh clone does not depend on stale `dist`. The evaluator checks date, time, price, party size/model, and callee confirmation. The model may veto a result for the demo's fee boundary; it cannot override the evaluator into success. A completed connection alone is insufficient. Later rejection invalidates earlier confirmation through the existing evidence engine.

Search results, targets, all utterances, stock, free-hold/no-purchase terms, and the reservation ledger are **synthetic fixtures**. Free-hold/no-purchase conditions are fixed script conditions, not a claim that arbitrary spoken fee terms are parsed. The browser has no network API, carrier, microphone, auth, payment, storage, or production gateway client. `connect-src 'none'` also prevents network requests from this document. Static assets load from the same origin. Numbers use `SIM-*`, never E.164. All names and reservation ids are fictional.

The current application remains `apps/gateway`; its existing provider/voice separation and approval APIs remain available to a future separately authorized integration. This demo deliberately includes no live-adapter switch. Real nearby search, telephony, speech recognition, external inventory/booking systems, real rollback guarantees and fee negotiation are unverified and absent here.

## Extending the demos

The UI uses the `DemoKind`, `FLOWS`, target/model fixtures, and `DemoSession` state contract. Add a new kind with an explicit input validator, production CallContract, synthetic conversation plan, permissions/disclosure scope, failure policy, result text, and tests before exposing an option. Hair salons, bicycle repair intake, opening hours, lost property, hotel late arrival, cleaning, and cancellation are listed as future use cases only. Cancellation needs a distinct permission and cannot reuse the three demos' deny-cancel policy.

## Run and verify

```sh
pnpm install --frozen-lockfile
pnpm build:site
python3 -m http.server 4318 --bind 127.0.0.1 --directory site
# http://127.0.0.1:4318/demos/?flow=restaurant
pnpm test:use-cases
node scripts/ui/use-cases.mjs
```

Published checks and media hashes are in [use-case-verification.json](use-case-verification.json). See `artifacts/use-cases/` for local browser screenshots, branch assertions, video full-decode reports and opening/middle/end frames. The screenshots and videos show actual UI operations. Review observations are in `use-case-review.md`. Existing Gateway app checks are regression evidence, not proof of live calling.

## Publication

The Oathra draft PR contains only these demo sources, the site/README entry points, capture and verification scripts, dedicated tests and the three recordings. Merge to `main` triggers existing GitHub Pages via `site/**`/`docs/media/**`; the intended public URL is `https://forifor.github.io/oathra/demos/`. Before merge this URL is a future destination, not a deployed preview.

Reachmade has a separate draft PR with its Oathra page, media, links, tests and documentation. Its local preview is independent of production. Production publication requires the existing Reachmade Cloudflare release procedure after review. Neither PR should merge unrelated open PRs. No note or Facebook content is changed by this work.
