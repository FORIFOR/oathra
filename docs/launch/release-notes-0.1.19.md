# Oathra v0.1.19

v0.1.19 replaces the Arena with the Oathra app. `oathra demo` now opens the same app that runs as the Gateway, in practice mode on your computer: no sign-in, no API key, nothing dials.

## The app (`oathra demo`)

- **練習 (practice):** watch the AI call a built-in character, or choose 自分が相手役 and answer the AI's call yourself as the shop, in text. A field is settled only by the other party's own words; the settling words are marked in the conversation.
- **記録 (records):** practice runs and `oathra play` calls are saved to `.oathra/calls/` and can be replayed.
- **Other devices:** `--allow-remote` (same network) and `--tunnel` print a sign-in link; only this computer opens without one.
- **Other AIs in practice:** `--allow-models` lets OpenAI, Gemini or Ollama make the practice call; the screen says the conversation is sent and charged.
- **Real calls:** `--live --tunnel` uses this machine's carrier and voice keys; readiness is shown at start and in 設定.
- 電話を頼む by kind of call, 予約を取る (the one request that may book), 予定 (dates the calls settled), the report with each settled value and its quote, AIが判断したこと (the AI's own account, not used for the verdict), voice samples, a monthly cap, email and password sign-in for the server.

## Voice and runtime

- Gemini Live (`gemini-3.8-live`) as a second speech-to-speech engine, with session resumption; an acting voice (Deepgram → OpenAI → Gemini TTS) for the pipeline engine.
- No stale replies after the callee has spoken again, no turns without words, and a check-in when the line goes quiet.
- The runtime hangs up on brain/TTS exceptions and ends silent lines at `maxDurationMs`. `oathra --version`; `doctor` checks ngrok instead of unused keys.

## Evidence

- Fixes from the 2026-09-26 audit: a bare 「承りました」 does not confirm; English "not confirmed yet" never does; 「2万5千円」 parses as 25,000; per-head prices are not party sizes; durations are not times; cancellation policies are not cancellations; 「その時間は難しい」 after a booking takes it back.

## Removed

- The Arena (`apps/arena`) and its local web phone. v0.1.18 and earlier still open it.

## Verification

- `pnpm test`: 1113 passed, 1 skipped credential-gated test. `pnpm test:gateway`: 334 passed. `pnpm lint:deps` passes.
- `oathra eval`: False Completion 0. `oathra eval --adversarial 10000`: 0 / 10000.
- Browser checks (local Chrome over CDP): the Gateway flow, the app (54 checks), the local app (12 checks: no sign-in here, sign-in link from a LAN address at 390 px, practice with another AI via a stand-in, records and seeking), the managed screens.
- The packed tarball was installed into an empty directory and `npx oathra demo` served the app.
- Not verified by the assistant: a real phone call on this build, a tunnel, a physical phone on the LAN, external model practice (paid), Windows and Linux.
