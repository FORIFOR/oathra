import { phoneMemory } from "@oathra/core";
import { describe, expect, it } from "vitest";
import { defineCall, preparePhoneRequest, renderIntakeConsentPrompt, type CallContract } from "@oathra/contract";
import type { BrainContext, BrainProvider, BrainResponse, CallSession, MissionView, PermissionGate, SessionEvent, SpeakInput, SpeakResult, TransportProvider } from "@oathra/core";
import { CallRuntime, runCall, VOICEMAIL_RE } from "./index.js";

// The runtime sits below the simulator in the dependency order, so these tests
// drive it with local fakes instead of importing a provider.

class Queue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;
  push(item: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

type Reply = string | SessionEvent | SessionEvent[] | "hangup";

/** A far end that answers each agent line with the next scripted reply. */
class FakeSession implements CallSession {
  readonly queue = new Queue<SessionEvent>();
  readonly events: AsyncIterable<SessionEvent> = this.queue;
  readonly spoken: string[] = [];
  readonly hangups: Array<string | undefined> = [];
  readonly contexts: MissionView[] = [];
  readonly resolved: Array<{ action: string; approved: boolean }> = [];
  interrupts = 0;
  acks = 0;
  private clock = 0;

  constructor(private readonly replies: Reply[], private readonly withAck = false) {
    if (withAck) this.ack = () => void this.acks++;
  }

  ack?: () => void;

  now(): number {
    return this.clock;
  }

  say(text: string): void {
    const startMs = this.clock + 100;
    this.clock = startMs + 900;
    this.queue.push({ type: "speech", text, startMs, endMs: this.clock });
  }

  private deliver(reply: Reply | undefined): void {
    if (reply === undefined) return;
    if (reply === "hangup") {
      this.queue.push({ type: "hangup" });
      this.queue.close();
    } else if (typeof reply === "string") this.say(reply);
    else for (const ev of Array.isArray(reply) ? reply : [reply]) this.queue.push(ev);
  }

  async speak(input: SpeakInput): Promise<SpeakResult> {
    this.spoken.push(input.text);
    const startMs = this.clock + 80;
    this.clock = startMs + 1000;
    this.deliver(this.replies.shift());
    return { startMs, endMs: this.clock, interrupted: false };
  }

  updateContext(view: MissionView): void {
    this.contexts.push(view);
  }

  resolveAction(action: string, approved: boolean): void {
    this.resolved.push({ action, approved });
  }

  interrupt(): void {
    this.interrupts++;
  }

  async hangup(reason?: string): Promise<void> {
    this.hangups.push(reason);
    this.queue.close();
  }
}

function fakeTransport(session: FakeSession, first: Reply | undefined, opts: { speaksItself?: boolean } = {}): TransportProvider {
  return {
    name: "fake",
    kind: "simulator",
    deliversText: true,
    ...(opts.speaksItself ? { speaksItself: true } : {}),
    connect: async () => {
      session.queue.push({ type: "connected", callee: "テスト店" });
      if (first === "hangup") {
        session.queue.push({ type: "hangup" });
        session.queue.close();
      } else if (typeof first === "string") session.say(first);
      else if (first) for (const ev of Array.isArray(first) ? first : [first]) session.queue.push(ev);
      return session;
    },
  };
}

class ScriptBrain implements BrainProvider {
  readonly name = "script";
  readonly contexts: BrainContext[] = [];
  constructor(private readonly lines: Array<string | BrainResponse>) {}
  async respond(ctx: BrainContext): Promise<BrainResponse> {
    this.contexts.push(ctx);
    const next = this.lines.shift() ?? { text: "失礼いたします。", action: "hangup" as const };
    return typeof next === "string" ? { text: next } : next;
  }
}

const NOW = new Date("2026-09-11T10:00:00+09:00");

const reservation = (over: Partial<Parameters<typeof defineCall>[0]> = {}): CallContract =>
  defineCall({
    goal: "restaurant.reservation",
    language: "ja",
    require: { date: true, time: true, partySize: true, confirmed: true },
    constraints: { date: { eq: "2026-09-12" }, time: { gte: "19:00" }, partySize: { eq: 2 } },
    permissions: { ask: true, reserve: true, payment: false },
    ...over,
  });

const types = (events: readonly { type: string }[]) => events.map((e) => e.type);

describe("CallRuntime: completion comes from callee evidence", () => {
  it("completes a negotiated reservation and records the whole call", async () => {
    const session = new FakeSession([
      "申し訳ございません、19時は満席です。19時半なら空いております。",
      "はい、9月12日の19時半に2名様でご予約承りました。",
      "hangup",
    ]);
    const brain = new ScriptBrain([
      "9月12日の19時以降で2名、予約をお願いします。",
      "では19時半でお願いします。",
      { text: "ありがとうございます。失礼いたします。", action: "hangup" },
    ]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "お電話ありがとうございます、テスト店です。"), brain, now: NOW, callId: "call_test" });

    expect(out.callId).toBe("call_test");
    expect(out.result.status).toBe("completed");
    expect(out.result.fields).toMatchObject({ date: "2026-09-12", time: "19:30", partySize: 2, confirmed: true });
    expect(out.endReason).toBe("agent_hangup");
    expect(out.metrics).toMatchObject({ agentTurns: 3, calleeTurns: 3, turns: 6 });
    expect(out.metrics.verifiedCount).toBeGreaterThan(0);
    expect(out.traces).toHaveLength(3);
    expect(out.traces.every((t) => t.ttfaMs !== undefined && t.ttfaMs >= 0)).toBe(true);

    const seen = types(out.events);
    expect(seen[0]).toBe("call.started");
    expect(seen.slice(-2)).toEqual(["call.ended", "result"]);
    expect(seen).toContain("call.connected");
    expect(seen).toContain("evidence.verified");
    // The brain only ever sees the callee's pending offers, never its own proposals.
    expect(brain.contexts[1]!.mission.pending).toMatchObject({ time: "19:30" });
  });

  it("does not complete when only the agent says the booking is done", async () => {
    const session = new FakeSession(["確認いたしますので、少々お待ちください。", "hangup"]);
    const brain = new ScriptBrain([
      "9月12日の19時に2名で予約をお願いします。",
      { text: "9月12日の19時に2名で予約できました。ありがとうございます。", action: "hangup" },
    ]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW });

    expect(out.result.status).not.toBe("completed");
    expect(out.result.fields.confirmed).toBeUndefined();
    expect(out.endReason).toBe("agent_hangup");
  });

  it("reports a failed connection without throwing", async () => {
    const transport: TransportProvider = { name: "down", kind: "sip", deliversText: true, connect: async () => Promise.reject(new Error("carrier unreachable")) };
    const out = await runCall({ contract: reservation(), transport, brain: new ScriptBrain([]), now: NOW });

    expect(out.endReason).toBe("error");
    expect(out.result.status).not.toBe("completed");
    expect(out.events.find((e) => e.type === "error")).toMatchObject({ message: "carrier unreachable", fatal: true });
    expect(types(out.events).slice(-2)).toEqual(["call.ended", "result"]);
  });
});

