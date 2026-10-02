# Realtime TTS migration candidate

This patch adds an **opt-in**, isolated Realtime GA text-to-speech adapter targeting
`gpt-realtime-2.1-mini`. It does not change the native GPT-Live engine, the default
legacy Speech transport, Gemini character voices, or any Noa voice assets.

## Local verification status

Baseline: `1fbb074e879895ae624f17ab0feb8f94f45918d8`.
The baseline suite passed 1,116 tests, with one pre-existing skip.
See the delivered verification logs for final post-patch results. Offline transport
fixtures and synthetic audio are test inputs, not real provider output or call benchmarks.
No credentials, paid generation, carrier call, deployment, or remote Git change was used.

## Select the candidate explicitly

After approved live acceptance, an operator can opt in in their own existing environment:

```sh
OATHRA_TTS_TRANSPORT=realtime
OATHRA_TTS_MODEL=gpt-realtime-2.1-mini
OATHRA_TTS_VOICE=alloy
```

Existing `OPENAI_API_KEY` authentication is used; this patch neither creates nor saves a key.
Do not paste keys or `.env` into reports. Unset the transport or set it to `speech` to retain
the existing path. There is no silent retry or fallback after a synthesis failure.
Unsupported model IDs and transport typos fail before opening the adapter connection.

The factory is used by the Pipeline default and CLI loopback callee. The CLI full
`--level conversation` test refuses Realtime selection because its legacy per-character
cost estimate is not valid for Realtime. Do not remove that guard until token-based
usage accounting and budget enforcement are implemented and verified. The standalone
`runLocalConversation` API remains caller-controlled; never inject this provider and
assume its legacy budget estimate is valid.

## Adapter contract

Each utterance opens a fresh authenticated WebSocket to the official Realtime endpoint.
After session configuration is acknowledged, it submits one out-of-band response with
only the requested text and no tools. The documented GA events are correlated by request,
response, output item and content index. Failed, incomplete and cancelled responses fail.

Output is configured as PCM16LE mono at 24kHz. Chunks are buffered, including fragments
that split PCM samples. After completion and a matching model-generated transcript,
existing audio-kit conversion produces 8kHz μ-law. Async frame iterators retain the
interfaces expected by Oathra. **They are buffered playback, not immediate streaming.**
This increases first-audio latency versus the legacy streaming path and must be measured.

Transcript matching uses NFKC, folded whitespace and terminal Japanese/English sentence
punctuation only. Decimal separators, minus signs, currency and internal spaces remain
significant. No bytes are released on a mismatch or missing transcript. This is a
conservative guard, not independent ASR or a guarantee that audible words are identical.
OpenAI explicitly does not guarantee that Realtime instructions will be followed exactly.
The default transport must not change on the strength of mocked tests.

The socket has a time limit, maximum payload, audio-byte limit and chunk-count limit.
Caller cancellation closes the connection and, when known, cancels its specific response.
Late events cannot release audio after a terminal result. Raw provider error payloads,
credentials and synthesis text are not included in adapter errors.

## Pipeline failure fixes

A synthesis failure before any frame is played now returns `skipped:true`; the runtime
therefore does not record the requested text as spoken evidence or act on an unspoken
hangup reply. An interrupted or failed partially queued stream emits `clear`.
Pipeline interruption/close propagates an AbortSignal to pending synthesis. The CLI
loopback closes its engine session even when callee synthesis fails.

## Remaining live acceptance gates

- Verify this model is available to the existing account and exact schema is accepted
- Measure Japanese names, numbers, dates, amounts and literal readback, using independent
  listening/ASR comparison rather than trusting the model's transcript alone
- Check audible quality, first-audio latency, repeated utterances, cancellation and carrier
  resampling; decide whether conservative transcript mismatch refusals are acceptable
- Implement and validate Realtime usage accounting before enabling budget-limited tests
- Run approved end-to-end carrier tests before changing any production default

## Official references, checked 2026-10-02

- Deprecation and prescribed replacement: https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models
- GA session and out-of-band context: https://developers.openai.com/api/docs/guides/realtime-conversations
- Client event contract: https://developers.openai.com/api/reference/resources/realtime/client-events
- Server event contract: https://developers.openai.com/api/reference/resources/realtime/server-events
- WebSocket connection: https://developers.openai.com/api/docs/guides/voice-websockets?voice-api=realtime

The legacy `/audio/speech` guide still exists. It is not evidence that replacing only
its model string with a Realtime model is a supported migration.
