/**
 * What a call was actually set up to sound like, captured when the call starts and saved with it. The wording
 * is copied, not referenced: changing a preset later must not rewrite what an old call says it used.
 */
import type { CallContract } from "@oathra/contract";
import { presetSpeakingStyle, VOICE_PRESET_VERSION } from "./phone-message.js";

export type VoiceSettingRecord = {
  engine: string;
  /** The model the engine was started with, e.g. "gemini-3.8-live". */
  model: string;
  /** The voice name sent to the engine (a request, not proof of what the server applied); null when none was sent. */
  voiceSent: string | null;
  voicePreset: string | null;
  /** The version of the preset wording; null when no preset was used. */
  presetVersion: string | null;
  /** The speaking-style text that went into the prompt for this call, verbatim; null without a preset. */
  styleApplied: string | null;
  language: string;
  capturedAt: string;
  /** Acting direction sent to a TTS voice with every utterance (pipeline calls only), verbatim. */
  ttsStyle?: string;
};

export function voiceSettingRecord(engine: string, model: string, voiceSent: string | undefined, contract: CallContract, now: Date = new Date(), extra: { ttsStyle?: string } = {}): VoiceSettingRecord {
  const preset = typeof contract.input.voicePreset === "string" ? contract.input.voicePreset : null;
  const style = preset ? presetSpeakingStyle(preset, contract.language) ?? null : null;
  return { engine, model, voiceSent: voiceSent ?? null, voicePreset: preset, presetVersion: preset ? VOICE_PRESET_VERSION : null, styleApplied: style, language: contract.language, capturedAt: now.toISOString(), ...(extra.ttsStyle ? { ttsStyle: extra.ttsStyle } : {}) };
}
