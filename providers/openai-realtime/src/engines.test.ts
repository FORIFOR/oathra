import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import { PCM_24K, type VoiceOutput } from "@oathra/voice";
import { gptLiveEngine } from "./engines.js";

let wss: WebSocketServer;
let port = 0;
const received: Record<string, unknown>[] = [];

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", r));
  port = (wss.address() as { port: number }).port;
  wss.on("connection", (socket: WebSocket) => {
    const send = (o: unknown) => socket.send(JSON.stringify(o));
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(msg);
      if (msg.type === "session.start") send({ type: "session.started" });
      if (msg.type === "session.input_audio.append" && received.filter((m) => m.type === "session.input_audio.append").length === 1) {
        // 20 ms of audible 24 kHz PCM -> 160 μ-law bytes for the carrier.
        const voiced = new Int16Array(480).fill(4000);
        send({ type: "session.output_audio.delta", delta: Buffer.from(voiced.buffer).toString("base64") });
        send({ type: "session.output_transcript.delta", delta: "では、19時半でお願いします。" });
        send({ type: "session.input_transcript.delta", delta: "19時半でしたら空いております。" });
        setTimeout(() => send({ type: "session.closed" }), 30);
      }
    });
  });
});
afterAll(() => wss.close());

describe("gptLiveEngine (VoiceEngine adapter)", () => {
  it("converts carrier PCM to Live PCM appends and publishes μ-law audio, events and hangup", async () => {
    const engine = gptLiveEngine({ model: "fake", voice: "vesper", apiKey: "test", url: `ws://127.0.0.1:${port}` });
    expect(engine.id).toBe("gpt-live");
    expect(engine.speaksItself).toBe(true);
    expect(engine.nativeAudio.format).toBe("mulaw");
    const contract = defineCall({ goal: "restaurant.reservation", require: { time: true, confirmed: true }, permissions: { ask: true } });
    const t0 = Date.now();
    const session = await engine.start({ contract, language: "ja", carrierAudio: PCM_24K }, { now: () => Date.now() - t0 });

    const pcm = new Int16Array(480);
    session.input({ ...PCM_24K, data: new Uint8Array(pcm.buffer) });

    const outputs: VoiceOutput[] = [];
    const deadline = Date.now() + 1500;
    for await (const o of session.output) {
      outputs.push(o);
      if (o.type === "event" && o.event.type === "hangup") break;
      if (Date.now() > deadline) break;
    }
    const audio = outputs.filter((o) => o.type === "audio");
    expect(audio).toHaveLength(1);
    expect(audio[0]!.type === "audio" && audio[0]!.chunk.format).toBe("mulaw");
    expect(audio[0]!.type === "audio" && audio[0]!.chunk.data.length).toBe(160);
    const types = outputs.flatMap((o) => (o.type === "event" ? [o.event.type] : []));
    expect(types).toContain("speech");
    expect(types).toContain("agent.speech");
    expect(types.at(-1)).toBe("hangup");

    const start = received.find((m) => m.type === "session.start") as { session: { model: string } } | undefined;
    expect(start?.session.model).toBe("fake");
    // The voice chosen for the call is the voice Live is started with.
    expect((start as unknown as { session: { audio: { output: { voice: string } } } }).session.audio.output.voice).toBe("vesper");
    const append = received.find((m) => m.type === "session.input_audio.append") as { audio: string } | undefined;
    // 24 kHz in -> μ-law 8 kHz at the adapter boundary -> 24 kHz PCM16 for Live: 480 samples = 960 bytes.
    expect(Buffer.from(append!.audio, "base64").length).toBe(960);
    await session.close();
  });
});
