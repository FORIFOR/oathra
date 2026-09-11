/**
 * Pipeline VoiceEngine — STT + (runtime brain) + TTS behind the VoiceEngine
 * protocol. The runtime still owns the dialogue: it receives `speech` events,
 * runs the BrainProvider, and calls `speak(text)`. This engine only turns
 * carrier audio into transcripts and reply text into carrier audio, with the
 * barge-in policy and acknowledgement fillers that made the phone feel human.
 */
import type { Language } from "@oathra/evidence";
import type { BrainProvider, SessionEvent, SpeechContext } from "@oathra/core";
import { frameMulaw, MULAW_FRAME_BYTES, mulawDurationMs } from "@oathra/audio-kit";
import { DeepgramSTT, type DeepgramLiveEvent, type DeepgramLiveSession } from "@oathra/deepgram";
import { OpenAITTS } from "@oathra/openai";
import { convert, MULAW_8K, OutputQueue, type AudioChunk, type VoiceEngine, type VoiceOutput, type VoiceSession, type VoiceSessionContext } from "@oathra/voice";

export type LiveSTTSession = Pick<DeepgramLiveSession, "open" | "send" | "on" | "close" | "finalize">;

export type PipelineSTT = { live(context: SpeechContext): LiveSTTSession };
export type PipelineTTS = {
  synthesizeMulaw8k(text: string, opts: { language: Language }): Promise<Uint8Array>;
  synthesizeMulaw8kStream?(text: string, opts: { language: Language }): AsyncIterable<Uint8Array>;
};

export type PipelineEngineOptions = {
  brain: BrainProvider;
  stt?: PipelineSTT;
  tts?: PipelineTTS;
  language?: Language;
  /** Vocabulary hints in addition to the callee name. */
  keywords?: string[];
  /** Ahead-of-real-time budget for streamed playback (ms). */
  leadMs?: number;
};

const BACKCHANNEL_RE = /^(?:はい|ええ|うん|ん|あ|え|あー|えー|えっと|そう|そうですね|なるほど|おー|お|はいはい|ok|okay|yes|yeah|yep|uh|um|mm|hmm|right|sure)+$/i;

/** True when a transcript fragment is real speech worth stopping playback for. */
export function isBargeIn(text: string, language: Language): boolean {
  const t = text.replace(/[\s、。,.!?！？「」]/g, "");
  if (!t) return false;
  if (BACKCHANNEL_RE.test(t)) return false;
  return language === "ja" ? t.length >= 4 : t.split(/\s+/).length >= 2 || t.length >= 8;
}

class PipelineVoiceSession implements VoiceSession {
  readonly output: AsyncIterable<VoiceOutput>;
  private readonly queue = new OutputQueue<VoiceOutput>();
  private stt: LiveSTTSession | undefined;
  private readonly language: Language;
  private closed = false;
  // STT segmenting
  private firstAudioMs: number | undefined;
  private segmentStartMs: number | undefined;
  private segmentFinals: Array<{ text: string; endMs: number; confidence: number }> = [];
  // Playback state
  private playing = false;
  private interrupted = false;
  private stopSending = false;
  private playStartMs: number | undefined;
  private fillers: Uint8Array[] = [];
  private fillerIdx = 0;

  constructor(
    private readonly opts: Required<Pick<PipelineEngineOptions, "stt" | "tts">> & PipelineEngineOptions,
    private readonly ctx: VoiceSessionContext,
    private readonly clock: { now(): number },
  ) {
    this.output = this.queue;
    this.language = ctx.language;
  }

  now(): number {
    return this.clock.now();
  }

  async start(): Promise<void> {
    const keywords = [...(this.ctx.calleeName ? [this.ctx.calleeName] : []), ...(this.opts.keywords ?? [])];
    const context: SpeechContext = { language: this.language, ...(keywords.length ? { keywords } : {}) };
    this.stt = this.opts.stt.live(context);
    this.stt.on((e) => this.onStt(e));
    await this.stt.open();
    void this.prepareFillers();
  }

