/**
 * GeminiLiveAgent — one Gemini Live API session per phone call.
 *
 * Carrier audio (μ-law 8 kHz) is upsampled to PCM16 16 kHz for the model; the model's PCM16 24 kHz reply
 * is downsampled and μ-law encoded back to the carrier. Input and output transcriptions become the
 * `speech` / `agent.speech` SessionEvents the evidence engine reads; the model never decides completion.
 *
 * Protocol (BidiGenerateContent over WebSocket): `setup` → `setupComplete`; `realtimeInput.audio` in;
 * `serverContent.modelTurn` / `inputTranscription` / `outputTranscription` / `interrupted` / `turnComplete`
 * out; `toolCall` → `toolResponse`. Mission state goes in as a `clientContent` turn with `turnComplete:
 * false`, which adds context without asking the model to speak.
 */
import WebSocket from "ws";
import type { Action, CallContract } from "@oathra/contract";
import { requiredFields } from "@oathra/contract";
import { bytesToInt16, int16ToBytes, mulawDecode, mulawEncode, StreamResampler } from "@oathra/audio-kit";
import type { MissionView, SessionEvent } from "@oathra/core";
import { callInstructions, DESK_TOOLS, deskTool, GOODBYE_RE, HANGUP_REQUEST_RE, openingLine, type DeskEvent, type ReservationDesk } from "@oathra/voice-kit";
import type { AgentBridge } from "./index.js";

export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.8-live";
/** Prebuilt Live voices. The first is the default; the model picks the language from the audio itself. */
export const GEMINI_LIVE_VOICES = ["Kore", "Aoede", "Leda", "Zephyr", "Puck", "Charon", "Fenrir", "Orus"] as const;
export const DEFAULT_GEMINI_LIVE_VOICE = "Kore";

export type GeminiLiveAgentOptions = {
  contract: CallContract;
  model?: string;
  apiKey?: string;
  voice?: string;
  calleeName?: string;
  /** Persona / style for casual goals ("chat.*"). */
  persona?: string;
  /** Hang up after this much silence from both sides (ms). */
  inactivityMs?: number;
  url?: string;
  /** Silence (ms) that closes a transcript segment. */
  segmentGapMs?: number;
  /** Open the call ourselves once the line is up instead of waiting for the callee (default: true). */
  greetFirst?: boolean;
  /** The restaurant's reservation desk. Only a `phone.reception` contract gets the tools that reach it. */
  desk?: ReservationDesk;
  onDesk?: (event: DeskEvent) => void;
  /** The clock used to read dates back ("あさって"); defaults to the wall clock. */
  today?: () => Date;
};

type Json = Record<string, unknown>;

const IN_RATE = 16000;
const OUT_RATE = 24000;
const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function hasAudiblePcm(pcm: Int16Array, threshold = 256): boolean {
  for (const sample of pcm) if (Math.abs(sample) >= threshold) return true;
  return false;
}

/** Gemini takes OpenAPI-style declarations; the shared tools are written in OpenAI's function shape. */
function functionDeclaration(tool: Json): Json {
  const strip = (schema: unknown): unknown => {
    if (Array.isArray(schema)) return schema.map(strip);
    if (schema && typeof schema === "object") {
      const out: Json = {};
      for (const [k, v] of Object.entries(schema as Json)) if (k !== "additionalProperties") out[k] = strip(v);
      return out;
    }
    return schema;
  };
  return { name: tool.name, description: tool.description, parameters: strip(tool.parameters) };
}

export class GeminiLiveAgent {
  readonly model: string;
  private readonly apiKey: string;
  private readonly voice: string;
  private ws: WebSocket | undefined;
  private bridge: AgentBridge | undefined;
  private started = false;
  private closed = false;
  private view: MissionView | undefined;
  private inText = "";
  private inStartMs: number | undefined;
  private inLastMs = 0;
  private inTimer: NodeJS.Timeout | undefined;
  private outText = "";
  private outStartMs: number | undefined;
  private outLastMs = 0;
  private outAudioStarted = false;
  private outInterrupted = false;
  private lastCalleeEndMs: number | undefined;
  private calleeSaidBye = false;
  private agentSaidByeMs = Number.NEGATIVE_INFINITY;
  private hangingUp = false;
  private readonly gapMs: number;
  private watchdog: NodeJS.Timeout | undefined;
  private carrierActive = false;
  private greeted = false;
  private agentSpoke = false;
  private lastCalleeVoiceMs = 0;
  private playbackEndMs = 0;
  private pendingActions = new Map<string, { name: string; action: Action }>();
  private endRequested: string | undefined;
  private missionDeferred = false;
  private sentMission: string | undefined;
  private readonly said: string[] = [];
  private readonly deskCalls = new Set<string>();
  private readonly toLive = new StreamResampler(8000, IN_RATE);
  private readonly toCarrier = new StreamResampler(OUT_RATE, 8000);
  /** Only a reception contract reaches the desk, whatever options were passed. */
  private get desk(): ReservationDesk | undefined { return this.opts.contract.goal === "phone.reception" ? this.opts.desk : undefined; }

