import { describe, expect, it } from "vitest";
import { GeminiTTS } from "@oathra/gemini";
import { OpenAITTS } from "@oathra/openai";
import { ElevenLabsTTS } from "@oathra/elevenlabs";
import { definePhoneRequest, preparePhoneRequest } from "@oathra/contract";
import { buildEngine, CHARACTER_TTS_STYLE, engineBrain, parseEngineSpec, phoneRequestSystemPrompt, pipelineTTS } from "./phone.js";

describe("pipeline TTS choice (character prototype)", () => {
  it("gemini-lite speaks with the character preset's voice and the approved style", () => {
    const female = pipelineTTS("gemini-lite", "character-female");
    const male = pipelineTTS("gemini-lite", "character-male");
    expect(female.tts).toBeInstanceOf(GeminiTTS);
    expect([female.voice, male.voice]).toEqual(["Leda", "Puck"]);
    expect((male.tts as GeminiTTS).style).toBe(CHARACTER_TTS_STYLE);
    expect((male.tts as GeminiTTS).model).toBe("gemini-3.8-flash-lite-tts");
  });
  it("is refused outside the character presets", () => {
    expect(() => pipelineTTS("gemini-lite")).toThrow(/character presets only/);
    expect(() => pipelineTTS("gemini-lite", "sales-female")).toThrow(/character presets only/);
  });
  it("the default pipeline voice is unchanged", () => {
    expect(pipelineTTS(undefined).tts).toBeInstanceOf(OpenAITTS);
    expect(pipelineTTS("openai", "character-female").tts).toBeInstanceOf(OpenAITTS);
  });
  it("elevenlabs speaks with the deployment's voice and names itself in the engine label", () => {
    const saved = { id: process.env.ELEVENLABS_VOICE_ID, model: process.env.ELEVENLABS_MODEL };
    process.env.ELEVENLABS_VOICE_ID = "voice-123"; delete process.env.ELEVENLABS_MODEL;
    try {
      const choice = pipelineTTS("elevenlabs");
      expect(choice.tts).toBeInstanceOf(ElevenLabsTTS);
      expect(choice.voice).toBe("voice-123");
      expect((choice.tts as ElevenLabsTTS).model).toBe("eleven_flash_v2_5");
      expect(buildEngine({ id: "pipeline", brain: "ollama", tts: "elevenlabs" }).label).toMatch(/ElevenLabs \(eleven_flash_v2_5\)/);
    } finally {
      for (const [k, v] of [["ELEVENLABS_VOICE_ID", saved.id], ["ELEVENLABS_MODEL", saved.model]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});

describe("character-tts engine (acting voice on a real call)", () => {
  const request = (extra: Record<string, unknown> = {}) => definePhoneRequest(preparePhoneRequest({ phone: "+819012345678", name: "ゆき", callerName: "田中", instruction: "近況を話す", conversationMode: "chat", engine: "character-tts", voicePreset: "character-male", ...extra }));
  it("parses, speaks with the preset's Gemini voice, and has no fixed acknowledgements", () => {
    const spec = parseEngineSpec("character-tts");
    expect(spec).toEqual({ id: "character-tts" });
    const engine = buildEngine(spec, { GEMINI_API_KEY: "g" }, undefined, "character-male");
    expect(engine.id).toBe("character-tts");
    expect(engine.speaksItself).toBe(false);
    expect(engine.label).toContain("Gemini TTS (Puck)");
    expect(engine.requires).toEqual(["DEEPGRAM_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]);
    expect(buildEngine(spec, {}, "Sulafat", "character-female").label).toContain("Gemini TTS (Sulafat)");
  });
  it("its brain gets the same call instructions as the Live engines, adapted to written replies", () => {
    const engine = buildEngine(parseEngineSpec("character-tts"), {}, undefined, "character-male");
    expect(engineBrain(parseEngineSpec("character-tts"), engine).name).toContain("openai");
    const prompt = phoneRequestSystemPrompt({ contract: request(), language: "ja", transcript: [], mission: { verified: {}, pending: {}, missing: [], violations: [] }, permitted: [], elapsedMs: 0, turnIndex: 0 } as never);
    expect(prompt).toContain("最初にAIによる代理電話であることを伝え");
    expect(prompt).toContain("田中");
    expect(prompt).toContain("【話し方：キャラクター風】");
    expect(prompt).toContain('action を "hangup"');
    expect(prompt).toContain('{"text": string, "action": "continue" | "hangup"}');
  });
  it("speech-to-speech engines still write their own replies", async () => {
    const engine = buildEngine(parseEngineSpec("gpt-live"), {});
    await expect(engineBrain(parseEngineSpec("gpt-live"), engine).respond({} as never)).rejects.toThrow(/speaks itself/);
  });
});
