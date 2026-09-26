import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineCall } from "@oathra/contract";
import { mulawDecodeSample } from "@oathra/audio-kit";
import { GeminiLiveAgent } from "./live.js";

function pcm24kSine(): string {
  const pcm = new Int16Array(480);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000);
  return Buffer.from(pcm.buffer).toString("base64");
}

const VOICED = new Uint8Array(160).fill(0x00);

function harness(goal = "phone.message", extra: Record<string, unknown> = {}) {
  const contract = defineCall({ goal, language: "ja", input: { request: "明日の集合時間を伝えてください。", ...extra }, permissions: { ask: true } });
  const agent = new GeminiLiveAgent({ contract, apiKey: "test" }) as unknown as {
    started: boolean;
    bridge: { sendAudio: (audio: Uint8Array) => void; clearAudio: () => void; emit: (event: unknown) => void; now: () => number };
    ws: { readyState: number; send: (raw: string) => void };
    onMessage: (message: Record<string, unknown>) => void;
    pushAudio: (mulaw: Uint8Array) => void;
    updateContext: (view: unknown) => void;
    resolveAction: (action: string, approved: boolean) => void;
    instructions: () => string;
    flushIn: () => void;
    flushOut: () => void;
  };
  const state = { now: 1000, clears: 0, audio: [] as Uint8Array[] };
  const sent: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  agent.started = true;
  agent.bridge = { sendAudio: (a) => { state.audio.push(a); }, clearAudio: () => { state.clears++; }, emit: (event) => events.push(event as Record<string, unknown>), now: () => state.now };
  agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
  return { agent, sent, events, state };
}