  constructor(private readonly opts: GeminiLiveAgentOptions) {
    this.model = opts.model ?? DEFAULT_GEMINI_LIVE_MODEL;
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.voice = opts.voice ?? DEFAULT_GEMINI_LIVE_VOICE;
    this.gapMs = opts.segmentGapMs ?? 800;
  }

  async connect(bridge: AgentBridge): Promise<void> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey");
    this.bridge = bridge;
    const base = this.opts.url ?? LIVE_URL;
    const ws = new WebSocket(`${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.apiKey)}`);
    this.ws = ws;
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(new Error("Gemini Live: connection timeout")), 15000);
      ws.once("open", () => { clearTimeout(timer); res(); });
      ws.once("error", (e) => { clearTimeout(timer); rej(new Error(`Gemini Live: ${(e as Error).message}`)); });
    });
    ws.on("message", (data) => {
      let msg: Json;
      try { msg = JSON.parse(data.toString()) as Json; } catch { return; }
      this.onMessage(msg);
    });
    ws.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.flushIn();
        this.flushOut();
        this.bridge?.emit({ type: "hangup", reason: "live_closed" });
      }
    });
    ws.on("error", (e) => this.bridge?.emit({ type: "error", message: `Gemini Live: ${(e as Error).message}` }));

    const casual = this.opts.contract.goal.startsWith("chat.");
    const tools: Json[] = [
      { name: "end_call", description: "Hang up the phone. Call this right after saying goodbye, when the other person says goodbye or asks you to hang up, on voicemail, or when the conversation is over.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
    ];
    if (!casual) tools.push({ name: "request_action", description: "Ask for permission before an action outside your permitted list (payment, cancel, share_address, share_phone, modify).", parameters: { type: "object", properties: { action: { type: "string" }, detail: { type: "string" } }, required: ["action", "detail"] } });
    if (this.desk) tools.push(...(DESK_TOOLS as unknown as Json[]).map(functionDeclaration));
    this.send({
      setup: {
        model: `models/${this.model}`,
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } } },
        systemInstruction: { parts: [{ text: this.instructions() }] },
        tools: [{ functionDeclarations: tools }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 700 } },
      },
    });
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(new Error("Gemini Live: setupComplete not received")), 15000);
      const check = setInterval(() => {
        if (this.started) { clearTimeout(timer); clearInterval(check); res(); }
        if (this.closed) { clearTimeout(timer); clearInterval(check); rej(new Error("Gemini Live: closed before setup completed")); }
      }, 20);
    });
  }

  /** What the model is told at session start; mission updates follow through `updateContext`. */
  instructions(): string {
    const c = this.opts.contract;
    return [
      callInstructions({ contract: c, view: this.view, calleeName: this.opts.calleeName, persona: this.opts.persona, webSearch: false, newsAvailable: false }),
      "",
      "## Tools",
      "- end_call: call it right after a goodbye, when the other person says goodbye or asks you to hang up, on voicemail, or when the conversation is over. Never leave the line open.",
      ...(this.desk ? ["- check_table / book_table: the reservation desk. Availability and bookings come only from these; a booking exists only when book_table returns status=booked."] : []),
      ...(c.goal.startsWith("chat.") ? [] : ["- request_action: required before any action outside the permitted list."]),
      "You cannot search the web or look anything up; if asked, say so honestly.",
      "Keep replies short and spoken. Never promise to do something later.",
    ].join("\n");
  }

  pushAudio(mulaw: Uint8Array): void {
    if (!this.started) return;
    const first = !this.carrierActive;
    this.carrierActive = true;
    const pcm8k = mulawDecode(mulaw);
    if (hasAudiblePcm(pcm8k, 1500)) { this.lastCalleeVoiceMs = this.bridge?.now() ?? 0; this.touch(); }
    else if (first) this.touch();
    if (first) setTimeout(() => this.greet(), 600).unref?.();
    const pcm16k = this.toLive.process(pcm8k);
    this.send({ realtimeInput: { audio: { data: Buffer.from(int16ToBytes(pcm16k)).toString("base64"), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
  }

  /** The line is up: open the call ourselves, then listen. Input audio keeps flowing throughout. */
  private greet(attempt = 0): void {
    if (this.greeted || this.closed || this.opts.greetFirst === false) return;
    const now = this.bridge?.now() ?? 0;
    const calleeBusy = (this.lastCalleeVoiceMs > 0 && now - this.lastCalleeVoiceMs < 700) || this.inText !== "";
    const answering = this.opts.contract.goal === "phone.inbound" || this.opts.contract.goal === "phone.reception";
    if (!answering && (calleeBusy || now < this.playbackEndMs)) {
      if (attempt < 100) { setTimeout(() => this.greet(attempt + 1), 300).unref?.(); return; }
    }
    this.greeted = true;
    // The callee already opened (a shop answering with its name): the model answers that turn from its instructions.
    if (this.inText !== "" && this.opts.contract.goal !== "phone.message" && !answering) return;
    const line = openingLine(this.opts.contract, this.agentSpoke);
    const ja = this.opts.contract.language === "ja";
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: ja ? `（電話がつながりました。相手はまだ何も言っていません。次の一言で会話を始めてください: 「${line}」）` : `(The line is connected and the other person has not spoken yet. Open the conversation with: "${line}")` }] }], turnComplete: true } });
  }

  updateContext(view: MissionView): void {
    this.view = view;
    if (!this.started || (this.opts.contract.goal.startsWith("chat.") && !this.opts.contract.intake)) return;
    // Context sent while the model is replying lands mid-turn; hold it until the reply has ended.
    if (this.outAudioStarted || this.outText !== "") { this.missionDeferred = true; return; }
    this.sendMission();
  }

  private sendMission(): void {
    this.missionDeferred = false;
    const v = this.view;
    const c = this.opts.contract;
    const ja = c.language === "ja";
    const lines = [
      ja ? "検証状態の更新（この状態を優先。返答は不要）" : "Authoritative mission state update (context only, do not reply to this)",
      `verified=${JSON.stringify(v?.verified ?? {})}`,
      `pending=${JSON.stringify(v?.pending ?? {})}`,
      `missing=${JSON.stringify(v?.missing ?? requiredFields(c))}`,
      `violations=${JSON.stringify(v?.violations ?? [])}`,
    ];
    if (c.goal === "phone.message") lines.push(ja ? "これは会話から抽出した現在の状態で、予約成立そのものではありません。pendingは相手の提案です。未確認として復唱し、元の希望と違う条件を勝手に承諾しないでください。" : "This is the state extracted from the conversation, not a completed booking. pending holds the other side's offers: read them back as unconfirmed and never accept conditions that differ from the original request on your own.");
    if (c.intake) {
      const intake = v?.intake;
      lines.push(`intake.status=${intake?.status ?? "not_started"}`, `intake.asked=${intake?.askedQuestions ?? 0}/${c.intake.maxQuestions}`, `intake.answers=${JSON.stringify(intake?.answers?.map((a) => ({ key: a.key, value: typeof a.value === "string" ? a.value.slice(0, 120) : a.value })) ?? [])}`, `intake.declined=${JSON.stringify(intake?.declined ?? [])}`, `intake.pending=${intake?.pendingField ?? "none"}`);
    }
    const block = lines.join("\n");
    if (block === this.sentMission) return;
    this.sentMission = block;
    // `turnComplete: false` adds the text to the conversation without asking for a reply.
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: block }] }], turnComplete: false } });
  }

  resolveAction(action: Action, approved: boolean): void {
    for (const [id, p] of this.pendingActions) {
      if (p.action !== action) continue;
      this.pendingActions.delete(id);
      this.send({ toolResponse: { functionResponses: [{ id, name: p.name, response: { approved, note: approved ? "You may proceed." : "Not permitted on this call. Tell the caller you cannot do that." } }] } });
    }
  }

  interrupt(): void {
    // The runtime asks to stop the agent mid-reply (cancel). Gemini yields on its own when the callee speaks.
    this.bridge?.clearAudio();
    this.playbackEndMs = this.bridge?.now() ?? 0;
  }

  /** Every transcript/audio event resets the inactivity watchdog. */
  private touch(): void {
    if (!this.carrierActive) return;
    if (this.watchdog) clearTimeout(this.watchdog);
    const limit = this.opts.inactivityMs ?? 25000;
    this.watchdog = setTimeout(() => { if (!this.closed) this.bridge?.emit({ type: "hangup", reason: "inactivity" }); }, limit);
    this.watchdog.unref?.();
  }

  close(): void {
    if (this.closed) return;
    if (this.inTimer) clearTimeout(this.inTimer);
    this.flushIn();
    this.flushOut();
    this.closed = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  private send(msg: Json): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(msg: Json): void {
    const b = this.bridge;
    if (!b) return;
    if (msg.setupComplete !== undefined) { this.started = true; return; }
    const content = msg.serverContent as Json | undefined;
    if (content) {
      const now = b.now();
      const turn = content.modelTurn as { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> } | undefined;
      for (const part of turn?.parts ?? []) {
        const inline = part.inlineData;
        if (!inline?.data || !/^audio\//.test(inline.mimeType ?? "")) continue;
        const pcm24k = bytesToInt16(new Uint8Array(Buffer.from(inline.data, "base64")));
        const bytes = mulawEncode(this.toCarrier.process(pcm24k));
        this.playbackEndMs = Math.max(now, this.playbackEndMs) + bytes.length / 8;
        if (hasAudiblePcm(pcm24k)) {
          this.outAudioStarted = true;
          if (this.outStartMs === undefined) this.outStartMs = now;
          this.outLastMs = now;
          this.touch();
        }
        b.sendAudio(bytes);
      }
      const inTr = content.inputTranscription as { text?: string } | undefined;
      if (inTr?.text) {
        if (this.inStartMs === undefined) { this.inStartMs = now; b.emit({ type: "speech.started", startMs: now }); }
        this.inText += inTr.text;
        this.inLastMs = now;
        this.touch();
        this.armInputFlush();
      }
      const outTr = content.outputTranscription as { text?: string } | undefined;
      if (outTr?.text) {
        if (this.outText === "" && this.outStartMs === undefined) this.outStartMs = now;
        this.outText += outTr.text;
        this.outLastMs = now;
      }
      if (content.interrupted === true) {
        // The callee spoke over the reply: drop what the carrier has buffered and mark the turn.
        this.outInterrupted = true;
        b.clearAudio();
        this.playbackEndMs = now;
        b.emit({ type: "interruption", atMs: now });
        this.flushOut();
      }
      if (content.turnComplete === true) this.flushOut();
      return;
    }
    const call = msg.toolCall as { functionCalls?: Array<{ id?: string; name?: string; args?: Json }> } | undefined;
    if (call?.functionCalls) { for (const fc of call.functionCalls) this.onToolCall(String(fc.id ?? ""), String(fc.name ?? ""), fc.args ?? {}); return; }
    const cancel = msg.toolCallCancellation as { ids?: string[] } | undefined;
    if (cancel?.ids) { for (const id of cancel.ids) this.pendingActions.delete(id); return; }
    if (msg.goAway !== undefined) {
      // The server will close the connection soon; the close handler reports the hangup.
      return;
    }
    if (msg.error !== undefined) {
      const err = msg.error as Json;
      b.emit({ type: "error", message: `Gemini Live: ${String(err.message ?? JSON.stringify(err)).slice(0, 300)}`, fatal: !this.started });
    }
  }

  private onToolCall(id: string, name: string, args: Json): void {
    const b = this.bridge;
    if (!b || !id) return;
    if (name === "end_call") {
      this.endRequested = String(args.reason ?? "agent_hangup");
      const note = this.opts.contract.language === "ja"
        ? (this.opts.contract.goal === "phone.message" ? "通話を終了します。相手のトーンに合わせて自然で温かい最後の挨拶を一言だけ言って終了してください。" : "通話を終了します。「ありがとうございました。失礼いたします」のような短い挨拶を一言だけ言って終了してください。")
        : "Say a warm, brief one-phrase goodbye; the line closes now.";
      this.send({ toolResponse: { functionResponses: [{ id, name, response: { ok: true, note } }] } });
      this.hangUpSoon(this.endRequested);
      return;
    }
    if (name === "request_action") {
      const action = String(args.action ?? "") as Action;
      this.pendingActions.set(id, { name, action });
      b.emit({ type: "action.requested", action, detail: String(args.detail ?? "") });
      return;
    }
    if (name === "check_table" || name === "book_table") { void this.askDesk(id, name, args); return; }
    this.send({ toolResponse: { functionResponses: [{ id, name, response: { error: "unknown tool" } }] } });
  }

  /** The reservation desk answers; the model only relays. A booking needs its values to have been said aloud first. */
  private async askDesk(id: string, tool: string, args: Json): Promise<void> {
    if (this.deskCalls.has(id)) return;
    this.deskCalls.add(id);
    const result = this.desk
      ? await deskTool(this.desk, tool, args ?? {}, [...this.said, this.outText], this.opts.today?.() ?? new Date(), this.opts.contract.language)
      : { status: "unavailable" as const };
    try { this.opts.onDesk?.({ type: tool === "book_table" ? "desk.book" : "desk.check", request: args ?? {}, result }); } catch { /* observers never break the call */ }
    if (this.closed) return;
    this.send({ toolResponse: { functionResponses: [{ id, name: tool, response: result as unknown as Json }] } });
  }

  private armInputFlush(): void {
    if (this.inTimer) clearTimeout(this.inTimer);
    this.inTimer = setTimeout(() => {
      const quietMs = (this.bridge?.now() ?? 0) - this.lastCalleeVoiceMs;
      const waitedMs = (this.bridge?.now() ?? 0) - this.inLastMs;
      if (!this.closed && quietMs < this.gapMs && waitedMs < 6000) this.armInputFlush();
      else this.flushIn();
    }, this.gapMs);
  }

  private flushIn(): void {
    const b = this.bridge;
    const text = this.inText.trim();
    const startMs = this.inStartMs;
    this.inText = "";
    this.inStartMs = undefined;
    if (!b || !text || startMs === undefined) return;
    this.lastCalleeEndMs = this.inLastMs;
    if (GOODBYE_RE.test(text) || HANGUP_REQUEST_RE.test(text)) {
      this.calleeSaidBye = true;
      if (b.now() - this.agentSaidByeMs < 15000) this.hangUpSoon("agent_hangup");
    }
    b.emit({ type: "speech", text, startMs, endMs: this.inLastMs, asr: { primary: 0.9 } });
  }

  private flushOut(): void {
    const b = this.bridge;
    const text = this.outText.trim();
    const startMs = this.outStartMs;
    const interrupted = this.outInterrupted;
    this.outText = "";
    this.outStartMs = undefined;
    this.outAudioStarted = false;
    this.outInterrupted = false;
    if (this.missionDeferred && !this.closed) this.sendMission();
    if (!b || !text || startMs === undefined) return;
    this.agentSpoke = true;
    this.said.push(text);
    const ev: Extract<SessionEvent, { type: "agent.speech" }> = { type: "agent.speech", text, startMs, endMs: this.outLastMs, ...(interrupted ? { interrupted: true } : {}) };
    if (this.lastCalleeEndMs !== undefined && startMs >= this.lastCalleeEndMs) ev.ttfaMs = startMs - this.lastCalleeEndMs;
    b.emit(ev);
    if (GOODBYE_RE.test(text)) {
      this.agentSaidByeMs = this.outLastMs;
      if (this.calleeSaidBye) this.hangUpSoon("agent_hangup");
    }
  }

  /** Both sides are done, or the model asked to end: let the goodbye finish playing, then close the line. */
  private hangUpSoon(reason: string): void {
    if (this.closed || this.hangingUp) return;
    this.hangingUp = true;
    const wait = Math.max(2500, this.playbackEndMs - (this.bridge?.now() ?? 0) + 300);
    setTimeout(() => { if (!this.closed) this.bridge?.emit({ type: "hangup", reason }); }, Math.min(wait, 6000)).unref?.();
  }
}
