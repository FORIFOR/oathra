# Oathra — project conventions

- pnpm workspace, TypeScript ESM (`NodeNext`), `exactOptionalPropertyTypes` on. Build with `pnpm build` (tsc -b), test with `pnpm test` (vitest, aliases `@oathra/*` to src).
- **CLI runs against dist**: `pnpm oathra ...` rebuilds first. Running `tsx packages/cli/src/bin.ts` directly uses stale `dist/` of workspace deps — rebuild before trusting output.
- Dependency direction is enforced by `scripts/check-deps.mjs` (`pnpm lint:deps`). Never import upward.
- Deterministic first: dates/times/prices/phones/serials are parsed in `packages/evidence/src/normalize.ts`, never by an LLM. Completion is `evaluate()` in `packages/evidence`, never a model's opinion.
- The canonical confirmation field is `confirmed` (callee-only evidence). Scenario `win` fields must appear in `mission.require` or `mission.constraints`.
- Scripted characters live in `providers/simulator/src/characters/` and must implement `truth()` so eval can detect false completions. `pnpm oathra eval` must report `False Completion 0`.
- Product goal: `docs/GOAL.md`. Architecture: `docs/ARCHITECTURE.md`.
- Arena visual QA without the Chrome extension: start `oathra demo --no-open`, then `node scripts/qa-arena.mjs <outDir>` (drives local Google Chrome headless over CDP and writes PNGs).
- Trust gate: `oathra eval --adversarial 10000` must print `False Completion: 0 / 10000`.
- Phone Layer (`packages/phone`) + Voice Layer (`packages/voice`): carriers (`providers/phone-*`) and engines (`providers/openai-realtime` engines, `providers/voice-pipeline`) never import each other; the bridge in `packages/phone/src/bridge.ts` converts audio. LiveKit is the first `SipGateway` implementation, not the spec.
- Real-call verification order: `oathra phone test --level local` (¥0 telephony, few yen of API) → `--level gateway` → `--level pstn` only with the user's explicit go.
- `apps/gateway`, `sdk/`, `plugins/` are plain ESM outside the pnpm workspace. Test them with `pnpm test:gateway` (needs the build; the gateway imports `packages/*/dist`). `pnpm lint:deps` also enforces `sdk → nothing`, `plugins → sdk`, `gateway → sdk, plugins, built packages`; the core never imports from them.
- Appointment-style outcomes (sales meetings) use `confirmation: "callee_acceptance"` on the contract. The verdict still comes from `evaluate()`; never add gateway-local agreement rules. `packages/evidence/src/appointment-fuzz.test.ts` must stay at 0 false completions over 10,000 seeded dialogues.
