/**
 * What every speech-to-speech engine says and listens for. The engines (GPT-Live, Gemini Live) never
 * import each other; the words they share live here.
 */
export { conversationPolicies, dialoguePolicy, receptionDialogue, gentlePace, extractCallerName, phoneInboundInstructions, phoneMessageInstructions, presetSpeakingStyle, VOICE_PRESET_VERSION } from "./phone-message.js";
export { DESK_TOOLS, deskTool, notReadBack, receptionGreeting, restaurantReceptionInstructions, type DeskEvent, type DeskToolResult, type ReservationDesk } from "./reception.js";
export { callInstructions, GOODBYE_RE, HANGUP_REQUEST_RE, openingLine, type CallInstructionOptions } from "./call-instructions.js";
export { S2SVoiceSession, type AgentLike } from "./s2s-session.js";
export { voiceSettingRecord, type VoiceSettingRecord } from "./voice-setting.js";
export { CHARACTER_TTS_STYLE, phoneRequestSystemPrompt } from "./text-brain.js";
export { DECISION_TOOL, decisionEvent, decisionInstruction, delegatedScope, recordsDecisions, SCOPE_HEAD, type DecisionEvent } from "./decision.js";
export { CONCERN_TOOL, concernEvent, concernInstruction, type ConcernEvent } from "./concern.js";
