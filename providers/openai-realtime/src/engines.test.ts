import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import { PCM_24K, type VoiceOutput } from "@oathra/voice";
import { realtimeEngine } from "./engines.js";

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
      if (msg.type === "session.update" && received.filter((m) => m.type === "session.update").length === 1) {
        send({ type: "session.updated" });
        setTimeout(() => {
          send({ type: "input_audio_buffer.speech_started", audio_start_ms: 100 });
          send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 900 });
          send({ type: "conversation.item.input_audio_transcription.completed", transcript: "19時半でしたら空いております。" });
          send({ type: "response.output_audio.delta", item_id: "it1", response_id: "r1", delta: Buffer.alloc(800, 0xff).toString("base64") });
          send({ type: "response.output_audio_transcript.done", transcript: "では、19時半でお願いします。" });
          send({ type: "response.function_call_arguments.done", name: "end_call", call_id: "c1", arguments: JSON.stringify({ reason: "done" }) });
          send({ type: "response.done", response: {} });
        }, 30);
      }
    });
  });
});
afterAll(() => wss.close());

describe("realtimeEngine (VoiceEngine adapter)", () => {
  it("converts carrier PCM to μ-law appends and publishes audio, events and hangup", async () => {
    const engine = realtimeEngine({ model: "fake", apiKey: "test", url: `ws://127.0.0.1:${port}` });
    expect(engine.speaksItself).toBe(true);
    expect(engine.nativeAudio.format).toBe("mulaw");
    const contract = defineCall({ goal: "restaurant.reservation", require: { time: true, confirmed: true }, permissions: { ask: true } });
    const t0 = Date.now();
    const session = await engine.start({ contract, language: "ja", carrierAudio: PCM_24K }, { now: () => Date.now() - t0 });

    // 20 ms of 24 kHz PCM = 480 samples = 960 bytes -> 160 μ-law bytes.
    const pcm = new Int16Array(480);
    session.input({ ...PCM_24K, data: new Uint8Array(pcm.buffer) });
    session.updateContext({ verified: { time: "19:30" }, pending: {}, missing: ["confirmed"], violations: [] });

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
    expect(audio[0]!.type === "audio" && audio[0]!.chunk.data.length).toBe(800);
    const types = outputs.flatMap((o) => (o.type === "event" ? [o.event.type] : []));
    expect(types).toContain("speech");
    expect(types).toContain("agent.speech");
    expect(types.at(-1)).toBe("hangup");

    const append = received.find((m) => m.type === "input_audio_buffer.append") as { audio: string } | undefined;
    expect(append).toBeDefined();
    expect(Buffer.from(append!.audio, "base64").length).toBe(160);
    await session.close();
  });
});
