import { describe, expect, it } from "vitest";
import { ElevenLabsTTS } from "./tts.js";

/** A response whose body delivers `bytes` in awkward pieces and, when `hang`, never closes. */
function fakeFetch(bytes: Uint8Array, opts: { hang?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown>; signal: AbortSignal }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown>, signal: init.signal! });
    if (opts.status) return new Response('{"detail":{"status":"quota_exceeded"}}', { status: opts.status });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.subarray(i, i + 37));
        if (!opts.hang) controller.close();
        init.signal?.addEventListener("abort", () => { try { controller.error(new Error("aborted")); } catch { /* closed */ } });
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const mulaw = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7) & 0xff);

describe("ElevenLabsTTS", () => {
  it("asks for the phone line's μ-law and passes the bytes through unchanged", async () => {
    const audio = mulaw(800);
    const { impl, calls } = fakeFetch(audio);
    const tts = new ElevenLabsTTS({ apiKey: "k", voiceId: "voice/1", fetch: impl });
    const out = await tts.synthesizeMulaw8k("はい、承知しました。", { language: "ja" });
    expect(out).toEqual(audio);
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice%2F1/stream?output_format=ulaw_8000");
    expect(calls[0]!.headers["xi-api-key"]).toBe("k");
    expect(calls[0]!.body).toEqual({ text: "はい、承知しました。", model_id: "eleven_flash_v2_5", language_code: "ja" });
  });

  it("streams chunks as they arrive", async () => {
    const { impl } = fakeFetch(mulaw(100));
    const sizes: number[] = [];
    for await (const c of new ElevenLabsTTS({ apiKey: "k", voiceId: "v", fetch: impl }).synthesizeMulaw8kStream("はい")) sizes.push(c.length);
    expect(sizes).toEqual([37, 37, 26]);
  });

  it("leaves language_code out for the model that does not take it", async () => {
    const { impl, calls } = fakeFetch(mulaw(10));
    await new ElevenLabsTTS({ apiKey: "k", voiceId: "v", model: "eleven_multilingual_v2", fetch: impl }).synthesizeMulaw8k("はい", { language: "ja" });
    expect(calls[0]!.body).toEqual({ text: "はい", model_id: "eleven_multilingual_v2" });
  });

  it("says which setting is missing before any request", async () => {
    const { impl, calls } = fakeFetch(mulaw(10));
    await expect(new ElevenLabsTTS({ apiKey: "", voiceId: "v", fetch: impl }).synthesizeMulaw8k("はい")).rejects.toThrow(/ELEVENLABS_API_KEY/);
    await expect(new ElevenLabsTTS({ apiKey: "k", voiceId: "", fetch: impl }).synthesizeMulaw8k("はい")).rejects.toThrow(/ELEVENLABS_VOICE_ID/);
    expect(calls).toHaveLength(0);
  });

  it("an HTTP error is an error, with the status", async () => {
    const { impl } = fakeFetch(mulaw(10), { status: 401 });
    await expect(new ElevenLabsTTS({ apiKey: "k", voiceId: "v", fetch: impl }).synthesizeMulaw8k("はい")).rejects.toThrow(/ElevenLabs TTS 401/);
  });

  it("stopping early aborts the request", async () => {
    const { impl, calls } = fakeFetch(mulaw(200), { hang: true });
    for await (const _ of new ElevenLabsTTS({ apiKey: "k", voiceId: "v", fetch: impl }).synthesizeMulaw8kStream("はい")) break;
    expect(calls[0]!.signal.aborted).toBe(true);
  });

  it("a stalled stream times out", async () => {
    const { impl } = fakeFetch(mulaw(10), { hang: true });
    await expect(new ElevenLabsTTS({ apiKey: "k", voiceId: "v", timeoutMs: 50, fetch: impl }).synthesizeMulaw8k("はい")).rejects.toThrow();
  });
});
