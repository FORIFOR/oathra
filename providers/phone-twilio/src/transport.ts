/**
 * Twilio Direct — Programmable Voice Media Streams as a CarrierTransport.
 *
 * Carrier concerns only: dial via REST, host the bidirectional media
 * WebSocket, move μ-law 8 kHz in both directions, echo marks, clear on
 * barge-in, hang up, record. No STT, TTS or model logic lives here; the
 * Phone Layer bridge plugs any VoiceEngine on top.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { concatBytes, frameMulaw, mulawDecode, mulawDurationMs, mulawSilence, wavFromInt16, MULAW_SAMPLE_RATE } from "@oathra/audio-kit";
import type { CarrierEvent, CarrierMediaSession, CarrierTransport, DialOptions } from "@oathra/phone";
import { convert, MULAW_8K, OutputQueue, type AudioChunk, type AudioSpec } from "@oathra/voice";

export type TwilioDirectOptions = {
  accountSid: string;
  authToken: string;
  /** Caller ID (a Twilio number you own), E.164. */
  from: string;
  /** Public wss:// base URL that reaches this process (e.g. an ngrok tunnel). */
  publicWsUrl: string;
  port?: number;
  host?: string;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Skip the REST call and just wait for a media stream (tests / inbound). */
  placeCall?: boolean;
  /** Give up if Twilio has not connected the stream after this long. */
  connectTimeoutMs?: number;
};

type TwilioMessage =
  | { event: "connected"; protocol?: string }
  | { event: "start"; streamSid: string; start?: { callSid?: string; streamSid?: string } }
  | { event: "media"; media: { payload: string; track?: string; timestamp?: string } }
  | { event: "mark"; mark: { name: string } }
  | { event: "stop" }
  | { event: string };

export class TwilioDirectSession implements CarrierMediaSession {
  readonly audio: AudioSpec = MULAW_8K;
  readonly events: AsyncIterable<CarrierEvent>;
  private readonly queue = new OutputQueue<CarrierEvent>();
  private readonly startWall = Date.now();
  private wss: WebSocketServer | undefined;
  private socket: WsSocket | undefined;
  private streamSid: string | undefined;
  private callSid: string | undefined;
  private ended = false;
  private firstMediaMs: number | undefined;
  private readonly calleeChunks: Uint8Array[] = [];
  private readonly callerChunks: Array<{ atMs: number; bytes: Uint8Array }> = [];
  private hangupPromise: Promise<void> | undefined;

  constructor(
    private readonly opts: TwilioDirectOptions,
    private readonly recordDir: string | undefined,
  ) {
    this.events = this.queue;
  }

