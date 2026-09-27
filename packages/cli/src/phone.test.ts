import { describe, expect, it } from "vitest";
import { GeminiTTS } from "@oathra/gemini";
import { OpenAITTS } from "@oathra/openai";
import { CHARACTER_TTS_STYLE, pipelineTTS } from "./phone.js";

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
