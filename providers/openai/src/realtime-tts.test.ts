import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { int16ToBytes, pcm24kToMulaw8k } from "@oathra/audio-kit";
import { OpenAIRealtimeTTS, normalizeReadback, type OpenAIRealtimeTTSOptions } from "./realtime-tts.js";
import { OpenAITTS } from "./tts.js";
import { createOpenAITTS } from "./tts-factory.js";

type Json = Record<string, any>;
const TEXT = "合計は1.5ドルです。";
function tone(n = 2400) {
  return Int16Array.from({ length: n }, (_, i) => Math.round(6000 * Math.sin(i * Math.PI / 20)));
}

/** Synthetic transport fixtures. Never opens a socket or represents a live audio result. */
class FixtureSocket extends EventEmitter {
  readyState = 1;
  sent: Json[] = [];
  terminated = false;
  closed = false;
  request: Json | undefined;
  constructor(readonly reply: (ws: FixtureSocket) => void, readonly config?: (session: Json) => Json) {
    super();
  }
  event(event: Json) { this.emit("message", Buffer.from(JSON.stringify(event)), false); }
  send(raw: string) {
    const event = JSON.parse(raw) as Json;
    this.sent.push(event);
    if (event.type === "session.update") queueMicrotask(() => this.event({ type: "session.updated", session: this.config?.(event.session) ?? event.session }));
    if (event.type === "response.create") {
      this.request = event.response;
      queueMicrotask(() => {
        this.event({ type: "response.created", response: { id: "r1", metadata: this.request?.metadata } });
        this.reply(this);
      });
    }
  }
  audio(bytes: Uint8Array, extra: Json = {}) {
    this.event({ type: "response.output_audio.delta", response_id: "r1", item_id: "i1", output_index: 0, content_index: 0, delta: Buffer.from(bytes).toString("base64"), ...extra });
  }
  endAudio() { this.event({ type: "response.output_audio.done", response_id: "r1", item_id: "i1", output_index: 0, content_index: 0 }); }
  transcript(text = TEXT, extra: Json = {}) {
    this.event({ type: "response.output_audio_transcript.done", response_id: "r1", item_id: "i1", output_index: 0, content_index: 0, transcript: text, ...extra });
  }
  done(status = "completed", extra: Json = {}) { this.event({ type: "response.done", response: { id: "r1", status, ...extra } }); }
  close() { this.closed = true; this.readyState = 3; this.emit("close"); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit("close"); }
}
function success(ws: FixtureSocket) {
  const bytes = int16ToBytes(tone());
  ws.audio(bytes.subarray(0, 3)); // deliberately bisects a 16-bit PCM sample
  ws.audio(bytes.subarray(3));
  ws.endAudio(); ws.transcript(); ws.done();
}
function setup(reply = success, options: OpenAIRealtimeTTSOptions = {}, config?: (session: Json) => Json) {
  const calls: Array<{ url: string; options: Json; ws: FixtureSocket }> = [];
  const tts = new OpenAIRealtimeTTS({ apiKey: "fixture-key", ...options, socketFactory: (url, connection) => {
    const ws = new FixtureSocket(reply, config);
    calls.push({ url, options: connection, ws });
    queueMicrotask(() => ws.event({ type: "session.created" }));
    return ws as unknown as WebSocket;
  } });
  return { tts, calls };
}
afterEach(() => vi.unstubAllEnvs());

