import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioFrame, TranscriptEvent } from "@oathra/core";
import { DeepgramLiveSession, DeepgramSTT, type DeepgramLiveEvent } from "./index.js";

/** Just enough of a WebSocket for the session: records what was sent, lets the test play the server. */
class FakeSocket extends EventTarget {
  static last: FakeSocket;
  readonly OPEN = 1;
  readyState = 0;
  binaryType = "";
  readonly sent: Array<string | Uint8Array> = [];
  constructor(readonly url: string, readonly protocols: string[]) { super(); FakeSocket.last = this; }
  send(data: string | Uint8Array): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "bye" })); }
  accept(): void { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  fail(): void { this.dispatchEvent(new Event("error")); }
  server(message: unknown): void { this.dispatchEvent(Object.assign(new Event("message"), { data: typeof message === "string" ? message : JSON.stringify(message) })); }
  get control(): Array<{ type: string }> { return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s)); }
}
const WebSocketImpl = FakeSocket as unknown as typeof WebSocket;
const results = (transcript: string, o: { final?: boolean; speechFinal?: boolean; start?: number; duration?: number; confidence?: number } = {}) =>
  ({ type: "Results", start: o.start ?? 1.2, duration: o.duration ?? 0.8, is_final: o.final ?? false, speech_final: o.speechFinal ?? false, channel: { alternatives: [{ transcript, confidence: o.confidence ?? 0.97 }] } });

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function opened(opts: ConstructorParameters<typeof DeepgramLiveSession>[0] = {}) {
  const session = new DeepgramLiveSession({ apiKey: "dg-key", WebSocketImpl, ...opts }), events: DeepgramLiveEvent[] = [];
  session.on((e) => events.push(e));
  const ready = session.open(); FakeSocket.last.accept(); await ready;
  return { session, socket: FakeSocket.last, events };
}

describe("DeepgramLiveSession", () => {
  it("connects for Japanese telephone audio by default and passes the key as a subprotocol, not in the URL", async () => {
    const { socket } = await opened({ keywords: ["トラットリア", "Ringo"] });
    const url = new URL(socket.url);
    expect(url.origin + url.pathname).toBe("wss://api.deepgram.com/v1/listen");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ model: "nova-3", language: "ja", encoding: "mulaw", sample_rate: "8000", channels: "1", interim_results: "true", endpointing: "300", utterance_end_ms: "1000", vad_events: "true" });
    expect(url.searchParams.getAll("keyterm")).toEqual(["トラットリア", "Ringo"]);
    expect(socket.protocols).toEqual(["token", "dg-key"]);
    expect(socket.url).not.toContain("dg-key");
  });

  it("refuses to open without a key and says where to get one", () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    expect(() => new DeepgramLiveSession({ WebSocketImpl }).open()).toThrow(/DEEPGRAM_API_KEY is not set.*console\.deepgram\.com/);
  });

  it("turns server messages into partials, finals, speech starts and utterance ends in milliseconds", async () => {
    const { socket, events } = await opened();
    socket.server({ type: "SpeechStarted", timestamp: 1.18 });
    socket.server(results("19時半なら"));
    socket.server(results(" 19時半なら空いております。 ", { final: true, speechFinal: true, confidence: 0.91 }));
    socket.server({ type: "UtteranceEnd", last_word_end: 2.04 });
    expect(events.slice(1)).toEqual([
      { type: "speech_started", t: 1180 },
      { type: "partial", text: "19時半なら", startMs: 1200, endMs: 2000, confidence: 0.97 },
      { type: "final", text: "19時半なら空いております。", startMs: 1200, endMs: 2000, confidence: 0.91, speechFinal: true },
      { type: "utterance_end", lastWordEndMs: 2040 },
    ]);
  });

  it("ignores empty transcripts, binary frames, broken JSON and unknown message types", async () => {
    const { socket, events } = await opened();
    socket.server(results("   ", { final: true }));
    socket.server("{not json");
    socket.server({ type: "Metadata", request_id: "x" });
    socket.dispatchEvent(Object.assign(new Event("message"), { data: new ArrayBuffer(4) }));
    expect(events).toEqual([{ type: "open" }]);
  });

  it("reports provider errors and a failed connection", async () => {
    const { socket, events } = await opened();
    socket.server({ type: "Error", description: "insufficient credits" });
    expect(events.at(-1)).toEqual({ type: "error", message: "insufficient credits" });

    const session = new DeepgramLiveSession({ apiKey: "k", WebSocketImpl }), failed = session.open();
    FakeSocket.last.fail();
    await expect(failed).rejects.toThrow("Deepgram websocket error");
  });

  it("sends audio only while open, keeps the connection alive, and closes cleanly once", async () => {
    vi.useFakeTimers();
    const session = new DeepgramLiveSession({ apiKey: "k", WebSocketImpl });
    session.send(new Uint8Array([1, 2, 3])); // before open: dropped, no throw
    const ready = session.open(), socket = FakeSocket.last;
    session.send(new Uint8Array([1])); expect(socket.sent).toHaveLength(0);
    socket.accept(); await ready;
    expect(session.open()).toBe(ready); // idempotent

    session.send(new Uint8Array([9, 9]));
    vi.advanceTimersByTime(10_000);
    session.finalize();
    expect(socket.sent[0]).toEqual(new Uint8Array([9, 9]));
    expect(socket.control.map((c) => c.type)).toEqual(["KeepAlive", "KeepAlive", "Finalize"]);

    session.close(); session.close();
    expect(socket.control.map((c) => c.type)).toEqual(["KeepAlive", "KeepAlive", "Finalize", "CloseStream"]);
    expect(session.isClosed).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(socket.control.filter((c) => c.type === "KeepAlive")).toHaveLength(2); // keep-alive stopped
  });

  it("a listener can unsubscribe", async () => {
    const session = new DeepgramLiveSession({ apiKey: "k", WebSocketImpl }), seen: string[] = [];
    const off = session.on((e) => seen.push(e.type));
    const ready = session.open(); FakeSocket.last.accept(); await ready;
    off(); FakeSocket.last.server(results("x", { final: true }));
    expect(seen).toEqual(["open"]);
  });
});

