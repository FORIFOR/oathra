import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import type { SpeechContext } from "@oathra/core";
import type { DeepgramLiveEvent } from "@oathra/deepgram";
import { MULAW_8K, PCM_16K, type VoiceOutput } from "@oathra/voice";
import { isBargeIn, pipelineEngine, type LiveSTTSession, type PipelineTTS } from "./index.js";

/** Hand-driven fake Deepgram session. */
class FakeStt implements LiveSTTSession {
  listeners: Array<(e: DeepgramLiveEvent) => void> = [];
  sent: Uint8Array[] = [];
  opened = false;
  closed = false;
  context: SpeechContext | undefined;
  async open(): Promise<void> {
    this.opened = true;
  }
  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }
  on(l: (e: DeepgramLiveEvent) => void): () => void {
    this.listeners.push(l);
    return () => undefined;
  }
  finalize(): void {}
  close(): void {
    this.closed = true;
  }
  fire(e: DeepgramLiveEvent): void {
    for (const l of this.listeners) l(e);
  }
}

const FIXED = new Uint8Array(8000).fill(0x7f); // 1 s of μ-law
const fakeTts = {
  calls: [] as string[],
  async synthesizeMulaw8k(text: string) {
    this.calls.push(text);
    return text.length <= 3 ? new Uint8Array(800).fill(0x7f) : FIXED;
  },
};

function setup(stt = new FakeStt()) {
  const engine = pipelineEngine({ brain: { name: "scripted", respond: async () => ({ text: "" }) }, stt: { live: (c) => ((stt.context = c), stt) }, tts: fakeTts, leadMs: 100000 });
  const contract = defineCall({ goal: "restaurant.reservation", require: { time: true }, permissions: { ask: true } });
  const t0 = Date.now();
  return { engine, stt, start: () => engine.start({ contract, language: "ja", calleeName: "トラットリア", carrierAudio: MULAW_8K }, { now: () => Date.now() - t0 }) };
}

async function drain(session: { output: AsyncIterable<VoiceOutput> }, ms: number): Promise<VoiceOutput[]> {
  const out: VoiceOutput[] = [];
  const it = session.output[Symbol.asyncIterator]();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await Promise.race([it.next(), new Promise<"t">((res) => setTimeout(() => res("t"), Math.max(1, end - Date.now())))]);
    if (r === "t") break;
    if (r.done) break;
    out.push(r.value);
  }
  return out;
}

describe("pipelineEngine", () => {
  it("segments STT into speech.started / speech and converts inbound audio to μ-law", async () => {
    const { engine, stt, start } = setup();
    expect(engine.speaksItself).toBe(false);
    const session = await start();
    expect(stt.opened).toBe(true);
    expect(stt.context?.keywords).toContain("トラットリア");
    const pcm = new Int16Array(320); // 20 ms @16k
    session.input({ ...PCM_16K, data: new Uint8Array(pcm.buffer) });
    expect(stt.sent[0]!.length).toBe(160);
    stt.fire({ type: "speech_started", t: 100 });
    stt.fire({ type: "partial", text: "19時", startMs: 100, endMs: 400, confidence: 0.9 });
    stt.fire({ type: "final", text: "19時半でしたら空いております", startMs: 100, endMs: 1500, confidence: 0.95, speechFinal: true });
    const out = await drain(session, 100);
    const events = out.flatMap((o) => (o.type === "event" ? [o.event] : []));
    expect(events[0]?.type).toBe("speech.started");
    const speech = events.find((e) => e.type === "speech");
    expect(speech && speech.type === "speech" ? speech.text : "").toContain("19時半");
    expect(speech && speech.type === "speech" ? speech.endMs > speech.startMs : false).toBe(true);
    await session.close();
    expect(stt.closed).toBe(true);
  });

  it("speak() streams audio and resolves after the audio duration", async () => {
    const { start } = setup();
    const session = await start();
    await new Promise((r) => setTimeout(r, 20)); // fillers prepared
    const t0 = Date.now();
    const [result, out] = await Promise.all([session.speak!("19時半でお願いします。"), drain(session, 1300)]);
    const elapsed = Date.now() - t0;
    const audio = out.filter((o) => o.type === "audio");
    expect(audio.length).toBeGreaterThanOrEqual(50); // 1 s = 50 frames of 20 ms
    expect(audio.every((o) => o.type === "audio" && o.chunk.format === "mulaw")).toBe(true);
    expect(result.interrupted).toBe(false);
    expect(result.endMs - result.startMs).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    await session.close();
  });

  it("ack() plays a pre-synthesized filler once", async () => {
    const { start } = setup();
    const session = await start();
    await new Promise((r) => setTimeout(r, 20));
    session.ack!();
    const out = await drain(session, 50);
    expect(out.filter((o) => o.type === "audio")).toHaveLength(1);
    await session.close();
  });

  it("barges in on real speech (clear + interruption) but not on backchannels", async () => {
    const { stt, start } = setup();
    const session = await start();
    await new Promise((r) => setTimeout(r, 20));
    const speaking = session.speak!("ご予約の件でお電話いたしました。明日の19時以降で2名なのですが。");
    await new Promise((r) => setTimeout(r, 600)); // > 500 ms into playback
    stt.fire({ type: "partial", text: "はい", startMs: 600, endMs: 700, confidence: 0.9 });
    stt.fire({ type: "final", text: "はい", startMs: 600, endMs: 700, confidence: 0.9, speechFinal: true });
    await new Promise((r) => setTimeout(r, 50));
    stt.fire({ type: "partial", text: "ちょっと待ってください", startMs: 800, endMs: 1200, confidence: 0.9 });
    const [result, out] = await Promise.all([speaking, drain(session, 300)]);
    expect(result.interrupted).toBe(true);
    const types = out.map((o) => (o.type === "event" ? o.event.type : o.type));
    expect(types).toContain("clear");
    expect(types).toContain("interruption");
    // The backchannel "はい" never became a speech turn while we were talking.
    expect(out.some((o) => o.type === "event" && o.event.type === "speech" && o.event.text === "はい")).toBe(false);
    await session.close();
  });

  it("VAD alone opens no segment: the callee is speaking only once there are words", async () => {
    const { stt, start } = setup();
    const session = await start();
    stt.fire({ type: "speech_started", t: 100 });
    stt.fire({ type: "final", text: "", startMs: 100, endMs: 400, confidence: 0, speechFinal: true });
    stt.fire({ type: "partial", text: "もしもし", startMs: 900, endMs: 1300, confidence: 0.9 });
    // The first event is the words' segment, starting at the words, not at the earlier VAD blip.
    const events = (await drain(session, 80)).flatMap((o) => (o.type === "event" ? [o.event] : []));
    expect(events.filter((e) => e.type === "speech.started")).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "speech.started", startMs: 900 });
    await session.close();
  });

  it("drops a reply unplayed when the callee said real words after it was written (not for a nod)", async () => {
    const { stt, start } = setup();
    const session = await start();
    stt.fire({ type: "partial", text: "うん", startMs: 30, endMs: 60, confidence: 0.9 });
    const kept = session.speak!("こんにちは、少しお時間よろしいですか。", { inputUntilMs: 10 });
    const [played] = await Promise.all([kept, drain(session, 50)]);
    expect(played.skipped).toBeUndefined();
    stt.fire({ type: "partial", text: "もしもし", startMs: 2000, endMs: 2400, confidence: 0.9 });
    const before = fakeTts.calls.length;
    const [dropped, out] = await Promise.all([session.speak!("こんにちは、少しお時間よろしいですか。", { inputUntilMs: 1500 }), drain(session, 50)]);
    expect(dropped).toMatchObject({ interrupted: true, skipped: true });
    expect(out.some((o) => o.type === "audio")).toBe(false);
    expect(fakeTts.calls.length).toBe(before); // nothing was synthesized for it either
    await session.close();
  });

  it("isBargeIn policy", () => {
    expect(isBargeIn("うん", "ja")).toBe(false);
    expect(isBargeIn("19時は満席です", "ja")).toBe(true);
    expect(isBargeIn("okay", "en")).toBe(false);
    expect(isBargeIn("hold on a second", "en")).toBe(true);
  });
});

