import { describe, expect, it } from "vitest";
import { definePhoneRequest, preparePhoneRequest, VOICE_PRESETS } from "@oathra/contract";
import { presetSpeakingStyle, VOICE_PRESET_VERSION } from "./phone-message.js";
import { voiceSettingRecord } from "./voice-setting.js";

const req = (extra: Record<string, unknown>) => definePhoneRequest(preparePhoneRequest({ phone: "+819012345678", name: "田中", instruction: "近況を話す", ...extra }));

describe("voice setting record", () => {
  it("copies the model, the voice sent, the preset, its version and the exact style text", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const r = voiceSettingRecord("gemini-live", "gemini-3.8-live", "Kore", req({ voicePreset: "guide-female" }), now);
    expect(r).toMatchObject({ engine: "gemini-live", model: "gemini-3.8-live", voiceSent: "Kore", voicePreset: "guide-female", presetVersion: VOICE_PRESET_VERSION, language: "ja", capturedAt: now.toISOString() });
    expect(r.styleApplied).toBe(presetSpeakingStyle("guide-female", "ja"));
  });
  it("without a preset there is no version and no style; without a voice nothing was sent", () => {
    const r = voiceSettingRecord("gpt-live", "gpt-live-1", undefined, req({}));
    expect(r).toMatchObject({ voiceSent: null, voicePreset: null, presetVersion: null, styleApplied: null });
  });
});

describe("scene adaptation", () => {
  it("every preset carries it once, and dates/negations are stated once, not twice", () => {
    for (const preset of VOICE_PRESETS) {
      const text = presetSpeakingStyle(preset, "ja")!;
      expect(text.match(/【場面に合わせる】/g), preset).toHaveLength(1);
      expect(text, preset).toContain("相手の怒りをまねしない");
      expect(text, preset).toContain("毎回は笑いません");
      expect(text.match(/日時・金額/g), preset).toHaveLength(1);
      expect(presetSpeakingStyle(preset, "en")!, preset).toContain("never mirror anger");
    }
  });
});
