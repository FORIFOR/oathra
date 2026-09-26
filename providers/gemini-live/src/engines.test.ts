import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import { PCM_24K, type VoiceOutput } from "@oathra/voice";
import { geminiLiveEngine } from "./engines.js";

let wss: WebSocketServer;
let port = 0;
const received: Record<string, unknown>[] = [];
let connectUrl = "";

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", r));
  port = (wss.address() as { port: number }).port;
  wss.on("connection", (socket: WebSocket, req) => {
    connectUrl = req.url ?? "";
    const send = (o: unknown) => socket.send(JSON.stringify(o));
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(msg);
      if (msg.setup) send({ setupComplete: {} });
      if (msg.realtimeInput && received.filter((m) => m.realtimeInput).length === 1) {
        const voiced = new Int16Array(480).fill(4000);
        send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.from(voiced.buffer).toString("base64") } }] } } });
        send({ serverContent: { outputTranscription: { text: "では、19時半でお願いします。" } } });
        send({ serverContent: { inputTranscription: { text: "19時半でしたら空いております。" } } });
        send({ serverContent: { turnComplete: true } });
        setTimeout(() => socket.close(), 30);
      }
    });
  });
});
afterAll(() => wss.close());

describe("geminiLiveEngine (VoiceEngine adapter)", () => {
  it("sets up the Live session, converts audio both ways and publishes events and hangup", async () => {
    const engine = geminiLiveEngine({ model: "gemini-fake-live", voice: "Aoede", apiKey: "test-key", url: `ws://127.0.0.1:${port}` });
    expect(engine.id).toBe("gemini-live");
    expect(engine.speaksItself).toBe(true);
    expect(engine.requires).toEqual(["GEMINI_API_KEY"]);
    const contract = defineCall({ goal: "restaurant.reservation", require: { time: true, confirmed: true }, permissions: { ask: true } });
    const t0 = Date.now();
    const session = await engine.start({ contract, language: "ja", carrierAudio: PCM_24K }, { now: () => Date.now() - t0 });
    expect(connectUrl).toContain("key=test-key");

    session.input({ ...PCM_24K, data: new Uint8Array(new Int16Array(480).buffer) });
    const outputs: VoiceOutput[] = [];
    const deadline = Date.now() + 2000;
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
    expect(types).toContain("agent.speech");
    expect(types.at(-1)).toBe("hangup");

    const setup = received.find((m) => m.setup) as { setup: { model: string; generationConfig: { responseModalities: string[]; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } }; inputAudioTranscription: object; outputAudioTranscription: object; tools: Array<{ functionDeclarations: Array<{ name: string }> }> } } | undefined;
    expect(setup?.setup.model).toBe("models/gemini-fake-live");
    expect(setup?.setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup?.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Aoede");
    expect(setup?.setup.inputAudioTranscription).toEqual({});
    expect(setup?.setup.tools[0]?.functionDeclarations.map((f) => f.name)).toEqual(["end_call", "request_action"]);
    // A permission must be answered before the model goes on talking.
    expect((setup?.setup.tools[0]?.functionDeclarations.find((f) => f.name === "request_action") as { behavior?: string } | undefined)?.behavior).toBe("BLOCKING");
    // Not sent by default: 3.8 Live accepts it at setup and then closes the session when it would speak.
    expect((setup?.setup.generationConfig as { enableAffectiveDialog?: boolean }).enableAffectiveDialog).toBeUndefined();
    const audioIn = received.find((m) => m.realtimeInput) as { realtimeInput: { audio: { data: string; mimeType: string } } } | undefined;
    expect(audioIn?.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    // 480 samples at 24 kHz -> 160 μ-law at 8 kHz at the adapter boundary -> 320 PCM16 samples at 16 kHz = 640 bytes.
    expect(Buffer.from(audioIn!.realtimeInput.audio.data, "base64").length).toBe(640);
    await session.close();
  });
});