  private async prepareFillers(): Promise<void> {
    const texts = this.language === "ja" ? ["はい。", "ええ。"] : ["Sure.", "Okay."];
    for (const t of texts) {
      try {
        this.fillers.push(await this.opts.tts.synthesizeMulaw8k(t, { language: this.language }));
      } catch {
        /* fillers are optional */
      }
    }
  }

  // ---- inbound -------------------------------------------------------------

  input(chunk: AudioChunk): void {
    if (this.closed || !this.stt) return;
    if (this.firstAudioMs === undefined) this.firstAudioMs = this.now();
    this.stt.send(convert(chunk, MULAW_8K).data);
  }

  /** Deepgram reports audio-relative times; anchor them to the call clock. */
  private audioToCallMs(ms: number): number {
    return (this.firstAudioMs ?? 0) + ms;
  }

  private onStt(e: DeepgramLiveEvent): void {
    switch (e.type) {
      case "speech_started":
        // VAD alone is too noise-prone to stop our playback; it only opens a segment.
        this.beginSegment(this.audioToCallMs(e.t));
        break;
      case "partial":
        this.beginSegment(this.audioToCallMs(e.startMs));
        this.maybeBargeIn(e.text);
        break;
      case "final":
        this.beginSegment(this.audioToCallMs(e.startMs));
        this.maybeBargeIn(e.text);
        this.segmentFinals.push({ text: e.text, endMs: this.audioToCallMs(e.endMs), confidence: e.confidence });
        if (e.speechFinal) this.flushSegment();
        break;
      case "utterance_end":
        this.flushSegment();
        break;
      case "error":
        this.emit({ type: "error", message: e.message, fatal: false });
        break;
      default:
        break;
    }
  }

  private emit(event: SessionEvent): void {
    this.queue.push({ type: "event", event });
  }

  private beginSegment(atMs: number): void {
    if (this.segmentStartMs !== undefined) return;
    this.segmentStartMs = atMs;
    this.emit({ type: "speech.started", startMs: atMs });
  }

  /**
   * Barge-in only for real speech: more than a backchannel and only after our
   * playback has been audible for a moment. Noise and nods never stop the agent.
   */
  private maybeBargeIn(text: string): void {
    if (!this.playing || this.interrupted) return;
    if (this.playStartMs !== undefined && this.now() - this.playStartMs < 500) return;
    if (!isBargeIn(text, this.language)) return;
    this.interrupt();
    this.emit({ type: "interruption", atMs: this.now() });
  }

  private flushSegment(): void {
    if (this.segmentStartMs === undefined || this.segmentFinals.length === 0) {
      this.segmentStartMs = undefined;
      this.segmentFinals = [];
      return;
    }
    const text = this.segmentFinals.map((f) => f.text).join(this.language === "ja" ? "" : " ").trim();
    const endMs = Math.max(...this.segmentFinals.map((f) => f.endMs));
    const confidence = this.segmentFinals.reduce((a, f) => a + f.confidence, 0) / this.segmentFinals.length;
    const startMs = this.segmentStartMs;
    this.segmentStartMs = undefined;
    this.segmentFinals = [];
    // A nod while we are talking is not a turn.
    if (this.playing && !this.interrupted && !isBargeIn(text, this.language)) return;
    if (text) this.emit({ type: "speech", text, startMs, endMs, asr: { primary: Number(confidence.toFixed(3)) } });
  }

  // ---- outbound ------------------------------------------------------------

  private pushAudio(mulaw: Uint8Array): void {
    this.queue.push({ type: "audio", chunk: { ...MULAW_8K, data: mulaw } });
  }

  ack(): void {
    if (this.closed || this.playing) return;
    const filler = this.fillers[this.fillerIdx++ % Math.max(1, this.fillers.length)];
    if (filler) this.pushAudio(filler);
  }

