import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import type { SessionEvent } from "@oathra/core";
import { MULAW_8K, OutputQueue, PCM_24K, toPcm16, type AudioChunk, type VoiceEngine, type VoiceOutput, type VoiceSession } from "@oathra/voice";
import { BridgedCallSession, PhoneTransport } from "./bridge.js";
import type { CarrierEvent, CarrierMediaSession, CarrierTransport, DialOptions } from "./types.js";

class FakeCarrier implements CarrierMediaSession {
  readonly audio = MULAW_8K;
  readonly queue = new OutputQueue<CarrierEvent>();
  readonly events: AsyncIterable<CarrierEvent> = this.queue;
  readonly sent: AudioChunk[] = [];
  readonly hangups: Array<string | undefined> = [];
  clears = 0;
  send(chunk: AudioChunk): void {
    this.sent.push(chunk);
  }
  clear(): void {
    this.clears++;
  }
  async hangup(reason?: string): Promise<void> {
    this.hangups.push(reason);
  }
  now(): number {
    return 1234;
  }
}

class FakeVoice implements VoiceSession {
  readonly queue = new OutputQueue<VoiceOutput>();
  readonly output: AsyncIterable<VoiceOutput> = this.queue;
  readonly inputs: AudioChunk[] = [];
  readonly said: string[] = [];
  interrupts = 0;
  closes = 0;
  input(chunk: AudioChunk): void {
    this.inputs.push(chunk);
  }
  async speak(text: string): Promise<{ startMs: number; endMs: number; interrupted: boolean }> {
    this.said.push(text);
    return { startMs: 10, endMs: 20, interrupted: false };
  }
  interrupt(): void {
    this.interrupts++;
  }
  async close(): Promise<void> {
    this.closes++;
  }
  now(): number {
    return 0;
  }
}

function fakeEngine(voice: VoiceSession, speaksItself = true): VoiceEngine & { startedWith?: Parameters<VoiceEngine["start"]>[0] } {
  const engine: VoiceEngine & { startedWith?: Parameters<VoiceEngine["start"]>[0] } = {
    id: "fake-live",
    label: "Fake Live",
    speaksItself,
    nativeAudio: PCM_24K,
    requires: [],
    start: async (ctx) => {
      engine.startedWith = ctx;
      return voice;
    },
  };
  return engine;
}

const contract = defineCall({ goal: "restaurant.reservation", language: "ja", target: { phone: "+819012345678", name: "テスト店" } });

async function bridge(voice: VoiceSession = new FakeVoice()) {
  const carrier = new FakeCarrier();
  const session = new BridgedCallSession({ carrier, engine: fakeEngine(voice), contract, language: "ja", calleeName: "テスト店" });
  await session.start();
  const iterator = session.events[Symbol.asyncIterator]();
  const next = async (): Promise<SessionEvent | undefined> => (await iterator.next()).value as SessionEvent | undefined;
  return { carrier, session, next };
}

const tick = () => new Promise<void>((res) => setImmediate(res));

/** 100 ms of a 440 Hz tone at 24 kHz, 16-bit PCM — what a speech-to-speech engine emits. */
function tone24k(): AudioChunk {
  const pcm = new Int16Array(2400);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000);
  return { ...PCM_24K, data: new Uint8Array(pcm.buffer) };
}

const rms = (pcm: Int16Array) => Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / pcm.length);

