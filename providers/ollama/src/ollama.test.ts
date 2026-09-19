import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainContext } from "@oathra/core";
import { OllamaBrain } from "./index.js";

const ctx = (): BrainContext => {
  // These packages depend on core and brain-kit only, so the contract is spelled out instead of importing defineCall.
  const contract = { goal: "restaurant.reservation", language: "en", target: {}, input: {}, require: { date: true, confirmed: true }, constraints: {}, permissions: { ask: true }, budget: { maxTurns: 60, maxDurationMs: 600_000 } } as unknown as BrainContext["contract"];
  return { contract, language: "en", transcript: [{ id: "t1", source: "callee", text: "Trattoria Ringo, how can I help?", t: 900 }], mission: { verified: {}, pending: {}, missing: ["date", "confirmed"], violations: [] }, permitted: ["ask"], elapsedMs: 1000, turnIndex: 0 };
};
type Call = { url: string; init: RequestInit };
function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => { calls.push({ url: String(url), init }); return respond(); }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OllamaBrain", () => {
  it("talks to the local server with no key, in JSON mode, and costs nothing", async () => {
    const calls = stubFetch(() => Response.json({ message: { content: '{"text":"A table for two, please.","action":"continue"}' }, prompt_eval_count: 300, eval_count: 20 }));
    const r = await new OllamaBrain({ model: "qwen2.5:7b", baseUrl: "http://127.0.0.1:11434/" }).respond(ctx());

    expect(r).toMatchObject({ text: "A table for two, please.", usage: { inputTokens: 300, outputTokens: 20, costUsd: 0 } });
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]!.init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ model: "qwen2.5:7b", format: "json", stream: false, options: { num_predict: 300 } });
  });

  it("honours OLLAMA_HOST and names itself after the model", () => {
    vi.stubEnv("OLLAMA_HOST", "http://gpu-box:11434");
    const brain = new OllamaBrain({ model: "llama3.1:8b" });
    expect(brain.name).toBe("ollama:llama3.1:8b");
    const calls = stubFetch(() => Response.json({ message: { content: '{"text":"x"}' } }));
    return brain.respond(ctx()).then(() => expect(calls[0]!.url).toBe("http://gpu-box:11434/api/chat"));
  });

  it("explains how to start the server when it is unreachable", async () => {
    stubFetch(() => { throw new TypeError("fetch failed"); });
    await expect(new OllamaBrain({ model: "qwen2.5:7b" }).respond(ctx())).rejects.toThrow(/Ollama unreachable at http:\/\/127\.0\.0\.1:11434 \(fetch failed\)\. Start it with `ollama serve` and pull the model with `ollama pull qwen2\.5:7b`/);
  });

  it("reports a missing model with the server's message", async () => {
    stubFetch(() => new Response('{"error":"model \\"nope\\" not found"}', { status: 404 }));
    await expect(new OllamaBrain({ model: "nope" }).respond(ctx())).rejects.toThrow(/^Ollama 404: .*not found/);
  });

  it("a small model that ignores JSON mode still produces a speakable line", async () => {
    stubFetch(() => Response.json({ message: { content: "Sure, a table for two please." } }));
    const r = await new OllamaBrain().respond(ctx());
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.action ?? "continue").toBe("continue");
  });
});
