/**
 * Gemini Live voice agent for Oathra — speech-to-speech over the phone.
 *
 * The model talks on its own; Oathra keeps the proof: every callee and agent transcript is forwarded to
 * the runtime as SessionEvents, the mission state is pushed back into the model's context, and tools let
 * the model end the call or ask for a permission — never decide completion.
 */
import type { SessionEvent } from "@oathra/core";

export type AgentBridge = {
  /** Send μ-law bytes to the far end (Twilio). */
  sendAudio(mulaw: Uint8Array): void;
  /** Drop whatever is queued at the far end (barge-in). */
  clearAudio(): void;
  emit(event: SessionEvent): void;
  now(): number;
};

export { GeminiLiveAgent, DEFAULT_GEMINI_LIVE_MODEL, GEMINI_LIVE_VOICES, DEFAULT_GEMINI_LIVE_VOICE, type GeminiLiveAgentOptions } from "./live.js";
export { geminiLiveEngine, type GeminiLiveEngineOptions } from "./engines.js";