  async speak(text: string): Promise<{ startMs: number; endMs: number; interrupted: boolean }> {
    if (this.closed) return { startMs: this.now(), endMs: this.now(), interrupted: false };
    const tts = this.opts.tts;
    const lead = this.opts.leadMs ?? 400;
    this.playing = true;
    this.interrupted = false;
    this.stopSending = false;
    this.playStartMs = undefined;
    const startMs = this.now();
    let firstFrameMs: number | undefined;
    let sentMs = 0;
    let carry = new Uint8Array(0);
    const sendFrames = (bytes: Uint8Array) => {
      this.pushAudio(bytes);
      sentMs += mulawDurationMs(bytes);
      if (firstFrameMs === undefined) {
        firstFrameMs = this.now();
        this.playStartMs = firstFrameMs;
      }
    };
    const source: AsyncIterable<Uint8Array> = tts.synthesizeMulaw8kStream
      ? tts.synthesizeMulaw8kStream(text, { language: this.language })
      : (async function* (t, txt, language) {
          yield await t.synthesizeMulaw8k(txt, { language });
        })(tts, text, this.language);

    try {
      for await (const chunk of source) {
        if (this.stopSending) break;
        const buf = new Uint8Array(carry.length + chunk.length);
        buf.set(carry, 0);
        buf.set(chunk, carry.length);
        const whole = buf.length - (buf.length % MULAW_FRAME_BYTES);
        carry = buf.subarray(whole);
        for (const f of frameMulaw(buf.subarray(0, whole))) {
          if (this.stopSending) break;
          sendFrames(f);
          // Stay at most `lead` ms ahead of real time so a `clear` cuts playback short.
          const elapsed = this.now() - (firstFrameMs ?? this.now());
          if (sentMs - elapsed > lead) await new Promise((r) => setTimeout(r, 100));
        }
      }
      if (!this.stopSending && carry.length) {
        const last = new Uint8Array(MULAW_FRAME_BYTES).fill(0xff);
        last.set(carry, 0);
        sendFrames(last);
      }
    } catch (e) {
      this.emit({ type: "error", message: `tts: ${(e as Error).message}`, fatal: false });
    }
    // No carrier mark at this layer: wait until the queued audio has played out.
    if (!this.stopSending && firstFrameMs !== undefined) {
      const remaining = sentMs - (this.now() - firstFrameMs);
      if (remaining > 0) {
        await new Promise<void>((res) => {
          const t = setTimeout(res, remaining);
          const poll = setInterval(() => {
            if (this.stopSending) {
              clearTimeout(t);
              clearInterval(poll);
              res();
            }
          }, 50);
          setTimeout(() => clearInterval(poll), remaining + 10);
        });
      }
    }
    const endMs = this.now();
    this.playing = false;
    return { startMs: firstFrameMs ?? startMs, endMs, interrupted: this.interrupted };
  }

  interrupt(): void {
    if (!this.playing) return;
    this.interrupted = true;
    this.stopSending = true;
    this.queue.push({ type: "clear" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopSending = true;
    try {
      this.stt?.close();
    } catch {
      /* ignore */
    }
    this.queue.close();
  }
}

export function pipelineEngine(opts: PipelineEngineOptions): VoiceEngine {
  const stt = opts.stt ?? new DeepgramSTT();
  const tts = opts.tts ?? new OpenAITTS();
  return {
    id: "pipeline",
    label: `Pipeline (Deepgram + ${opts.brain.name} + OpenAI TTS)`,
    speaksItself: false,
    nativeAudio: MULAW_8K,
    requires: ["DEEPGRAM_API_KEY", "OPENAI_API_KEY"],
    async start(ctx: VoiceSessionContext, clock) {
      const session = new PipelineVoiceSession({ ...opts, stt, tts, language: opts.language ?? ctx.language }, { ...ctx, language: opts.language ?? ctx.language }, clock);
      await session.start();
      return session;
    },
  };
}