describe("CallRuntime: how calls end", () => {
  it("hangs up on voicemail before the brain is ever asked", async () => {
    const session = new FakeSession([]);
    const brain = new ScriptBrain(["使われないはずの台詞"]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "ただいま電話に出ることができません。発信音の後にメッセージをどうぞ。"), brain, now: NOW });

    expect(out.endReason).toBe("voicemail");
    expect(session.hangups[0]).toBe("voicemail");
    expect(brain.contexts).toHaveLength(0);
    expect(session.spoken).toHaveLength(0);
    expect(out.transcript).toHaveLength(1);
    expect(out.result.status).not.toBe("completed");
  });

  it("recognises Japanese and English voicemail prompts, but not a normal greeting", () => {
    expect(VOICEMAIL_RE.test("留守番電話サービスに接続します")).toBe(true);
    expect(VOICEMAIL_RE.test("Please leave a message after the tone.")).toBe(true);
    expect(VOICEMAIL_RE.test("お電話ありがとうございます、テスト店です。")).toBe(false);
  });

  it("stops at the turn budget", async () => {
    const session = new FakeSession(["はい。", "はい。", "はい。", "はい。"]);
    const brain = new ScriptBrain(["一つ目の質問です。", "二つ目の質問です。", "三つ目の質問です。", "四つ目の質問です。"]);
    const contract = reservation({ budget: { maxTurns: 2 } as never });
    const out = await runCall({ contract, transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW });

    expect(out.endReason).toBe("budget_exceeded");
    expect(session.hangups[0]).toBe("budget_exceeded");
    expect(out.metrics.agentTurns).toBe(2);
  });

  it("treats the far end hanging up, or the stream ending, as callee_hangup", async () => {
    const explicit = await runCall({ contract: reservation(), transport: fakeTransport(new FakeSession(["hangup"]), "はい、テスト店です。"), brain: new ScriptBrain(["予約をお願いします。"]), now: NOW });
    expect(explicit.endReason).toBe("callee_hangup");

    const session = new FakeSession([]);
    const transport = fakeTransport(session, undefined);
    const p = runCall({ contract: reservation(), transport, brain: new ScriptBrain([]), now: NOW, openingTimeoutMs: 60_000 });
    setTimeout(() => session.queue.close(), 5);
    expect((await p).endReason).toBe("callee_hangup");
  });

  it("ends on a fatal transport error and keeps going after a recoverable one", async () => {
    const recoverable = new FakeSession([[{ type: "error", message: "stt hiccup", code: "stt_hiccup", fatal: false }, { type: "hangup" }]]);
    const a = await runCall({ contract: reservation(), transport: fakeTransport(recoverable, "はい、テスト店です。"), brain: new ScriptBrain(["予約をお願いします。"]), now: NOW });
    expect(a.endReason).toBe("callee_hangup");
    expect(a.events.find((e) => e.type === "error")).toMatchObject({ fatal: false, code: "stt_hiccup" });

    const fatal = new FakeSession([{ type: "error", message: "media stream lost", code: "media_stream_lost" }]);
    const b = await runCall({ contract: reservation(), transport: fakeTransport(fatal, "はい、テスト店です。"), brain: new ScriptBrain(["予約をお願いします。"]), now: NOW });
    expect(b.endReason).toBe("error");
    expect(b.events.find((e) => e.type === "error")).toMatchObject({ fatal: true, code: "media_stream_lost" });
    expect(b.result.status).not.toBe("completed");
  });

  it("cancel() ends the call as cancelled", async () => {
    const session = new FakeSession([]);
    const runtime = new CallRuntime({ contract: reservation(), transport: fakeTransport(session, undefined), brain: new ScriptBrain([]), now: NOW, openingTimeoutMs: 60_000 });
    const p = runtime.run();
    setTimeout(() => runtime.cancel(), 5);
    const out = await p;

    expect(out.endReason).toBe("cancelled");
    expect(session.interrupts).toBe(1);
    expect(session.hangups).toContain("cancelled");
  });
});

