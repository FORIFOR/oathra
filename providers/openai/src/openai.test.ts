import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainContext } from "@oathra/core";
import { OpenAIBrain } from "./index.js";
import { OpenAITTS, splitSentences } from "./tts.js";

const ctx = (): BrainContext => {
  // These packages depend on core and brain-kit only, so the contract is spelled out instead of importing defineCall.
  const contract = { goal: "restaurant.reservation", language: "ja", target: {}, input: {}, require: { date: true, confirmed: true }, constraints: {}, permissions: { ask: true }, budget: { maxTurns: 60, maxDurationMs: 600_000 } } as unknown as BrainContext["contract"];
  return { contract, language: "ja", transcript: [{ id: "t1", source: "callee", text: "はい、テスト店です。", t: 900 }], mission: { verified: {}, pending: {}, missing: ["date", "confirmed"], violations: [] }, permitted: ["ask"], elapsedMs: 1000, turnIndex: 0 };
};
type Call = { url: string; init: RequestInit };
function stubFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => { const call = { url: String(url), init }; calls.push(call); return respond(call); }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OpenAIBrain", () => {
  it("asks for a JSON object and returns the parsed reply with usage and cost", async () => {
    const calls = stubFetch(() => Response.json({ choices: [{ message: { content: '{"text":"予約をお願いします。","action":"continue"}' } }], usage: { prompt_tokens: 120, completion_tokens: 18 } }));
    const tokens: string[] = [];
    const r = await new OpenAIBrain({ apiKey: "sk-test", model: "gpt-4o-mini", baseUrl: "https://llm.test/v1/" }).respond(ctx(), { onToken: (t) => tokens.push(t) });

    expect(r).toMatchObject({ text: "予約をお願いします。", action: "continue", usage: { inputTokens: 120, outputTokens: 18 } });
    expect(r.usage?.costUsd).toBeGreaterThan(0);
    expect(tokens).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://llm.test/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: "gpt-4o-mini", response_format: { type: "json_object" }, max_tokens: 300 });
    expect(body.messages[0].role).toBe("system");
    expect(JSON.stringify(body.messages)).toContain("はい、テスト店です。");
  });

  it("never lets the model decide completion: only text, action and a valid requested action survive", async () => {
    stubFetch(() => Response.json({ choices: [{ message: { content: '{"text":"予約できました。","action":"hangup","completed":true,"result":{"confirmed":true},"requestedAction":{"action":"launch_rocket"}}' } }] }));
    const r = await new OpenAIBrain({ apiKey: "sk-test" }).respond(ctx());
    expect(Object.keys(r).sort()).toEqual(["action", "text", "usage"]);
  });

  it("refuses to run without a key and names where to get one, before any request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const calls = stubFetch(() => Response.json({}));
    await expect(new OpenAIBrain({ apiKey: "" }).respond(ctx())).rejects.toThrow(/OPENAI_API_KEY is not set.*platform\.openai\.com/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a provider error with its status and a bounded body, without the key", async () => {
    stubFetch(() => new Response("x".repeat(5000), { status: 429 }));
    const error = await new OpenAIBrain({ apiKey: "sk-secret-value" }).respond(ctx()).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/^OpenAI 429: x+$/);
    expect((error as Error).message.length).toBeLessThan(320);
    expect((error as Error).message).not.toContain("sk-secret-value");
  });

  it("survives an empty or non-JSON completion without throwing", async () => {
    stubFetch(() => Response.json({ choices: [{ message: { content: null } }] }));
    expect(typeof (await new OpenAIBrain({ apiKey: "k" }).respond(ctx())).text).toBe("string");
  });
});

describe("OpenAITTS", () => {
  const pcm = (samples: number) => { const a = new Int16Array(samples); for (let i = 0; i < samples; i++) a[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000); return new Uint8Array(a.buffer); };

  it("requests raw PCM, adds Japanese delivery instructions only to models that accept them", async () => {
    const calls = stubFetch(() => new Response(pcm(2400)));
    const out = await new OpenAITTS({ apiKey: "k" }).synthesizePcm24k("こんにちは。", { language: "ja" });
    expect(out).toHaveLength(2400);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: "gpt-4o-mini-tts", voice: "alloy", response_format: "pcm", input: "こんにちは。" });
    expect(body.instructions).toContain("日本語");

    await new OpenAITTS({ apiKey: "k", model: "tts-1" }).synthesizePcm24k("こんにちは。", { language: "ja" });
    expect(JSON.parse(String(calls[1]!.init.body)).instructions).toBeUndefined();
  });

  it("converts to 8 kHz μ-law without losing the signal", async () => {
    stubFetch(() => new Response(pcm(2400)));
    const mulaw = await new OpenAITTS({ apiKey: "k" }).synthesizeMulaw8k("hello");
    expect(mulaw.length).toBeGreaterThanOrEqual(790);
    expect(mulaw.length).toBeLessThanOrEqual(810);
    expect(new Set(mulaw).size).toBeGreaterThan(20); // silence would be one repeated byte
  });

  it("streams sentence by sentence, keeps chunks aligned, and asks for the next sentence early", async () => {
    const order: string[] = [];
    stubFetch(({ init }) => {
      order.push(JSON.parse(String(init.body)).input);
      // Two network chunks that split a 6-byte group: 10 + 8 bytes.
      const bytes = pcm(9);
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 10)); c.enqueue(bytes.slice(10)); c.close(); } }));
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of new OpenAITTS({ apiKey: "k" }).synthesizeMulaw8kStream("一つ目です。二つ目です。")) chunks.push(chunk);
    expect(order).toEqual(["一つ目です。", "二つ目です。"]);
    // 9 samples at 24 kHz per sentence -> 3 samples at 8 kHz, however the bytes were split.
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(6);
  });

  it("yields 100 ms frames with timestamps, and reports provider errors", async () => {
    stubFetch(() => new Response(pcm(6000)));
    const frames = [];
    for await (const f of new OpenAITTS({ apiKey: "k" }).synthesize("hello", { language: "en" })) frames.push(f);
    expect(frames.map((f) => [f.samples.length, f.t, f.sampleRate])).toEqual([[2400, 0, 24000], [2400, 100, 24000], [1200, 200, 24000]]);

    stubFetch(() => new Response("bad voice", { status: 400 }));
    await expect(new OpenAITTS({ apiKey: "k" }).synthesizePcm24k("x")).rejects.toThrow("OpenAI TTS 400: bad voice");
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(new OpenAITTS({ apiKey: "" }).synthesizePcm24k("x")).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  it("warmup never throws", async () => {
    stubFetch(() => { throw new Error("offline"); });
    await expect(new OpenAITTS({ apiKey: "k" }).warmup()).resolves.toBeUndefined();
  });

  it("splits Japanese and Latin sentences and keeps the enders", () => {
    expect(splitSentences("はい。少々お待ちください！Is 7 pm fine? ok")).toEqual(["はい。", "少々お待ちください！", "Is 7 pm fine?", "ok"]);
    expect(splitSentences("")).toEqual([""]);
  });
});
