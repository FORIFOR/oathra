/**
 * @oathra/deepgram — Deepgram streaming STT.
 *
 * `DeepgramLiveSession` is the push-style primitive a transport uses
 * (send μ-law bytes, get partial/final/utterance_end/speech_started events).
 * `DeepgramSTT` wraps it as the core `STTProvider` protocol.
 */
import type { AudioFrame, SpeechContext, STTProvider, TranscriptEvent } from "@oathra/core";
import type { Language } from "@oathra/evidence";
import { mulawEncode, resample, MULAW_SAMPLE_RATE } from "@oathra/audio-kit";

export type DeepgramLiveOptions = {
  apiKey?: string;
  language?: Language;
  model?: string;
  /** Input encoding sent on the socket. */
  encoding?: "mulaw" | "linear16";
  sampleRate?: number;
  /** Deepgram endpointing in ms (silence that closes a final). */
  endpointingMs?: number;
  utteranceEndMs?: number;
  /** Vocabulary hints (Deepgram `keyterm`). */
  keywords?: string[];
  baseUrl?: string;
  /** Injectable WebSocket constructor for tests. */
  WebSocketImpl?: typeof WebSocket;
};

export type DeepgramLiveEvent =
  | { type: "open" }
  | { type: "speech_started"; t: number }
  | { type: "partial"; text: string; startMs: number; endMs: number; confidence: number }
  | { type: "final"; text: string; startMs: number; endMs: number; confidence: number; speechFinal: boolean }
  | { type: "utterance_end"; lastWordEndMs: number }
  | { type: "error"; message: string }
  | { type: "close"; code: number; reason: string };

type DeepgramMessage = {
  type?: string;
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
  timestamp?: number;
  last_word_end?: number;
  description?: string;
  message?: string;
};

export class DeepgramLiveSession {
  private ws: WebSocket | undefined;
  private readonly listeners = new Set<(e: DeepgramLiveEvent) => void>();
  private readonly opts: Required<Pick<DeepgramLiveOptions, "language" | "model" | "encoding" | "sampleRate" | "endpointingMs" | "utteranceEndMs" | "baseUrl">> & DeepgramLiveOptions;
  private keepAlive: NodeJS.Timeout | undefined;
  private closed = false;
  private openPromise: Promise<void> | undefined;

  constructor(opts: DeepgramLiveOptions = {}) {
    this.opts = {
      ...opts,
      language: opts.language ?? "ja",
      model: opts.model ?? "nova-3",
      encoding: opts.encoding ?? "mulaw",
      sampleRate: opts.sampleRate ?? MULAW_SAMPLE_RATE,
      endpointingMs: opts.endpointingMs ?? 300,
      utteranceEndMs: opts.utteranceEndMs ?? 1000,
      baseUrl: opts.baseUrl ?? "wss://api.deepgram.com/v1/listen",
    };
  }

  url(): string {
    const p = new URLSearchParams({
      model: this.opts.model,
      language: this.opts.language,
      encoding: this.opts.encoding,
      sample_rate: String(this.opts.sampleRate),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      endpointing: String(this.opts.endpointingMs),
      utterance_end_ms: String(this.opts.utteranceEndMs),
      vad_events: "true",
    });
    for (const k of this.opts.keywords ?? []) p.append("keyterm", k);
    return `${this.opts.baseUrl}?${p.toString()}`;
  }

