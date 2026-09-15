import { describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import { OpenAILiveAgent } from "./live.js";
import { mulawDecodeSample } from "@oathra/audio-kit";

function pcm24kSine(): string {
  const pcm = new Int16Array(480);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000);
  return Buffer.from(pcm.buffer).toString("base64");
}

describe("OpenAILiveAgent casual intake", () => {
  it("keeps a friend-like tone while exposing only consented declared fields", () => {
    const contract = defineCall({
      goal: "chat.casual",
      language: "ja",
      input: { topic: "最近ハマっていること", persona: "明るく聞き上手な友達" },
      permissions: { ask: true },
      intake: {
        purpose: "次回の会話を相手の関心に合わせる",
        consentPrompt: "2点だけ聞いてもいい？",
        fields: [
          { key: "current_interest", label: "最近の関心", question: "最近ハマっていることって何？" },
          { key: "next_topic", label: "次回の話題", question: "次に話すなら、どんな話題がいい？" },
        ],
        maxQuestions: 2,
      },
    });
    const agent = new OpenAILiveAgent({ contract });
    const initial = agent.instructions();
    expect(initial).toContain("気の置けない友達");
    expect(initial).toContain("同意が必要な追加聞き取り");
    expect(initial).toContain("最近ハマっていることって何？");
    expect(initial).toContain("推測したり、宣言外・機微な情報を聞いたりしない");

    agent.updateContext({
      verified: {},
      pending: {},
      missing: [],
      violations: [],
      intake: {
        status: "active",
        purpose: "次回の会話を相手の関心に合わせる",
        maxQuestions: 2,
        askedQuestions: 1,
        pendingField: "next_topic",
        answers: [{ key: "current_interest", label: "最近の関心", value: "料理", utteranceId: "u1", transcript: "料理", t: 1000 }],
        declined: [],
      },
    });
    expect(agent.instructions()).toContain('"key":"current_interest","value":"料理"');
    expect(agent.instructions()).toContain("next_topic");
  });

  it("sends Live mission updates with the current append envelope", () => {
    const contract = defineCall({
      goal: "chat.casual",
      language: "ja",
      input: { topic: "最近ハマっていること" },
      permissions: { ask: true },
      intake: {
        purpose: "次回の会話を相手の関心に合わせる",
        consentPrompt: "2点だけ聞いてもいい？",
        fields: [{ key: "current_interest", label: "最近の関心", question: "最近ハマっていることって何？" }],
        maxQuestions: 1,
      },
    });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      ws: { readyState: number; send: (raw: string) => void };
      updateContext: (view: Parameters<OpenAILiveAgent["updateContext"]>[0]) => void;
    };
    const sent: Record<string, unknown>[] = [];
    agent.started = true;
    agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
    agent.updateContext({ verified: {}, pending: {}, missing: [], violations: [], intake: { status: "not_started", purpose: "次回の会話を相手の関心に合わせる", maxQuestions: 1, askedQuestions: 0, answers: [], declined: [] } });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((message) => message.type === "session.instructions.append")).toBe(true);
    expect(sent.every((message) => message.delegation_id === null)).toBe(true);
    expect(sent.every((message) => typeof message.content === "string" && (message.content as string).length <= 500)).toBe(true);
    expect(sent.every((message) => !Object.hasOwn(message, "instructions"))).toBe(true);
    expect(new Set(sent.map((message) => message.event_id)).size).toBe(sent.length);
  });

  it("instructs the live model to delegate current-fact lookups", () => {
    const contract = defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } });
    const instructions = new OpenAILiveAgent({ contract }).instructions();
    expect(instructions).toContain("web_search");
    expect(instructions).toContain("ちょっと待って、今調べるね");
    expect(instructions).not.toContain("実際にはできないこと（調べる");
  });

  it("registers web search in the real Live Responses delegation config", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as { port: number }).port;
    let start: Record<string, unknown> | undefined;
    wss.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (message.type !== "session.start") return;
        start = message;
        socket.send(JSON.stringify({ type: "session.started" }));
      });
    });
    const agent = new OpenAILiveAgent({
      contract: defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } }),
      apiKey: "test",
      url: `ws://127.0.0.1:${port}`,
    });
    await agent.connect({ sendAudio: () => undefined, clearAudio: () => undefined, emit: () => undefined, now: () => 0 });
    const session = start?.session as { delegation?: { type?: string; responses?: { tools?: Array<Record<string, unknown>> } } } | undefined;
    expect(session?.delegation?.type).toBe("responses");
    expect(session?.delegation?.responses?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: "web_search" })]));
    expect((start?.session as { audio?: { format?: { type?: string; rate?: number } } }).audio?.format).toEqual({ type: "audio/pcm", rate: 24000 });
    agent.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("clears queued speech and records a barge-in when the callee starts talking", () => {
    const contract = defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      bridge: { sendAudio: (audio: Uint8Array) => void; clearAudio: () => void; emit: (event: unknown) => void; now: () => number };
      ws: { readyState: number; send: (raw: string) => void };
      onMessage: (message: Record<string, unknown>) => void;
      flushIn: () => void;
      flushOut: () => void;
    };
    const sent: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    let clears = 0;
    let sentAudio = 0;
    agent.started = true;
    agent.bridge = { sendAudio: () => { sentAudio++; }, clearAudio: () => { clears++; }, emit: (event) => events.push(event as Record<string, unknown>), now: () => 1000 };
    agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
    const audio = pcm24kSine();
    agent.onMessage({ type: "session.output_audio.delta", delta: audio });
    agent.onMessage({ type: "session.output_transcript.delta", delta: "うん、調べるね" });
    expect(sentAudio).toBe(1);
    agent.onMessage({ type: "session.input_transcript.delta", delta: "調べて" });
    agent.onMessage({ type: "session.output_audio.delta", delta: audio });

    expect(clears).toBe(1);
    expect(sentAudio).toBe(1);
    expect(sent).toContainEqual(expect.objectContaining({
      type: "session.instructions.append",
      delegation_id: null,
      content: expect.stringContaining("Stop speaking immediately"),
    }));
    expect(events).toContainEqual({ type: "speech.started", startMs: 1000 });
    expect(events).toContainEqual({ type: "interruption", atMs: 1000 });

    agent.flushIn();
    agent.flushOut();
    expect(events).toContainEqual(expect.objectContaining({ type: "agent.speech", interrupted: true }));
  });

  it("does not discard audio when the output transcript arrives before output audio", () => {
    const contract = defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      bridge: { sendAudio: (audio: Uint8Array) => void; clearAudio: () => void; emit: (event: unknown) => void; now: () => number };
      ws: { readyState: number; send: (raw: string) => void };
      onMessage: (message: Record<string, unknown>) => void;
    };
    const sent: Record<string, unknown>[] = [];
    let audio = 0;
    let clears = 0;
    agent.started = true;
    agent.bridge = { sendAudio: () => { audio++; }, clearAudio: () => { clears++; }, emit: () => undefined, now: () => 1000 };
    agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
    const silent = Buffer.alloc(960, 0).toString("base64");
    const audible = pcm24kSine();
    agent.onMessage({ type: "session.output_transcript.delta", delta: "もしもし" });
    agent.onMessage({ type: "session.input_transcript.delta", delta: "はい" });
    agent.onMessage({ type: "session.output_audio.delta", delta: silent });
    agent.onMessage({ type: "session.output_audio.delta", delta: audible });
    expect(audio).toBe(2);
    expect(clears).toBe(0);
    expect(sent.some((message) => message.type === "session.instructions.append")).toBe(false);
  });

  it("converts Twilio μ-law input to the Live PCM24K format", () => {
    const contract = defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      ws: { readyState: number; send: (raw: string) => void };
      pushAudio: (audio: Uint8Array) => void;
    };
    const sent: Record<string, unknown>[] = [];
    agent.started = true;
    agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
    agent.pushAudio(new Uint8Array(160).fill(0xff));
    const append = sent[0] as { type: string; audio: string };
    expect(append.type).toBe("session.input_audio.append");
    expect(Buffer.from(append.audio, "base64").length).toBe(960);
  });

  it("converts Live PCM24K output to audible μ-law for the carrier", () => {
    const contract = defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      bridge: { sendAudio: (audio: Uint8Array) => void; clearAudio: () => void; emit: (event: unknown) => void; now: () => number };
      onMessage: (message: Record<string, unknown>) => void;
    };
    let received: Uint8Array | undefined;
    agent.started = true;
    agent.bridge = { sendAudio: (audio) => { received = audio; }, clearAudio: () => undefined, emit: () => undefined, now: () => 1000 };
    agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });
    expect(received).toBeDefined();
    expect(received!.length).toBe(160);
    const peak = Math.max(...Array.from(received!).map((byte) => Math.abs(mulawDecodeSample(byte))));
    expect(peak).toBeGreaterThan(1000);
  });
});
