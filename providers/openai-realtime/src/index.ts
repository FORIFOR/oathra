/**
 * GPT-Live voice agent for Oathra — speech-to-speech over the phone.
 *
 * The model talks on its own; Oathra keeps the proof: every callee and agent
 * transcript is forwarded to the runtime as SessionEvents, the mission state is
 * pushed back into the model's instructions, and tools let the model end the
 * call or ask for a permission — never decide completion.
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

export { createNewsSearch, NEWS_TOPICS, type NewsSearch, type NewsResult, type NewsLookupEvent } from "./news.js";
export { DESK_TOOLS, deskTool, notReadBack, receptionGreeting, restaurantReceptionInstructions, type DeskEvent, type DeskToolResult, type ReservationDesk } from "@oathra/voice-kit";
export { OpenAILiveAgent, type LiveAgentOptions } from "./live.js";
export { gptLiveEngine, type GptLiveEngineOptions } from "./engines.js";