describe("CallRuntime: turn handling", () => {
  it("opens the conversation when the callee stays silent", async () => {
    const session = new FakeSession(["hangup"]);
    const brain = new ScriptBrain(["もしもし、予約のお電話です。"]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, undefined), brain, now: NOW, openingTimeoutMs: 10 });

    expect(session.spoken).toEqual(["もしもし、予約のお電話です。"]);
    expect(out.transcript[0]).toMatchObject({ source: "caller" });
  });

  it("merges utterances that queued up while the agent was busy into one callee turn", async () => {
    const session = new FakeSession([
      [
        { type: "speech", text: "19時は満席です。", startMs: 2000, endMs: 2800 },
        { type: "speech.started", startMs: 2900 },
        { type: "speech", text: "19時半なら空いております。", startMs: 2900, endMs: 3800 },
      ],
      "hangup",
    ]);
    const brain = new ScriptBrain(["9月12日の19時以降で2名、予約をお願いします。", "では19時半でお願いします。"]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW });

    const callee = out.transcript.filter((t) => t.source === "callee");
    expect(callee).toHaveLength(2);
    expect(callee[1]!.text).toBe("19時は満席です。19時半なら空いております。");
    expect(brain.contexts).toHaveLength(2);
  });

  it("asks the brain again instead of saying the same line twice, unless the repeat is deliberate", async () => {
    const session = new FakeSession(["はい？", "hangup"]);
    const brain = new ScriptBrain(["2名で予約をお願いします。", "2名で予約をお願いします。", "2名です。"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW });
    expect(session.spoken).toEqual(["2名で予約をお願いします。", "2名です。"]);
    expect(brain.contexts[2]!.hints?.[0]).toMatch(/Do NOT repeat/);

    const session2 = new FakeSession(["もう一度お願いします。", "hangup"]);
    const brain2 = new ScriptBrain(["2名で予約をお願いします。", { text: "2名で予約をお願いします。", verbatim: true }]);
    await runCall({ contract: reservation(), transport: fakeTransport(session2, "はい、テスト店です。"), brain: brain2, now: NOW });
    expect(session2.spoken).toEqual(["2名で予約をお願いします。", "2名で予約をお願いします。"]);
    expect(brain2.contexts).toHaveLength(2);
  });

  it("falls back to 'can you hear me' only on a voice line", async () => {
    const session = new FakeSession(["はい？", "hangup"], true);
    const brain = new ScriptBrain(["2名で予約をお願いします。", "2名で予約をお願いします。", "2名で予約をお願いします。"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW });
    expect(session.spoken[1]).toBe("もしもし、お声は届いておりますでしょうか？");
  });

  it("acknowledges only after a substantive callee turn", async () => {
    const session = new FakeSession(["はい。", "19時は満席でございます。", "hangup"], true);
    const brain = new ScriptBrain(["予約をお願いします。", "9月12日の19時で2名です。", "承知しました。"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店でございます。"), brain, now: NOW });
    // turn 0 (greeting) and the bare "はい。" get no ack; the full sentence does.
    expect(session.acks).toBe(1);
  });

  it("replaces an empty brain reply with a holding line", async () => {
    const session = new FakeSession(["hangup"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain(["   "]), now: NOW });
    expect(session.spoken).toEqual(["少々お待ちください。"]);
  });
});