  /** Open the socket. Resolves once Deepgram accepts the connection. */
  open(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    const apiKey = this.opts.apiKey ?? process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set. Get one at https://console.deepgram.com/");
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    // Node's WebSocket cannot set headers; Deepgram accepts the key as a subprotocol.
    const ws = new Impl(this.url(), ["token", apiKey]);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    this.openPromise = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => {
        this.emit({ type: "open" });
        this.keepAlive = setInterval(() => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
        }, 5000);
        resolve();
      });
      ws.addEventListener("error", () => {
        this.emit({ type: "error", message: "Deepgram websocket error" });
        reject(new Error("Deepgram websocket error"));
      });
      ws.addEventListener("close", (ev) => {
        if (this.keepAlive) clearInterval(this.keepAlive);
        this.closed = true;
        this.emit({ type: "close", code: ev.code, reason: ev.reason });
      });
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") return;
        let msg: DeepgramMessage;
        try {
          msg = JSON.parse(ev.data) as DeepgramMessage;
        } catch {
          return;
        }
        this.handle(msg);
      });
    });
    return this.openPromise;
  }

  private handle(msg: DeepgramMessage): void {
    switch (msg.type) {
      case "SpeechStarted":
        this.emit({ type: "speech_started", t: Math.round((msg.timestamp ?? 0) * 1000) });
        break;
      case "Results": {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript ?? "").trim();
        const startMs = Math.round((msg.start ?? 0) * 1000);
        const endMs = Math.round(((msg.start ?? 0) + (msg.duration ?? 0)) * 1000);
        const confidence = alt?.confidence ?? 0;
        if (!text) return;
        if (msg.is_final) this.emit({ type: "final", text, startMs, endMs, confidence, speechFinal: Boolean(msg.speech_final) });
        else this.emit({ type: "partial", text, startMs, endMs, confidence });
        break;
      }
      case "UtteranceEnd":
        this.emit({ type: "utterance_end", lastWordEndMs: Math.round((msg.last_word_end ?? 0) * 1000) });
        break;
      case "Error":
        this.emit({ type: "error", message: msg.description ?? msg.message ?? "Deepgram error" });
        break;
      default:
        break;
    }
  }

  /** Push audio bytes in the configured encoding. */
  send(bytes: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(bytes);
  }

  /** Ask Deepgram to flush pending results. */
  finalize(): void {
    const ws = this.ws;
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "Finalize" }));
  }

  on(listener: (e: DeepgramLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: DeepgramLiveEvent): void {
    for (const l of this.listeners) l(e);
  }

  close(): void {
    if (this.closed) return;
    if (this.keepAlive) clearInterval(this.keepAlive);
    const ws = this.ws;
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        /* ignore */
      }
      ws.close();
    }
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export type DeepgramSTTOptions = Omit<DeepgramLiveOptions, "language" | "keywords" | "encoding" | "sampleRate">;

/** Core STTProvider: consumes AudioFrames (any rate) and yields TranscriptEvents. */
export class DeepgramSTT implements STTProvider {
  readonly name = "deepgram";
  constructor(private readonly opts: DeepgramSTTOptions = {}) {}

  /** Factory used by transports that push μ-law directly. */
  live(context: SpeechContext): DeepgramLiveSession {
    return new DeepgramLiveSession({
      ...this.opts,
      language: context.language,
      ...(context.keywords ? { keywords: context.keywords } : {}),
      encoding: "mulaw",
      sampleRate: MULAW_SAMPLE_RATE,
    });
  }

  async *stream(audio: AsyncIterable<AudioFrame>, context: SpeechContext): AsyncIterable<TranscriptEvent> {
    const session = this.live(context);
    const queue: TranscriptEvent[] = [];
    let waiter: (() => void) | undefined;
    let done = false;
    const push = (e: TranscriptEvent) => {
      queue.push(e);
      waiter?.();
    };
    session.on((e) => {
      if (e.type === "partial") push({ type: "partial", text: e.text, t: e.endMs });
      else if (e.type === "final") push({ type: "final", text: e.text, startMs: e.startMs, endMs: e.endMs, confidence: e.confidence });
      else if (e.type === "close") {
        done = true;
        waiter?.();
      }
    });
    await session.open();
    void (async () => {
      try {
        for await (const frame of audio) {
          const pcm = frame.sampleRate === MULAW_SAMPLE_RATE ? frame.samples : resample(frame.samples, frame.sampleRate, MULAW_SAMPLE_RATE);
          session.send(mulawEncode(pcm));
        }
      } finally {
        session.finalize();
        setTimeout(() => session.close(), 1500);
      }
    })();
    while (!done || queue.length) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((r) => (waiter = r));
      waiter = undefined;
    }
  }
}
