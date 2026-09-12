import type { Scenario } from "@oathra/scenario";
import { LlmCharacter, type CalleeCharacter, type ChatFn, type ChatMessage } from "@oathra/simulator";
import { parseBrainSpec } from "./brains.js";

/**
 * Callee registry for `oathra eval --callee <spec>`: a language model plays the
 * shop / hotel / restaurant instead of the scripted character, so the evidence
 * engine is graded against phrasing nobody wrote by hand.
 *
 *   openai[:model]   OPENAI_API_KEY   (default gpt-4o-mini)
 *   gemini[:model]   GEMINI_API_KEY   (default gemini-flash-latest)
 */
export function resolveCallee(spec: string): (scenario: Scenario) => CalleeCharacter {
  const { name, model } = parseBrainSpec(spec);
  let chat: ChatFn;
  if (name === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set. Get one at https://platform.openai.com/api-keys");
    chat = openaiChat(model ?? "gpt-4o-mini");
  } else if (name === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey");
    chat = geminiChat(model ?? "gemini-flash-latest");
  } else {
    throw new Error(`Unknown callee "${name}". Available: openai[:model], gemini[:model]`);
  }
  const label = `${name}:${model ?? (name === "openai" ? "gpt-4o-mini" : "gemini-flash-latest")}`;
  return (scenario) => new LlmCharacter(scenario, chat, { name: `${scenario.callee.persona.name}（${label}）` });
}

function openaiChat(model: string): ChatFn {
  return async (messages) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages, temperature: 0.7, response_format: { type: "json_object" }, max_tokens: 400 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    return data.choices?.[0]?.message?.content ?? "";
  };
}

function geminiChat(model: string): ChatFn {
  return async (messages: ChatMessage[]) => {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY ?? "")}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.7, responseMimeType: "application/json", maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  };
}
