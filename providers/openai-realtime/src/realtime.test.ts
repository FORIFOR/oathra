import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import type { SessionEvent } from "@oathra/core";
import { OpenAIRealtimeAgent } from "./index.js";

/** A fake Realtime server that plays one callee turn and one agent turn, then ends the call. */
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

describe("OpenAIRealtimeAgent", () => {
  it("maps Realtime events to session events and forwards audio", async () => {
    const contract = defineCall({ goal: "restaurant.reservation", require: { time: true, confirmed: true }, permissions: { ask: true } });
    const agent = new OpenAIRealtimeAgent({ contract, apiKey: "test", model: "fake", url: `ws://127.0.0.1:${port}` });
    const events: SessionEvent[] = [];
    const audio: number[] = [];
    const t0 = Date.now();
    await agent.connect({ sendAudio: (b) => audio.push(b.length), clearAudio: () => undefined, emit: (e) => events.push(e), now: () => Date.now() - t0 });
    agent.pushAudio(new Uint8Array(160));
    agent.updateContext({ verified: { time: "19:30" }, pending: {}, missing: ["confirmed"], violations: [] });
    await new Promise((r) => setTimeout(r, 700));
    const types = events.map((e) => e.type);
    expect(types).toContain("speech.started");
    expect(types).toContain("speech");
    expect(types).toContain("agent.speech");
    expect(types.at(-1)).toBe("hangup");
    const speech = events.find((e) => e.type === "speech");
    expect(speech && speech.type === "speech" ? speech.text : "").toContain("19時半");
    const agentSpeech = events.find((e) => e.type === "agent.speech");
    expect(agentSpeech && agentSpeech.type === "agent.speech" ? agentSpeech.text : "").toContain("19時半");
    expect(audio).toEqual([800]);
    // The session config carries the contract-grounded instructions and the mission state after updateContext.
    const updates = received.filter((m) => m.type === "session.update") as Array<{ session: { instructions: string } }>;
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[1]!.session.instructions).toContain('"time":"19:30"');
    expect(received.some((m) => m.type === "input_audio_buffer.append")).toBe(true);
    expect(received.some((m) => m.type === "conversation.item.create")).toBe(true);
    agent.close();
  });
});
