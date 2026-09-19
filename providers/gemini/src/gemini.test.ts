import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainContext } from "@oathra/core";
import { GeminiBrain } from "./index.js";

const ctx = (): BrainContext => {
  // These packages depend on core and brain-kit only, so the contract is spelled out instead of importing defineCall.
  const contract = { goal: "restaurant.reservation", language: "ja", target: {}, input: {}, require: { date: true, confirmed: true }, constraints: {}, permissions: { ask: true }, budget: { maxTurns: 60, maxDurationMs: 600_000 } } as unknown as BrainContext["contract"];
  return {
    contract, language: "ja", permitted: ["ask"], elapsedMs: 3000, turnIndex: 1,
    transcript: [{ id: "t1", source: "callee", text: "はい、テスト店です。", t: 900 }, { id: "t2", source: "caller", text: "予約をお願いします。", t: 2000 }, { id: "t3", source: "callee", text: "何名様ですか。", t: 3000 }],
    mission: { verified: {}, pending: {}, missing: ["date", "confirmed"], violations: [] },
  };
};
type Call = { url: string; init: RequestInit };
function stubFetch(respond: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => { calls.push({ url: String(url), init }); return respond(); }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("GeminiBrain", () => {
  it("maps the conversation to Gemini roles, keeps the system prompt separate and joins the reply parts", async () => {
    const calls = stubFetch(() => Response.json({ candidates: [{ content: { parts: [{ text: '{"text":"2名です。",' }, { text: '"action":"continue"}' }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 12 } }));
    const r = await new GeminiBrain({ apiKey: "g-key", model: "gemini-flash-latest", baseUrl: "https://gemini.test/v1beta/" }).respond(ctx());

    expect(r).toMatchObject({ text: "2名です。", action: "continue", usage: { inputTokens: 200, outputTokens: 12 } });
    expect(calls[0]!.url).toBe("https://gemini.test/v1beta/models/gemini-flash-latest:generateContent?key=g-key");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.systemInstruction.parts[0].text.length).toBeGreaterThan(50);
    expect(new Set(body.contents.map((c: { role: string }) => c.role))).toEqual(new Set(["user", "model"]));
    expect(body.contents.every((c: { role: string }) => c.role !== "system")).toBe(true);
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } });
  });

  it("escapes the model name and key in the URL", async () => {
    const calls = stubFetch(() => Response.json({ candidates: [{ content: { parts: [{ text: '{"text":"x"}' }] } }] }));
    await new GeminiBrain({ apiKey: "a&b=c", model: "tuned/model 1" }).respond(ctx());
    expect(calls[0]!.url).toContain("/models/tuned%2Fmodel%201:generateContent?key=a%26b%3Dc");
  });

  it("refuses to run without a key, before any request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const calls = stubFetch(() => Response.json({}));
    await expect(new GeminiBrain({ apiKey: "" }).respond(ctx())).rejects.toThrow(/GEMINI_API_KEY is not set.*aistudio\.google\.com/);
    expect(calls).toHaveLength(0);
  });

  it("reports provider errors with status and a bounded body, and never echoes the key", async () => {
    stubFetch(() => new Response("quota ".repeat(200), { status: 429 }));
    const error = (await new GeminiBrain({ apiKey: "very-secret-key" }).respond(ctx()).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^Gemini 429: quota/);
    expect(error.message.length).toBeLessThan(320);
    expect(error.message).not.toContain("very-secret-key");
  });

  it("an empty candidate list does not throw", async () => {
    stubFetch(() => Response.json({ candidates: [] }));
    expect(typeof (await new GeminiBrain({ apiKey: "k" }).respond(ctx())).text).toBe("string");
  });
});