describe("CallRuntime: opening notice", () => {
  const NOTICE = "この通話は録音されています。";

  it("is the first thing the agent says, once, whatever the brain returns", async () => {
    const session = new FakeSession(["はい、どうぞ。", "hangup"]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain(["予約をお願いします。", "2名です。"]), now: NOW, openingNotice: NOTICE });
    expect(session.spoken).toEqual([`${NOTICE}予約をお願いします。`, "2名です。"]);
    expect(out.transcript.find((t) => t.source === "caller")!.text.startsWith(NOTICE)).toBe(true);
  });

  it("also comes first when the callee is silent and the agent opens, and with an empty brain reply", async () => {
    const session = new FakeSession(["hangup"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, undefined), brain: new ScriptBrain(["  "]), now: NOW, openingTimeoutMs: 10, openingNotice: NOTICE });
    expect(session.spoken).toEqual([`${NOTICE}少々お待ちください。`]);
  });

  it("does not hide a repeated line from the repeat guard", async () => {
    const session = new FakeSession(["はい？", "hangup"]);
    const brain = new ScriptBrain(["2名で予約をお願いします。", "2名で予約をお願いします。", "2名です。"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW, openingNotice: NOTICE });
    expect(session.spoken).toEqual([`${NOTICE}2名で予約をお願いします。`, "2名です。"]);
  });

  it("is never treated as evidence, and English gets a space after it", async () => {
    const session = new FakeSession(["hangup"]);
    const en = defineCall({ goal: "restaurant.reservation", language: "en", require: { confirmed: true } });
    const out = await runCall({ contract: en, transport: fakeTransport(session, "Hello?"), brain: new ScriptBrain(["Hi, a table for two please."]), now: NOW, openingNotice: "This call is being recorded." });
    expect(session.spoken).toEqual(["This call is being recorded. Hi, a table for two please."]);
    expect(out.result.fields).toEqual({});
  });

  it("is absent unless asked for (carriers that announce it themselves)", async () => {
    const session = new FakeSession(["hangup"]);
    await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain(["予約をお願いします。"]), now: NOW });
    expect(session.spoken).toEqual(["予約をお願いします。"]);
  });
});

