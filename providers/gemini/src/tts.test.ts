import { describe, expect, it } from "vitest";
import { mulawDecodeSample } from "@oathra/audio-kit";
import { GeminiTTS } from "./tts.js";

function tone(samples: number, amp = 8000): string {
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * amp);
  return Buffer.from(pcm.buffer).toString("base64");
}
const sse = (event: Record<string, unknown>) => `event: ${String(event.event_type)}\ndata: ${JSON.stringify(event)}\n\n`;
const delta = (data: string) => sse({ index: 0, delta: { type: "audio", mime_type: "audio/l16", sample_rate: 24000, data }, event_type: "step.delta" });

/** A response whose body delivers `text` in awkward pieces and, when `hang`, never closes (like the real stream after step.stop). */
function fakeFetch(text: string, opts: { hang?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown>; signal: AbortSignal }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, signal: init.signal! });
    if (opts.status) return new Response("quota", { status: opts.status });
    const bytes = new TextEncoder().encode(text);
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

describe("GeminiTTS", () => {
  it("sends the model, voice and acting style, and reads audio deltas split across network chunks", async () => {
    const stream = sse({ event_type: "interaction.created" }) + sse({ index: 0, step: { type: "model_output" }, event_type: "step.start" }) + delta(tone(480)) + delta(tone(720)) + sse({ index: 0, event_type: "step.stop" });
    const { impl, calls } = fakeFetch(stream);
    const tts = new GeminiTTS({ apiKey: "k", voice: "Puck", style: "日本語のアニメの会話シーンとして演じる。", fetch: impl });
    const parts: Int16Array[] = [];
    for await (const p of tts.streamPcm24k("はい。")) parts.push(p);
    expect(parts.map((p) => p.length)).toEqual([480, 720]);
    const body = calls[0]!.body as { model: string; stream: boolean; generation_config: { speech_config: Array<{ voice: string }> }; input: Array<{ content: Array<{ annotations: Array<{ style: string }> }> }> };
    expect(calls[0]!.url).toContain("/interactions?alt=sse");
    expect(body.model).toBe("gemini-3.8-flash-lite-tts");
    expect(body.stream).toBe(true);
    expect(body.generation_config.speech_config[0]!.voice).toBe("Puck");
    expect(body.input[0]!.content[0]!.annotations[0]!.style).toBe("日本語のアニメの会話シーンとして演じる。");
  });

  it("finishes at step.stop instead of waiting for the interaction to close, and releases the request", async () => {
    const { impl, calls } = fakeFetch(delta(tone(480)) + sse({ index: 0, event_type: "step.stop" }), { hang: true });
    const tts = new GeminiTTS({ apiKey: "k", fetch: impl });
    let n = 0;
    for await (const _ of tts.streamPcm24k("はい。")) n++;
    expect(n).toBe(1);
    expect(calls[0]!.signal.aborted).toBe(true);
  });

  it("an interrupted reply (the consumer stops early) aborts the request", async () => {
    const { impl, calls } = fakeFetch(delta(tone(480)) + delta(tone(480)) + delta(tone(480)), { hang: true });
    const tts = new GeminiTTS({ apiKey: "k", fetch: impl });
    for await (const _ of tts.streamPcm24k("長い返事")) break;
    expect(calls[0]!.signal.aborted).toBe(true);
  });

  it("turns 24 kHz PCM into 8 kHz μ-law for the phone line, keeping every sample group", async () => {
    // 1201 + 1199 samples: the odd split must not drop or duplicate the 24k→8k groups.
    const { impl } = fakeFetch(delta(tone(1201)) + delta(tone(1199)) + sse({ index: 0, event_type: "step.stop" }));
    const tts = new GeminiTTS({ apiKey: "k", fetch: impl });
    const mu = await tts.synthesizeMulaw8k("はい。");
    expect(mu.length).toBe(800);
    expect(Math.max(...Array.from(mu.subarray(100, 700), (b) => Math.abs(mulawDecodeSample(b))))).toBeGreaterThan(4000);
  });

  it("reports an HTTP error instead of returning silence", async () => {
    const { impl } = fakeFetch("", { status: 429 });
    const tts = new GeminiTTS({ apiKey: "k", fetch: impl });
    await expect(tts.synthesizeMulaw8k("はい。")).rejects.toThrow(/Gemini TTS 429/);
  });
});