async function failureSession(tts: PipelineTTS) {
  const stt = new FakeStt();
  const engine = pipelineEngine({ brain: { name: "fixture", respond: async () => ({ text: "" }) }, stt: { live: () => stt }, tts, acknowledgements: false, leadMs: 100000 });
  const contract = defineCall({ goal: "chat.casual", permissions: { ask: true } });
  const session = await engine.start({ contract, language: "ja", carrierAudio: MULAW_8K }, { now: () => Date.now() });
  return session;
}

describe("TTS failure and cancellation", () => {
  it("reports rejected text as skipped, never as successfully spoken", async () => {
    const session = await failureSession({ async synthesizeMulaw8k() { throw new Error("transcript mismatch"); } });
    const result = await session.speak!("この言葉は再生されていません。");
    await session.close();
    const output = [];
    for await (const item of session.output) output.push(item);
    expect(result).toMatchObject({ skipped: true, interrupted: true });
    expect(output.filter(x => x.type === "audio")).toHaveLength(0);
    expect(output.some(x => x.type === "event" && x.event.type === "error")).toBe(true);
  });
  it("empty synthesis is skipped", async () => {
    const session = await failureSession({ async synthesizeMulaw8k() { return new Uint8Array(); } });
    expect(await session.speak!("聞こえない発話")).toMatchObject({ skipped: true, interrupted: true });
    await session.close();
  });
  it("clears already queued frames when a stream fails part way through", async () => {
    const session = await failureSession({ async synthesizeMulaw8k() { return new Uint8Array(); }, async *synthesizeMulaw8kStream() { yield new Uint8Array(160).fill(0x7f); throw new Error("stream failed"); } });
    const result = await session.speak!("途中で失敗");
    await session.close();
    const output = [];
    for await (const item of session.output) output.push(item);
    expect(result.interrupted).toBe(true);
    expect(output.map(x => x.type)).toEqual(["audio", "clear", "event"]);
  });
  it.each(["interrupt", "close"])("%s aborts pending synthesis before the first audio frame", async action => {
    let signal: AbortSignal | undefined;
    const session = await failureSession({ async synthesizeMulaw8k(_text, opts) {
      signal = opts.signal;
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
    const speaking = session.speak!("待機中");
    await Promise.resolve();
    if (action === "interrupt") session.interrupt!(); else await session.close();
    expect(signal?.aborted).toBe(true);
    expect(await speaking).toMatchObject({ skipped: true, interrupted: true });
    await session.close();
  });
});
