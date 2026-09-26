/**
 * What every speech-to-speech engine says and listens for. The engines (GPT-Live, Gemini Live) never
 * import each other; the words they share live here.
 */
export { conversationPolicies, extractCallerName, phoneInboundInstructions, phoneMessageInstructions, presetSpeakingStyle } from "./phone-message.js";
export { DESK_TOOLS, deskTool, notReadBack, receptionGreeting, restaurantReceptionInstructions, type DeskEvent, type DeskToolResult, type ReservationDesk } from "./reception.js";
export { callInstructions, GOODBYE_RE, HANGUP_REQUEST_RE, openingLine, type CallInstructionOptions } from "./call-instructions.js";
export { S2SVoiceSession, type AgentLike } from "./s2s-session.js";