describe("CallRuntime: permissions are decided outside the model", () => {
  const payment = { text: "カード番号をお伝えします。", requestedAction: { action: "payment" as const, detail: "deposit ¥5,000" } };

  it("refuses an action the contract does not allow", async () => {
    const session = new FakeSession(["hangup"]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain([payment]), now: NOW });

    expect(session.spoken).toEqual(["申し訳ありません、その点は私の一存ではお答えできません。"]);
    expect(out.events.find((e) => e.type === "permission.decided")).toMatchObject({ action: "payment", approved: false, by: "policy" });
  });

  it("lets a human gate approve it, and skips the gate for pre-authorised actions", async () => {
    const asked: string[] = [];
    const gate: PermissionGate = { ask: async (action) => (asked.push(action), { approved: true, by: "human" }) };
    const session = new FakeSession(["hangup"]);
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain([payment]), permissionGate: gate, now: NOW });
    expect(session.spoken).toEqual(["カード番号をお伝えします。"]);
    expect(asked).toEqual(["payment"]);
    expect(out.events.find((e) => e.type === "permission.decided")).toMatchObject({ approved: true, by: "human" });

    const session2 = new FakeSession(["hangup"]);
    const reserve = { text: "予約を確定してください。", requestedAction: { action: "reserve" as const, detail: "book" } };
    const out2 = await runCall({ contract: reservation(), transport: fakeTransport(session2, "はい、テスト店です。"), brain: new ScriptBrain([reserve]), permissionGate: gate, now: NOW });
    expect(asked).toEqual(["payment"]);
    expect(out2.events.find((e) => e.type === "permission.decided")).toMatchObject({ action: "reserve", approved: true, by: "policy" });
  });
});

describe("CallRuntime: speech-to-speech transports", () => {
  it("records the model's own turns, grounds it in the evidence state, and never runs the brain", async () => {
    const session = new FakeSession([]);
    const brain = new ScriptBrain(["使われないはずの台詞"]);
    const first: SessionEvent[] = [
      { type: "speech", text: "はい、テスト店です。", startMs: 100, endMs: 900 },
      { type: "agent.speech", text: "9月12日の19時に2名で予約をお願いします。", startMs: 1300, endMs: 3000, ttfaMs: 400 },
      { type: "action.requested", action: "payment", detail: "deposit" },
      { type: "interruption", atMs: 3100 },
      { type: "speech", text: "はい、9月12日の19時に2名様でご予約承りました。", startMs: 3200, endMs: 5000 },
      { type: "hangup" },
    ];
    const out = await runCall({ contract: reservation(), transport: fakeTransport(session, first, { speaksItself: true }), brain, now: NOW });

    expect(brain.contexts).toHaveLength(0);
    expect(session.spoken).toHaveLength(0);
    expect(out.transcript.map((t) => t.source)).toEqual(["callee", "caller", "callee"]);
    expect(out.traces[0]).toMatchObject({ ttfaMs: 400, playbackStartMs: 1300, speechEndMs: 900 });
    expect(session.resolved).toEqual([{ action: "payment", approved: false }]);
    expect(session.interrupts).toBe(1);
    expect(session.contexts.length).toBeGreaterThanOrEqual(2);
    expect(session.contexts.at(-1)!.verified).toMatchObject({ confirmed: true });
    expect(out.result.status).toBe("completed");
    expect(out.endReason).toBe("callee_hangup");
  });
});

describe("CallRuntime: consent-gated intake", () => {
  const consentPrompt = "追加で1点だけ伺ってもよろしいでしょうか？";
  const question = "ご来店のきっかけを教えていただけますか？";
  const withIntake = (): CallContract =>
    defineCall({
      goal: "followup",
      language: "ja",
      intake: { purpose: "次回のご案内のため", consentPrompt, fields: [{ key: "source", label: "きっかけ", question }], maxQuestions: 1 },
    });
  const ask = (kind: "consent" | "field"): BrainResponse =>
    kind === "consent" ? { text: consentPrompt, intakeQuestion: { kind: "consent" } } : { text: question, intakeQuestion: { kind: "field", field: "source" } };

  it("stores an explicit answer with the utterance it came from", async () => {
    const session = new FakeSession(["はい、大丈夫です。", "友人の紹介です。", "hangup"]);
    const out = await runCall({ contract: withIntake(), transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain([ask("consent"), ask("field")]), now: NOW });

    expect(out.intake.status).toBe("complete");
    expect(out.intake.consent?.granted).toBe(true);
    expect(out.intake.answers).toHaveLength(1);
    const answer = out.intake.answers[0]!;
    expect(answer).toMatchObject({ key: "source", value: "友人の紹介です。" });
    expect(out.transcript.find((t) => t.id === answer.utteranceId)?.text).toBe("友人の紹介です。");
  });

  it.each([
    ["an ambiguous reply to the consent prompt", ["はい、ですが今は少し…", "hangup"], 1],
    ["a hold instead of an answer", ["はい。", "少々お待ちください。", "hangup"], 2],
    ["time pressure", ["はい。", "すみません、今は急いでいます。", "hangup"], 2],
    ["a question back", ["はい。", "それは何に使うのでしょうか？", "hangup"], 2],
  ])("stops and saves nothing on %s", async (_name, replies, asked) => {
    const session = new FakeSession(replies as Reply[]);
    const brain = new ScriptBrain([ask("consent"), ask("field"), ask("field")]);
    const out = await runCall({ contract: withIntake(), transport: fakeTransport(session, "はい、テスト店です。"), brain, now: NOW });

    expect(out.intake.status).toBe("declined");
    expect(out.intake.answers).toHaveLength(0);
    // Once declined, an optional question never reaches the callee again.
    expect(session.spoken.filter((t) => t === question).length).toBe(asked - 1);
    expect(session.spoken.filter((t) => t === renderIntakeConsentPrompt(withIntake().intake!, "ja"))).toHaveLength(1);
  });

  it("never lets a model start intake while the reservation is unsettled", async () => {
    const contract = defineCall({
      goal: "restaurant.reservation",
      language: "ja",
      require: { date: true, confirmed: true },
      intake: { purpose: "次回のご案内のため", consentPrompt, fields: [{ key: "source", label: "きっかけ", question }], maxQuestions: 1 },
    });
    const session = new FakeSession(["hangup"]);
    const out = await runCall({ contract, transport: fakeTransport(session, "はい、テスト店です。"), brain: new ScriptBrain([ask("field")]), now: NOW });

    expect(session.spoken).toEqual(["恐れ入ります、必要な情報をもう一度確認させてください。"]);
    expect(out.intake.status).toBe("not_started");
    expect(out.intake.askedQuestions).toBe(0);
  });
});

