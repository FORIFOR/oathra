import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiTTS } from "@oathra/gemini";
import { OpenAITTS, OpenAIRealtimeTTS } from "@oathra/openai";
import { definePhoneRequest, preparePhoneRequest } from "@oathra/contract";
import { buildEngine, CHARACTER_TTS_STYLE, engineBrain, parseEngineSpec, phoneRequestSystemPrompt, phoneTest, pipelineTTS } from "./phone.js";

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

afterEach(() => vi.unstubAllEnvs());
describe("Realtime TTS rollout boundaries", () => {
  it("selects opt-in TTS from the explicit environment and preserves native GPT-Live default", () => {
    expect(pipelineTTS(undefined, undefined, { OATHRA_TTS_TRANSPORT: "realtime", OPENAI_API_KEY: "fixture" }).tts).toBeInstanceOf(OpenAIRealtimeTTS);
    expect(parseEngineSpec()).toEqual({ id: "gpt-live" });
    expect(buildEngine(parseEngineSpec(), { OATHRA_TTS_TRANSPORT: "realtime" }).id).toBe("gpt-live");
  });
  it("does not apply legacy conversation budget estimates to Realtime TTS", async () => {
    vi.stubEnv("OATHRA_TTS_TRANSPORT", "realtime");
    await expect(phoneTest({ level: "conversation", engine: "gpt-live" })).rejects.toThrow("budget estimator uses legacy");
  });
});
