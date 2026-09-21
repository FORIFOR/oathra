import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall } from "@oathra/contract";
import { OpenAILiveAgent } from "./live.js";
import { mulawDecodeSample } from "@oathra/audio-kit";

function pcm24kSine(): string {
  const pcm = new Int16Array(480);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000);
  return Buffer.from(pcm.buffer).toString("base64");
}

const SILENT = new Uint8Array(160).fill(0xff);
// 0x00 is the loudest μ-law sample: a clearly voiced 20 ms carrier frame.
const VOICED = new Uint8Array(160).fill(0x00);

function harness(goal: string) {
  const contract = defineCall({ goal, language: "ja", input: { request: "近況を聞いてください。" }, permissions: { ask: true } });
  const agent = new OpenAILiveAgent({ contract, newsSearch: false }) as unknown as {
    started: boolean;
    bridge: { sendAudio: (audio: Uint8Array) => void; clearAudio: () => void; emit: (event: unknown) => void; now: () => number };
    ws: { readyState: number; send: (raw: string) => void };
    onMessage: (message: Record<string, unknown>) => void;
    pushAudio: (mulaw: Uint8Array) => void;
    flushIn: () => void;
    flushOut: () => void;
  };
  const state = { now: 1000, clears: 0, audio: 0 };
  const sent: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  agent.started = true;
  agent.bridge = { sendAudio: () => { state.audio++; }, clearAudio: () => { state.clears++; }, emit: (event) => events.push(event as Record<string, unknown>), now: () => state.now };
  agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
  return {
    agent, sent, events,
    get clears() { return state.clears; },
    sentAudio: () => state.audio,
    /** Moves the call clock and the repair timer together, in the timer's own steps. */
    advance(ms: number) { for (let t = 0; t < ms; t += 250) { state.now += 250; vi.advanceTimersByTime(250); } },
  };
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

  it("keeps a reviewed phone request's changed offer as unconfirmed state during the call", () => {
    const contract = defineCall({ goal: "phone.message", language: "ja", input: { request: "9月25日19時に2名の空席を確認してください。予約はしないでください。" }, permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      ws: { readyState: number; send: (raw: string) => void };
      updateContext: (view: Parameters<OpenAILiveAgent["updateContext"]>[0]) => void;
    };
    const sent: { type: string; content: string }[] = [];
    agent.started = true;
    agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as { type: string; content: string }) };
    agent.updateContext({ verified: { date: "2026-09-25", partySize: 2 }, pending: { time: "19:30" }, missing: [], violations: [] });
    const update = sent.map((message) => message.content).join("\n");
    // Plain state must never cut the reply in progress: it is context, not an instruction.
    expect(sent.every((message) => message.type === "session.thinking.append" && message.content.length <= 500)).toBe(true);
    expect(update).toContain('verified={"date":"2026-09-25","partySize":2}');
    expect(update).toContain('pending={"time":"19:30"}');
    expect(update).toContain("予約成立そのものではありません");
    expect(update).toContain("勝手に承諾しないでください");
  });

  it("never appends mission state while a reply is being generated, and skips unchanged state", async () => {
    const contract = defineCall({ goal: "phone.message", language: "ja", input: { request: "近況を聞いてください。", conversationMode: "chat" }, permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract, segmentGapMs: 20, newsSearch: false }) as unknown as {
      started: boolean;
      bridge: { sendAudio: (b: Uint8Array) => void; clearAudio: () => void; emit: (e: { type: string; text?: string }) => void; now: () => number };
      ws: { readyState: number; send: (raw: string) => void };
      onMessage: (message: Record<string, unknown>) => void;
      updateContext: (view: Parameters<OpenAILiveAgent["updateContext"]>[0]) => void;
    };
    const sent: { type: string; content?: string }[] = [];
    const events: { type: string; text?: string }[] = [];
    agent.started = true;
    agent.bridge = { sendAudio: () => {}, clearAudio: () => {}, emit: (e) => events.push(e), now: () => Date.now() };
    agent.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw) as { type: string; content?: string }) };
    const appends = () => sent.filter((message) => message.type === "session.thinking.append");
    const view = (pending: Record<string, unknown>) => ({ verified: {}, pending, missing: [], violations: [] });

    agent.updateContext(view({}));
    const first = appends().length;
    expect(first).toBeGreaterThan(0);
    agent.updateContext(view({}));
    expect(appends()).toHaveLength(first);

    // Live is already answering when the runtime reports the callee's finished turn.
    const voiced = new Int16Array(480).fill(4000);
    agent.onMessage({ type: "session.output_audio.delta", delta: Buffer.from(voiced.buffer).toString("base64") });
    agent.onMessage({ type: "session.output_transcript.delta", delta: "うん、少し確認しますね。" });
    agent.updateContext(view({ time: "19:00" }));
    agent.updateContext(view({ time: "19:30" }));
    expect(appends()).toHaveLength(first);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events.find((e) => e.type === "agent.speech")?.text).toBe("うん、少し確認しますね。");
    const later = appends().slice(first).map((message) => message.content).join("\n");
    expect(later).toContain('pending={"time":"19:30"}');
    expect(later).not.toContain("19:00");
  });

  it("keeps the words being spoken when the line is closed locally", () => {
    const contract = defineCall({ goal: "phone.message", language: "ja", input: { request: "近況を聞いてください。" }, permissions: { ask: true } });
    const agent = new OpenAILiveAgent({ contract }) as unknown as {
      started: boolean;
      bridge: { sendAudio: (b: Uint8Array) => void; clearAudio: () => void; emit: (e: { type: string; text?: string }) => void; now: () => number };
      ws: { readyState: number; send: (raw: string) => void; close: () => void };
      onMessage: (message: Record<string, unknown>) => void;
      close: () => void;
    };
    const events: { type: string; text?: string }[] = [];
    agent.started = true;
    agent.bridge = { sendAudio: () => {}, clearAudio: () => {}, emit: (e) => events.push(e), now: () => 1000 };
    agent.ws = { readyState: 1, send: () => {}, close: () => {} };
    agent.onMessage({ type: "session.input_transcript.delta", delta: "今日のニュース教えて" });
    agent.onMessage({ type: "session.output_transcript.delta", delta: "確認できたよ。" });
    agent.close();
    expect(events.filter((e) => e.type === "speech").map((e) => e.text)).toEqual(["今日のニュース教えて"]);
    expect(events.filter((e) => e.type === "agent.speech").map((e) => e.text)).toEqual(["確認できたよ。"]);
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

  it("keeps talking through a listening sound: nothing is cleared, dropped or instructed", () => {
    const h = harness("chat.casual");
    for (let i = 0; i < 20; i++) h.agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });
    h.agent.onMessage({ type: "session.output_transcript.delta", delta: "それでね、昨日の話なんだけど" });
    h.agent.pushAudio(VOICED);
    h.agent.onMessage({ type: "session.input_transcript.delta", delta: "うん" });
    h.agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });

    expect(h.clears).toBe(0);
    expect(h.sentAudio()).toBe(21);
    expect(h.sent.filter((message) => message.type === "session.instructions.append")).toEqual([]);
    expect(h.events.some((event) => event.type === "interruption")).toBe(false);
    h.agent.flushIn();
    h.agent.flushOut();
    expect(h.events).toContainEqual(expect.objectContaining({ type: "speech", text: "うん" }));
    expect(h.events.find((event) => event.type === "agent.speech")).not.toHaveProperty("interrupted");
  });

  it("yields to a real interruption: drops only the carrier's buffered reply and lets Live decide the rest", () => {
    const h = harness("chat.casual");
    for (let i = 0; i < 20; i++) h.agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });
    h.agent.onMessage({ type: "session.output_transcript.delta", delta: "日曜日の十時に" });
    h.agent.pushAudio(VOICED);
    h.agent.onMessage({ type: "session.input_transcript.delta", delta: "あ、" });
    expect(h.clears).toBe(0);
    h.agent.onMessage({ type: "session.input_transcript.delta", delta: "違う。土曜日で" });
    h.agent.onMessage({ type: "session.input_transcript.delta", delta: "お願いします" });

    expect(h.clears).toBe(1);
    expect(h.events.filter((event) => event.type === "interruption")).toEqual([{ type: "interruption", atMs: 1000 }]);
    // No "stop speaking" command: an instruction would itself cut whatever Live says next.
    expect(h.sent.filter((message) => message.type === "session.instructions.append")).toEqual([]);
    // Whatever Live sends after yielding is its new reply and must reach the line.
    h.agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });
    expect(h.sentAudio()).toBe(21);
    h.agent.flushIn();
    h.agent.flushOut();
    expect(h.events).toContainEqual(expect.objectContaining({ type: "agent.speech", interrupted: true }));
  });

  it("does not mistake a hello spoken before the agent started for an interruption of the agent", () => {
    const h = harness("phone.message");
    // The callee's words ended before any agent audio; their transcript arrives late, during the greeting.
    h.agent.pushAudio(VOICED);
    for (let i = 0; i < 20; i++) h.agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });
    h.agent.onMessage({ type: "session.output_transcript.delta", delta: "もしもし、AIによる代理のお電話です。" });
    h.agent.onMessage({ type: "session.input_transcript.delta", delta: "もしもし" });
    expect(h.clears).toBe(0);
    expect(h.events.some((event) => event.type === "interruption")).toBe(false);
    h.agent.flushIn();
    h.agent.flushOut();
    expect(h.events.find((event) => event.type === "agent.speech")).not.toHaveProperty("interrupted");
  });

  describe("opening the call", () => {
    afterEach(() => vi.useRealTimers());
    const spoken = (h: ReturnType<typeof harness>) => h.sent.filter((message) => message.type === "session.commentary.append") as { content: string; event_id: string; delegation_id: null }[];

    it("speaks first in every kind of call, once, after input audio is already flowing", () => {
      vi.useFakeTimers();
      const h = harness("phone.message");
      h.agent.pushAudio(SILENT);
      // Context is applied on the audio timeline: nothing is sent ahead of the audio.
      expect(h.sent.map((message) => message.type)).toEqual(["session.input_audio.append"]);
      for (let i = 0; i < 30; i++) h.agent.pushAudio(SILENT);
      vi.advanceTimersByTime(600);
      for (let i = 0; i < 30; i++) h.agent.pushAudio(SILENT);
      vi.advanceTimersByTime(5000);
      expect(spoken(h)).toHaveLength(1);
      expect(spoken(h)[0]).toMatchObject({ delegation_id: null, content: expect.stringContaining("もしもし") });
      expect(spoken(h)[0]!.content).toContain("AIによる代理");
      // An instruction is accepted but does not make Live speak; it must not be used to open.
      expect(h.sent.filter((message) => message.type === "session.instructions.append")).toEqual([]);
      expect(h.sent.filter((message) => message.type === "session.input_audio.append")).toHaveLength(61);

      const shop = harness("restaurant.reservation");
      shop.agent.pushAudio(SILENT);
      vi.advanceTimersByTime(600);
      expect(spoken(shop)[0]!.content).toContain("お忙しいところ失礼いたします");
      const friend = harness("chat.casual");
      friend.agent.pushAudio(SILENT);
      vi.advanceTimersByTime(600);
      expect(spoken(friend)[0]!.content).toBe("もしもし？");
    });

    it("never drops the AI disclosure: answered into a conversation, it waits for the first quiet moment and says it once", () => {
      vi.useFakeTimers();
      const h = harness("phone.message");
      h.agent.pushAudio(SILENT);
      // People are already talking when the line connects, and keep talking for three seconds.
      for (let t = 0; t < 3000; t += 250) { h.agent.pushAudio(VOICED); h.advance(250); }
      expect(spoken(h)).toEqual([]);
      h.advance(1500);
      expect(spoken(h)).toHaveLength(1);
      expect(spoken(h)[0]!.content).toContain("AIによる代理のお電話です");
      h.advance(10000);
      expect(spoken(h)).toHaveLength(1);
    });

    it("lets a shop's greeting or a voicemail announcement go first, and can be turned off", () => {
      vi.useFakeTimers();
      const answered = harness("restaurant.reservation");
      answered.agent.pushAudio(SILENT);
      answered.agent.pushAudio(VOICED);
      vi.advanceTimersByTime(5000);
      expect(spoken(answered)).toEqual([]);

      const quiet = new OpenAILiveAgent({ contract: defineCall({ goal: "chat.casual", language: "ja", permissions: { ask: true } }), greetFirst: false }) as unknown as { started: boolean; ws: unknown; pushAudio: (b: Uint8Array) => void };
      const sent: Record<string, unknown>[] = [];
      quiet.started = true;
      quiet.ws = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
      quiet.pushAudio(SILENT);
      vi.advanceTimersByTime(5000);
      expect(sent.map((message) => message.type)).toEqual(["session.input_audio.append"]);
    });
  });

  it("keeps one halting sentence as one turn while the callee's voice is still on the line", () => {
    vi.useFakeTimers();
    try {
      const h = harness("phone.message");
      const say = (delta: string) => { h.agent.pushAudio(VOICED); h.agent.onMessage({ type: "session.input_transcript.delta", delta }); };
      // Deltas arrive more than a gap apart, but the line is never quiet for a whole gap in between.
      say("いや、今日");
      for (let i = 0; i < 3; i++) { h.advance(500); h.agent.pushAudio(VOICED); }
      say("の東京のイベント情報");
      for (let i = 0; i < 3; i++) { h.advance(500); h.agent.pushAudio(VOICED); }
      say("とか、台風の最新情報を教えて");
      expect(h.events.filter((event) => event.type === "speech")).toEqual([]);
      h.advance(1000);
      expect(h.events.filter((event) => event.type === "speech").map((event) => event.text)).toEqual(["いや、今日の東京のイベント情報とか、台風の最新情報を教えて"]);
    } finally { vi.useRealTimers(); }
  });

  it("says it is still checking when a lookup runs long, never over the callee and not twice in a row", () => {
    vi.useFakeTimers();
    try {
      const pending = () => new Promise<never>(() => {});
      const contract = defineCall({ goal: "phone.message", language: "ja", input: { request: "雑談", conversationMode: "chat" }, permissions: { ask: true } });
      const make = () => {
        const agent = new OpenAILiveAgent({ contract, newsSearch: pending, greetFirst: false }) as unknown as { started: boolean; bridge: unknown; ws: unknown; onMessage: (m: Record<string, unknown>) => void; pushAudio: (b: Uint8Array) => void };
        const sent: Record<string, unknown>[] = [];
        const state = { now: 1000 };
        agent.started = true;
        agent.bridge = { sendAudio: () => {}, clearAudio: () => {}, emit: () => {}, now: () => state.now };
        agent.ws = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
        const lookup = (id: string) => agent.onMessage({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", name: "lookup_news", call_id: id, arguments: JSON.stringify({ topic: "weather" }) } } });
        const fillers = () => sent.filter((message) => String(message.event_id ?? "").startsWith("lookup_wait_"));
        const advance = (ms: number) => { state.now += ms; vi.advanceTimersByTime(ms); };
        return { agent, lookup, fillers, advance };
      };
      const quiet = make();
      quiet.lookup("a");
      quiet.advance(4900);
      expect(quiet.fillers()).toHaveLength(0);
      quiet.advance(200);
      expect(quiet.fillers()).toHaveLength(1);
      expect(quiet.fillers()[0]).toMatchObject({ type: "session.commentary.append", delegation_id: null, content: expect.stringContaining("確認している") });
      quiet.lookup("b");
      quiet.advance(5200);
      expect(quiet.fillers()).toHaveLength(1);

      const talking = make();
      talking.lookup("a");
      talking.advance(4800);
      talking.agent.pushAudio(VOICED);
      talking.advance(400);
      expect(talking.fillers()).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it("hangs up promptly when asked to, whichever side says goodbye first", () => {
    vi.useFakeTimers();
    try {
      const h = harness("phone.message");
      h.agent.onMessage({ type: "session.input_transcript.delta", delta: "あの電話切って" });
      h.agent.flushIn();
      h.agent.onMessage({ type: "session.output_transcript.delta", delta: "うん、オッケー、切るねー。またね。" });
      h.agent.flushOut();
      vi.advanceTimersByTime(1400);
      expect(h.events.some((event) => event.type === "hangup")).toBe(false);
      vi.advanceTimersByTime(200);
      expect(h.events.filter((event) => event.type === "hangup")).toEqual([{ type: "hangup", reason: "agent_hangup" }]);

      const late = harness("phone.message");
      late.agent.onMessage({ type: "session.output_transcript.delta", delta: "今日はありがとう。またね。" });
      late.agent.flushOut();
      late.agent.onMessage({ type: "session.input_transcript.delta", delta: "うん、またね" });
      late.agent.flushIn();
      vi.advanceTimersByTime(1600);
      expect(late.events.filter((event) => event.type === "hangup")).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  describe("conversation repair after an overlap", () => {
    afterEach(() => vi.useRealTimers());
    const collide = (h: ReturnType<typeof harness>, said: string) => {
      for (let i = 0; i < 10; i++) h.agent.onMessage({ type: "session.output_audio.delta", delta: pcm24kSine() });
      h.agent.pushAudio(VOICED);
      h.agent.onMessage({ type: "session.input_transcript.delta", delta: said });
      h.agent.flushIn();
    };
    const repairs = (h: ReturnType<typeof harness>) => h.sent.filter((message) => String(message.event_id ?? "").startsWith("repair_overlap_"));

    it("offers the floor once when both sides stay silent, and not again for the same overlap", () => {
      vi.useFakeTimers();
      const h = harness("chat.casual");
      collide(h, "あ");
      h.advance(1000);
      expect(repairs(h)).toHaveLength(0);
      h.advance(1000);
      expect(repairs(h)).toHaveLength(1);
      expect(repairs(h)[0]).toMatchObject({ type: "session.instructions.append", delegation_id: null, content: expect.stringContaining("一度だけ") });
      h.advance(8000);
      expect(repairs(h)).toHaveLength(1);
    });

    it("stays out of the way when the callee resumes, asked for time, or a lookup is pending", () => {
      vi.useFakeTimers();
      const resumed = harness("chat.casual");
      collide(resumed, "あ");
      resumed.advance(800);
      resumed.agent.pushAudio(VOICED);
      resumed.advance(5000);
      expect(repairs(resumed)).toHaveLength(0);

      const thinking = harness("chat.casual");
      collide(thinking, "ちょっと待って、考えます");
      thinking.advance(9000);
      expect(repairs(thinking)).toHaveLength(0);

      const working = harness("chat.casual");
      (working.agent as unknown as { newsControllers: Set<AbortController> }).newsControllers.add(new AbortController());
      collide(working, "あ");
      working.advance(7000);
      expect(repairs(working)).toHaveLength(0);
    });
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
    const append = sent.find((message) => message.type === "session.input_audio.append") as { type: string; audio: string };
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