describe("DeepgramSTT", () => {
  it("resamples frames to 8 kHz μ-law, passes language and keywords, and yields partials then finals until the socket closes", async () => {
    vi.useFakeTimers();
    async function* audio(): AsyncIterable<AudioFrame> {
      yield { sampleRate: 24000, samples: new Int16Array(2400).fill(8000), channels: 1, t: 0 }; // 100 ms at 24 kHz
      yield { sampleRate: 8000, samples: new Int16Array(800).fill(-8000), channels: 1, t: 100 };  // 100 ms already at 8 kHz
    }
    const out: TranscriptEvent[] = [];
    const run = (async () => { for await (const e of new DeepgramSTT({ apiKey: "k", WebSocketImpl }).stream(audio(), { language: "en", keywords: ["Ringo"] })) out.push(e); })();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.last; socket.accept();
    await vi.advanceTimersByTimeAsync(0);

    const url = new URL(socket.url);
    expect([url.searchParams.get("language"), url.searchParams.get("encoding"), url.searchParams.get("sample_rate"), url.searchParams.getAll("keyterm")]).toEqual(["en", "mulaw", "8000", ["Ringo"]]);
    const frames = socket.sent.filter((s): s is Uint8Array => typeof s !== "string");
    expect(frames.map((f) => f.length)).toEqual([800, 800]); // one byte per 8 kHz sample
    expect(socket.control.map((c) => c.type)).toContain("Finalize");

    socket.server(results("seven thirty"));
    socket.server(results("Seven thirty works.", { final: true, speechFinal: true, confidence: 0.88 }));
    await vi.advanceTimersByTimeAsync(1500); // the session closes itself after the audio ends
    await run;
    expect(out).toEqual([
      { type: "partial", text: "seven thirty", t: 2000 },
      { type: "final", text: "Seven thirty works.", startMs: 1200, endMs: 2000, confidence: 0.88 },
    ]);
    expect(socket.control.at(-1)?.type).toBe("CloseStream");
  });
});
