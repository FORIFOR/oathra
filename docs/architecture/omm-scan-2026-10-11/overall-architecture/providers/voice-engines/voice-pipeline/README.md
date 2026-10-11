# overall-architecture/providers/voice-engines/voice-pipeline

[解析トップへ戻る](../../../README.md) ・ [ひとつ上へ](../README.md)

Deepgram の STT、任意の Brain、TTS を組み合わせる VoiceEngine。割り込みの方針と相づちを持つ。TTS は既定で OpenAI、CLI の --tts で Gemini や ElevenLabs に切り替える。