// Bounded interruption fixture: test returned transcripts, not an external phone service.
it.each([true,false])('preserves interrupted readbacks through RunResult and note reconstruction (self-speaking=%s)',async speaksItself=>{
 const session=new FakeSession(['hangup']);
 const speak=session.speak.bind(session);session.speak=async input=>({...await speak(input),interrupted:true});
 const first:SessionEvent[]=[{type:'speech',text:'19時半でしたら空いております。',startMs:0,endMs:100}];
 if(speaksItself)first.push({type:'agent.speech',text:'では、19時半でお願いします。',startMs:120,endMs:200,interrupted:true},{type:'hangup'});
 const out=await runCall({contract:defineCall({goal:'phone.message'}),transport:fakeTransport(session,first,{speaksItself}),brain:new ScriptBrain(['では、19時半でお願いします。']),now:NOW});
 const caller=out.transcript.find(t=>t.source==='caller');expect(caller?.interrupted).toBe(true);
 expect(out.events.find(e=>e.type==='transcript.final'&&e.source==='caller')).toMatchObject({interrupted:true});
 const request=preparePhoneRequest({phone:'+819000000000',name:'条件確認',instruction:'19時の空席を確認'});
 expect(phoneMemory(request,out.transcript,NOW.getTime()).notes.find(n=>n.field==='time')).toMatchObject({value:'19:30',status:'proposed'});
});

describe("audit 2026-09-26: the line is never left open", () => {
  const budget = (maxDurationMs: number) => defineCall({ goal: "restaurant.reservation", language: "ja", require: { date: true, time: true, partySize: true, confirmed: true }, permissions: { ask: true, reserve: true }, budget: { maxTurns: 20, maxDurationMs, maxCostUsd: 1 } });

  it("hangs up when the brain throws mid-call", async () => {
    const contract = budget(30_000);
    const session = new FakeSession([]);
    const transport = fakeTransport(session, "はい、こちらレストランです。");
    const brain: BrainProvider = { name: "broken", respond: async () => { throw new Error("model down"); } };
    const outcome = await runCall({ contract, transport, brain });
    expect(outcome.endReason).toBe("error");
    expect(session.hangups.length).toBeGreaterThan(0);
  });

  it("ends a silent line when the wall-clock budget runs out", async () => {
    // Never yields a callee turn after connecting, so the per-turn budget check would never run.
    const contract = budget(1000);
    const session = new FakeSession([]);
    const transport = fakeTransport(session, undefined, { speaksItself: true });
    const brain: BrainProvider = { name: "quiet", respond: async () => ({ text: "" }) };
    const started = Date.now();
    const outcome = await Promise.race([
      runCall({ contract, transport, brain }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("still open after 5 s")), 5000)),
    ]);
    expect(outcome.endReason).toBe("budget_exceeded");
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
