import { expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import type { CallEvent } from "@oathra/core";
import { runCall } from "@oathra/runtime";
import { PhoneTransport, type CarrierEvent, type CarrierMediaSession, type CarrierTransport } from "@oathra/phone";
import { MULAW_8K, OutputQueue } from "@oathra/voice";
import { pipelineEngine, type LiveSTTSession } from "@oathra/voice-pipeline";
import type { DeepgramLiveEvent } from "@oathra/deepgram";

it("a rejected TTS utterance is never recorded as spoken evidence or an agent hangup", async () => {
  const startedAt = Date.now();
  const queue = new OutputQueue<CarrierEvent>();
  const sent: unknown[] = [];
  const events: CallEvent[] = [];
  let listener: (event: DeepgramLiveEvent) => void = () => {};
  const stt: LiveSTTSession = {
    async open() { setTimeout(() => listener({ type: "final", text: "こんにちは", startMs: 10, endMs: 20, confidence: 1, speechFinal: true }), 0); },
    on(fn) { listener = fn; return () => {}; }, send() {}, finalize() {}, close() {},
  };
  const media: CarrierMediaSession = {
    audio: MULAW_8K, events: queue, send(chunk) { sent.push(chunk); }, clear() {},
    async hangup() { queue.close(); }, now: () => Date.now() - startedAt,
  };
  const carrier: CarrierTransport = { providerId: "offline-fixture", path: "simulator", describe: () => "synthetic, no telephone", async dial() { queue.push({ type: "connected" }); return media; } };
  const brain = { name: "offline-fixture", async respond() { return { text: "予約を確定しました。", action: "hangup" as const }; } };
  const engine = pipelineEngine({ brain, stt: { live: () => stt }, acknowledgements: false,
    tts: { async synthesizeMulaw8k() { throw new Error("Realtime TTS transcript does not match requested text"); } } });
  const guard = setTimeout(() => queue.push({ type: "hangup", reason: "fixture-timeout" }), 1000);
  try {
    const result = await runCall({
      contract: defineCall({ goal: "chat.casual", target: { phone: "+819000000000" }, permissions: { ask: true } }),
      transport: new PhoneTransport(carrier, engine), brain, silenceCheckMs: 0,
      onEvent(event) { events.push(event); if (event.type === "agent.speech.ended") queue.push({ type: "hangup", reason: "fixture-end" }); },
    });
    expect(sent).toHaveLength(0);
    expect(result.transcript.some(x => x.source === "caller")).toBe(false);
    expect(events.some(x => x.type === "transcript.final" && x.source === "caller")).toBe(false);
    expect(events.some(x => x.type === "agent.speech.ended" && x.interrupted)).toBe(true);
    expect(result.endReason).not.toBe("agent_hangup");
  } finally { clearTimeout(guard); queue.close(); }
});