  now(): number {
    return Date.now() - this.startWall;
  }

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64")}`;
  }

  /** Start the media server, dial, and arm the no-stream timeout. */
  async start(to: string): Promise<void> {
    const port = this.opts.port ?? 4243;
    const host = this.opts.host ?? "0.0.0.0";
    this.wss = new WebSocketServer({ port, host, path: "/media" });
    await new Promise<void>((res, rej) => {
      this.wss!.once("listening", () => res());
      this.wss!.once("error", rej);
    });
    this.wss.on("connection", (socket) => this.attach(socket));

    if (this.opts.placeCall !== false) {
      const twiml = `<Response><Connect><Stream url="${this.opts.publicWsUrl.replace(/\/$/, "")}/media"/></Connect></Response>`;
      const body = new URLSearchParams({ To: to, From: this.opts.from, Twiml: twiml });
      const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls.json`, {
        method: "POST",
        headers: { authorization: this.authHeader, "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        await this.teardown();
        throw new Error(`Twilio ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as { sid?: string };
      this.callSid = data.sid;
    }

    const timeout = this.opts.connectTimeoutMs ?? 60_000;
    const timer = setTimeout(() => {
      if (!this.streamSid && !this.ended) {
        this.queue.push({ type: "error", message: `Twilio did not connect a media stream within ${timeout} ms (is ${this.opts.publicWsUrl} reachable?)`, fatal: true });
        void this.hangup("no_media_stream");
      }
    }, timeout);
    timer.unref();
  }

  private attach(socket: WsSocket): void {
    if (this.socket) {
      socket.close();
      return;
    }
    this.socket = socket;
    socket.on("message", (raw) => {
      let msg: TwilioMessage;
      try {
        msg = JSON.parse(raw.toString()) as TwilioMessage;
      } catch {
        return;
      }
      this.onTwilio(msg);
    });
    socket.on("close", () => {
      if (!this.ended) {
        this.queue.push({ type: "hangup", reason: "stream_closed" });
        void this.hangup("stream_closed");
      }
    });
  }

  private onTwilio(msg: TwilioMessage): void {
    switch (msg.event) {
      case "start": {
        const m = msg as Extract<TwilioMessage, { event: "start" }>;
        this.streamSid = m.streamSid ?? m.start?.streamSid;
        if (m.start?.callSid) this.callSid = m.start.callSid;
        this.queue.push({ type: "connected", ...(this.callSid ? { callId: this.callSid } : {}) });
        break;
      }
      case "media": {
        const m = msg as Extract<TwilioMessage, { event: "media" }>;
        if (m.media.track && m.media.track !== "inbound") break;
        const bytes = new Uint8Array(Buffer.from(m.media.payload, "base64"));
        if (this.firstMediaMs === undefined) this.firstMediaMs = this.now();
        if (this.recordDir) this.calleeChunks.push(bytes);
        this.queue.push({ type: "audio", chunk: { ...MULAW_8K, data: bytes } });
        break;
      }
      case "mark": {
        const m = msg as Extract<TwilioMessage, { event: "mark" }>;
        this.queue.push({ type: "mark", name: m.mark.name });
        break;
      }
      case "stop":
        if (!this.ended) {
          this.queue.push({ type: "hangup", reason: "callee_hangup" });
          void this.hangup("stop");
        }
        break;
      default:
        break;
    }
  }

  private sendJson(obj: unknown): void {
    const s = this.socket;
    if (s && s.readyState === s.OPEN) s.send(JSON.stringify(obj));
  }

  send(chunk: AudioChunk): void {
    if (this.ended || !this.streamSid) return;
    const mulaw = convert(chunk, MULAW_8K).data;
    for (const f of frameMulaw(mulaw)) {
      this.sendJson({ event: "media", streamSid: this.streamSid, media: { payload: Buffer.from(f).toString("base64") } });
    }
    if (this.recordDir) this.callerChunks.push({ atMs: this.now(), bytes: mulaw });
  }

  mark(name: string): void {
    if (this.ended || !this.streamSid) return;
    this.sendJson({ event: "mark", streamSid: this.streamSid, mark: { name } });
  }

  clear(): void {
    if (this.ended || !this.streamSid) return;
    this.sendJson({ event: "clear", streamSid: this.streamSid });
  }

  async hangup(reason?: string): Promise<void> {
    // A carrier `stop` event starts hangup asynchronously. Repeated callers
    // (the bridge and runtime both close a session) must await that same
    // promise so recordings are finished before the call outcome is saved.
    if (this.hangupPromise) return this.hangupPromise;
    this.ended = true;
    this.hangupPromise = this.finishHangup(reason);
    return this.hangupPromise;
  }

  private async finishHangup(reason?: string): Promise<void> {
    void reason;
    if (this.callSid && this.opts.placeCall !== false) {
      try {
        await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls/${this.callSid}.json`, {
          method: "POST",
          headers: { authorization: this.authHeader, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ Status: "completed" }),
        });
      } catch {
        /* best effort */
      }
    }
    this.writeRecordings();
    await this.teardown();
    this.queue.close();
  }

  private async teardown(): Promise<void> {
    this.socket?.close();
    await new Promise<void>((res) => (this.wss ? this.wss.close(() => res()) : res()));
  }

  private writeRecordings(): void {
    const dir = this.recordDir;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "callee.wav"), wavFromInt16(mulawDecode(concatBytes(this.calleeChunks)), MULAW_SAMPLE_RATE));
      // Caller track: place each chunk at its call-time offset relative to the first inbound byte.
      const base = this.firstMediaMs ?? 0;
      const parts: Uint8Array[] = [];
      let cursorMs = 0;
      for (const c of this.callerChunks.sort((a, b) => a.atMs - b.atMs)) {
        const at = Math.max(0, c.atMs - base);
        if (at > cursorMs) parts.push(mulawSilence(at - cursorMs));
        parts.push(c.bytes);
        cursorMs = Math.max(cursorMs, at) + mulawDurationMs(c.bytes);
      }
      writeFileSync(join(dir, "caller.wav"), wavFromInt16(mulawDecode(concatBytes(parts)), MULAW_SAMPLE_RATE));
    } catch {
      /* recordings are best effort */
    }
  }

  /** Twilio identifiers, once known. */
  get ids(): { callSid?: string; streamSid?: string } {
    return { ...(this.callSid ? { callSid: this.callSid } : {}), ...(this.streamSid ? { streamSid: this.streamSid } : {}) };
  }
}

export class TwilioDirectTransport implements CarrierTransport {
  readonly providerId = "twilio";
  readonly path = "direct" as const;
  lastSession: TwilioDirectSession | undefined;

  constructor(private readonly opts: TwilioDirectOptions) {}

  describe(): string {
    return `Twilio Media Streams from ${this.opts.from} via ${this.opts.publicWsUrl} (port ${this.opts.port ?? 4243})`;
  }

  async dial(opts: DialOptions): Promise<CarrierMediaSession> {
    const session = new TwilioDirectSession({ ...this.opts, ...(opts.callerId ? { from: opts.callerId } : {}) }, opts.recordDir);
    this.lastSession = session;
    await session.start(opts.to);
    return session;
  }
}