describe("BridgedCallSession", () => {
  it("tells the engine which format the carrier speaks and uses the carrier's clock", async () => {
    const voice = new FakeVoice();
    const carrier = new FakeCarrier();
    const engine = fakeEngine(voice);
    const session = new BridgedCallSession({ carrier, engine, contract, language: "ja", calleeName: "テスト店" });
    await session.start();

    expect(engine.startedWith).toMatchObject({ carrierAudio: MULAW_8K, language: "ja", calleeName: "テスト店" });
    expect(session.now()).toBe(1234);
  });

  it("forwards far-end audio to the engine untouched and reports the connection", async () => {
    const voice = new FakeVoice();
    const { carrier, next } = await bridge(voice);
    const chunk: AudioChunk = { ...MULAW_8K, data: new Uint8Array([0xff, 0x7f, 0x00]) };
    carrier.queue.push({ type: "connected" });
    carrier.queue.push({ type: "audio", chunk });

    expect(await next()).toEqual({ type: "connected", callee: "テスト店" });
    await tick();
    expect(voice.inputs).toEqual([chunk]);
  });

  it("converts engine audio to the carrier's wire format without losing the signal", async () => {
    const voice = new FakeVoice();
    const { carrier } = await bridge(voice);
    voice.queue.push({ type: "audio", chunk: tone24k() });
    await tick();

    expect(carrier.sent).toHaveLength(1);
    const out = carrier.sent[0]!;
    expect(out).toMatchObject({ format: "mulaw", sampleRate: 8000, channels: 1 });
    // 100 ms at 8 kHz μ-law is 800 bytes; an all-silent payload would be the 2026-09-15 live-call bug.
    expect(out.data.length).toBeGreaterThanOrEqual(790);
    expect(out.data.length).toBeLessThanOrEqual(810);
    expect(rms(toPcm16(out))).toBeGreaterThan(4000);
  });

  it("passes barge-in and engine events through", async () => {
    const voice = new FakeVoice();
    const { carrier, session, next } = await bridge(voice);
    voice.queue.push({ type: "clear" });
    voice.queue.push({ type: "event", event: { type: "speech", text: "はい、テスト店です。", startMs: 0, endMs: 900 } });

    expect(await next()).toMatchObject({ type: "speech", text: "はい、テスト店です。" });
    expect(carrier.clears).toBe(1);

    session.interrupt();
    expect(voice.interrupts).toBe(1);
    expect(carrier.clears).toBe(2);
  });

  it("hands runtime speech to a pipeline engine and tolerates engines that cannot speak", async () => {
    const voice = new FakeVoice();
    const { session } = await bridge(voice);
    expect(await session.speak({ text: "予約をお願いします。", language: "ja" })).toEqual({ startMs: 10, endMs: 20, interrupted: false });
    expect(voice.said).toEqual(["予約をお願いします。"]);

    const mute = new FakeVoice();
    (mute as { speak?: unknown }).speak = undefined;
    const { session: s2 } = await bridge(mute);
    expect(await s2.speak({ text: "x", language: "ja" })).toEqual({ startMs: 1234, endMs: 1234, interrupted: false });
  });

  it("closes both sides exactly once when the far end hangs up", async () => {
    const voice = new FakeVoice();
    const { carrier, session, next } = await bridge(voice);
    carrier.queue.push({ type: "hangup", reason: "completed" });

    expect(await next()).toEqual({ type: "hangup", reason: "completed" });
    expect(await next()).toBeUndefined();
    await session.hangup("agent_hangup");
    await session.hangup("again");
    expect(voice.closes).toBe(1);
    expect(carrier.hangups).toHaveLength(1);
    // Nothing is played or spoken after the call ended.
    expect(await session.speak({ text: "遅れた台詞", language: "ja" })).toMatchObject({ interrupted: false });
    expect(voice.said).toHaveLength(0);
  });

  it("reports a carrier stream that ends without a hangup", async () => {
    const { carrier, next } = await bridge();
    carrier.queue.close();
    expect(await next()).toEqual({ type: "hangup", reason: "carrier_closed" });
    expect(await next()).toBeUndefined();
  });

  it("keeps the fatal flag on carrier errors and treats a crashed engine as fatal", async () => {
    const { carrier, next } = await bridge();
    carrier.queue.push({ type: "error", message: "jitter", fatal: false });
    expect(await next()).toEqual({ type: "error", message: "jitter", fatal: false });

    const crashing: VoiceSession = {
      input: () => undefined,
      output: {
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("websocket closed 1006")) }),
      },
      interrupt: () => undefined,
      close: async () => undefined,
      now: () => 0,
    };
    const b = await bridge(crashing);
    expect(await b.next()).toEqual({ type: "error", message: "websocket closed 1006", fatal: true });
    expect(await b.next()).toBeUndefined();
    expect(b.carrier.hangups).toHaveLength(1);
  });

  it("ends the call when the engine itself hangs up", async () => {
    const voice = new FakeVoice();
    const { carrier, next } = await bridge(voice);
    voice.queue.push({ type: "event", event: { type: "hangup", reason: "agent_done" } });
    expect(await next()).toEqual({ type: "hangup", reason: "agent_done" });
    await tick();
    expect(carrier.hangups).toHaveLength(1);
    expect(voice.closes).toBe(1);
  });
});

describe("PhoneTransport", () => {
  const carrierTransport = (dialed: DialOptions[]): CarrierTransport => ({
    providerId: "twilio",
    path: "direct",
    describe: () => "fake",
    dial: async (opts) => {
      dialed.push(opts);
      return new FakeCarrier();
    },
  });

  it("names itself after carrier, path and engine, and mirrors speaksItself", () => {
    const t = new PhoneTransport(carrierTransport([]), fakeEngine(new FakeVoice(), false));
    expect(t.name).toBe("twilio:direct+fake-live");
    expect(t.speaksItself).toBe(false);
    expect(t.kind).toBe("sip");
  });

  it("refuses to dial without a phone number", async () => {
    const dialed: DialOptions[] = [];
    const t = new PhoneTransport(carrierTransport(dialed), fakeEngine(new FakeVoice()));
    await expect(t.connect({ name: "テスト店" }, { language: "ja", contract })).rejects.toThrow(/E\.164/);
    expect(dialed).toHaveLength(0);
  });

  it("dials with caller id and recording directory and returns a started session", async () => {
    const dialed: DialOptions[] = [];
    const engine = fakeEngine(new FakeVoice());
    const t = new PhoneTransport(carrierTransport(dialed), engine, { callerId: "+815012345678", recordDir: "/tmp/rec" });
    const session = await t.connect({ phone: "+819012345678", name: "テスト店" }, { language: "ja", contract });

    expect(dialed).toEqual([{ to: "+819012345678", language: "ja", contract, callerId: "+815012345678", recordDir: "/tmp/rec" }]);
    expect(t.lastSession).toBe(session);
    expect(engine.startedWith?.calleeName).toBe("テスト店");
  });
});
