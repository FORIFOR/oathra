/**
 * Twilio Direct — Programmable Voice Media Streams as a CarrierTransport.
 *
 * Carrier concerns only: dial via REST, host the bidirectional media
 * WebSocket, move μ-law 8 kHz in both directions, echo marks, clear on
 * barge-in, hang up, record. No STT, TTS or model logic lives here; the
 * Phone Layer bridge plugs any VoiceEngine on top.
 */
import type { IncomingMessage } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { concatBytes, frameMulaw, mulawDecode, mulawDurationMs, mulawSilence, wavFromInt16, MULAW_SAMPLE_RATE } from "@oathra/audio-kit";
import { recordingNotice } from "@oathra/core";
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
  | { event: "start"; streamSid: string; start?: { callSid?: string; streamSid?: string; accountSid?: string } }
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
  private readonly streamToken = randomBytes(32).toString("hex");
  private pendingStart: TwilioMessage | undefined;
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
  async start(to: string, language: "ja" | "en" = "ja"): Promise<void> {
    const port = this.opts.port ?? 4243;
    const host = this.opts.host ?? "0.0.0.0";
    const publicUrl = new URL(this.mediaUrl);
    if (publicUrl.protocol !== "wss:" || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error("Twilio media URL must be a public wss URL without query or credentials");
    this.wss = new WebSocketServer({ port, host, path: publicUrl.pathname, maxPayload: 65536,
      verifyClient: ({ req }: { req: IncomingMessage }) => !this.ended && req.url === publicUrl.pathname && this.validSignature(req.headers["x-twilio-signature"]),
    });
    await new Promise<void>((res, rej) => {
      this.wss!.once("listening", () => res());
      this.wss!.once("error", rej);
    });
    this.wss.on("connection", (socket) => this.attach(socket));

    if (this.opts.placeCall !== false) {
      // A recorded call says so first, in the carrier's own voice, before the model or the callee can say anything.
      // (The text is fixed and XML-safe; nothing user-supplied is interpolated here.)
      const notice = this.recordDir ? `<Say language="${language === "ja" ? "ja-JP" : "en-US"}">${recordingNotice(language)}</Say>` : "";
      if (this.recordDir) mkdirSync(this.recordDir, { recursive: true }), writeFileSync(join(this.recordDir, "recording-notice.json"), JSON.stringify({ text: recordingNotice(language), language, method: "carrier_tts_before_media_stream" }, null, 2));
      const twiml = `<Response>${notice}<Connect><Stream url="${this.mediaUrl}"/></Connect></Response>`;
      const body = new URLSearchParams({ To: to, From: this.opts.from, Twiml: twiml });
      try {
        const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls.json`, {
          method: "POST",
          headers: { authorization: this.authHeader, "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Twilio ${res.status}: ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as { sid?: string };
        if (!data.sid) throw new Error("Twilio call result unconfirmed: missing call identifier");
        this.callSid = data.sid;
        if (this.pendingStart) { const pending = this.pendingStart; this.pendingStart = undefined; this.onTwilio(pending); }
      } catch (error) {
        await this.teardown();
        throw error;
      }
    }

    const timeout = this.opts.connectTimeoutMs ?? 60_000;
    const timer = setTimeout(() => {
      if (!this.streamSid && !this.ended) {
        this.queue.push({ type: "error", message: `Twilio did not connect a media stream within ${timeout} ms (is ${this.opts.publicWsUrl} reachable?)`, fatal: true });
        void this.hangup("no_media_stream").catch(() => undefined);
      }
    }, timeout);
    timer.unref();
  }

  private attach(socket: WsSocket): void {
    if (this.socket || this.ended) {
      socket.close();
      return;
    }
    this.socket = socket;
    socket.on("error", () => socket.terminate());
    socket.on("message", (raw) => {
      let msg: TwilioMessage;
      try {
        msg = JSON.parse(raw.toString()) as TwilioMessage;
        if (!msg || typeof msg !== "object" || typeof msg.event !== "string") return;
      } catch {
        return;
      }
      this.onTwilio(msg);
    });
    socket.on("close", () => {
      if (this.socket === socket && !this.streamSid) { this.socket = undefined; this.pendingStart = undefined; }
      if (!this.ended && this.socket === socket && this.streamSid) {
        this.queue.push({ type: "hangup", reason: "stream_closed" });
        void this.hangup("stream_closed").catch(() => undefined);
      }
    });
  }

  private onTwilio(msg: TwilioMessage): void {
    if (this.ended || (msg.event !== "start" && !this.streamSid)) return;
    switch (msg.event) {
      case "start": {
        const m = msg as Extract<TwilioMessage, { event: "start" }>;
        if (this.streamSid) return;
        if (!this.callSid && this.opts.placeCall !== false) { this.pendingStart = m; return; }
        const streamSid = m.streamSid ?? m.start?.streamSid;
        if (typeof streamSid !== "string" || !streamSid || !m.start?.callSid || m.start.accountSid !== this.opts.accountSid || (this.callSid && m.start.callSid !== this.callSid)) {
          const rejected = this.socket;
          this.socket = undefined;
          rejected?.terminate();
          return;
        }
        this.streamSid = streamSid;
        // Only the explicitly local/inbound path may adopt its first authenticated SID.
        if (this.opts.placeCall === false) this.callSid = m.start.callSid;
        this.queue.push({ type: "connected", ...(this.callSid ? { callId: this.callSid } : {}) });
        break;
      }
      case "media": {
        const m = msg as Extract<TwilioMessage, { event: "media" }>;
        if (!m.media || typeof m.media.payload !== "string") return;
        if (m.media.track && m.media.track !== "inbound") break;
        const bytes = new Uint8Array(Buffer.from(m.media.payload, "base64"));
        if (this.firstMediaMs === undefined) this.firstMediaMs = this.now();
        if (this.recordDir) this.calleeChunks.push(bytes);
        this.queue.push({ type: "audio", chunk: { ...MULAW_8K, data: bytes } });
        break;
      }
      case "mark": {
        const m = msg as Extract<TwilioMessage, { event: "mark" }>;
        if (!m.mark || typeof m.mark.name !== "string") return;
        this.queue.push({ type: "mark", name: m.mark.name });
        break;
      }
      case "stop":
        if (!this.ended) {
          this.queue.push({ type: "hangup", reason: "callee_hangup" });
          void this.hangup("stop").catch(() => undefined);
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
    let terminationError: Error | undefined;
    if (this.callSid && this.opts.placeCall !== false) {
      try {
        const response = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls/${this.callSid}.json`, {
          method: "POST",
          headers: { authorization: this.authHeader, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ Status: "completed" }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) terminationError = new Error(`Twilio termination unconfirmed: HTTP ${response.status}`);
      } catch {
        terminationError = new Error("Twilio termination unconfirmed: network error");
      }
    }
    this.writeRecordings();
    await this.teardown();
    this.queue.close();
    if (terminationError) throw terminationError;
  }

  private async teardown(): Promise<void> {
    this.socket?.terminate();
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

  /** Per-session unguessable URL supplied to Twilio; never put in public logs. */
  get mediaUrl(): string { return `${this.opts.publicWsUrl.replace(/\/$/, "")}/media/${this.streamToken}`; }

  private validSignature(signature: string | string[] | undefined): boolean {
    if (typeof signature !== "string") return false;
    const supplied = Buffer.from(signature, "base64");
    // WebSocket upgrade is an HTTPS GET (no form fields). Twilio documents a
    // trailing-slash variant for WSS handshakes. Never trust proxy Host headers.
    const urls = [this.mediaUrl, this.mediaUrl.replace(/^wss:/, "https:")];
    return urls.some(url => [url, `${url}/`].some(value => {
      const expected = createHmac("sha1", this.opts.authToken).update(value).digest();
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    }));
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
    await session.start(opts.to, opts.language);
    return session;
  }
}