describe("GeminiLiveAgent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("speaks the shared instructions and declares its tools without web search", () => {
    const { agent } = harness();
    const text = agent.instructions();
    expect(text).toContain("最初にAIによる代理電話");
    expect(text).toContain("end_call");
    expect(text).toContain("request_action");
    expect(text).not.toContain("web_search:");
    expect(text).toContain("cannot search the web");
  });

  it("sends carrier μ-law as 16 kHz PCM realtimeInput", () => {
    const { agent, sent } = harness();
    agent.pushAudio(VOICED);
    const audio = sent.find((m) => m.realtimeInput) as { realtimeInput: { audio: { data: string; mimeType: string } } } | undefined;
    expect(audio?.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    // 160 μ-law samples at 8 kHz become 320 PCM16 samples at 16 kHz = 640 bytes.
    expect(Buffer.from(audio!.realtimeInput.audio.data, "base64").length).toBe(640);
  });

  it("returns model audio to the carrier as μ-law 8 kHz and reports both transcripts", () => {
    const { agent, events, state } = harness();
    agent.onMessage({ serverContent: { inputTranscription: { text: "はい、田中です。" } } });
    state.now += 1000;
    agent.onMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: pcm24kSine() } }] } } });
    agent.onMessage({ serverContent: { outputTranscription: { text: "もしもし、AIです。" } } });
    agent.onMessage({ serverContent: { turnComplete: true } });
    expect(state.audio).toHaveLength(1);
    expect(state.audio[0]!.length).toBe(160);
    expect(Math.abs(mulawDecodeSample(state.audio[0]![40]!))).toBeGreaterThan(1000);
    agent.flushIn();
    const types = events.map((e) => e.type);
    expect(types).toContain("speech.started");
    expect(types).toContain("agent.speech");
    expect(types).toContain("speech");
    const agentTurn = events.find((e) => e.type === "agent.speech") as { text: string } | undefined;
    expect(agentTurn?.text).toBe("もしもし、AIです。");
    const callee = events.find((e) => e.type === "speech") as { text: string; asr: { primary: number } } | undefined;
    expect(callee?.text).toBe("はい、田中です。");
  });

  it("an interruption drops the buffered reply and marks the turn", () => {
    const { agent, events, state } = harness();
    agent.onMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: pcm24kSine() } }] } } });
    agent.onMessage({ serverContent: { outputTranscription: { text: "ご説明しますと" } } });
    agent.onMessage({ serverContent: { interrupted: true } });
    expect(state.clears).toBe(1);
    expect(events.some((e) => e.type === "interruption")).toBe(true);
    const turn = events.find((e) => e.type === "agent.speech") as { interrupted?: boolean } | undefined;
    expect(turn?.interrupted).toBe(true);
  });

  it("end_call answers the tool and hangs up after the goodbye has played", () => {
    const { agent, sent, events } = harness();
    agent.onMessage({ toolCall: { functionCalls: [{ id: "c1", name: "end_call", args: { reason: "done" } }] } });
    const reply = sent.find((m) => m.toolResponse) as { toolResponse: { functionResponses: Array<{ id: string; response: { ok: boolean } }> } } | undefined;
    expect(reply?.toolResponse.functionResponses[0]?.id).toBe("c1");
    expect(reply?.toolResponse.functionResponses[0]?.response.ok).toBe(true);
    expect(events.some((e) => e.type === "hangup")).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(events.some((e) => e.type === "hangup" && (e as { reason: string }).reason === "done")).toBe(true);
  });

  it("request_action waits for the runtime's decision and relays it", () => {
    const { agent, sent, events } = harness();
    agent.onMessage({ toolCall: { functionCalls: [{ id: "c2", name: "request_action", args: { action: "payment", detail: "deposit" } }] } });
    expect(events.some((e) => e.type === "action.requested")).toBe(true);
    expect(sent.some((m) => m.toolResponse)).toBe(false);
    agent.resolveAction("payment", false);
    const reply = sent.find((m) => m.toolResponse) as { toolResponse: { functionResponses: Array<{ id: string; response: { approved: boolean } }> } } | undefined;
    expect(reply?.toolResponse.functionResponses[0]?.id).toBe("c2");
    expect(reply?.toolResponse.functionResponses[0]?.response.approved).toBe(false);
  });

  it("mission state goes in as context that asks for no reply, and waits while the model is speaking", () => {
    const { agent, sent } = harness();
    agent.onMessage({ serverContent: { outputTranscription: { text: "はい" } } });
    agent.updateContext({ verified: { date: "2026-09-27" }, pending: {}, missing: ["time"], violations: [] });
    expect(sent.some((m) => m.clientContent)).toBe(false);
    agent.onMessage({ serverContent: { turnComplete: true } });
    const ctx = sent.find((m) => m.clientContent) as { clientContent: { turns: Array<{ role: string; parts: Array<{ text: string }> }>; turnComplete: boolean } } | undefined;
    expect(ctx?.clientContent.turnComplete).toBe(false);
    expect(ctx?.clientContent.turns[0]?.parts[0]?.text).toContain('verified={"date":"2026-09-27"}');
  });

  it("both goodbyes end the call", () => {
    const { agent, events, state } = harness();
    agent.onMessage({ serverContent: { outputTranscription: { text: "それでは失礼します。" } } });
    agent.onMessage({ serverContent: { turnComplete: true } });
    state.now += 500;
    agent.onMessage({ serverContent: { inputTranscription: { text: "はーい、バイバイ。" } } });
    agent.flushIn();
    vi.advanceTimersByTime(3000);
    expect(events.some((e) => e.type === "hangup")).toBe(true);
  });
});

describe("voice presets", () => {
  it("the preset speaking style reaches Gemini's system instruction", async () => {
    const { definePhoneRequest, preparePhoneRequest } = await import("@oathra/contract");
    const contract = definePhoneRequest(preparePhoneRequest({ phone: "+819012345678", name: "田中", instruction: "近況を話す", conversationMode: "chat", voicePreset: "character-male" }));
    const text = new GeminiLiveAgent({ contract, apiKey: "x" }).instructions();
    expect(text).toContain("【話し方：キャラクター風】");
    expect(text).not.toContain("大げさな演技や過剰な明るさは避けて");
  });
});