describe("Realtime TTS GA contract (offline fixtures)", () => {
  it("uses GA authentication and waits for negotiated PCM24k before isolated synthesis", async () => {
    const { tts, calls } = setup();
    const result = await tts.synthesizePcm24k(TEXT, { language: "ja" });
    expect(result).toEqual(tone());
    expect(calls[0]!.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini");
    expect(calls[0]!.options.headers).toEqual({ Authorization: "Bearer fixture-key" });
    const [session, response] = calls[0]!.ws.sent;
    expect(session!.session.audio.output).toEqual({ format: { type: "audio/pcm", rate: 24000 }, voice: "alloy" });
    expect(session!.session.audio.input.turn_detection).toBeNull();
    expect(response!.response).toMatchObject({ conversation: "none", output_modalities: ["audio"], tools: [], tool_choice: "none",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: TEXT }] }] });
    expect(calls[0]!.ws.closed).toBe(true);
  });
  it("does not release audio before terminal success and matching transcript", async () => {
    let socket: FixtureSocket | undefined;
    const { tts } = setup(ws => { socket = ws; ws.audio(int16ToBytes(tone())); ws.endAudio(); ws.transcript(); });
    let resolved = false;
    const p = tts.synthesizePcm24k(TEXT).then(x => { resolved = true; return x; });
    await new Promise(r => setImmediate(r));
    expect(resolved).toBe(false);
    socket!.done();
    await p;
    expect(resolved).toBe(true);
  });
  it("converts to existing 8kHz μ-law contract", async () => {
    const { tts } = setup();
    expect(await tts.synthesizeMulaw8k(TEXT)).toEqual(pcm24kToMulaw8k(tone()));
    const chunks: Uint8Array[] = [];
    for await (const chunk of tts.synthesizeMulaw8kStream(TEXT)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(pcm24kToMulaw8k(tone())));
  });
  it("produces timestamped 100ms PCM frames", async () => {
    const { tts } = setup(ws => { ws.audio(int16ToBytes(tone(6000))); ws.endAudio(); ws.transcript(); ws.done(); });
    const frames = [];
    for await (const frame of tts.synthesize(TEXT, { language: "ja" })) frames.push(frame);
    expect(frames.map(x => [x.sampleRate, x.channels, x.t, x.samples.length])).toEqual([[24000, 1, 0, 2400], [24000, 1, 100, 2400], [24000, 1, 200, 1200]]);
  });
  it("honors the configured voice without sharing voice-locked sessions", async () => {
    const { tts, calls } = setup();
    await Promise.all([tts.synthesizePcm24k(TEXT, { voice: "cedar" }), tts.synthesizePcm24k(TEXT, { voice: "marin" })]);
    expect(calls).toHaveLength(2);
    expect(calls.map(x => x.ws.sent[0]!.session.audio.output.voice)).toEqual(["cedar", "marin"]);
  });
  it.each(["failed", "cancelled", "incomplete"])("rejects terminal %s after partial audio", async status => {
    const { tts, calls } = setup(ws => { ws.audio(int16ToBytes(tone())); ws.endAudio(); ws.transcript(); ws.done(status); });
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow("did not complete");
    expect(calls[0]!.ws.terminated).toBe(true);
  });
  it.each(["合計は15ドルです。", "別の言葉です。", "合計は1.5ドルです。追加しました"])("rejects changed text %s", async transcript => {
    const { tts } = setup(ws => { ws.audio(int16ToBytes(tone())); ws.endAudio(); ws.transcript(transcript); ws.done(); });
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow("does not match");
  });
  it("does not ignore decimal points, minus signs or currency", () => {
    expect(normalizeReadback("1.5")).not.toBe(normalizeReadback("15"));
    expect(normalizeReadback("-5")).not.toBe(normalizeReadback("5"));
    expect(normalizeReadback("$5")).not.toBe(normalizeReadback("5"));
    expect(normalizeReadback("1 5")).not.toBe(normalizeReadback("15"));
    expect(normalizeReadback("Ａです！")).toBe(normalizeReadback("Aです。"));
  });
  it.each(["no-audio", "odd-audio", "no-audio-done", "no-transcript"])("rejects %s", async kind => {
    const { tts } = setup(ws => {
      if (kind !== "no-audio") ws.audio(kind === "odd-audio" ? new Uint8Array([1]) : int16ToBytes(tone()));
      if (kind !== "no-audio-done") ws.endAudio();
      if (kind !== "no-transcript") ws.transcript();
      ws.done();
    });
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow(/incomplete PCM|does not match/);
  });
  it("rejects corrupt base64", async () => {
    const { tts } = setup(ws => ws.audio(new Uint8Array(), { delta: "not-base64!" }));
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow("invalid audio chunk");
  });
  it("rejects a different response or audio item", async () => {
    const a = setup(ws => ws.audio(new Uint8Array([0, 0]), { response_id: "wrong" }));
    await expect(a.tts.synthesizePcm24k(TEXT)).rejects.toThrow("correlation");
    const b = setup(ws => { ws.audio(new Uint8Array([0, 0])); ws.transcript(TEXT, { item_id: "wrong" }); });
    await expect(b.tts.synthesizePcm24k(TEXT)).rejects.toThrow("audio item mismatch");
  });
  it("rejects an unexpected response metadata ID", async () => {
    const factory = setup(ws => ws.event({ type: "response.created", response: { id: "r2", metadata: { request_id: "wrong" } } }));
    await expect(factory.tts.synthesizePcm24k(TEXT)).rejects.toThrow("unexpected response");

  });
  it("rejects negotiated format or voice changes", async () => {
    const { tts, calls } = setup(success, {}, s => ({ ...s, audio: { output: { format: { type: "audio/pcm", rate: 16000 }, voice: "alloy" } } }));
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow("configuration mismatch");
    expect(calls[0]!.ws.sent.some(x => x.type === "response.create")).toBe(false);
  });
  it("enforces audio memory limits", async () => {
    const { tts } = setup(success, { maxAudioBytes: 32 });
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow("audio limit");
  });
  it("cancels by response ID and suppresses late output", async () => {
    const controller = new AbortController();
    const { tts, calls } = setup(ws => { ws.audio(int16ToBytes(tone())); controller.abort(); success(ws); });
    await expect(tts.synthesizePcm24k(TEXT, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(calls[0]!.ws.sent.at(-1)).toEqual({ type: "response.cancel", response_id: "r1" });
  });
  it("pre-cancellation or missing key opens no socket", async () => {
    const abort = new AbortController(); abort.abort();
    const a = setup();
    await expect(a.tts.synthesizePcm24k(TEXT, { signal: abort.signal })).rejects.toThrow("cancelled");
    expect(a.calls).toHaveLength(0);
    const b = setup(success, { apiKey: "" });
    await expect(b.tts.synthesizePcm24k(TEXT)).rejects.toThrow("OPENAI_API_KEY");
    expect(b.calls).toHaveLength(0);
  });
  it("times out and cleans up a hanging connection", async () => {
    const { tts, calls } = setup(() => {}, { timeoutMs: 10 });
    await expect(tts.synthesizePcm24k(TEXT)).rejects.toThrow("timed out");
    expect(calls[0]!.ws.terminated).toBe(true);
  });
  it("rejects early close, malformed events and provider errors without echoing payloads", async () => {
    for (const reply of [
      (ws: FixtureSocket) => ws.close(),
      (ws: FixtureSocket) => ws.emit("message", Buffer.from("SECRET-invalid"), false),
      (ws: FixtureSocket) => ws.event({ type: "error", error: { message: "SECRET-private-content" } }),
    ]) {
      await expect(setup(reply).tts.synthesizePcm24k(TEXT)).rejects.not.toThrow("SECRET");
    }
  });
  it("rejects empty/oversized text, invalid voice/model/bounds before connecting", async () => {
    const { tts, calls } = setup();
    for (const text of ["", "。", "x".repeat(4097)]) await expect(tts.synthesizePcm24k(text)).rejects.toThrow("characters");
    await expect(tts.synthesizePcm24k(TEXT, { voice: "unverified" })).rejects.toThrow("voice");
    expect(calls).toHaveLength(0);
    expect(() => setup(success, { model: "gpt-live-1" })).toThrow("validated target");
    expect(() => setup(success, { timeoutMs: NaN })).toThrow("timeout");
    expect(() => setup(success, { maxAudioBytes: -1 })).toThrow("bound");
  });
});

describe("TTS rollout factory", () => {
  it("keeps existing speech default and exposes explicit realtime choice", () => {
    expect(createOpenAITTS({})).toBeInstanceOf(OpenAITTS);
    expect(createOpenAITTS({ OATHRA_TTS_TRANSPORT: "realtime" })).toBeInstanceOf(OpenAIRealtimeTTS);
    expect(createOpenAITTS({ OATHRA_TTS_TRANSPORT: "realtime" }).name).toContain("gpt-realtime-2.1-mini");
  });
  it("refuses unknown transports and targets instead of silently falling back", () => {
    expect(() => createOpenAITTS({ OATHRA_TTS_TRANSPORT: "typo" })).toThrow("speech or realtime");
    expect(() => createOpenAITTS({ OATHRA_TTS_TRANSPORT: "realtime", OATHRA_TTS_MODEL: "gpt-live-1" })).toThrow("validated target");
  });
  it("does not inherit ambient credentials when an explicit environment is supplied", async () => {
    vi.stubEnv("OPENAI_API_KEY", "ambient-secret");
    await expect(createOpenAITTS({ OATHRA_TTS_TRANSPORT: "realtime" }).synthesizePcm24k(TEXT)).rejects.toThrow("OPENAI_API_KEY");
  });
});
